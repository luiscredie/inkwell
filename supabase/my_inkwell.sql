-- My Inkwell: a public profile people choose to share, invites, reports and the admin panel.
-- Run after community.sql, friends.sql and user_trades_listings.sql (safe to run again).
--
-- Privacy rules this file enforces:
--   * profiles are private until the member turns "public" on, and only members who declared
--     they are 18 or older can do that (enforced here, not only in the page);
--   * the public view (public_profile) returns only what the member picked: name, short bio,
--     avatar card, inks, city, a 3-card showcase, one featured deck, and, if they allow it,
--     their win/loss count and their wishlist/board cards. Never the collection itself;
--   * the admin can hide any profile, and is_mock marks the example accounts.

-- ---------- admins (who can open /admin/) ----------
create table if not exists public.admins (user_id uuid primary key references auth.users(id) on delete cascade, added_at timestamptz not null default now());
alter table public.admins enable row level security;
drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select to authenticated using (user_id = (select auth.uid()));
grant select on public.admins to authenticated;
insert into public.admins (user_id) values ('68dad53f-ba6c-4065-8a8d-c7cbdf02f743') on conflict do nothing;

-- ---------- profile fields ----------
alter table public.profiles add column if not exists handle text;
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists avatar_card text;
alter table public.profiles add column if not exists inks text[] not null default '{}';
alter table public.profiles add column if not exists city text not null default '';
alter table public.profiles add column if not exists showcase jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists featured_deck text;
alter table public.profiles add column if not exists inkwell_profile text;
alter table public.profiles add column if not exists is_public boolean not null default false;
alter table public.profiles add column if not exists adult boolean not null default false;
alter table public.profiles add column if not exists show_record boolean not null default true;
alter table public.profiles add column if not exists show_trade boolean not null default false;
alter table public.profiles add column if not exists invite_code text;
alter table public.profiles add column if not exists is_mock boolean not null default false;
alter table public.profiles add column if not exists hidden_by_admin boolean not null default false;

update public.profiles set invite_code = substr(md5(random()::text || user_id::text), 1, 10) where invite_code is null;
alter table public.profiles alter column invite_code set default substr(md5(random()::text || clock_timestamp()::text), 1, 10);

create unique index if not exists profiles_handle on public.profiles (lower(handle)) where handle is not null;
create unique index if not exists profiles_invite on public.profiles (invite_code);

alter table public.profiles drop constraint if exists profiles_handle_ok;
alter table public.profiles add constraint profiles_handle_ok check (handle is null or handle ~ '^[a-z0-9_]{3,20}$');
alter table public.profiles drop constraint if exists profiles_fields_ok;
alter table public.profiles add constraint profiles_fields_ok check (
  length(bio) <= 160 and length(city) <= 40 and coalesce(length(avatar_card), 0) <= 40
  and coalesce(array_length(inks, 1), 0) <= 2 and inks <@ array['Amber','Amethyst','Emerald','Ruby','Sapphire','Steel']
  and jsonb_typeof(showcase) = 'array' and jsonb_array_length(showcase) <= 3
  and coalesce(length(featured_deck), 0) <= 60 and coalesce(length(inkwell_profile), 0) <= 60);
alter table public.profiles drop constraint if exists profiles_public_adult;
alter table public.profiles add constraint profiles_public_adult check (not is_public or adult);

-- members may not flip the admin/mock flags or their invite code themselves
create or replace function private.profiles_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.is_mock := false; new.hidden_by_admin := false; new.invite_code := substr(md5(random()::text || clock_timestamp()::text), 1, 10);
    else
      new.is_mock := old.is_mock; new.hidden_by_admin := old.hidden_by_admin; new.invite_code := old.invite_code;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles for each row execute function private.profiles_guard();

-- Other members read only the old, non-personal columns directly; the new fields are read through
-- my_profile() (your own) and public_profile() (what someone chose to show).
revoke select on public.profiles from authenticated, anon;
grant select (user_id, display_name, updated_at, default_visibility, default_group_id, default_coach_email, default_coach_group_id, auto_collection) on public.profiles to authenticated;

