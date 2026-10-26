-- Communities: store details, admins and
-- handing the community to another member.
--  * contact (stores): address, phone, email,
--    site, Instagram. Public, like a shop sign.
--  * role 'admin': edits the details and
--    moderates, like the owner. Only the owner
--    picks admins and can transfer ownership.
--  * transfer: the new owner must be a member
--    and 18+; the old owner stays as admin.
-- Run after communities.sql.

alter table public.communities
  add column if not exists contact jsonb;

alter table public.community_members
  drop constraint if exists
    community_members_role_check;
alter table public.community_members
  add constraint community_members_role_check
  check (role in ('owner', 'admin', 'member'));

-- owner or admin of a community (or site admin)
create or replace function
  private.can_manage(p_cid uuid)
returns boolean
language sql stable security definer
set search_path = '' as $$
  select exists (
    select 1 from public.community_members
     where community_id = p_cid
       and user_id = auth.uid()
       and role in ('owner', 'admin'))
    or private.is_admin();
$$;

-- clean one contact field: trimmed, cut to n
create or replace function
  private.clip(v text, n int)
returns text
language sql immutable
set search_path = '' as $$
  select nullif(left(btrim(
    coalesce(v, '')), n), '');
$$;

create or replace function
  public.update_community(
    p_slug text, p jsonb)
returns void
language plpgsql security definer
set search_path = '' as $$
declare
  c public.communities;
  k jsonb := p->'contact';
  site text; insta text; mail text;
begin
  select * into c from public.communities
   where slug = p_slug and not hidden;
  if c.id is null
     or not private.can_manage(c.id) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  if jsonb_typeof(k) = 'object' then
    site := private.clip(k->>'site', 200);
    if site is not null
       and site !~* '^https?://' then
      site := 'https://' || site;
    end if;
    insta := private.clip(regexp_replace(
      coalesce(k->>'instagram', ''),
      '^(https?://)?(www\.)?'
      || '(instagram\.com/)?@?', '', 'i'),
      40);
    insta := nullif(regexp_replace(
      coalesce(insta, ''),
      '[^A-Za-z0-9._]', '', 'g'), '');
    mail := private.clip(k->>'email', 120);
    if mail is not null
       and mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    then
      raise exception 'bad email';
    end if;
  end if;
  update public.communities set
    name = coalesce(nullif(
      btrim(p->>'name'), ''), name),
    city = case when p ? 'city'
      then btrim(coalesce(p->>'city', ''))
      else city end,
    description = case
      when p ? 'description'
      then btrim(coalesce(
        p->>'description', ''))
      else description end,
    avatar_card = case
      when p ? 'avatar_card'
      then nullif(p->>'avatar_card', '')
      else avatar_card end,
    kind = case
      when p->>'kind' in
        ('store', 'city', 'interest')
      then p->>'kind' else kind end,
    contact = case
      when jsonb_typeof(k) = 'object'
      then nullif(jsonb_strip_nulls(
        jsonb_build_object(
          'address',
            private.clip(k->>'address', 160),
          'phone',
            private.clip(k->>'phone', 30),
          'email', mail,
          'site', site,
          'instagram', insta)),
        '{}'::jsonb)
      when p ? 'contact' then null
      else contact end
  where id = c.id;
end $$;

-- owner only: make a member admin, or back
create or replace function
  public.set_community_role(
    p_slug text, p_user uuid, p_role text)
returns void
language plpgsql security definer
set search_path = '' as $$
declare cid uuid;
begin
  select id into cid
    from public.communities
   where slug = p_slug and not hidden;
  if cid is null or not exists (
       select 1
         from public.community_members
        where community_id = cid
          and user_id = auth.uid()
          and role = 'owner')
     or p_role not in ('admin', 'member')
     or p_user = auth.uid() then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  update public.community_members
     set role = p_role
   where community_id = cid
     and user_id = p_user
     and role <> 'owner';
  if not found then
    raise exception 'not a member';
  end if;
end $$;

-- owner only: hand the community to a member
create or replace function
  public.transfer_community(
    p_slug text, p_user uuid)
returns void
language plpgsql security definer
set search_path = '' as $$
declare cid uuid;
begin
  select id into cid
    from public.communities
   where slug = p_slug and not hidden;
  if cid is null or not exists (
       select 1
         from public.community_members
        where community_id = cid
          and user_id = auth.uid()
          and role = 'owner')
     or p_user = auth.uid() then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  if not exists (
       select 1
         from public.community_members
        where community_id = cid
          and user_id = p_user)
  then
    raise exception 'not a member';
  end if;
  if not private.is_adult(p_user) then
    raise exception 'adults_only';
  end if;
  update public.community_members
     set role = 'admin'
   where community_id = cid
     and user_id = auth.uid();
  update public.community_members
     set role = 'owner'
   where community_id = cid
     and user_id = p_user;
  update public.communities
     set created_by = p_user
   where id = cid;
