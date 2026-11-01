-- Conquistas (achievements, like a Facebook
-- milestone): "Ganhei o Set Championship",
-- "Campeão da liguinha"… with a date, an
-- optional place, a text and 1 photo.
-- Who sees one: the owner; friends; and
-- everyone when it is marked public and the
-- profile is public (18+, not hidden).
-- Photos live in the private "achievements"
-- bucket (folder = the owner's id); the page
-- asks for short-lived signed links, and the
-- storage rules below only sign a photo for
-- someone who can see its achievement.
-- Optionally a post on Início tells friends.
-- Run after social.sql and hardening.sql
-- (safe to run again).

create table if not exists
  public.achievements (
  id uuid primary key
    default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id)
    on delete cascade,
  kind text not null default 'other'
    check (kind in ('set_championship',
      'league', 'store', 'top8', 'other')),
  title text not null
    check (length(btrim(title))
      between 1 and 80),
  body text not null default ''
    check (length(body) <= 500),
  happened_on date not null
    default current_date,
  place text not null default ''
    check (length(place) <= 80),
  image text
    check (image is null
      or length(image) <= 200),
  visibility text not null default 'friends'
    check (visibility in
      ('friends', 'public')),
  hidden boolean not null default false,
  created_at timestamptz not null
    default now());
create index if not exists achievements_user
  on public.achievements
    (user_id, happened_on desc);
alter table public.achievements
  enable row level security;
revoke all on public.achievements
  from anon, authenticated;

-- the post on Início that tells friends
alter table public.posts
  add column if not exists achievement uuid
    references public.achievements(id)
    on delete cascade;

-- can the person asking see this one?
create or replace function
  private.sees_achievement(
    a public.achievements)
returns boolean
language sql stable security definer
set search_path = '' as $$
  select a.user_id = auth.uid()
    or (not a.hidden
      and exists (select 1
        from public.profiles p
       where p.user_id = a.user_id
         and not coalesce(p.hidden_by_admin,
           false))
      and ((auth.uid() is not null
          and private.are_friends(
            a.user_id, auth.uid()))
        or (a.visibility = 'public'
          and exists (select 1
            from public.profiles p
           where p.user_id = a.user_id
             and p.is_public
             and coalesce(p.adult, false)))));
$$;
revoke all on function
  private.sees_achievement(public.achievements)
  from public;


create or replace function
  private.achievement_json(
    a public.achievements)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'kind', a.kind,
    'title', a.title, 'body', a.body,
    'on', a.happened_on, 'place', a.place,
    'image', a.image,
    'visibility', a.visibility,
    'mine', a.user_id = auth.uid());
$$;

-- a profile's achievements (p_handle null:
-- mine), newest first
create or replace function
  public.achievements_of(p_handle text)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce(jsonb_agg(
      private.achievement_json(a)
      order by a.happened_on desc,
        a.created_at desc), '[]'::jsonb)
    from public.achievements a
   where a.user_id = case
       when p_handle is null then auth.uid()
       else (select user_id
         from public.profiles
        where lower(handle) = lower(p_handle))
     end
     and private.sees_achievement(a);
$$;

-- the ones behind posts on Início
create or replace function
  public.achievements_by_ids(p_ids uuid[])
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce(jsonb_agg(
      private.achievement_json(a)),
      '[]'::jsonb)
    from public.achievements a
   where a.id = any(p_ids[1:100])
     and private.sees_achievement(a);
$$;

-- add or change one; p.announce = also post
-- it on Início (only when it is new)
create or replace function
  public.save_achievement(p jsonb)
returns uuid
language plpgsql security definer
set search_path = '' as $$
declare
  u uuid := auth.uid(); aid uuid;
  d date; img text;