create or replace function public.my_profile()
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) - 'hidden_by_admin' - 'is_mock' || jsonb_build_object('hidden', p.hidden_by_admin,
           'is_admin', exists (select 1 from public.admins a where a.user_id = p.user_id))
    from public.profiles p where p.user_id = auth.uid() $$;
revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;

-- save the My Inkwell fields (creates the profile row if the member has none yet)
create or replace function public.save_my_profile(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur public.profiles; h text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'bad profile'; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('display_name','handle','bio','avatar_card','inks','city','showcase','featured_deck','inkwell_profile','is_public','adult','show_record','show_trade'))
    then raise exception 'unknown field'; end if;
  h := nullif(lower(btrim(coalesce(p->>'handle', ''))), '');
  if h is not null and exists (select 1 from public.profiles where lower(handle) = h and user_id <> auth.uid()) then raise exception 'handle_taken'; end if;
  insert into public.profiles (user_id, display_name) values (auth.uid(), coalesce(nullif(btrim(p->>'display_name'), ''), 'Jogador'))
    on conflict (user_id) do nothing;
  select * into cur from public.profiles where user_id = auth.uid() for update;
  update public.profiles set
    display_name = coalesce(nullif(btrim(p->>'display_name'), ''), cur.display_name),
    handle = case when p ? 'handle' then h else cur.handle end,
    bio = case when p ? 'bio' then btrim(coalesce(p->>'bio', '')) else cur.bio end,
    avatar_card = case when p ? 'avatar_card' then nullif(p->>'avatar_card', '') else cur.avatar_card end,
    inks = case when p ? 'inks' then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'inks') x), '{}') else cur.inks end,
    city = case when p ? 'city' then btrim(coalesce(p->>'city', '')) else cur.city end,
    showcase = case when p ? 'showcase' then (select coalesce(jsonb_agg(jsonb_build_object('id', left(e->>'id', 40), 'k', case when e->>'k' = 'own' then 'own' else 'fav' end)), '[]'::jsonb)
                                            from jsonb_array_elements(case when jsonb_typeof(p->'showcase') = 'array' then p->'showcase' else '[]'::jsonb end) e)
               else cur.showcase end,
    featured_deck = case when p ? 'featured_deck' then nullif(p->>'featured_deck', '') else cur.featured_deck end,
    inkwell_profile = case when p ? 'inkwell_profile' then nullif(p->>'inkwell_profile', '') else cur.inkwell_profile end,
    adult = case when p ? 'adult' then coalesce((p->>'adult')::boolean, false) else cur.adult end,
    is_public = case when p ? 'is_public' then coalesce((p->>'is_public')::boolean, false) else cur.is_public end,
    show_record = case when p ? 'show_record' then coalesce((p->>'show_record')::boolean, true) else cur.show_record end,
    show_trade = case when p ? 'show_trade' then coalesce((p->>'show_trade')::boolean, false) else cur.show_trade end,
    updated_at = now()
  where user_id = auth.uid();
  -- a profile can only be public with a handle, a declared 18+, and not hidden by the admin
  update public.profiles set is_public = false where user_id = auth.uid() and is_public and (handle is null or not adult or hidden_by_admin);
  return public.my_profile();
end $$;
revoke all on function public.save_my_profile(jsonb) from public, anon;
grant execute on function public.save_my_profile(jsonb) to authenticated;

