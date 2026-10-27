-- Início social: posts with a card or a deck,
-- likes and comments; Mesas & Ligas (events
-- of a community, with "Vou"); notifications.
-- Everything goes through the functions below
-- (tables have RLS on and no policies).
-- Posting, commenting and events: 18+, like
-- communities and recados. Run once.

-- ---------- tables ----------
create table if not exists public.posts (
  id uuid primary key
    default gen_random_uuid(),
  author uuid not null
    references auth.users(id)
    on delete cascade,
  body text not null default ''
    check (length(body) <= 1000),
  card_id text
    check (length(card_id) <= 40),
  foil boolean not null default false,
  deck jsonb
    check (deck is null
      or length(deck::text) <= 6000),
  visibility text not null
    default 'friends'
    check (visibility in
      ('friends', 'public')),
  hidden boolean not null default false,
  created_at timestamptz not null
    default now());
create index if not exists posts_author_at
  on public.posts (author, created_at desc);
create index if not exists posts_at
  on public.posts (created_at desc);

create table if not exists
  public.post_likes (
  post_id uuid not null
    references public.posts(id)
    on delete cascade,
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  created_at timestamptz not null
    default now(),
  primary key (post_id, user_id));

create table if not exists
  public.post_comments (
  id uuid primary key
    default gen_random_uuid(),
  post_id uuid not null
    references public.posts(id)
    on delete cascade,
  author uuid not null
    references auth.users(id)
    on delete cascade,
  body text not null
    check (length(btrim(body))
      between 1 and 500),
  hidden boolean not null default false,
  created_at timestamptz not null
    default now());
create index if not exists post_comments_post
  on public.post_comments
    (post_id, created_at);

create table if not exists public.events (
  id uuid primary key
    default gen_random_uuid(),
  community_id uuid not null
    references public.communities(id)
    on delete cascade,
  title text not null
    check (length(btrim(title))
      between 3 and 80),
  starts_at timestamptz not null,
  place text not null default ''
    check (length(place) <= 160),
  details text not null default ''
    check (length(details) <= 600),
  capacity int
    check (capacity is null
      or capacity between 2 and 999),
  cancelled boolean not null
    default false,
  created_by uuid
    references auth.users(id)
    on delete set null,
  created_at timestamptz not null
    default now());
create index if not exists events_comm_at
  on public.events (community_id, starts_at);

create table if not exists
  public.event_rsvps (
  event_id uuid not null
    references public.events(id)
    on delete cascade,
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  status text not null
    check (status in ('going', 'maybe')),
  created_at timestamptz not null
    default now(),
  primary key (event_id, user_id));

create table if not exists
  public.notifications (
  id uuid primary key
    default gen_random_uuid(),
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  kind text not null,
  actor uuid
    references auth.users(id)
    on delete cascade,
  ref jsonb not null default '{}',
  created_at timestamptz not null
    default now(),
  read_at timestamptz);
create index if not exists notif_user_at
  on public.notifications
    (user_id, created_at desc);

alter table public.posts
  enable row level security;
alter table public.post_likes
  enable row level security;
alter table public.post_comments
  enable row level security;
alter table public.events
  enable row level security;
alter table public.event_rsvps
  enable row level security;
alter table public.notifications
  enable row level security;

-- ---------- helpers ----------
create or replace function
  private.need_adult()
returns void
language plpgsql stable security definer
set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if not private.is_adult(auth.uid()) then
    raise exception 'adults_only';
  end if;
end $$;

-- can I see this post?
create or replace function
  private.sees_post(p public.posts)
returns boolean
language sql stable security definer
set search_path = '' as $$
  select not p.hidden and (
    p.author = auth.uid()
    or private.are_friends(
         p.author, auth.uid())
    or (p.visibility = 'public'
        and auth.uid() is not null));
$$;

create or replace function
  private.notify(
    p_user uuid, p_kind text, p_ref jsonb)
returns void
language sql security definer
set search_path = '' as $$
  insert into public.notifications
    (user_id, kind, actor, ref)
  select p_user, p_kind, auth.uid(), p_ref
   where p_user is not null
     and p_user <> auth.uid();
$$;

