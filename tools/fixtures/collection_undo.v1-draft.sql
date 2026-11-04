-- Pacote 1, item 5 (PR #153): an atomic Undo
-- for "Adicionar deck à coleção".
--
-- Takes out EXACTLY the copies an add put in,
-- in one transaction, and only if every one of
-- them is still there. Otherwise it changes
-- nothing and fails with collection_changed:
-- copies removed later (here or on another
-- device) are never taken out twice, and
-- copies added later stay.
--
-- The row is locked (for update) like
-- private.collection_delta_for does, so the
-- check and the removal cannot be split by a
-- change from another device.
--
-- Counts, not copies: a collection keeps how
-- many normal and foil copies of each card
-- there are (no id per physical copy), so
-- the undo takes out N of that card and
-- finish, whichever copies those are.
--
-- The trigger inkwell_profiles_collection_
-- added only stamps increases: the undo adds
-- no stamp; cards added and then undone may
-- still show as "added recently" in Coleção
-- (as after any manual removal).
--
-- New: public.undo_collection_delta(text,
--   jsonb). Nothing else changes.
-- Production gives anon EXECUTE on new
-- functions by default: the revoke below
-- takes it back (do not drop it).
-- Safe to run again.

create or replace function
  public.undo_collection_delta(
    p_profile text, p_delta jsonb)
returns void
language plpgsql security definer
set search_path = '' as $$
declare
  u uuid := auth.uid();
  d jsonb; e jsonb; cur jsonb;
  k text; have int; q int;
begin
  if u is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_delta) <> 'array'
     or jsonb_array_length(p_delta) = 0
     or jsonb_array_length(p_delta) > 400 then
    raise exception 'bad delta';
  end if;
  -- the caller's own collection, locked
  select data into d
    from public.inkwell_profiles
   where user_id = u and profile = p_profile
   for update;
  if d is null then
    raise exception 'profile not found';
  end if;
  d := jsonb_set(d, '{collection}',
    coalesce(d->'collection', '{}'::jsonb));
  for e in select * from
      jsonb_array_elements(p_delta) loop
    -- qty: how many to take out, a whole
    -- number above zero
    if coalesce(e->>'card_id', '') = ''
       or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number'
       or (e->>'qty') !~ '^[1-9][0-9]{0,2}$'
    then
      raise exception 'bad delta item';
    end if;
    q := (e->>'qty')::int;
    k := case when coalesce(
      (e->>'foil')::boolean, false)
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
   where user_id = u and profile = p_profile;
end $$;

revoke all on function
  public.undo_collection_delta(text, jsonb)
  from public, anon;
grant execute on function
  public.undo_collection_delta(text, jsonb)
  to authenticated;
