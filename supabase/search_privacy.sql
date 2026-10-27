-- 1. Global search: people and communities.
--    People: public profiles (18+, not hidden)
--    and my friends. Never e-mails.
-- 2. Privacy: other members could read the
--    "default" columns of anyone's profile
--    (coach e-mail, groups). Now only the owner
--    reads them, through my_settings().
-- Run after communities.sql and social.sql.

create or replace function
  public.search_all(p_q text)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare
  q text := btrim(regexp_replace(
    coalesce(p_q, ''), '[%_\\]', '', 'g'));
  people jsonb; comms jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if length(q) < 2 then
    return jsonb_build_object(
      'people', '[]'::jsonb,
      'communities', '[]'::jsonb);
  end if;
  q := left(q, 60);
  select coalesce(jsonb_agg(y.j
           order by y.fr desc, y.n),
         '[]'::jsonb)
    into people from (
    select private.face(p.user_id)
           || jsonb_build_object(
             'uid', p.user_id,
             'city', case when p.is_public
               then p.city end,
             'friend', f.fr) j,
           f.fr, p.display_name n
      from public.profiles p
      cross join lateral (select
        private.are_friends(
          p.user_id, auth.uid()) fr) f
     where p.user_id <> auth.uid()
       and not coalesce(p.hidden_by_admin,
         false)
       and coalesce(p.adult, false)
       and (p.is_public or f.fr)
       and (p.display_name ilike
             '%' || q || '%'
         or p.handle ilike q || '%')
     order by f.fr desc, p.display_name
     limit 12) y;
  select coalesce(jsonb_agg(z.j
           order by z.mine desc, z.n),
         '[]'::jsonb)
    into comms from (
    select jsonb_build_object(
             'slug', c.slug, 'name', c.name,
             'kind', c.kind, 'city', c.city,
             'avatar', c.avatar_card,
             'mine', m.uid is not null) j,
           m.uid is not null mine, c.name n
      from public.communities c
      left join lateral (
        select x.user_id uid
          from public.community_members x
         where x.community_id = c.id
           and x.user_id = auth.uid()) m
        on true
     where not c.hidden
       and (c.name || ' '
         || coalesce(c.city, ''))
         ilike '%' || q || '%'
     order by m.uid is not null desc, c.name
     limit 8) z;
  return jsonb_build_object(
    'people', people,
    'communities', comms);
end $$;

revoke all on function
  public.search_all(text)
  from public, anon;
grant execute on function
  public.search_all(text) to authenticated;

-- my own defaults (Início, Trocas)
create or replace function
  public.my_settings()
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select to_jsonb(x) from (
    select p.user_id, p.display_name,
           p.default_visibility,
           p.default_group_id,
           p.default_coach_email,
           p.default_coach_group_id,
           p.auto_collection
      from public.profiles p
     where p.user_id = auth.uid()) x;
$$;
revoke all on function
  public.my_settings() from public, anon;
grant execute on function
  public.my_settings() to authenticated;

-- names stay readable; the rest doesn't
revoke select (default_visibility,
  default_group_id, default_coach_email,
  default_coach_group_id, auto_collection)
  on public.profiles from authenticated;
