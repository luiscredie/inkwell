-- Production's shape for the card-language tests, read 13/11/2026 with read-only queries (pg_get_functiondef and
-- information_schema). Self-contained: roles, auth.uid(), the collection tables and the functions that change a
-- collection, as they were in production before supabase/card_langs.sql.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth; create schema if not exists private;
revoke all on schema private from public; grant usage on schema private to authenticated;
create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to public;

create table public.inkwell_profiles (user_id uuid not null references auth.users(id) on delete cascade, profile text not null,
  data jsonb not null, schema integer not null default 1, updated_at timestamptz not null default now(),
  revision bigint not null default 1, primary key (user_id, profile));
create table public.collection_shares (owner uuid not null, profile text not null, member uuid not null,
  can_edit boolean not null default false, created_at timestamptz not null default now());
create table public.collection_home (user_id uuid not null default auth.uid(), profile text not null, card_id text not null,
  n int not null default 0, f int not null default 0, updated_at timestamptz not null default now(), primary key (user_id, profile, card_id));
create table public.collection_trade (user_id uuid not null default auth.uid(), profile text not null, card_id text not null,
  n int not null default 0, f int not null default 0, updated_at timestamptz not null default now(), primary key (user_id, profile, card_id));
create table public.collection_decked (user_id uuid not null, profile text not null, deck_id text not null, deck_name text not null default '',
  built_by uuid, card_id text not null, n int not null default 0, f int not null default 0, updated_at timestamptz not null default now(),
  primary key (user_id, profile, deck_id, card_id));
create table public.collection_added (user_id uuid not null, profile text not null, card_id text not null,
  added_at timestamptz not null default now(), qty integer not null default 1, primary key (user_id, profile, card_id));
create table private.collection_ops (op_id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  profile text not null, delta jsonb not null, created_at timestamptz not null default now(), undone_at timestamptz);

create or replace function private.valid_items(p jsonb) returns boolean language sql immutable set search_path to '' as $function$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 200 and not exists (
    select 1 from jsonb_array_elements(p) e
    where jsonb_typeof(e) <> 'object' or coalesce(e->>'card_id', '') = '' or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number' or (e->>'qty')::numeric not between 1 and 99);
$function$;
create table public.loans (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  direction text not null check (direction in ('lent', 'borrowed')), person text not null check (length(btrim(person)) between 1 and 60),
  items jsonb not null check (private.valid_items(items) and jsonb_array_length(items) > 0), lent_on date not null default current_date,
  due_on date, returned_at timestamptz, note text not null default '' check (length(note) <= 500), created_at timestamptz not null default now());

create or replace function private.collection_delta_for(u uuid, p_profile text, p_delta jsonb)
 returns void language plpgsql security definer set search_path to '' as $function$
declare d jsonb; e jsonb; cur jsonb; k text;
begin
  if jsonb_typeof(p_delta) <> 'array'
     or jsonb_array_length(p_delta) > 400 then
    raise exception 'bad delta';
  end if;
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
    if coalesce(e->>'card_id', '') = ''
       or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number'
    then
      raise exception 'bad delta item';
    end if;
    k := case when coalesce(
      (e->>'foil')::boolean, false)
      then 'f' else 'n' end;
    cur := coalesce(
      d->'collection'->(e->>'card_id'),
      '{"n": 0, "f": 0}'::jsonb);
    cur := jsonb_set(cur, array[k],
      to_jsonb(greatest(0, coalesce(
        (cur->>k)::int, 0)
        + (e->>'qty')::int)));
    d := jsonb_set(d, array['collection',
      e->>'card_id'], cur);
  end loop;
  update public.inkwell_profiles
     set data = d, revision = revision + 1,
         updated_at = now()
   where user_id = u and profile = p_profile;
end $function$;

create or replace function public.apply_collection_delta(p_profile text, p_delta jsonb)
 returns void language plpgsql security definer set search_path to '' as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  perform private.collection_delta_for(
    auth.uid(), p_profile, p_delta);
end $function$;

create or replace function private.stock_apply(p_tbl text, u uuid, p_profile text, p_items jsonb)
 returns text[] language plpgsql security definer set search_path to '' as $function$
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
end $function$;

create or replace function private.collection_move_for(u uuid, p_profile text, p_delta jsonb, p_home jsonb, p_trade jsonb)
 returns void language plpgsql security definer set search_path to '' as $function$
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
end $function$;

create or replace function private.collection_change_for(u uuid, p_profile text, p_delta jsonb, p_home jsonb)
 returns void language plpgsql security definer set search_path to '' as $function$
begin
  perform private.collection_move_for(
    u, p_profile, p_delta, p_home, '[]');
end $function$;

create or replace function public.collection_change(p_profile text, p_delta jsonb, p_home jsonb)
 returns void language plpgsql security definer set search_path to '' as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  perform private.collection_change_for(
    auth.uid(), p_profile, p_delta, p_home);
end $function$;

create or replace function public.shared_collection_change(p_owner uuid, p_profile text, p_delta jsonb, p_home jsonb)
 returns void language plpgsql security definer set search_path to '' as $function$
begin
  if not exists (
       select 1 from public.collection_shares
        where owner = p_owner
          and profile = p_profile
          and member = auth.uid()
          and can_edit) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  perform private.collection_change_for(
    p_owner, p_profile, p_delta, p_home);
end $function$;

create or replace function private.collection_op_delta(p jsonb)
 returns jsonb language plpgsql immutable set search_path to '' as $function$
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
end $function$;

create or replace function public.add_collection_op(p_profile text, p_delta jsonb, p_op uuid)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
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
end $function$;

create or replace function public.undo_collection_op(p_op uuid)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
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
  select * into o
    from private.collection_ops
   where op_id = p_op;
  if not found or o.user_id <> u then
    raise exception 'op_not_found';
  end if;
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
end $function$;

grant select, insert, update on public.loans to authenticated;
-- production's default: new functions are executable by anon and authenticated
alter default privileges in schema public grant execute on functions to anon, authenticated;