-- one post, as the page shows it
create or replace function
  private.post_json(p public.posts)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select private.face(p.author)
    || jsonb_build_object(
      'id', p.id, 'author', p.author,
      'body', p.body,
      'card', p.card_id, 'foil', p.foil,
      'deck', p.deck,
      'visibility', p.visibility,
      'at', p.created_at,
      'mine', p.author = auth.uid(),
      'likes', (select count(*)
        from public.post_likes l
       where l.post_id = p.id),
      'liked', exists (select 1
        from public.post_likes l
       where l.post_id = p.id
         and l.user_id = auth.uid()),
      'comments_n', (select count(*)
        from public.post_comments c
       where c.post_id = p.id
         and not c.hidden),
      'comments', coalesce((
        select jsonb_agg(x.j order by x.at)
          from (
          select c.created_at at,
                 private.face(c.author)
                 || jsonb_build_object(
                   'id', c.id,
                   'body', c.body,
                   'at', c.created_at,
                   'mine',
                     c.author = auth.uid())
                 j
            from public.post_comments c
           where c.post_id = p.id
             and not c.hidden
           order by c.created_at desc
           limit 3) x), '[]'::jsonb));
$$;

-- ---------- posts ----------
create or replace function
  public.create_post(
    p_body text, p_card text default null,
    p_foil boolean default false,
    p_deck jsonb default null,
    p_visibility text default 'friends')
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare r public.posts;
begin
  perform private.need_adult();
  if length(btrim(coalesce(p_body, '')))
       = 0 and p_card is null
     and p_deck is null then
    raise exception 'empty post';
  end if;
  if (select count(*) from public.posts
       where author = auth.uid()
         and created_at
           > now() - interval '1 day')
     >= 30 then
    raise exception 'too many posts';
  end if;
  insert into public.posts
    (author, body, card_id, foil, deck,
     visibility)
  values (auth.uid(),
    btrim(coalesce(p_body, '')),
    nullif(btrim(coalesce(p_card, '')), ''),
    coalesce(p_foil, false),
    case when jsonb_typeof(p_deck)
           = 'object' then p_deck end,
    case when p_visibility = 'public'
      then 'public' else 'friends' end)
  returning * into r;
  return private.post_json(r);
end $$;

-- me, my friends, and public posts of people
-- who share a community with me
create or replace function
  public.feed_posts(
    p_before timestamptz default null,
    p_limit int default 20)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce(jsonb_agg(
           private.post_json(x)
           order by x.created_at desc),
         '[]'::jsonb)
    from (
    select p.* from public.posts p
     where not p.hidden
       and p.created_at < coalesce(
             p_before, now() + interval '1 h')
       and (p.author = auth.uid()
         or private.are_friends(
              p.author, auth.uid())
         or (p.visibility = 'public'
           and exists (
             select 1
               from public.community_members a
               join public.community_members b
                 on b.community_id
                    = a.community_id
              where a.user_id = p.author
                and b.user_id = auth.uid())))
     order by p.created_at desc
     limit least(greatest(
       coalesce(p_limit, 20), 1), 50)) x;
$$;

create or replace function
  public.like_post(
    p_post uuid, p_on boolean default true)
returns void
language plpgsql security definer
set search_path = '' as $$
declare p public.posts;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  select * into p from public.posts
   where id = p_post;
  if p.id is null
     or not private.sees_post(p) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  if p_on then
    insert into public.post_likes
      (post_id, user_id)
    values (p.id, auth.uid())
    on conflict do nothing;
    if found then
      perform private.notify(p.author,
        'like', jsonb_build_object(
          'post', p.id));
    end if;
  else
    delete from public.post_likes
     where post_id = p.id
       and user_id = auth.uid();
  end if;
end $$;

create or replace function
  public.comment_post(
    p_post uuid, p_body text)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare p public.posts; cid uuid;
begin
  perform private.need_adult();
  select * into p from public.posts
   where id = p_post;
  if p.id is null
     or not private.sees_post(p) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  if (select count(*)
        from public.post_comments
       where author = auth.uid()
         and created_at
           > now() - interval '1 day')
     >= 100 then
    raise exception 'too many comments';
  end if;
  insert into public.post_comments
    (post_id, author, body)
  values (p.id, auth.uid(),
    btrim(coalesce(p_body, '')))
  returning id into cid;
  perform private.notify(p.author,
    'comment', jsonb_build_object(
      'post', p.id, 'comment', cid));
  return private.post_json(p);
end $$;

create or replace function
  public.post_comments_all(p_post uuid)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare p public.posts;
begin
  select * into p from public.posts
   where id = p_post;
  if p.id is null
     or not private.sees_post(p) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(
      private.face(c.author)
      || jsonb_build_object(
        'id', c.id, 'body', c.body,
        'at', c.created_at,
        'mine', c.author = auth.uid())
      order by c.created_at)
      from public.post_comments c
     where c.post_id = p.id
       and not c.hidden), '[]'::jsonb);
end $$;

