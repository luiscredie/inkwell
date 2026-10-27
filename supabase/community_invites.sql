-- Communities: open or with approval;
-- requests to join; invitations from the
-- owner and admins. Run after social.sql.

alter table public.communities
  add column if not exists join_mode text
  not null default 'open'
  check (join_mode in ('open', 'approval'));

create table if not exists
  public.community_requests (
  community_id uuid not null
    references public.communities(id)
    on delete cascade,
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  created_at timestamptz not null
    default now(),
  primary key (community_id, user_id));

create table if not exists
  public.community_invites (
  community_id uuid not null
    references public.communities(id)
    on delete cascade,
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  invited_by uuid
    references auth.users(id)
    on delete set null,
  created_at timestamptz not null
    default now(),
  primary key (community_id, user_id));

alter table public.community_requests
  enable row level security;
alter table public.community_invites
  enable row level security;

-- tell every owner and admin
create or replace function
  private.notify_managers(
    p_cid uuid, p_kind text, p_ref jsonb)
returns void
language sql security definer
set search_path = '' as $$
  insert into public.notifications
    (user_id, kind, actor, ref)
  select m.user_id, p_kind, auth.uid(), p_ref
    from public.community_members m
   where m.community_id = p_cid
     and m.role in ('owner', 'admin')
     and m.user_id <> auth.uid();
$$;

-- join, ask to join, or leave. Returns
-- 'joined', 'requested' or 'left'.
drop function if exists
  public.join_community(text, boolean);
create function public.join_community(
  p_slug text, p_join boolean default true)
returns text
language plpgsql security definer
set search_path = '' as $$
declare c public.communities;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  select * into c from public.communities
   where slug = p_slug and not hidden
     and not is_mock;
  if c.id is null then
    raise exception 'unknown community';
  end if;
  if not p_join then
    if exists (
      select 1 from public.community_members
       where community_id = c.id
         and user_id = auth.uid()
         and role = 'owner') then
      raise exception 'owner_cannot_leave';
    end if;
    delete from public.community_members
     where community_id = c.id
       and user_id = auth.uid();
    delete from public.community_requests
     where community_id = c.id
       and user_id = auth.uid();
    return 'left';
  end if;
  if not private.is_adult(auth.uid()) then
    raise exception 'adults_only';
  end if;
  if c.join_mode = 'approval'
     and not exists (
       select 1 from public.community_invites
        where community_id = c.id
          and user_id = auth.uid())
     and not exists (
       select 1 from public.community_members
        where community_id = c.id
          and user_id = auth.uid()) then
    insert into public.community_requests
      (community_id, user_id)
    values (c.id, auth.uid())
    on conflict do nothing;
    if found then
      perform private.notify_managers(c.id,
        'join_request', jsonb_build_object(
          'slug', c.slug, 'name', c.name));
    end if;
    return 'requested';
  end if;
  insert into public.community_members
    (community_id, user_id)
  values (c.id, auth.uid())
  on conflict do nothing;
  delete from public.community_invites
   where community_id = c.id
     and user_id = auth.uid();
  delete from public.community_requests
   where community_id = c.id
     and user_id = auth.uid();
  return 'joined';
end $$;

-- my standing in a community, and for the
-- owner/admins the pending requests and
-- invitations
create or replace function
  public.community_access(p_slug text)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare c public.communities; man boolean;
begin
  select * into c from public.communities
   where slug = p_slug and not hidden;
  if c.id is null then return null; end if;
  man := private.can_manage(c.id);
  return jsonb_build_object(
    'join_mode', c.join_mode,
    'requested', exists (
      select 1 from public.community_requests
       where community_id = c.id
         and user_id = auth.uid()),
    'invited', exists (
      select 1 from public.community_invites
       where community_id = c.id
         and user_id = auth.uid()),
    'requests', case when man then coalesce((
      select jsonb_agg(
        coalesce(private.face(r.user_id),
          '{}'::jsonb)
        || jsonb_build_object(
          'uid', r.user_id,
          'at', r.created_at)
        order by r.created_at)
        from public.community_requests r
       where r.community_id = c.id),
      '[]'::jsonb) end,
    'invites', case when man then coalesce((
      select jsonb_agg(i.user_id)
        from public.community_invites i
       where i.community_id = c.id),
      '[]'::jsonb) end);
end $$;

-- owner/admins: open or with approval
create or replace function
  public.set_community_join_mode(
    p_slug text, p_mode text)
returns void
language plpgsql security definer
set search_path = '' as $$
declare cid uuid;
begin
  select id into cid
    from public.communities
   where slug = p_slug and not hidden;
  if cid is null
     or not private.can_manage(cid)
     or p_mode not in ('open', 'approval')
  then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  update public.communities
     set join_mode = p_mode
   where id = cid;
end $$;

-- owner/admins invite someone (a friend
-- picked on the page); they get a notice
create or replace function
  public.invite_to_community(
    p_slug text, p_user uuid)
returns void
language plpgsql security definer
set search_path = '' as $$
declare c public.communities;
begin
  select * into c from public.communities
   where slug = p_slug and not hidden
     and not is_mock;
  if c.id is null
     or not private.can_manage(c.id) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from public.community_members
     where community_id = c.id
       and user_id = p_user) then
    return;
  end if;
  if (select count(*)
        from public.community_invites
       where invited_by = auth.uid()
         and created_at
           > now() - interval '1 day')
     >= 50 then
    raise exception 'too many invites';
  end if;
  insert into public.community_invites
    (community_id, user_id, invited_by)
  values (c.id, p_user, auth.uid())
  on conflict do nothing;
  if found then
    perform private.notify(p_user,
      'community_invite', jsonb_build_object(
        'slug', c.slug, 'name', c.name));
  end if;
end $$;

-- owner/admins accept or turn down a request
create or replace function
  public.answer_community_request(
    p_slug text, p_user uuid,
    p_accept boolean)
returns void
language plpgsql security definer
set search_path = '' as $$
declare c public.communities;
begin
  select * into c from public.communities
   where slug = p_slug and not hidden;
  if c.id is null
     or not private.can_manage(c.id) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  delete from public.community_requests
   where community_id = c.id
     and user_id = p_user;
  if not found then
    raise exception 'no request';
  end if;
  if p_accept then
    if not private.is_adult(p_user) then
      raise exception 'adults_only';
    end if;
    insert into public.community_members
      (community_id, user_id)
    values (c.id, p_user)
    on conflict do nothing;
    perform private.notify(p_user,
      'join_accepted', jsonb_build_object(
        'slug', c.slug, 'name', c.name));
  end if;
end $$;

revoke all on function
  public.join_community(text, boolean)
  from public, anon;
grant execute on function
  public.join_community(text, boolean)
  to authenticated;
revoke all on function
  public.community_access(text)
  from public;
grant execute on function
  public.community_access(text)
  to anon, authenticated;
revoke all on function
  public.set_community_join_mode(text, text)
  from public, anon;
grant execute on function
  public.set_community_join_mode(text, text)
  to authenticated;
revoke all on function
  public.invite_to_community(text, uuid)
  from public, anon;
grant execute on function
  public.invite_to_community(text, uuid)
  to authenticated;
revoke all on function
  public.answer_community_request(
    text, uuid, boolean)
  from public, anon;
grant execute on function
  public.answer_community_request(
    text, uuid, boolean)
  to authenticated;
