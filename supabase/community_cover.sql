-- Community background: a second card for
-- the top of the page (a Location is turned
-- sideways by the site). Run after
-- community_invites.sql.
alter table public.communities
  add column if not exists cover_card text
  check (length(cover_card) <= 40);

-- owner/admins set it (null clears it)
create or replace function
  public.set_community_cover(
    p_slug text, p_card text)
returns void
language plpgsql security definer
set search_path = '' as $$
declare cid uuid;
begin
  select id into cid
    from public.communities
   where slug = p_slug and not hidden;
  if cid is null
     or not private.can_manage(cid) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  update public.communities
     set cover_card = nullif(left(btrim(
           coalesce(p_card, '')), 40), '')
   where id = cid;
end $$;

-- same as before, plus the cover
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
    'cover', c.cover_card,
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

revoke all on function
  public.set_community_cover(text, text)
  from public, anon;
grant execute on function
  public.set_community_cover(text, text)
  to authenticated;