begin
  if u is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  d := coalesce(nullif(p->>'on', '')::date,
    current_date);
  if d < date '2023-01-01'
     or d > current_date + 1 then
    raise exception 'bad_date';
  end if;
  img := nullif(p->>'image', '');
  if img is not null
     and img !~ ('^' || u::text
       || '/[a-z0-9-]{8,60}\.(jpg|webp)$')
  then
    raise exception 'bad_image';
  end if;
  if coalesce(p->>'id', '') = '' then
    perform private.rate_hit(
      'achievements', 20, interval '1 day');
    insert into public.achievements
      (user_id, kind, title, body,
       happened_on, place, image, visibility)
    values (u,
      coalesce(p->>'kind', 'other'),
      btrim(coalesce(p->>'title', '')),
      left(coalesce(p->>'body', ''), 500),
      d, left(coalesce(p->>'place', ''), 80),
      img,
      coalesce(p->>'visibility', 'friends'))
    returning id into aid;
    if coalesce((p->>'announce')::boolean,
         false) then
      insert into public.posts
        (author, body, visibility,
         achievement)
      values (u,
        left(btrim(coalesce(p->>'title', '')),
          200),
        coalesce(p->>'visibility', 'friends'),
        aid);
    end if;
  else
    update public.achievements
       set kind = coalesce(p->>'kind', kind),
           title = btrim(coalesce(
             p->>'title', title)),
           body = left(coalesce(
             p->>'body', body), 500),
           happened_on = d,
           place = left(coalesce(
             p->>'place', place), 80),
           image = img,
           visibility = coalesce(
             p->>'visibility', visibility)
     where id = (p->>'id')::uuid
       and user_id = u
    returning id into aid;
    if aid is null then
      raise exception 'not allowed'
        using errcode = '42501';
    end if;
    update public.posts
       set visibility = coalesce(
             p->>'visibility', visibility),
           body = left(btrim(coalesce(
             p->>'title', body)), 200)
     where achievement = aid;
  end if;
  return aid;
end $$;

create or replace function
  public.delete_achievement(p_id uuid)
returns text
language plpgsql security definer
set search_path = '' as $$
declare img text;
begin
  delete from public.achievements
   where id = p_id and user_id = auth.uid()
  returning image into img;
  return img;   -- the page removes the photo
end $$;

-- admins: hide / show one
create or replace function
  public.admin_hide_achievement(
    p_id uuid, p_hidden boolean)
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  update public.achievements
     set hidden = coalesce(p_hidden, true)
   where id = p_id;
  update public.posts
     set hidden = coalesce(p_hidden, true)
   where achievement = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'save_achievement(jsonb)',
    'delete_achievement(uuid)',
    'admin_hide_achievement(uuid, boolean)']
  loop
    execute format('revoke all on function'
      || ' public.%s from public, anon', f);
    execute format('grant execute on function'
      || ' public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function
  public.achievements_of(text) from public;
grant execute on function
  public.achievements_of(text)
  to anon, authenticated;
revoke all on function
  public.achievements_by_ids(uuid[])
  from public;
grant execute on function
  public.achievements_by_ids(uuid[])
  to anon, authenticated;

-- posts carry their achievement id
do $$
declare d text;
begin
  d := pg_get_functiondef(
    'private.post_json(public.posts)'
      ::regprocedure);
  if position('''achievement''' in d) = 0
  then
    d := replace(d, '''deck'', p.deck,',
      '''deck'', p.deck, '
      || '''achievement'', p.achievement,');
    execute d;
  end if;
end $$;

-- ---------- the photos ----------
-- (a public function: storage rules run as
-- the visitor, who can't reach "private")
create or replace function
  public.sees_achievement_photo(p_name text)
returns boolean
language sql stable security definer
set search_path = '' as $$
  select exists (select 1
    from public.achievements a
   where a.image = p_name
     and private.sees_achievement(a));
$$;
revoke all on function
  public.sees_achievement_photo(text)
  from public;
grant execute on function
  public.sees_achievement_photo(text)
  to anon, authenticated;

insert into storage.buckets (id, name,
  public, file_size_limit,
  allowed_mime_types)
values ('achievements', 'achievements',
  false, 2000000,
  array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 2000000,
      allowed_mime_types =
        array['image/jpeg', 'image/webp'];

drop policy if exists "achievement photos: own"
  on storage.objects;
create policy "achievement photos: own"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'achievements'
    and (storage.foldername(name))[1]
      = (select auth.uid())::text)
  with check (bucket_id = 'achievements'
    and (storage.foldername(name))[1]
      = (select auth.uid())::text);

drop policy if exists "achievement photos: see"
  on storage.objects;
create policy "achievement photos: see"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'achievements'
    and public.sees_achievement_photo(name));

-- "Baixar meus dados": + achievements
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
       where x.user_id = u), '[]'),
    'achievements', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.achievements x
       where x.user_id = u), '[]'));
end $$;