-- author deletes; site admin hides or deletes
create or replace function
  public.moderate_post(
    p_action text,
    p_post uuid default null,
    p_comment uuid default null)
returns void
language plpgsql security definer
set search_path = '' as $$
declare a uuid; pa uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if p_comment is not null then
    select c.author, p.author into a, pa
      from public.post_comments c
      join public.posts p on p.id = c.post_id
     where c.id = p_comment;
    if p_action = 'delete' and (a = auth.uid()
         or pa = auth.uid()
         or private.is_admin()) then
      delete from public.post_comments
       where id = p_comment;
    elsif p_action = 'hide'
          and private.is_admin() then
      update public.post_comments
         set hidden = true
       where id = p_comment;
    else
      raise exception 'not allowed'
        using errcode = '42501';
    end if;
    return;
  end if;
  select author into a from public.posts
   where id = p_post;
  if p_action = 'delete' and (a = auth.uid()
       or private.is_admin()) then
    delete from public.posts where id = p_post;
  elsif p_action = 'hide'
        and private.is_admin() then
    update public.posts set hidden = true
     where id = p_post;
  else
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
end $$;

-- goes to the admin's reports, with the post id
create or replace function
  public.report_post(
    p_post uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = '' as $$
declare p public.posts;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  select * into p from public.posts
   where id = p_post;
  if p.id is null
     or not private.sees_post(p) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  if (select count(*) from public.reports
       where reporter = auth.uid()
         and created_at
           > now() - interval '1 day')
     >= 10 then
    raise exception 'too many reports';
  end if;
  insert into public.reports
    (reporter, target, reason)
  values (auth.uid(), p.author, left(format(
    '[post:%s] "%s" — %s', p.id,
    left(p.body, 120),
    btrim(coalesce(p_reason, ''))), 500));
end $$;

-- ---------- Mesas & Ligas ----------
create or replace function
  private.event_json(e public.events)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'title', e.title,
    'starts_at', e.starts_at,
    'place', e.place,
    'details', e.details,
    'capacity', e.capacity,
    'cancelled', e.cancelled,
    'community', c.name, 'slug', c.slug,
    'avatar', c.avatar_card,
    'going', (select count(*)
      from public.event_rsvps r
     where r.event_id = e.id
       and r.status = 'going'),
    'maybe', (select count(*)
      from public.event_rsvps r
     where r.event_id = e.id
       and r.status = 'maybe'),
    'me', (select r.status
      from public.event_rsvps r
     where r.event_id = e.id
       and r.user_id = auth.uid()),
    'can_edit',
      private.can_manage(e.community_id),
    'people', coalesce((
      select jsonb_agg(private.face(r.user_id)
        || jsonb_build_object(
          'status', r.status)
        order by r.created_at)
        from public.event_rsvps r
        join public.profiles p
          on p.user_id = r.user_id
       where r.event_id = e.id
         and p.is_public and p.adult
         and not p.hidden_by_admin),
      '[]'::jsonb))
    from public.communities c
   where c.id = e.community_id;
$$;

-- owner or admin creates or edits; members are
-- told about a new one
create or replace function
  public.save_event(
    p_slug text, p jsonb,
    p_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  cid uuid; e public.events;
begin
  perform private.need_adult();
  select id into cid
    from public.communities
   where slug = p_slug and not hidden
     and not is_mock;
  if cid is null
     or not private.can_manage(cid) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.events
      (community_id, title, starts_at,
       place, details, capacity, created_by)
    values (cid, btrim(p->>'title'),
      (p->>'starts_at')::timestamptz,
      btrim(coalesce(p->>'place', '')),
      btrim(coalesce(p->>'details', '')),
      nullif(p->>'capacity', '')::int,
      auth.uid())
    returning * into e;
    insert into public.notifications
      (user_id, kind, actor, ref)
    select m.user_id, 'event', auth.uid(),
           jsonb_build_object(
             'event', e.id, 'slug', p_slug)
      from public.community_members m
     where m.community_id = cid
       and m.user_id <> auth.uid()
     limit 1000;
  else
    update public.events set
      title = coalesce(nullif(
        btrim(p->>'title'), ''), title),
      starts_at = coalesce(
        (p->>'starts_at')::timestamptz,
        starts_at),
      place = case when p ? 'place'
        then btrim(coalesce(p->>'place', ''))
        else place end,
      details = case when p ? 'details'
        then btrim(coalesce(
          p->>'details', ''))
        else details end,
      capacity = case when p ? 'capacity'
        then nullif(p->>'capacity', '')::int
        else capacity end,
      cancelled = case when p ? 'cancelled'
        then coalesce(
          (p->>'cancelled')::boolean, false)
        else cancelled end
    where id = p_id and community_id = cid
    returning * into e;
    if e.id is null then
      raise exception 'unknown event';
    end if;
  end if;
  return private.event_json(e);
end $$;

-- the community's next events (anyone sees
-- them, like the community page)
create or replace function
  public.community_events(p_slug text)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce(jsonb_agg(
           private.event_json(e)
           order by e.starts_at), '[]'::jsonb)
    from public.events e
    join public.communities c
      on c.id = e.community_id
   where c.slug = p_slug and not c.hidden
     and e.starts_at
       > now() - interval '6 hours'
     and e.starts_at
       < now() + interval '120 days';
