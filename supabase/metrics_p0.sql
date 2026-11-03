-- Issue #145, P0-B: product metrics with an
-- explicit schema, real counts only, no PII.
--
-- Definitions (also on the admin page):
--  * page_view: a page opened (kind 'view').
--  * Visit / session: one browser tab (random
--    code in sessionStorage; no cookie, no IP).
--    Unique visitors = distinct tabs.
--  * Active member (7d / 30d): distinct
--    accounts that opened at least one page
--    signed in, in the last 7 / 30 days. Only
--    (account, day) is kept, in
--    private.member_days, for 90 days.
--  * Events: try_deck_started,
--    deck_sample_loaded, signup_started,
--    signup_completed, deck_saved,
--    profile_started, profile_saved,
--    collection_started (older names are
--    counted under the new ones).
--  * Duplicates: an action counts once per
--    page view (the page) and the same event
--    from the same tab within 3 seconds is
--    dropped (here).
--  * Retention: 90 days. Admins, automated
--    browsers and "do not track" / GPC
--    browsers are not counted.
-- Run after site_stats.sql (safe to run
-- again).

create table if not exists
  private.member_days (
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  day date not null,
  primary key (user_id, day));
alter table private.member_days
  enable row level security;
revoke all on private.member_days
  from public, anon, authenticated;

create or replace function public.track(
  p_sid text, p_page text, p_kind text,
  p_name text, p_ref text, p_dev text)
returns void
language plpgsql security definer
set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if p_sid !~ '^[a-f0-9]{16,40}$'
     or p_page !~ '^[a-z_-]{1,20}$'
     or p_kind not in ('view', 'action')
     or (p_kind = 'action'
       and coalesce(p_name, '')
         !~ '^[a-z_]{1,30}$')
     or private.is_admin() then
    return;
  end if;
  -- a runaway tab stops counting
  if (select count(*)
        from private.page_events
       where sid = p_sid
         and at > now() - interval '1 day')
     >= 400 then
    return;
  end if;
  -- the same event twice in a row (a double
  -- tap, a page sending twice): once
  if exists (select 1
       from private.page_events
      where sid = p_sid and page = p_page
        and kind = p_kind
        and name is not distinct from
          case when p_kind = 'action'
            then p_name end
        and at > now()
          - interval '3 seconds') then
    return;
  end if;
  insert into private.page_events
    (sid, page, kind, name, signed, ref, dev)
  values (p_sid, p_page, p_kind,
    case when p_kind = 'action'
      then p_name end,
    u is not null,
    case when p_ref ~ '^[a-z0-9.-]{3,60}$'
      then p_ref end,
    case when p_dev in ('mobile', 'desktop')
      then p_dev end);
  if u is not null then
    insert into private.member_days
      (user_id, day)
    values (u, (now() at time zone
      'America/Sao_Paulo')::date)
    on conflict do nothing;
  end if;
end $$;
revoke all on function public.track(text, text,
  text, text, text, text) from public;
grant execute on function public.track(text,
  text, text, text, text, text)
  to anon, authenticated;

-- 90 days are enough (both tables)
create or replace function
  private.trim_page_events()
returns void
language sql security definer
set search_path = '' as $$
  delete from private.page_events
   where at < now() - interval '90 days';
  delete from private.member_days
   where day < (now() - interval '90 days')
     ::date;
$$;

-- the older event names, under the new ones
create or replace function
  private.event_name(p text)
returns text
language sql immutable
set search_path = '' as $$
  select case p
    when 'deck_sample'
      then 'deck_sample_loaded'
    when 'profile_start'
      then 'profile_started'
    when 'collection_start'
      then 'collection_started'
    when 'signin_code'
      then 'signup_started'
    else p end;
$$;

-- ---------- the P0 report (admin only) -----
create or replace function
  public.admin_metrics(p_days int)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare
  d int := least(90, greatest(1,
    coalesce(p_days, 14)));
  tz text := 'America/Sao_Paulo';
  since timestamptz;
  names text[] := array['page_view',
    'try_deck_started', 'deck_sample_loaded',
    'signup_started', 'signup_completed',
    'deck_saved', 'profile_started',
    'profile_saved', 'collection_started'];
  res jsonb;
begin
  if not private.is_admin() then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  since := (date_trunc('day', now() at time
    zone tz) - (d - 1) * interval '1 day')
    at time zone tz;
  with ev as (
    select sid, signed, at,
      case when kind = 'view'
        then 'page_view'
        else private.event_name(name) end
        as ev
      from private.page_events
     where at >= since)
  select jsonb_build_object(
    'generated_at', now(),
    'since', since,
    'days', d,
    'retention_days', 90,
    'first_event_at', (select min(at)
      from private.page_events),
    'visits', (select count(distinct sid)
      from ev),
    'visits_anon', (select count(*) from (
      select sid from ev group by sid
      having not bool_or(signed)) x),
    'events', (select jsonb_agg(
      jsonb_build_object('name', n,
        'count', (select count(*) from ev
          where ev.ev = n),
        'visits', (select count(distinct sid)
          from ev where ev.ev = n),
        'anon', (select count(*) from ev
          where ev.ev = n and not signed),
        'signed', (select count(*) from ev
          where ev.ev = n and signed))
      order by o)
      from unnest(names)
        with ordinality t(n, o)),
    'members', (select count(*)
      from auth.users),
    'accounts_created', (select count(*)
      from auth.users
     where created_at >= since),
    'active_7d', (select count(distinct
        user_id) from private.member_days
      where day > (now() at time zone tz)
        ::date - 7),
    'active_30d', (select count(distinct
        user_id) from private.member_days
      where day > (now() at time zone tz)
        ::date - 30),
    'active_since', (select min(day)
      from private.member_days))
    into res;
  return res;
end $$;
revoke all on function
  public.admin_metrics(int) from public, anon;
grant execute on function
  public.admin_metrics(int) to authenticated;

-- "Baixar meus dados": + the days you used
-- the site signed in
do $$
declare d text;
begin
  d := pg_get_functiondef(
    'public.my_data_export()'::regprocedure);
  if position('active_days' in d) = 0
  then
    d := regexp_replace(d,
      '''\[\]''\)\);(\s*end)',
      '''[]''),' || chr(10)
      || '    ''active_days'', coalesce(('
      || chr(10)
      || '      select jsonb_agg(x.day'
      || ' order by x.day)'
      || chr(10)
      || '        from private.member_days x'
      || chr(10)
      || '       where x.user_id = u),'
      || ' ''[]''));' || '\1');
    execute d;
  end if;
end $$;