-- ---------- the public view ----------
-- Anyone (signed in or not) can read a profile its owner made public. Only the chosen fields.
create or replace function public.public_profile(p_handle text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles; data jsonb; owned jsonb := '{}'::jsonb; deck jsonb; rec jsonb; trade jsonb; show jsonb := '[]'::jsonb; e jsonb;
begin
  select * into p from public.profiles where lower(handle) = lower(p_handle);
  if p.user_id is null or not p.is_public or not p.adult or p.hidden_by_admin then return null; end if;
  -- the Inkwell profile they chose (or their biggest one): for the featured deck, "tenho" and the wishlist
  select ip.data into data from public.inkwell_profiles ip where ip.user_id = p.user_id
   order by (ip.profile = p.inkwell_profile) desc, jsonb_array_length(coalesce(case when jsonb_typeof(ip.data->'decks') = 'array' then ip.data->'decks' end, '[]'::jsonb)) desc, ip.updated_at desc limit 1;
  if data is not null and jsonb_typeof(data->'collection') = 'object' then owned := data->'collection'; end if;
  for e in select * from jsonb_array_elements(p.showcase) loop
    show := show || jsonb_build_array(jsonb_build_object('id', e->>'id',
      'own', (e->>'k') = 'own' and coalesce((owned->(e->>'id')->>'n')::int, 0) + coalesce((owned->(e->>'id')->>'f')::int, 0) > 0));
  end loop;
  if p.featured_deck is not null and data is not null and jsonb_typeof(data->'decks') = 'array' then
    select jsonb_build_object('name', d->>'name', 'format', d->>'format', 'colors', d->'colors', 'cards', d->'cards') into deck
      from jsonb_array_elements(data->'decks') d where d->>'id' = p.featured_deck limit 1;
  end if;
  if p.show_record then
    select jsonb_build_object('w', count(*) filter (where g.summary->>'result' = 'win'), 'l', count(*) filter (where g.summary->>'result' = 'loss'))
      into rec from public.game_logs g where g.user_id = p.user_id;
  end if;
  if p.show_trade then
    trade := jsonb_build_object(
      'want', coalesce((select jsonb_agg(k) from (select k from jsonb_object_keys(case when jsonb_typeof(data->'wishlist') = 'object' then data->'wishlist' else '{}'::jsonb end) k limit 12) x), '[]'::jsonb)
              || coalesce((select jsonb_agg(distinct l.card_id) from public.listings l where l.user_id = p.user_id and l.kind in ('buy', 'borrow')), '[]'::jsonb),
      'have', coalesce((select jsonb_agg(distinct l.card_id) from public.listings l where l.user_id = p.user_id and l.kind in ('sell', 'lend')), '[]'::jsonb));
  end if;
  return jsonb_build_object('handle', p.handle, 'name', p.display_name, 'bio', p.bio, 'avatar', p.avatar_card, 'inks', to_jsonb(p.inks),
    'city', p.city, 'showcase', show, 'deck', deck, 'record', rec, 'trade', trade, 'mock', p.is_mock, 'invite', null);
end $$;
revoke all on function public.public_profile(text) from public;
grant execute on function public.public_profile(text) to anon, authenticated;

-- example profiles for the public home (only accounts marked is_mock)
create or replace function public.example_profiles()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.public_profile(handle) order by handle), '[]'::jsonb)
    from public.profiles where is_mock and is_public and not hidden_by_admin and handle is not null $$;
revoke all on function public.example_profiles() from public;
grant execute on function public.example_profiles() to anon, authenticated;

-- ---------- invites ----------
-- /perfil/?u=handle&convite=code: whoever signs in through it becomes friends with the inviter.
create or replace function public.accept_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare inviter public.profiles;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into inviter from public.profiles where invite_code = p_code and not is_mock;
  if inviter.user_id is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if inviter.user_id = auth.uid() then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  insert into public.friendships (requester, addressee, status, accepted_at)
  values (inviter.user_id, auth.uid(), 'accepted', now())
  on conflict ((least(requester, addressee)), (greatest(requester, addressee))) do update set status = 'accepted', accepted_at = coalesce(public.friendships.accepted_at, now());
  return jsonb_build_object('ok', true, 'name', inviter.display_name);
