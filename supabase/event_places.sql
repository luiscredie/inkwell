-- "Evento novo perto de você": the place a
-- person chose to keep in their account (with
-- consent), and the daily check for new Play
-- Hub events near it.
--  * user_places: one rounded point (~1 km,
--    2 decimals), a label (district/city), a
--    radius and the notices switch. Only the
--    person reads it. Gone with the account.
--  * event_seen: Play Hub events already known
--    for that person (so each is told once).
--  * the events-near function (daily) sends
--    the events it found through near_events();
--    the first run only learns what exists.
--  * my_data_export() now also lists posts,
--    comments, event marks, devices, notices
--    and the saved place.
-- Run after social.sql, event_marks.sql and
-- push.sql.

create table if not exists public.user_places (
  user_id uuid primary key
    references auth.users(id)
    on delete cascade,
  lat numeric(5, 2) not null
    check (lat between -90 and 90),
  lng numeric(5, 2) not null
    check (lng between -180 and 180),
  label text check (length(label) <= 80),
  km int not null default 100
    check (km between 5 and 300),
  notify boolean not null default true,
  baseline_done boolean not null
    default false,
  consent_at timestamptz not null
    default now(),
  updated_at timestamptz not null
    default now());
alter table public.user_places
  enable row level security;

create table if not exists public.event_seen (
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  rph_id bigint not null,
  seen_at timestamptz not null
    default now(),
  primary key (user_id, rph_id));
alter table public.event_seen
  enable row level security;

-- save (consent given by the person's click)
create or replace function
  public.set_my_place(
    p_lat numeric, p_lng numeric,
    p_label text default null,
    p_km int default 100,
    p_notify boolean default true)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare moved boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  select abs(lat - round(p_lat, 2))
           + abs(lng - round(p_lng, 2)) > 0
           or km <> p_km
    into moved
    from public.user_places
   where user_id = auth.uid();
  insert into public.user_places
    (user_id, lat, lng, label, km, notify)
  values (auth.uid(), round(p_lat, 2),
    round(p_lng, 2),
    nullif(left(btrim(
      coalesce(p_label, '')), 80), ''),
    least(300, greatest(5,
      coalesce(p_km, 100))),
    coalesce(p_notify, true))
  on conflict (user_id) do update
    set lat = excluded.lat,
        lng = excluded.lng,
        label = excluded.label,
        km = excluded.km,
        notify = excluded.notify,
        -- a new place or radius: learn
        -- again what is already there
        baseline_done = case when moved
          then false
          else public.user_places
            .baseline_done end,
        updated_at = now();
  return public.my_place();
end $$;

create or replace function
  public.my_place()
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select jsonb_build_object(
    'lat', lat, 'lng', lng, 'label', label,
    'km', km, 'notify', notify,
    'consent_at', consent_at)
    from public.user_places
   where user_id = auth.uid();
$$;

create or replace function
  public.delete_my_place()
returns void
language sql security definer
set search_path = '' as $$
  delete from public.event_seen
   where user_id = auth.uid();
  delete from public.user_places
   where user_id = auth.uid();
$$;

-- for events-near: the key check and the list
-- of places (only the function calls these)
create or replace function
  public.near_places(p_key text)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
begin
  if p_key is null
     or p_key <> private.push_key() then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(
    jsonb_build_object('user', user_id,
      'lat', lat, 'lng', lng, 'km', km))
    from public.user_places
   where notify), '[]'::jsonb);
end $$;

-- what events-near found for one person:
-- [{id, name, start, store}] -> notices
create or replace function
  public.near_events(
    p_key text, p_user uuid, p_events jsonb)
returns int
language plpgsql security definer
set search_path = '' as $$
declare
  pl public.user_places;
  fresh jsonb; n int;
begin
  if p_key is null
     or p_key <> private.push_key() then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  select * into pl
    from public.user_places
   where user_id = p_user and notify;
  if pl.user_id is null
     or jsonb_typeof(p_events) <> 'array'
  then
    return 0;
  end if;
  with ev as (
    select (e->>'id')::bigint id, e
      from jsonb_array_elements(p_events) e
     where e->>'id' ~ '^\d{1,15}$'),
  ins as (
    insert into public.event_seen
      (user_id, rph_id)
    select p_user, id from ev
    on conflict do nothing
    returning rph_id)
  select coalesce(jsonb_agg(ev.e
           order by ev.e->>'start'),
         '[]'::jsonb)
    into fresh
    from ev join ins on ins.rph_id = ev.id;
  n := jsonb_array_length(fresh);
  if not pl.baseline_done then
    update public.user_places
       set baseline_done = true
     where user_id = p_user;
    return 0;   -- first look: just learn
  end if;
  if n between 1 and 3 then
    insert into public.notifications
      (user_id, kind, actor, ref)
    select p_user, 'event_near', null,
           jsonb_build_object(
             'rph', (x->>'id')::bigint,
             'text', left(x->>'name', 120),
             'at', x->>'start',
             'store', left(x->>'store', 80))
      from jsonb_array_elements(fresh) x;
  elsif n > 3 then
    insert into public.notifications
      (user_id, kind, actor, ref)
    values (p_user, 'event_near_many', null,
      jsonb_build_object('n', n,
        'text', coalesce(pl.label, '')));
  end if;
  return n;
