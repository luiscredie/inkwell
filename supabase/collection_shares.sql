-- Shared collection (couples, families):
-- one collection, kept by its owner, that
-- other people can see — and change, if the
-- owner allows.
--  * the owner makes a link (one use, 7 days)
--    saying "can see" or "can see and change";
--    the person opens it (signing up if new)
--    and accepts.
--  * the owner switches "can change" on/off or
--    removes the person; the person can leave.
--  * changes by the person go through the same
--    rules as the owner's (one function does
--    both), so nothing new can go wrong there.
-- A person can keep more than one collection
-- (one shared, one only theirs): each is a row
-- of inkwell_profiles; sharing is per
-- collection.
-- Run after collection_home.sql and social.sql.

create table if not exists
  public.collection_shares (
  owner uuid not null
    references auth.users(id)
    on delete cascade,
  profile text not null,
  member uuid not null
    references auth.users(id)
    on delete cascade,
  can_edit boolean not null default false,
  created_at timestamptz not null
    default now(),
  primary key (owner, profile, member),
  check (owner <> member),
  foreign key (owner, profile)
    references public.inkwell_profiles
      (user_id, profile)
    on delete cascade on update cascade);
create index if not exists coll_shares_member
  on public.collection_shares (member);
alter table public.collection_shares
  enable row level security;

create table if not exists
  public.collection_share_invites (
  code text primary key,
  owner uuid not null
    references auth.users(id)
    on delete cascade,
  profile text not null,
  can_edit boolean not null default false,
  created_at timestamptz not null
    default now(),
  expires_at timestamptz not null
    default now() + interval '7 days',
  used_by uuid
    references auth.users(id)
    on delete set null,
  used_at timestamptz,
  foreign key (owner, profile)
    references public.inkwell_profiles
      (user_id, profile)
    on delete cascade on update cascade);
alter table public.collection_share_invites
  enable row level security;
revoke all on public.collection_shares,
  public.collection_share_invites from anon;

-- ----- one set of rules for changes -----
-- (the owner's own calls and a member's call
-- both end here, with the owner as u)
create or replace function
  private.collection_delta_for(
    u uuid, p_profile text, p_delta jsonb)
returns void
language plpgsql security definer
set search_path = '' as $$
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
end $$;

create or replace function
  private.collection_change_for(
    u uuid, p_profile text,
    p_delta jsonb, p_home jsonb)
returns void
language plpgsql security definer
set search_path = '' as $$
declare
  e jsonb; k text; q int;
  ids text[] := '{}'; bad text;
begin
  p_delta := coalesce(p_delta, '[]');
  p_home := coalesce(p_home, '[]');
  if jsonb_typeof(p_home) <> 'array'
     or jsonb_array_length(p_home) > 400 then
    raise exception 'bad home';
  end if;
  if jsonb_array_length(p_delta) > 0 then
    perform private.collection_delta_for(
      u, p_profile, p_delta);
  end if;
  for e in select * from
      jsonb_array_elements(p_home) loop
    if coalesce(e->>'card_id', '') = ''
       or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number'
    then
      raise exception 'bad home item';
    end if;
    k := case when coalesce(
      (e->>'foil')::boolean, false)
      then 'f' else 'n' end;
    q := (e->>'qty')::int;
    update public.collection_home h
       set n = h.n + case when k = 'n'
             then q else 0 end,
           f = h.f + case when k = 'f'
             then q else 0 end,
           updated_at = now()
     where h.user_id = u
       and h.profile = p_profile
       and h.card_id = e->>'card_id';
    if not found then
      if q < 0 then
        raise exception 'not at home: %',
          e->>'card_id';
      end if;
      insert into public.collection_home
        (user_id, profile, card_id, n, f)
      values (u, p_profile, e->>'card_id',
        case when k = 'n' then q else 0 end,
        case when k = 'f' then q else 0 end);
    end if;
    ids := ids || (e->>'card_id');
  end loop;
  ids := ids || array(select x->>'card_id'
    from jsonb_array_elements(p_delta) x);
  select h.card_id into bad
    from public.collection_home h
    join public.inkwell_profiles p
      on p.user_id = h.user_id
     and p.profile = h.profile
   where h.user_id = u
     and h.profile = p_profile
     and h.card_id = any(ids)
     and (h.n > coalesce((p.data->'collection'
             ->h.card_id->>'n')::int, 0)
       or h.f > coalesce((p.data->'collection'
             ->h.card_id->>'f')::int, 0))
   limit 1;
  if bad is not null then
    raise exception
      'more at home than owned: %', bad;
  end if;
  delete from public.collection_home
   where user_id = u and profile = p_profile
     and card_id = any(ids)
     and n = 0 and f = 0;
