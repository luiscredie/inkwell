-- Pacote 1, item 5 (PR #153): add a whole deck
-- to the collection, and an Undo that can
-- never take the same copies out twice.
--
-- Each add is an OPERATION with an id made by
-- the page (a uuid). The database keeps what
-- that operation put in (card, finish, qty),
-- for 1 day:
--
--  add_collection_op(profile, delta, op)
--    adds the copies and records the op, in
--    one transaction. The same op again (a
--    retry after a lost answer) adds nothing.
--
--  undo_collection_op(op)
--    takes out exactly what THAT op put in,
--    once. It receives only the op id, never
--    quantities. Again: already_undone.
--    Copies removed meanwhile: collection_
--    changed, nothing changes. Copies added
--    meanwhile stay.
--
-- Both lock the collection row (for update),
-- like private.collection_delta_for, so two
-- requests (two taps, two devices) run one
-- after the other.
--
-- Counts, not copies: the collection keeps
-- how many normal and foil copies of each
-- card there are (no id per physical copy).
-- A collection changed and then put back to
-- the same numbers can be undone.
--
-- New: table private.collection_ops,
-- functions public.add_collection_op and
-- public.undo_collection_op. Existing tables
-- and functions are not changed.
-- Production gives anon EXECUTE on new
-- functions by default: the revokes below
-- take it back (do not drop them).
-- Safe to run again. One transaction.

begin;

-- an earlier draft of this file (never run
-- in production); gone if it was
drop function if exists
  public.undo_collection_delta(text, jsonb);

-- ---------- the operations ----------------
-- user, collection, what was added, when.
-- No e-mail, no names. Kept 1 day; gone with
-- the account.
create table if not exists
  private.collection_ops (
  op_id uuid primary key,
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  profile text not null,
  delta jsonb not null,
  created_at timestamptz not null
    default now(),
  undone_at timestamptz);
alter table private.collection_ops
  enable row level security;
revoke all on private.collection_ops
  from public, anon, authenticated;
create index if not exists
  collection_ops_created
  on private.collection_ops (created_at);

-- ---------- checking a delta --------------
-- a list of 1 to 400 items, each a card id
-- (1 to 40 letters), a whole qty from 1 to
-- 999 and foil true or false
create or replace function
  private.collection_op_delta(p jsonb)
returns jsonb
language plpgsql immutable
set search_path = '' as $$
declare e jsonb; out jsonb := '[]';
begin
  if jsonb_typeof(p) is distinct from
       'array'
     or jsonb_array_length(p) = 0
     or jsonb_array_length(p) > 400 then
    raise exception 'bad delta';
  end if;
  for e in select * from
      jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object'
       or coalesce(e->>'card_id', '') = ''
       or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number'
       or (e->>'qty') !~ '^[1-9][0-9]{0,2}$'
       or coalesce(jsonb_typeof(e->'foil'),
            'boolean') <> 'boolean' then
      raise exception 'bad delta item';
    end if;
    out := out || jsonb_build_array(
      jsonb_build_object(
        'card_id', e->>'card_id',
        'qty', (e->>'qty')::int,
        'foil', coalesce(
          (e->>'foil')::boolean, false)));
  end loop;
  return out;
end $$;
revoke all on function
  private.collection_op_delta(jsonb)
  from public, anon, authenticated;

-- ---------- add ---------------------------
create or replace function
  public.add_collection_op(
    p_profile text, p_delta jsonb,
    p_op uuid)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  u uuid := auth.uid();
  dl jsonb; prev private.collection_ops;
begin
  if u is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'bad op';
  end if;
  dl := private.collection_op_delta(p_delta);
  -- the collection row first (same order
  -- as the undo: no deadlock)
  perform 1 from public.inkwell_profiles
   where user_id = u and profile = p_profile
   for update;
  if not found then
    raise exception 'profile not found';
  end if;
  select * into prev
    from private.collection_ops
   where op_id = p_op for update;
  if found then
    -- a retry of the same add: nothing more;
    -- the same id for something else: no
    if prev.user_id = u
       and prev.profile = p_profile
       and prev.delta = dl then
      return jsonb_build_object(
        'status', 'already_applied');
    end if;
    raise exception 'op_conflict';
  end if;
  perform private.collection_delta_for(
    u, p_profile, dl);
  insert into private.collection_ops
    (op_id, user_id, profile, delta)
  values (p_op, u, p_profile, dl);
  delete from private.collection_ops
   where created_at
     < now() - interval '1 day';
  return jsonb_build_object(
    'status', 'applied');
end $$;
revoke all on function
  public.add_collection_op(text, jsonb, uuid)
  from public, anon;
grant execute on function
  public.add_collection_op(text, jsonb, uuid)
  to authenticated;

-- ---------- undo --------------------------
create or replace function
  public.undo_collection_op(p_op uuid)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  u uuid := auth.uid();
  o private.collection_ops;
  d jsonb; e jsonb; cur jsonb;
  k text; have int; q int;
begin
  if u is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'bad op';
  end if;
  -- whose op it is, without locking yet
  select * into o
    from private.collection_ops
   where op_id = p_op;
  if not found or o.user_id <> u then
    raise exception 'op_not_found';
  end if;
  -- the collection row, then the op again,
  -- both locked: a second undo waits here
  select data into d
    from public.inkwell_profiles
   where user_id = u and profile = o.profile
   for update;
  if d is null then
    raise exception 'profile not found';
  end if;
  select * into o
    from private.collection_ops
   where op_id = p_op for update;
  if o.undone_at is not null then
    raise exception 'already_undone';
  end if;
  if o.created_at
     < now() - interval '10 minutes' then
    raise exception 'undo_expired';
  end if;
  d := jsonb_set(d, '{collection}',
    coalesce(d->'collection', '{}'::jsonb));
  for e in select * from
      jsonb_array_elements(o.delta) loop
    q := (e->>'qty')::int;
    k := case when (e->>'foil')::boolean
      then 'f' else 'n' end;
    cur := coalesce(
      d->'collection'->(e->>'card_id'),
      '{"n": 0, "f": 0}'::jsonb);
    have := coalesce((cur->>k)::int, 0);
    if have < q then
      raise exception 'collection_changed'
        using detail = (e->>'card_id')
          || ' ' || k || ' ' || have
          || ' < ' || q;
    end if;
    cur := jsonb_set(cur, array[k],
      to_jsonb(have - q));
    d := jsonb_set(d, array['collection',
      e->>'card_id'], cur);
  end loop;
  update public.inkwell_profiles
     set data = d, revision = revision + 1,
         updated_at = now()
   where user_id = u and profile = o.profile;
  update private.collection_ops
     set undone_at = now()
   where op_id = p_op;
  return jsonb_build_object(
    'status', 'undone');
end $$;
revoke all on function
  public.undo_collection_op(uuid)
  from public, anon;
grant execute on function
  public.undo_collection_op(uuid)
  to authenticated;

commit;