$$;

-- next events in my communities (Início)
create or replace function
  public.my_events()
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce(jsonb_agg(x.j
           order by x.at), '[]'::jsonb)
    from (
    select e.starts_at at,
           private.event_json(e) j
      from public.events e
      join public.community_members m
        on m.community_id = e.community_id
       and m.user_id = auth.uid()
      join public.communities c
        on c.id = e.community_id
       and not c.hidden
     where not e.cancelled
       and e.starts_at
         > now() - interval '6 hours'
     order by e.starts_at
     limit 8) x;
$$;

-- members say "Vou" / "Talvez" / nothing
create or replace function
  public.rsvp_event(
    p_event uuid, p_status text)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare e public.events; n int;
begin
  perform private.need_adult();
  select * into e from public.events
   where id = p_event;
  if e.id is null or e.cancelled
     or not exists (
       select 1 from public.community_members
        where community_id = e.community_id
          and user_id = auth.uid()) then
    raise exception 'members_only';
  end if;
  if p_status is null
     or p_status not in ('going', 'maybe')
  then
    delete from public.event_rsvps
     where event_id = e.id
       and user_id = auth.uid();
  else
    if p_status = 'going'
       and e.capacity is not null then
      select count(*) into n
        from public.event_rsvps
       where event_id = e.id
         and status = 'going'
         and user_id <> auth.uid();
      if n >= e.capacity then
        raise exception 'event_full';
      end if;
    end if;
    insert into public.event_rsvps
      (event_id, user_id, status)
    values (e.id, auth.uid(), p_status)
    on conflict (event_id, user_id)
    do update set status = excluded.status;
    if p_status = 'going' then
      perform private.notify(e.created_by,
        'rsvp', jsonb_build_object(
          'event', e.id));
    end if;
  end if;
  return private.event_json(e);
end $$;

-- ---------- notifications ----------
create or replace function
  public.my_notifications()
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce(jsonb_agg(
    coalesce(private.face(n.actor),
      '{}'::jsonb)
    || jsonb_build_object(
      'id', n.id, 'kind', n.kind,
      'ref', n.ref
        || case when n.ref ? 'post' then
          jsonb_build_object('text', (
            select left(p.body, 80)
              from public.posts p
             where p.id
               = (n.ref->>'post')::uuid))
        when n.ref ? 'event' then
          jsonb_build_object('text', (
            select e.title
              from public.events e
             where e.id
               = (n.ref->>'event')::uuid),
            'slug', coalesce(n.ref->>'slug', (
            select c.slug
              from public.events e
              join public.communities c
                on c.id = e.community_id
             where e.id
               = (n.ref->>'event')::uuid)))
        else '{}'::jsonb end,
      'at', n.created_at,
      'unread', n.read_at is null)
    order by n.created_at desc),
    '[]'::jsonb)
    from (select * from public.notifications
           where user_id = auth.uid()
           order by created_at desc
           limit 30) n;
$$;

create or replace function
  public.read_notifications()
returns void
language sql security definer
set search_path = '' as $$
  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null;
$$;

-- ---------- grants ----------
do $$
declare f text;
begin
  foreach f in array array[
    'create_post(text, text, boolean,'
      || ' jsonb, text)',
    'feed_posts(timestamptz, int)',
    'like_post(uuid, boolean)',
    'comment_post(uuid, text)',
    'post_comments_all(uuid)',
    'moderate_post(text, uuid, uuid)',
    'report_post(uuid, text)',
    'save_event(text, jsonb, uuid)',
    'my_events()',
    'rsvp_event(uuid, text)',
    'my_notifications()',
    'read_notifications()']
  loop
    execute format('revoke all on function'
      || ' public.%s from public, anon', f);
    execute format('grant execute on function'
      || ' public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function
  public.community_events(text)
  from public;
grant execute on function
  public.community_events(text)
  to anon, authenticated;