end $$;

-- the owner's own calls (same names as before)
create or replace function
  public.apply_collection_delta(
    p_profile text, p_delta jsonb)
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  perform private.collection_delta_for(
    auth.uid(), p_profile, p_delta);
end $$;

create or replace function
  public.collection_change(p_profile text,
    p_delta jsonb, p_home jsonb)
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  perform private.collection_change_for(
    auth.uid(), p_profile, p_delta, p_home);
end $$;

-- a member changes the owner's collection
create or replace function
  public.shared_collection_change(
    p_owner uuid, p_profile text,
    p_delta jsonb, p_home jsonb)
returns void
language plpgsql security definer
set search_path = '' as $$
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
end $$;

-- ---------- reading ----------
-- collections shared with me, with their cards
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

-- who I share with, and who shares with me
create or replace function
  public.my_collection_shares()
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select jsonb_build_object(
    'given', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile', s.profile,
        'member', s.member,
        'name', p.display_name,
        'can_edit', s.can_edit)
        order by s.created_at)
        from public.collection_shares s
        left join public.profiles p
          on p.user_id = s.member
       where s.owner = auth.uid()),
      '[]'::jsonb),
    'received', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile', s.profile,
        'owner', s.owner,
        'name', p.display_name,
        'can_edit', s.can_edit)
        order by s.created_at)
        from public.collection_shares s
        left join public.profiles p
          on p.user_id = s.owner
       where s.member = auth.uid()),
      '[]'::jsonb));
$$;

-- ---------- links ----------
create or replace function
  public.create_share_invite(
    p_profile text, p_can_edit boolean)
returns text
language plpgsql security definer
set search_path = '' as $$
declare c text;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if not exists (
       select 1 from public.inkwell_profiles
        where user_id = auth.uid()
          and profile = p_profile) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  if (select count(*)
        from public.collection_share_invites
       where owner = auth.uid()
         and created_at
           > now() - interval '1 day') >= 10
  then
    raise exception 'too_many_invites';
  end if;
  c := replace(
    gen_random_uuid()::text, '-', '');
  insert into public.collection_share_invites
    (code, owner, profile, can_edit)
  values (c, auth.uid(), p_profile,
    coalesce(p_can_edit, false));
  return c;
end $$;