end $$;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- who sent an invite (shown to the visitor before they sign in): the name, and the handle only if public
create or replace function public.invite_info(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', display_name, 'handle', case when is_public and adult and not hidden_by_admin then handle end)
    from public.profiles where invite_code = p_code and not is_mock and not hidden_by_admin $$;
revoke all on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to anon, authenticated;

-- ---------- reports ----------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target uuid not null references auth.users(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
alter table public.reports enable row level security;
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (reporter = (select auth.uid()) and status = 'open' and handled_at is null);
drop policy if exists reports_own on public.reports;
create policy reports_own on public.reports for select to authenticated using (reporter = (select auth.uid()));
grant select, insert on public.reports to authenticated;

-- a report by handle (the page never sees user ids of other people); at most 10 a day per member
create or replace function public.report_profile(p_handle text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select user_id into t from public.profiles where lower(handle) = lower(p_handle);
  if t is null then raise exception 'unknown profile'; end if;
  if (select count(*) from public.reports where reporter = auth.uid() and created_at > now() - interval '1 day') >= 10 then raise exception 'too many reports'; end if;
  insert into public.reports (reporter, target, reason) values (auth.uid(), t, left(btrim(p_reason), 500));
end $$;
revoke all on function public.report_profile(text, text) from public, anon;
grant execute on function public.report_profile(text, text) to authenticated;

-- ---------- admin ----------

create or replace function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid()) $$;

create or replace function public.admin_users()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select u.id, u.email, u.created_at, u.last_sign_in_at, p.display_name, p.handle, coalesce(p.is_public, false) is_public,
           coalesce(p.is_mock, false) is_mock, coalesce(p.hidden_by_admin, false) hidden, coalesce(p.adult, false) adult,
           exists (select 1 from public.admins a where a.user_id = u.id) is_admin,
           (select count(*) from public.game_logs g where g.user_id = u.id) games,
           (select count(*) from public.reports r where r.target = u.id and r.status = 'open') open_reports
      from auth.users u left join public.profiles p on p.user_id = u.id) x), '[]'::jsonb);
end $$;

create or replace function public.admin_reports()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x.status, x.created_at desc) from (
    select r.id, r.reason, r.status, r.created_at, r.target, tp.display_name target_name, tp.handle target_handle, rp.display_name reporter_name
      from public.reports r left join public.profiles tp on tp.user_id = r.target left join public.profiles rp on rp.user_id = r.reporter
     order by r.created_at desc limit 200) x), '[]'::jsonb);
end $$;

