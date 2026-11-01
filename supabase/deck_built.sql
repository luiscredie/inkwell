-- Decks montados: a place for the copies that
-- are in a deck you built for real, besides
-- the binder (Fichário), home (Casa) and the
-- trade binder (Trocas). Per deck: "Montei
-- este deck" takes its cards out of the
-- binder (and home, when the binder is
-- short); "Desmontei" puts them back in the
-- binder. Never more at home + in trades +
-- in decks than owned.
-- A shared collection works too (who can
-- change it can build from it).
-- Run after trade_binder.sql (safe to run
-- again).

create table if not exists
  public.collection_decked (
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  profile text not null,
  deck_id text not null
    check (length(deck_id) between 1 and 80),
  deck_name text not null default ''
    check (length(deck_name) <= 80),
  built_by uuid
    references auth.users(id)
    on delete set null,
  card_id text not null
    check (length(card_id) between 1 and 40),
  n int not null default 0 check (n >= 0),
  f int not null default 0 check (f >= 0),
  updated_at timestamptz not null
    default now(),
  primary key (user_id, profile, deck_id,
    card_id));
alter table public.collection_decked
  enable row level security;
drop policy if exists "owners read deck cards"
  on public.collection_decked;
create policy "owners read deck cards"
  on public.collection_decked for select
  to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.collection_decked
  from anon, authenticated;
grant select on public.collection_decked
  to authenticated;

-- moves between places now count the decks
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
   left join (select card_id, sum(n) n,
       sum(f) f
       from public.collection_decked
      where user_id = u
        and profile = p_profile
      group by card_id) k
     on k.card_id = c.key
   where p.user_id = u
     and p.profile = p_profile
     and (coalesce(h.n, 0) + coalesce(t.n, 0)
           + coalesce(k.n, 0)
           > coalesce((p.data->'collection'
             ->c.key->>'n')::int, 0)
       or coalesce(h.f, 0) + coalesce(t.f, 0)
           + coalesce(k.f, 0)
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

-- build (or rebuild) one deck: p_items are
-- the copies in it [{card_id, n, f}];
-- p_from_home the copies taken from home
-- [{card_id, qty, foil}] (the rest come out of
-- the binder). Empty p_items = taken apart:
-- the copies go back to the binder.
create or replace function public.build_deck(
  p_owner uuid, p_profile text,
  p_deck text, p_name text,
  p_items jsonb, p_from_home jsonb)
returns void
language plpgsql security definer
set search_path = '' as $$
declare u uuid; e jsonb; ids text[];
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  u := coalesce(p_owner, auth.uid());
  if u <> auth.uid() and not exists (
       select 1 from public.collection_shares
        where owner = u
          and profile = p_profile
          and member = auth.uid()
          and can_edit) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  if coalesce(p_deck, '') = ''
     or length(p_deck) > 80 then
    raise exception 'bad deck';
  end if;
  p_items := coalesce(p_items, '[]');
  p_from_home := coalesce(p_from_home, '[]');
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) > 400 then
    raise exception 'bad items';
  end if;
  ids := array(select card_id
    from public.collection_decked
   where user_id = u and profile = p_profile
     and deck_id = p_deck);
  delete from public.collection_decked
   where user_id = u and profile = p_profile
     and deck_id = p_deck;
  -- copies taken from home leave home
  ids := ids || private.stock_apply(
    'collection_home', u, p_profile,
    (select coalesce(jsonb_agg(x
      || jsonb_build_object('qty',
        -abs((x->>'qty')::int))), '[]')
       from jsonb_array_elements(p_from_home)
         x));
  for e in select * from
      jsonb_array_elements(p_items) loop
    if coalesce(e->>'card_id', '') = ''
       or length(e->>'card_id') > 40
       or jsonb_typeof(e->'n') <> 'number'
       or jsonb_typeof(e->'f') <> 'number'
       or (e->>'n')::int < 0
       or (e->>'f')::int < 0 then
      raise exception 'bad item';
    end if;
    if (e->>'n')::int + (e->>'f')::int = 0
    then continue; end if;
    insert into public.collection_decked
      (user_id, profile, deck_id, deck_name,
       built_by, card_id, n, f)
    values (u, p_profile, p_deck,
      left(coalesce(p_name, ''), 80),
      auth.uid(), e->>'card_id',
      (e->>'n')::int, (e->>'f')::int)
    on conflict (user_id, profile, deck_id,
      card_id) do update
      set n = collection_decked.n
            + excluded.n,
          f = collection_decked.f
            + excluded.f;
    ids := ids || (e->>'card_id');
  end loop;
  -- the same check as every move
  perform private.collection_move_for(u,
    p_profile, '[]', '[]',
    (select coalesce(jsonb_agg(
       jsonb_build_object('card_id', x,
         'qty', 0)), '[]')
       from unnest(ids) x));
end $$;
revoke all on function public.build_deck(uuid,
  text, text, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.build_deck(
  uuid, text, text, text, jsonb, jsonb)
  to authenticated;

-- shared collections also show the decks
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
      '[]'::jsonb),
    'decked', coalesce((
      select jsonb_agg(jsonb_build_object(
        'deck_id', k.deck_id,
        'deck_name', k.deck_name,
        'by_me', k.built_by = auth.uid(),
        'card_id', k.card_id,
        'n', k.n, 'f', k.f))
        from public.collection_decked k
       where k.user_id = s.owner
         and k.profile = s.profile),
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


-- renaming / deleting a collection takes
-- its decks along
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
  update public.collection_decked
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
  delete from public.collection_decked
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

-- "Baixar meus dados": + the decks
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
       where x.user_id = u), '[]'),
    'cards_in_built_decks', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_decked x
       where x.user_id = u), '[]'));
end $$;