-- what a link offers (shown before accepting;
-- only the owner's first name and the kind)
create or replace function
  public.share_invite_info(p_code text)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select jsonb_build_object(
    'name', split_part(coalesce(
      p.display_name, ''), ' ', 1),
    'can_edit', i.can_edit,
    'valid', i.used_by is null
      and i.expires_at > now(),
    'mine', i.owner = auth.uid())
    from public.collection_share_invites i
    left join public.profiles p
      on p.user_id = i.owner
   where i.code = p_code;
$$;

create or replace function
  public.accept_share_invite(p_code text)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare i public.collection_share_invites;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  select * into i
    from public.collection_share_invites
   where code = p_code for update;
  if i.code is null or i.used_by is not null
     or i.expires_at < now() then
    raise exception 'invite_gone';
  end if;
  if i.owner = auth.uid() then
    raise exception 'own_invite';
  end if;
  insert into public.collection_shares
    (owner, profile, member, can_edit)
  values (i.owner, i.profile, auth.uid(),
    i.can_edit)
  on conflict (owner, profile, member)
    do update set can_edit = excluded.can_edit;
  update public.collection_share_invites
     set used_by = auth.uid(), used_at = now()
   where code = p_code;
  insert into public.notifications
    (user_id, kind, actor, ref)
  values (i.owner, 'share_accepted',
    auth.uid(), jsonb_build_object(
      'profile', i.profile));
  return jsonb_build_object(
    'owner', i.owner, 'profile', i.profile,
    'can_edit', i.can_edit);
end $$;

-- owner: allow or stop changes; remove someone.
-- member: leave (p_member = me).
create or replace function
  public.set_collection_share(
    p_owner uuid, p_profile text,
    p_member uuid, p_can_edit boolean)
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if p_can_edit is null then   -- remove
    if auth.uid() not in (p_owner, p_member)
    then
      raise exception 'not allowed'
        using errcode = '42501';
    end if;
    delete from public.collection_shares
     where owner = p_owner
       and profile = p_profile
       and member = p_member;
    return;
  end if;
  if auth.uid() <> p_owner then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  update public.collection_shares
     set can_edit = p_can_edit
   where owner = p_owner
     and profile = p_profile
     and member = p_member;
end $$;

-- ---------- grants ----------
revoke all on function
  private.collection_delta_for(uuid, text,
    jsonb) from public;
revoke all on function
  private.collection_change_for(uuid, text,
    jsonb, jsonb) from public;
do $$
declare f text;
begin
  foreach f in array array[
    'apply_collection_delta(text, jsonb)',
    'collection_change(text, jsonb, jsonb)',
    'shared_collection_change(uuid, text,'
      || ' jsonb, jsonb)',
    'shared_collections()',
    'my_collection_shares()',
    'create_share_invite(text, boolean)',
    'share_invite_info(text)',
    'accept_share_invite(text)',
    'set_collection_share(uuid, text, uuid,'
      || ' boolean)']
  loop
    execute format('revoke all on function'
      || ' public.%s from public, anon', f);
    execute format('grant execute on function'
      || ' public.%s to authenticated', f);
  end loop;
end $$;
-- a visitor opening a link sees whose it is
grant execute on function
  public.share_invite_info(text) to anon;

-- ----- friends: see, ask to borrow -----
-- Off until the owner turns them on
-- (Coleção >
-- Compartilhar):
--  view: friends can open the whole collection
--        (read only);
--  lend: friends building a deck see which of
--        the cards they lack the owner
--        has free,
--        and can ask to borrow them.
create table if not exists
  public.collection_privacy (
  user_id uuid primary key
    references auth.users(id)
    on delete cascade,
  profile text not null,
  friends_view boolean not null default false,
  friends_lend boolean not null default false,
  updated_at timestamptz not null
    default now(),
  foreign key (user_id, profile)
    references public.inkwell_profiles
      (user_id, profile)
    on delete cascade on update cascade);
alter table public.collection_privacy
  enable row level security;
revoke all on public.collection_privacy
  from anon;

create or replace function
  public.my_collection_privacy()
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce((select jsonb_build_object(
      'profile', profile,
      'view', friends_view,
      'lend', friends_lend)
    from public.collection_privacy
   where user_id = auth.uid()),
    jsonb_build_object('view', false,
      'lend', false));
$$;

create or replace function
  public.set_collection_privacy(
    p_profile text, p_view boolean,
    p_lend boolean)
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if not exists (
       select 1 from public.inkwell_profiles
        where user_id = auth.uid()
          and profile = p_profile) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  insert into public.collection_privacy
    (user_id, profile, friends_view,
     friends_lend)
  values (auth.uid(), p_profile,
    coalesce(p_view, false),
    coalesce(p_lend, false))
  on conflict (user_id) do update
    set profile = excluded.profile,
        friends_view = excluded.friends_view,
        friends_lend = excluded.friends_lend,
        updated_at = now();
end $$;

-- copies someone has lent and not got back
create or replace function
  private.lent_out(p_user uuid)
returns table (card_id text, qty int)
language sql stable security definer
set search_path = '' as $$
  select e->>'card_id',
         sum((e->>'qty')::int)::int
    from (
      select items from public.user_loans
       where lender = p_user
         and status in ('accepted',
           'delivered')
      union all
      select items from public.loans
       where user_id = p_user
         and direction = 'lent'
         and returned_at is null) l
    cross join lateral
      jsonb_array_elements(l.items) e
   group by 1;
$$;
revoke all on function
  private.lent_out(uuid) from public;

-- a friend's collection, by their handle.
-- p_full false: only whether it is open
-- (for the button on their profile).
create or replace function
  public.friend_collection(
    p_handle text, p_full boolean)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare f uuid; nm text; cp record;
begin
  select user_id, display_name into f, nm
    from public.profiles
   where lower(handle) = lower(p_handle);
  if f is null or auth.uid() is null
     or f = auth.uid()
     or not private.are_friends(
       f, auth.uid()) then
    return null;
  end if;
  select * into cp
    from public.collection_privacy
   where user_id = f and friends_view;
  if cp.user_id is null then
    return jsonb_build_object('view', false);
  end if;
  return jsonb_build_object(
    'view', true, 'name', nm,
    'lend', cp.friends_lend,
    'cards', (select count(*)
      from public.inkwell_profiles ip,
        jsonb_each(coalesce(
          ip.data->'collection', '{}')) c
     where ip.user_id = f
       and ip.profile = cp.profile),
    'collection', case when p_full then (
      select coalesce(
        ip.data->'collection', '{}')
        from public.inkwell_profiles ip
       where ip.user_id = f
         and ip.profile = cp.profile) end,
    'lent', case when p_full then (
      select coalesce(jsonb_object_agg(
        card_id, qty), '{}')
        from private.lent_out(f)) end);
end $$;

-- deck builder: friends who lend and have
-- some of these cards free (owned - lent)
create or replace function
  public.friends_lending(p_cards text[])
returns jsonb
language sql stable security definer
set search_path = '' as $$
  with fr as (
    select case when requester = auth.uid()
             then addressee else requester
           end as uid
      from public.friendships
     where status = 'accepted'
       and auth.uid() in
         (requester, addressee)),
  have as (
    select fr.uid, c.key as card_id,
      coalesce((c.value->>'n')::int, 0)
      + coalesce((c.value->>'f')::int, 0)
        as n
      from fr
      join public.collection_privacy cp
        on cp.user_id = fr.uid
       and cp.friends_lend
      join public.inkwell_profiles ip
        on ip.user_id = cp.user_id
       and ip.profile = cp.profile
     cross join lateral jsonb_each(
       coalesce(ip.data->'collection', '{}')) c
     where c.key = any(p_cards[1:400]))
  select coalesce(jsonb_agg(jsonb_build_object(
      'user', h.uid,
      'name', p.display_name,
      'handle', p.handle,
      'card_id', h.card_id,
      'free', h.n - coalesce(l.qty, 0))
      order by p.display_name), '[]'::jsonb)
    from have h
    left join public.profiles p
      on p.user_id = h.uid
    left join lateral (
      select qty from private.lent_out(h.uid) x
       where x.card_id = h.card_id) l on true
   where h.n - coalesce(l.qty, 0) > 0;
$$;

-- ----- a loan request is a notice -----
-- (the other person gets it on the bell and,
-- with notices on, on the phone); at most 40
-- requests a day.
create or replace function
  private.loan_request_notice()
returns trigger
language plpgsql security definer
set search_path = '' as $$
begin
  perform private.rate_hit(
    'loan_requests', 40, interval '1 day');
  insert into public.notifications
    (user_id, kind, actor, ref)
  values (case when new.created_by
      = new.lender then new.borrower
      else new.lender end,
    case when new.created_by = new.lender
      then 'loan_offer' else 'loan_request'
    end,
    new.created_by, jsonb_build_object(
      'loan', new.id,
      'n', (select sum((e->>'qty')::int)
        from jsonb_array_elements(new.items) e),
      'text', left(new.note, 80)));
  return new;
end $$;
drop trigger if exists user_loans_notice
  on public.user_loans;
create trigger user_loans_notice
  after insert on public.user_loans
  for each row
  execute function
    private.loan_request_notice();

do $$
declare f text;
begin
  foreach f in array array[
    'my_collection_privacy()',
    'set_collection_privacy(text, boolean,'
      || ' boolean)',
    'friend_collection(text, boolean)',
    'friends_lending(text[])']
  loop
    execute format('revoke all on function'
      || ' public.%s from public, anon', f);
    execute format('grant execute on function'
      || ' public.%s to authenticated', f);
  end loop;
end $$;

-- ----- download my data: + sharing -----
do $$
begin
  if not exists (select 1 from pg_proc p
       join pg_namespace n
         on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.proname = 'my_data_export_base')
  then
    alter function public.my_data_export()
      rename to my_data_export_base;
    alter function public.my_data_export_base()
      set schema private;
  end if;
end $$;
revoke all on function
  private.my_data_export_base() from public;
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
       where x.user_id = u));
