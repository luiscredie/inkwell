-- Communities: a store, a city or a shared interest. Run after my_inkwell_2.sql (safe to run again).
--
-- Rules enforced here:
--   * anyone can see a community's name, description and its members who have a public profile;
--   * only members who declared 18+ can join, create (up to 3 each) or post;
--   * conversations are visible to members only (the fictional example communities are open to read);
--   * the owner edits the community, hides posts and removes members; the author deletes own posts;
--   * any member can report a post; the admin can hide or delete any community.

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (length(btrim(name)) between 3 and 60),
  kind text not null default 'store' check (kind in ('store', 'city', 'interest')),
  city text not null default '' check (length(city) <= 40),
  description text not null default '' check (length(description) <= 300),
  avatar_card text check (length(avatar_card) <= 40),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  is_mock boolean not null default false,
  hidden boolean not null default false
);
create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists community_members_user on public.community_members (user_id);
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 1000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists community_posts_recent on public.community_posts (community_id, created_at desc);

-- everything goes through the functions below; no direct table access for members
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_posts enable row level security;
revoke all on public.communities, public.community_members, public.community_posts from anon, authenticated;

create or replace function private.is_adult(u uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select adult and not hidden_by_admin from public.profiles where user_id = u), false) $$;
create or replace function private.slugify(t text) returns text language sql immutable set search_path = '' as $$
  select trim(both '-' from left(regexp_replace(lower(translate(t,
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^a-z0-9]+', '-', 'g'), 40)) $$;
-- a member's public face: name always, handle and avatar only when their own profile is public
create or replace function private.face(u uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', p.display_name,
    'handle', case when p.is_public and p.adult and not p.hidden_by_admin then p.handle end,
    'avatar', case when p.is_public and p.adult and not p.hidden_by_admin then p.avatar_card end)
    from public.profiles p where p.user_id = u $$;

-- ---------- reading ----------
create or replace function public.communities_list(p_q text default '', p_mine boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'mine' desc, (x->>'members')::int desc, x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object('slug', c.slug, 'name', c.name, 'kind', c.kind, 'city', c.city, 'description', c.description, 'avatar', c.avatar_card, 'mock', c.is_mock,
             'members', (select count(*) from public.community_members m where m.community_id = c.id),
             'mine', exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id = auth.uid())) x
      from public.communities c
     where not c.hidden
       and (not p_mine or exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id = auth.uid()))
       and (coalesce(p_q, '') = '' or (c.name || ' ' || c.city || ' ' || c.description) ilike '%' || replace(replace(p_q, '%', ''), '_', '') || '%')
     limit 100) y $$;

create or replace function public.community_view(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.communities; me_role text; members jsonb; n int; posts jsonb := null; week int; manage jsonb := null;
begin
  select * into c from public.communities where slug = p_slug and not hidden;
  if c.id is null then return null; end if;
  select role into me_role from public.community_members where community_id = c.id and user_id = auth.uid();
  select count(*) into n from public.community_members where community_id = c.id;
  select coalesce(jsonb_agg(private.face(m.user_id) || jsonb_build_object('role', m.role) order by m.role desc, m.joined_at), '[]'::jsonb) into members
    from public.community_members m join public.profiles p on p.user_id = m.user_id
   where m.community_id = c.id and p.is_public and p.adult and not p.hidden_by_admin;
  select count(*) into week from public.community_posts where community_id = c.id and not hidden and created_at > now() - interval '7 days';
  if me_role is not null or c.is_mock then
    select coalesce(jsonb_agg(y.x), '[]'::jsonb) into posts from (
      select coalesce(private.face(cp.author), jsonb_build_object('name', null)) || jsonb_build_object('id', cp.id, 'body', cp.body, 'at', cp.created_at, 'mine', cp.author = auth.uid()) x
        from public.community_posts cp where cp.community_id = c.id and not cp.hidden order by cp.created_at desc limit 50) y;
  end if;
  if me_role = 'owner' then   -- the owner sees every member, to remove one if needed
    select coalesce(jsonb_agg(jsonb_build_object('uid', m.user_id, 'name', p.display_name, 'role', m.role) order by m.joined_at), '[]'::jsonb) into manage
      from public.community_members m left join public.profiles p on p.user_id = m.user_id where m.community_id = c.id;
  end if;
  return jsonb_build_object('slug', c.slug, 'name', c.name, 'kind', c.kind, 'city', c.city, 'description', c.description, 'avatar', c.avatar_card, 'mock', c.is_mock,
    'created_at', c.created_at, 'member_n', n, 'members', members, 'week_posts', week, 'posts', posts, 'role', me_role,
    'can_join', me_role is null and auth.uid() is not null and private.is_adult(auth.uid()) and not c.is_mock, 'manage', manage);
end $$;

-- ---------- membership and posts ----------
create or replace function public.create_community(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s text; base text; i int := 1; cid uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not private.is_adult(auth.uid()) then raise exception 'adults_only'; end if;
  if (select count(*) from public.communities where created_by = auth.uid() and not hidden) >= 3 then raise exception 'too_many_communities'; end if;
  if coalesce(p->>'kind', 'store') not in ('store', 'city', 'interest') then raise exception 'bad kind'; end if;
  base := private.slugify(coalesce(p->>'name', ''));
  if length(base) < 3 then base := base || '-lorcana'; end if;
  s := base;
  while exists (select 1 from public.communities where slug = s) loop i := i + 1; s := left(base, 36) || '-' || i; end loop;
  insert into public.communities (slug, name, kind, city, description, avatar_card, created_by)
  values (s, btrim(p->>'name'), coalesce(p->>'kind', 'store'), btrim(coalesce(p->>'city', '')), btrim(coalesce(p->>'description', '')), nullif(p->>'avatar_card', ''), auth.uid())
  returning id into cid;
  insert into public.community_members (community_id, user_id, role) values (cid, auth.uid(), 'owner');
  return jsonb_build_object('slug', s);
end $$;

create or replace function public.update_community(p_slug text, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.communities;
begin
  select * into c from public.communities where slug = p_slug and not hidden;
  if c.id is null or not exists (select 1 from public.community_members where community_id = c.id and user_id = auth.uid() and role = 'owner') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.communities set
    name = coalesce(nullif(btrim(p->>'name'), ''), name), city = case when p ? 'city' then btrim(coalesce(p->>'city', '')) else city end,
    description = case when p ? 'description' then btrim(coalesce(p->>'description', '')) else description end,
    avatar_card = case when p ? 'avatar_card' then nullif(p->>'avatar_card', '') else avatar_card end,
    kind = case when p->>'kind' in ('store', 'city', 'interest') then p->>'kind' else kind end
  where id = c.id;
end $$;

create or replace function public.join_community(p_slug text, p_join boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.communities;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into c from public.communities where slug = p_slug and not hidden and not is_mock;
  if c.id is null then raise exception 'unknown community'; end if;
  if p_join then
    if not private.is_adult(auth.uid()) then raise exception 'adults_only'; end if;
    insert into public.community_members (community_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  else
    if exists (select 1 from public.community_members where community_id = c.id and user_id = auth.uid() and role = 'owner') then raise exception 'owner_cannot_leave'; end if;
    delete from public.community_members where community_id = c.id and user_id = auth.uid();
  end if;
end $$;

create or replace function public.post_in_community(p_slug text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.communities; pid uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into c from public.communities where slug = p_slug and not hidden;
  if c.id is null or not exists (select 1 from public.community_members where community_id = c.id and user_id = auth.uid()) then raise exception 'members_only'; end if;
  if not private.is_adult(auth.uid()) then raise exception 'adults_only'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then raise exception 'bad post'; end if;
  if (select count(*) from public.community_posts where author = auth.uid() and created_at > now() - interval '1 day') >= 30 then raise exception 'too many posts'; end if;
  insert into public.community_posts (community_id, author, body) values (c.id, auth.uid(), btrim(p_body)) returning id into pid;
  return jsonb_build_object('id', pid);
end $$;

-- hide (owner, admin) or delete (author, owner, admin) a post; remove a member (owner, admin)
create or replace function public.moderate_community(p_action text, p_post uuid default null, p_slug text default null, p_user uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid; v_author uuid; is_owner boolean;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_post is not null then select cp.community_id, cp.author into cid, v_author from public.community_posts cp where cp.id = p_post;
  else select id into cid from public.communities where slug = p_slug; end if;
  if cid is null then raise exception 'unknown'; end if;
  is_owner := exists (select 1 from public.community_members where community_id = cid and user_id = auth.uid() and role = 'owner') or private.is_admin();
  if p_action = 'hide_post' and is_owner then update public.community_posts set hidden = true where id = p_post;
  elsif p_action = 'delete_post' and (is_owner or v_author = auth.uid()) then delete from public.community_posts where id = p_post;
  elsif p_action = 'remove_member' and is_owner and p_user is not null and p_user <> auth.uid() then
    delete from public.community_members where community_id = cid and user_id = p_user and role <> 'owner';
  else raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;

-- a member reports a post: it goes to the admin's report list, against the post's author
create or replace function public.report_community_post(p_post uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare cp public.community_posts; cname text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into cp from public.community_posts where id = p_post;
  if cp.id is null or not exists (select 1 from public.community_members where community_id = cp.community_id and user_id = auth.uid()) then raise exception 'members_only'; end if;
  if (select count(*) from public.reports where reporter = auth.uid() and created_at > now() - interval '1 day') >= 10 then raise exception 'too many reports'; end if;
  select name into cname from public.communities where id = cp.community_id;
  insert into public.reports (reporter, target, reason)
  values (auth.uid(), cp.author, left(format('[%s] "%s" — %s', cname, left(cp.body, 120), btrim(coalesce(p_reason, ''))), 500));
end $$;

-- ---------- admin ----------
create or replace function public.admin_communities()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'kind', c.kind, 'city', c.city, 'hidden', c.hidden, 'mock', c.is_mock,
      'created_at', c.created_at, 'owner', (select display_name from public.profiles where user_id = c.created_by),
      'members', (select count(*) from public.community_members m where m.community_id = c.id),
      'posts', (select count(*) from public.community_posts cp where cp.community_id = c.id)) order by c.created_at desc) from public.communities c), '[]'::jsonb);
end $$;
create or replace function public.admin_community(p_id uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_action = 'hide' then update public.communities set hidden = true where id = p_id;
  elsif p_action = 'unhide' then update public.communities set hidden = false where id = p_id;
  elsif p_action = 'delete' then delete from public.communities where id = p_id;
  else raise exception 'unknown action'; end if;
end $$;

revoke all on function public.communities_list(text, boolean), public.community_view(text) from public;
grant execute on function public.communities_list(text, boolean), public.community_view(text) to anon, authenticated;
revoke all on function public.create_community(jsonb), public.update_community(text, jsonb), public.join_community(text, boolean), public.post_in_community(text, text),
  public.moderate_community(text, uuid, text, uuid), public.report_community_post(uuid, text), public.admin_communities(), public.admin_community(uuid, text) from public, anon;
grant execute on function public.create_community(jsonb), public.update_community(text, jsonb), public.join_community(text, boolean), public.post_in_community(text, text),
  public.moderate_community(text, uuid, text, uuid), public.report_community_post(uuid, text), public.admin_communities(), public.admin_community(uuid, text) to authenticated;

-- ---------- the profile shows the communities its owner belongs to ----------
create or replace function public.profile_communities(p_handle text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name, 'kind', c.kind, 'city', c.city, 'avatar', c.avatar_card, 'role', m.role) order by m.joined_at), '[]'::jsonb)
    from public.profiles p join public.community_members m on m.user_id = p.user_id join public.communities c on c.id = m.community_id
   where lower(p.handle) = lower(p_handle) and p.is_public and p.adult and not p.hidden_by_admin and not c.hidden $$;
revoke all on function public.profile_communities(text) from public;
grant execute on function public.profile_communities(text) to anon, authenticated;

-- ---------- example communities (fictional; delete in the admin panel) ----------
do $$
declare u1 uuid := '00000000-0000-4000-a000-000000000001'; u2 uuid := '00000000-0000-4000-a000-000000000002'; u3 uuid := '00000000-0000-4000-a000-000000000003';
        c1 uuid := '00000000-0000-4000-b000-000000000001'; c2 uuid := '00000000-0000-4000-b000-000000000002';
begin
  insert into public.communities (id, slug, name, kind, city, description, avatar_card, created_by, is_mock)
  values (c1, 'taverna-da-tinta-exemplo', 'Taverna da Tinta (exemplo)', 'store', 'São Paulo', 'Loja fictícia de exemplo. Liga às quintas, torneio casual às sextas e mesa livre no sábado à tarde.', 'LOR10-178', u1, true),
         (c2, 'encantadas-e-cia-exemplo', 'Encantadas & Cia (exemplo)', 'interest', '', 'Comunidade fictícia de exemplo para quem coleciona Encantadas: trocas, fotos de fichário e dicas de conservação.', 'LOR13-234', u2, true)
  on conflict (id) do update set name = excluded.name, slug = excluded.slug, description = excluded.description, avatar_card = excluded.avatar_card, is_mock = true, hidden = false;
  insert into public.community_members (community_id, user_id, role, joined_at) values
    (c1, u1, 'owner', now() - interval '30 days'), (c1, u3, 'member', now() - interval '10 days'), (c1, u2, 'member', now() - interval '4 days'),
    (c2, u2, 'owner', now() - interval '25 days'), (c2, u1, 'member', now() - interval '6 days')
  on conflict do nothing;
  delete from public.community_posts where community_id in (c1, c2);
  insert into public.community_posts (community_id, author, body, created_at) values
    (c1, u1, 'Quinta tem liga às 19h, formato Core, BO3. Tragam lista impressa!', now() - interval '3 days'),
    (c1, u3, 'Primeira vez na liga, alguém me empresta um deck Esmeralda/Rubi para testar?', now() - interval '2 days'),
    (c1, u2, 'Sexta levo meu fichário de Encantadas para quem quiser ver/trocar.', now() - interval '20 hours'),
    (c2, u2, 'Dica: sleeve dupla e fichário com folha de 9 bolsos sem PVC.', now() - interval '5 days'),
    (c2, u1, 'Alguém tem a Kida Encantada para troca? Ofereço duas lendárias.', now() - interval '1 day');
end $$;
