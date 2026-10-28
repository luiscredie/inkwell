-- Pasta de trocas (trade binder): a third
-- place for your cards, besides the binder
-- (Fichário) and home (Casa). Like home, it
-- keeps how many copies of each card are
-- there; the binder is what is left.
-- One call moves cards between the places:
-- collection_move(owner, profile, delta,
-- home, trade). owner null = your own; a
-- shared collection needs "can change".
-- Never more at home + in trades than owned.
-- Run after collection_shares.sql (safe to
-- run again).

create table if not exists
  public.collection_trade (
  user_id uuid not null default auth.uid()
    references auth.users(id)
    on delete cascade,
  profile text not null,
  card_id text not null
    check (length(card_id) between 1 and 40),
  n int not null default 0 check (n >= 0),
  f int not null default 0 check (f >= 0),
  updated_at timestamptz not null
    default now(),
  primary key (user_id, profile, card_id));
alter table public.collection_trade
  enable row level security;
drop policy if exists "owners read trade cards"
  on public.collection_trade;
create policy "owners read trade cards"
  on public.collection_trade for select
  to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.collection_trade
  from anon, authenticated;
grant select on public.collection_trade
  to authenticated;

-- add/remove copies in one place (home or
-- trade); a negative count is refused
create or replace function
  private.stock_apply(p_tbl text, u uuid,
    p_profile text, p_items jsonb)
returns text[]
language plpgsql security definer
set search_path = '' as $$
declare e jsonb; k text; q int; n int;
  ids text[] := '{}';
begin
  if p_tbl not in ('collection_home',
       'collection_trade') then
    raise exception 'bad place';
  end if;
  p_items := coalesce(p_items, '[]');
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) > 400 then
    raise exception 'bad %', p_tbl;
  end if;
  for e in select * from
      jsonb_array_elements(p_items) loop
    if coalesce(e->>'card_id', '') = ''
       or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number'
    then
      raise exception 'bad item';
    end if;
    k := case when coalesce(
      (e->>'foil')::boolean, false)
      then 'f' else 'n' end;
    q := (e->>'qty')::int;
    execute format('update public.%I'
      || ' set %I = %I + $1,'
      || ' updated_at = now()'
      || ' where user_id = $2'
      || ' and profile = $3'
      || ' and card_id = $4', p_tbl, k, k)
      using q, u, p_profile, e->>'card_id';
    get diagnostics n = row_count;
    if n = 0 then
      if q < 0 then
        raise exception 'not there: %',
          e->>'card_id';
      end if;
      execute format('insert into public.%I'
        || ' (user_id, profile, card_id,'
        || ' n, f) values ($1, $2, $3,'
        || ' $4, $5)', p_tbl)
        using u, p_profile, e->>'card_id',
          case when k = 'n' then q else 0 end,
          case when k = 'f' then q else 0 end;
    end if;
    ids := ids || (e->>'card_id');
  end loop;
  return ids;
end $$;
revoke all on function private.stock_apply(
  text, uuid, text, jsonb) from public;

create or replace function
  private.collection_move_for(u uuid,
    p_profile text, p_delta jsonb,
    p_home jsonb, p_trade jsonb)
returns void
language plpgsql security definer
set search_path = '' as $$
declare ids text[] := '{}'; bad text;
begin
  p_delta := coalesce(p_delta, '[]');
  if jsonb_array_length(p_delta) > 0 then
    perform private.collection_delta_for(
      u, p_profile, p_delta);
  end if;
  ids := private.stock_apply(
      'collection_home', u, p_profile, p_home)
    || private.stock_apply(
      'collection_trade', u, p_profile, p_trade)
    || array(select x->>'card_id'
      from jsonb_array_elements(p_delta) x);
  -- home + trade never more than owned
  select c.key into bad
    from public.inkwell_profiles p
   cross join lateral (
     select x as key from unnest(ids) x) c
   left join public.collection_home h
     on h.user_id = u
    and h.profile = p_profile
    and h.card_id = c.key
   left join public.collection_trade t
     on t.user_id = u
    and t.profile = p_profile
    and t.card_id = c.key
   where p.user_id = u
     and p.profile = p_profile
     and (coalesce(h.n, 0) + coalesce(t.n, 0)
           > coalesce((p.data->'collection'
             ->c.key->>'n')::int, 0)
       or coalesce(h.f, 0) + coalesce(t.f, 0)
           > coalesce((p.data->'collection'
             ->c.key->>'f')::int, 0))
   limit 1;
  if bad is not null then
    raise exception
      'more placed than owned: %', bad;
  end if;
  delete from public.collection_home
   where user_id = u and profile = p_profile
     and card_id = any(ids)
     and n = 0 and f = 0;
  delete from public.collection_trade
   where user_id = u and profile = p_profile
     and card_id = any(ids)
     and n = 0 and f = 0;