end $$;
revoke all on function
  public.my_data_export() from public, anon;
grant execute on function
  public.my_data_export() to authenticated;

-- ----- more than one collection -----
-- new: an empty collection (decks stay where
-- they are). rename keeps shares, home and
-- "added" dates. delete: not the last one.
create or replace function
  public.create_collection(p_name text)
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  p_name := btrim(coalesce(p_name, ''));
  if length(p_name) not between 1 and 40
     or p_name like 'share:%' then
    raise exception 'bad_name';
  end if;
  if (select count(*)
        from public.inkwell_profiles
       where user_id = auth.uid()) >= 10 then
    raise exception 'too_many_collections';
  end if;
  insert into public.inkwell_profiles
    (user_id, profile, schema, data)
  values (auth.uid(), p_name, 2,
    jsonb_build_object('_schema', 2,
      'collection', '{}'::jsonb,
      'decks', '[]'::jsonb,
      'wishlist', '{}'::jsonb));
exception when unique_violation then
  raise exception 'name_taken';
end $$;

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
  delete from public.collection_added
   where user_id = u and profile = p_profile;
  delete from public.inkwell_profiles
   where user_id = u and profile = p_profile;
  if not found then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_collection(text)',
    'rename_collection(text, text)',
    'delete_collection(text)']
  loop
    execute format('revoke all on function'
      || ' public.%s from public, anon', f);
    execute format('grant execute on function'
      || ' public.%s to authenticated', f);
  end loop;
end $$;