create or replace function public.admin_action(p_user uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_action = 'hide' then update public.profiles set hidden_by_admin = true, is_public = false where user_id = p_user;
  elsif p_action = 'unhide' then update public.profiles set hidden_by_admin = false where user_id = p_user;
  elsif p_action = 'signout' then   -- ends every session: the person signs in again with a new code
    delete from auth.refresh_tokens where user_id = p_user::text;
    delete from auth.sessions where user_id = p_user;
  elsif p_action = 'delete' then
    if p_user = auth.uid() then raise exception 'you cannot delete your own account here'; end if;
    if exists (select 1 from public.admins where user_id = p_user) then raise exception 'remove the admin role first'; end if;
    delete from public.inkwell_profiles where user_id = p_user;
    delete from auth.users where id = p_user;   -- the rest goes with it (on delete cascade)
  else raise exception 'unknown action';
  end if;
end $$;

create or replace function public.admin_resolve_report(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.reports set status = 'done', handled_at = now() where id = p_id;
end $$;

revoke all on function public.admin_users(), public.admin_reports(), public.admin_action(uuid, text), public.admin_resolve_report(uuid) from public, anon;
grant execute on function public.admin_users(), public.admin_reports(), public.admin_action(uuid, text), public.admin_resolve_report(uuid) to authenticated;

-- ---------- example accounts (mockups) ----------
-- Two clearly fictional members for the public home. Delete them in the admin panel when real
-- members can be shown (with their permission). Emails use the reserved .invalid domain.
do $$
declare u1 uuid := '00000000-0000-4000-a000-000000000001'; u2 uuid := '00000000-0000-4000-a000-000000000002';
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', u1, 'authenticated', 'authenticated', 'user1@exemplo.invalid', '{"provider":"email","providers":["email"],"mock":true}', '{}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', u2, 'authenticated', 'authenticated', 'user2@exemplo.invalid', '{"provider":"email","providers":["email"],"mock":true}', '{}', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (user_id, display_name, handle, bio, avatar_card, inks, city, showcase, featured_deck, inkwell_profile, is_public, adult, show_record, show_trade, is_mock)
  values (u1, 'user1 (exemplo)', 'user1', 'Perfil fictício de exemplo. Jogo Amber/Steel nas sextas e coleciono as Encantadas da Bela.',
          'LOR14-2', array['Amber','Steel'], 'São Paulo', '[{"id":"LOR13-80","k":"own"},{"id":"LOR14-1","k":"own"},{"id":"LOR10-10","k":"fav"}]', 'mock-deck-1', 'user1', true, true, true, true, true),
         (u2, 'user2 (exemplo)', 'user2', 'Perfil fictício de exemplo. Colecionador: quero completar o set 14.',
          'LOR13-80', array['Emerald','Sapphire'], 'Campinas', '[{"id":"LOR14-3","k":"own"},{"id":"LOR9-7","k":"fav"}]', null, 'user2', true, true, false, true, true)
  on conflict (user_id) do update set display_name = excluded.display_name, handle = excluded.handle, bio = excluded.bio, avatar_card = excluded.avatar_card,
    inks = excluded.inks, city = excluded.city, showcase = excluded.showcase, featured_deck = excluded.featured_deck, inkwell_profile = excluded.inkwell_profile,
    is_public = true, adult = true, show_record = excluded.show_record, show_trade = excluded.show_trade, is_mock = true;

  insert into public.inkwell_profiles (user_id, profile, data, schema, updated_at, revision)
  values (u1, 'user1', jsonb_build_object('mock', true,
            'collection', '{"LOR13-80":{"n":2,"f":0},"LOR14-1":{"n":1,"f":1},"LOR14-2":{"n":3,"f":0}}'::jsonb,
            'wishlist', '{"LOR14-3":1,"LOR10-10":1}'::jsonb,
            'decks', jsonb_build_array(jsonb_build_object('id', 'mock-deck-1', 'name', 'Amber/Steel exemplo', 'format', 'core', 'colors', jsonb_build_array('Amber', 'Steel'),
                      'cards', '{"LOR14-1":4,"LOR14-10":4,"LOR14-11":4,"LOR14-12":4,"LOR14-13":4,"LOR14-14":4,"LOR14-15":4,"LOR14-16":4,"LOR14-171":4,"LOR14-172":4,"LOR14-173":4,"LOR14-174":4,"LOR14-175":4,"LOR14-176":4,"LOR14-177":4}'::jsonb))), 1, now(), 1),
         (u2, 'user2', jsonb_build_object('mock', true, 'collection', '{"LOR14-3":1}'::jsonb, 'wishlist', '{"LOR14-1":1,"LOR14-2":1}'::jsonb, 'decks', '[]'::jsonb), 1, now(), 1)
  on conflict (user_id, profile) do nothing;

  -- a short, invented match record for user1 (summaries only, private: never in any feed)
  insert into public.game_logs (user_id, game_id, source, played_at, log, visibility)
  select u1, 'mock-' || g, 'manual', now() - (g || ' days')::interval, '{"mock":true}'::jsonb, 'private'
    from generate_series(1, 12) g
  on conflict do nothing;
  update public.game_logs set visibility = 'private',
         summary = jsonb_build_object('result', case when split_part(game_id, '-', 2)::int % 3 = 0 then 'loss' else 'win' end, 'my_inks', 'Amber/Steel', 'mock', true)
   where user_id = u1 and game_id like 'mock-%';
end $$;