end $$;
revoke all on function
  private.collection_move_for(uuid, text,
    jsonb, jsonb, jsonb) from public;

-- the old calls keep working, now also
-- counting what is in the trade binder
create or replace function
  private.collection_change_for(
    u uuid, p_profile text,
    p_delta jsonb, p_home jsonb)
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  perform private.collection_move_for(
    u, p_profile, p_delta, p_home, '[]');
end $$;

create or replace function
  public.collection_move(p_owner uuid,
    p_profile text, p_delta jsonb,
    p_home jsonb, p_trade jsonb)
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if p_owner is not null
     and p_owner <> auth.uid()
     and not exists (
       select 1 from public.collection_shares
        where owner = p_owner
          and profile = p_profile
          and member = auth.uid()
          and can_edit) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  perform private.collection_move_for(
    coalesce(p_owner, auth.uid()), p_profile,
    p_delta, p_home, p_trade);
end $$;
revoke all on function public.collection_move(
  uuid, text, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function
  public.collection_move(uuid, text, jsonb,
    jsonb, jsonb) to authenticated;

-- shared collections also show the trade
-- binder
create or replace function
  public.shared_collections()
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'owner', s.owner,
    'owner_name', pr.display_name,
    'profile', s.profile,
    'can_edit', s.can_edit,
    'updated_at', ip.updated_at,
    'collection', coalesce(
      ip.data->'collection', '{}'::jsonb),
    'home', coalesce((
      select jsonb_agg(jsonb_build_object(
        'card_id', h.card_id,
        'n', h.n, 'f', h.f))
        from public.collection_home h
       where h.user_id = s.owner
         and h.profile = s.profile),
      '[]'::jsonb),
    'trade', coalesce((
      select jsonb_agg(jsonb_build_object(
        'card_id', t.card_id,
        'n', t.n, 'f', t.f))
        from public.collection_trade t
       where t.user_id = s.owner
         and t.profile = s.profile),
      '[]'::jsonb))
    order by s.created_at), '[]'::jsonb)
    from public.collection_shares s
    join public.inkwell_profiles ip
      on ip.user_id = s.owner
     and ip.profile = s.profile
    left join public.profiles pr
      on pr.user_id = s.owner
   where s.member = auth.uid();
$$;

-- renaming / deleting a collection takes its
-- trade binder along
create or replace function
  public.rename_collection(
    p_profile text, p_name text)
returns void
language plpgsql security definer
set search_path = '' as $$
declare u uuid := auth.uid();
begin
  p_name := btrim(coalesce(p_name, ''));
  if length(p_name) not between 1 and 40
     or p_name like 'share:%' then
    raise exception 'bad_name';
  end if;
  if p_name = p_profile then return; end if;
  update public.inkwell_profiles
     set profile = p_name, updated_at = now()
   where user_id = u and profile = p_profile;
  if not found then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  update public.collection_home
     set profile = p_name
   where user_id = u and profile = p_profile;
  update public.collection_trade
     set profile = p_name
   where user_id = u and profile = p_profile;
  update public.collection_added
     set profile = p_name
   where user_id = u and profile = p_profile;
exception when unique_violation then
  raise exception 'name_taken';
end $$;

create or replace function
  public.delete_collection(p_profile text)
returns void
language plpgsql security definer
set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if (select count(*)
        from public.inkwell_profiles
       where user_id = u) < 2 then
    raise exception 'last_collection';
  end if;
  delete from public.collection_home
   where user_id = u and profile = p_profile;
  delete from public.collection_trade
   where user_id = u and profile = p_profile;
  delete from public.collection_added
   where user_id = u and profile = p_profile;
  delete from public.inkwell_profiles
   where user_id = u and profile = p_profile;
  if not found then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
end $$;

-- "Baixar meus dados": + the trade binder
create or replace function
  public.my_data_export()
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare u uuid := auth.uid();
begin
  return private.my_data_export_base()
    || jsonb_build_object(
    'collection_shares', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_shares x
       where u in (x.owner, x.member)),
      '[]'),
    'collection_share_links', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_share_invites x
       where x.owner = u), '[]'),
    'collection_privacy', (
      select to_jsonb(x)
        from public.collection_privacy x
       where x.user_id = u),
    'cards_in_trade_binder', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_trade x
       where x.user_id = u), '[]'));
end $$;