end $$;

revoke all on function
  public.set_community_role(text, uuid, text)
  from public, anon;
grant execute on function
  public.set_community_role(text, uuid, text)
  to authenticated;
revoke all on function
  public.transfer_community(text, uuid)
  from public, anon;
grant execute on function
  public.transfer_community(text, uuid)
  to authenticated;

-- admins moderate too; nobody removes the owner,
-- and only the owner removes an admin
create or replace function
  public.moderate_community(
    p_action text,
    p_post uuid default null,
    p_slug text default null,
    p_user uuid default null)
returns void
language plpgsql security definer
set search_path = '' as $$
declare
  cid uuid; v_author uuid;
  can boolean; is_owner boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if p_post is not null then
    select cp.community_id, cp.author
      into cid, v_author
      from public.community_posts cp
     where cp.id = p_post;
  else
    select id into cid
      from public.communities
     where slug = p_slug;
  end if;
  if cid is null then
    raise exception 'unknown';
  end if;
  can := private.can_manage(cid);
  is_owner := exists (
    select 1 from public.community_members
     where community_id = cid
       and user_id = auth.uid()
       and role = 'owner')
    or private.is_admin();
  if p_action = 'hide_post' and can then
    update public.community_posts
       set hidden = true where id = p_post;
  elsif p_action = 'delete_post'
    and (can or v_author = auth.uid()) then
    delete from public.community_posts
     where id = p_post;
  elsif p_action = 'remove_member' and can
    and p_user is not null
    and p_user <> auth.uid() then
    delete from public.community_members
     where community_id = cid
       and user_id = p_user
       and role <> 'owner'
       and (role = 'member' or is_owner);
  else
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
end $$;

-- the page: contact for everyone; the member
-- list with roles for the owner and admins
create or replace function
  public.community_view(p_slug text)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare
  c public.communities; me_role text;
  members jsonb; n int; posts jsonb := null;
  week int; manage jsonb := null;
begin
  select * into c from public.communities
   where slug = p_slug and not hidden;
  if c.id is null then return null; end if;
  select role into me_role
    from public.community_members
   where community_id = c.id
     and user_id = auth.uid();
  select count(*) into n
    from public.community_members
   where community_id = c.id;
  select coalesce(jsonb_agg(
           private.face(m.user_id)
           || jsonb_build_object('role', m.role)
           order by case m.role
             when 'owner' then 0
             when 'admin' then 1 else 2 end,
             m.joined_at), '[]'::jsonb)
    into members
    from public.community_members m
    join public.profiles p
      on p.user_id = m.user_id
   where m.community_id = c.id
     and p.is_public and p.adult
     and not p.hidden_by_admin;
  select count(*) into week
    from public.community_posts
   where community_id = c.id and not hidden
     and created_at > now() - interval '7 days';
  if me_role is not null or c.is_mock then
    select coalesce(jsonb_agg(y.x), '[]'::jsonb)
      into posts from (
      select coalesce(private.face(cp.author),
               jsonb_build_object('name', null))
             || jsonb_build_object(
               'id', cp.id, 'body', cp.body,
               'at', cp.created_at,
               'mine', cp.author = auth.uid()) x
        from public.community_posts cp
       where cp.community_id = c.id
         and not cp.hidden
       order by cp.created_at desc
       limit 50) y;
  end if;
  if me_role in ('owner', 'admin') then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'uid', m.user_id,
               'name', p.display_name,
               'role', m.role,
               'adult', coalesce(p.adult, false))
             order by case m.role
               when 'owner' then 0
               when 'admin' then 1 else 2 end,
               m.joined_at), '[]'::jsonb)
      into manage
      from public.community_members m
      left join public.profiles p
        on p.user_id = m.user_id
     where m.community_id = c.id;
  end if;
  return jsonb_build_object(
    'slug', c.slug, 'name', c.name,
    'kind', c.kind, 'city', c.city,
    'description', c.description,
    'avatar', c.avatar_card,
    'contact', c.contact,
    'mock', c.is_mock,
    'created_at', c.created_at,
    'member_n', n, 'members', members,
    'week_posts', week, 'posts', posts,
    'role', me_role,
    'can_join', me_role is null
      and auth.uid() is not null
      and private.is_adult(auth.uid())
      and not c.is_mock,
    'manage', manage);
end $$;