end $$;

-- the old marks go after a while
create or replace function
  private.trim_event_seen()
returns void
language sql security definer
set search_path = '' as $$
  delete from public.event_seen
   where seen_at
     < now() - interval '200 days';
$$;

-- every day at 10:13 (Brasília) = 13:13 UTC
select cron.unschedule('inkwell-events-near')
 where exists (select 1 from cron.job
   where jobname = 'inkwell-events-near');
select cron.schedule('inkwell-events-near',
  '13 13 * * *',
  $c$select net.http_post(
    url := 'https://sorefaetiaebmjploanp'
      || '.supabase.co/functions/v1/'
      || 'events-near',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-key', private.push_key()),
    timeout_milliseconds := 60000);
  select private.trim_event_seen();$c$);

revoke all on function
  public.set_my_place(numeric, numeric,
    text, int, boolean) from public, anon;
grant execute on function
  public.set_my_place(numeric, numeric,
    text, int, boolean) to authenticated;
revoke all on function public.my_place()
  from public, anon;
grant execute on function public.my_place()
  to authenticated;
revoke all on function
  public.delete_my_place()
  from public, anon;
grant execute on function
  public.delete_my_place() to authenticated;
revoke all on function
  public.near_places(text) from public;
grant execute on function
  public.near_places(text)
  to anon, authenticated;
revoke all on function
  public.near_events(text, uuid, jsonb)
  from public;
grant execute on function
  public.near_events(text, uuid, jsonb)
  to anon, authenticated;

-- ---------- download my data ----------
create or replace function
  public.my_data_export()
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  return jsonb_build_object(
    'exported_at', now(),
    'about', 'Inkwell: todos os dados '
      || 'ligados à sua conta / all data '
      || 'linked to your account',
    'account', (select jsonb_build_object(
        'id', id, 'email', email,
        'created_at', created_at,
        'last_sign_in_at', last_sign_in_at)
      from auth.users where id = u),
    'profile', (select to_jsonb(p)
      from public.profiles p
     where p.user_id = u),
    'inkwell', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.inkwell_profiles x
       where x.user_id = u), '[]'),
    'games', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.game_logs x
       where x.user_id = u), '[]'),
    'game_notes', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.game_notes x
       where x.author = u), '[]'),
    'friendships', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.friendships x
       where u in (x.requester,
         x.addressee)), '[]'),
    'friend_groups', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.friend_groups x
       where x.owner_id = u), '[]'),
    'coach_groups', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.coach_groups x
       where x.owner_id = u), '[]'),
    'coach_links', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.coach_links x
       where x.owner_id = u), '[]'),
    'listings', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.listings x
       where x.user_id = u), '[]'),
    'loans', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.loans x
       where x.user_id = u), '[]'),
    'trades', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.trades x
       where x.user_id = u), '[]'),
    'loans_with_friends', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.user_loans x
       where u in (x.lender, x.borrower)),
      '[]'),
    'trades_with_friends', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.user_trades x
       where u in (x.proposer, x.partner)),
      '[]'),
    'collection_dates', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_added x
       where x.user_id = u), '[]'),
    'cards_at_home', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_home x
       where x.user_id = u), '[]'),
    'recados_received', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.recados x
       where x.owner = u), '[]'),
    'recados_written', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.recados x
       where x.author = u), '[]'),
    'communities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'community', c.name, 'slug', c.slug,
        'role', m.role,
        'joined_at', m.joined_at))
        from public.community_members m
        join public.communities c
          on c.id = m.community_id
       where m.user_id = u), '[]'),
    'community_posts', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.community_posts x
       where x.author = u), '[]'),
    'posts', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.posts x
       where x.author = u), '[]'),
    'post_comments', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.post_comments x
       where x.author = u), '[]'),
    'post_likes', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.post_likes x
       where x.user_id = u), '[]'),
    'table_rsvps', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.event_rsvps x
       where x.user_id = u), '[]'),
    'event_marks', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.event_marks x
       where x.user_id = u), '[]'),
    'saved_place', (select to_jsonb(x)
      from public.user_places x
     where x.user_id = u),
    'push_devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'device', x.ua,
        'since', x.created_at))
        from public.push_subs x
       where x.user_id = u), '[]'),
    'notifications', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.notifications x
       where x.user_id = u), '[]'),
    'reports_sent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reason', x.reason,
        'status', x.status,
        'created_at', x.created_at))
        from public.reports x
       where x.reporter = u), '[]'));
end $$;
revoke all on function
  public.my_data_export() from public, anon;
grant execute on function
  public.my_data_export() to authenticated;
