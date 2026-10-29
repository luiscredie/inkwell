-- Site statistics for the admin page (Painel):
-- are people visiting, what do they look at,
-- do they try things, do they sign up.
-- Privacy:
--  * no cookies, no IP, no fingerprint: each
--    browser tab has a random code that lives
--    only while the tab is open
--    (sessionStorage);
--  * no user id: only "signed in or not";
--  * the other site's domain only, never the
--    full address it came from;
--  * kept 90 days; admins are not counted;
--    "do not track" browsers send nothing.
-- Run once (safe to run again).

create table if not exists private.page_events (
  id bigint generated always as identity
    primary key,
  at timestamptz not null default now(),
  sid text not null,
  page text not null,
  kind text not null,
  name text,
  signed boolean not null default false,
  ref text,
  dev text);
create index if not exists page_events_at
  on private.page_events (at);
create index if not exists page_events_sid
  on private.page_events (sid, at);

-- the page calls this (with or without an
-- account); quietly ignores what isn't valid
create or replace function public.track(
  p_sid text, p_page text, p_kind text,
  p_name text, p_ref text, p_dev text)
returns void
language plpgsql security definer
set search_path = '' as $$
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
  insert into private.page_events
    (sid, page, kind, name, signed, ref, dev)
  values (p_sid, p_page, p_kind,
    case when p_kind = 'action'
      then p_name end,
    auth.uid() is not null,
    case when p_ref ~ '^[a-z0-9.-]{3,60}$'
      then p_ref end,
    case when p_dev in ('mobile', 'desktop')
      then p_dev end);
end $$;
revoke all on function public.track(text, text,
  text, text, text, text) from public;
grant execute on function public.track(text,
  text, text, text, text, text)
  to anon, authenticated;

-- 90 days are enough
create or replace function
  private.trim_page_events()
returns void
language sql security definer
set search_path = '' as $$
  delete from private.page_events
   where at < now() - interval '90 days';
$$;
select cron.unschedule('inkwell-trim-stats')
 where exists (select 1 from cron.job
   where jobname = 'inkwell-trim-stats');
select cron.schedule('inkwell-trim-stats',
  '47 6 * * *',
  'select private.trim_page_events()');

-- ---------- the Painel ----------
-- p_days: how far back (1 to 90). Days are
-- São Paulo days.
create or replace function public.admin_stats(
  p_days int)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare
  d int := least(90, greatest(1,
    coalesce(p_days, 14)));
  since timestamptz;
  tz text := 'America/Sao_Paulo';
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
    select * from private.page_events
     where at >= since),
  -- one row per visit (tab session)
  s as (
    select sid,
      min(at) as first_at,
      (array_agg(signed order by at))[1]
        as first_signed,
      bool_or(signed) as any_signed,
      count(*) filter
        (where kind = 'view') as views,
      count(*) filter
        (where kind = 'action'
          and name not in ('signin_open',
            'signin_code', 'signin_done'))
        as tries,
      bool_or(name = 'signin_open')
        as opened_signin,
      bool_or(name = 'signin_code')
        as got_code,
      (array_agg(page order by at)
        filter (where kind = 'view'))[1]
        as landing,
      (array_agg(page order by at desc)
        filter (where kind = 'view'))[1]
        as last_page,
      (array_agg(ref order by at)
        filter (where ref is not null))[1]
        as ref,
      (array_agg(dev order by at))[1] as dev
      from ev group by sid),
  -- visits that started without an account
  a as (
    select * from s
     where first_signed = false),
  days as (
    select g::date as day
      from generate_series(
        (now() at time zone tz)::date
          - (d - 1),
        (now() at time zone tz)::date,
        interval '1 day') g)
  select jsonb_build_object(
    'days', d,
    'since', since,
    'totals', jsonb_build_object(
      'visits_anon', (select count(*) from a),
      'visits_signed', (select count(*)
        from s where first_signed),
      'views', (select count(*) from ev
        where kind = 'view'),
      'bounced', (select count(*) from a
        where views <= 1 and tries = 0
          and not coalesce(opened_signin,
            false)),
      'two_plus', (select count(*) from a
        where views >= 2),
      'tried', (select count(*) from a
        where tries > 0),
      'opened_signin', (select count(*)
        from a where opened_signin),
      'got_code', (select count(*)
        from a where got_code),
      'signed_in', (select count(*)
        from a where any_signed),
      'avg_views', (select round(avg(views),
        1) from a),
      'signups', (select count(*)
        from auth.users u
        where u.created_at >= since),
      'signups_confirmed', (select count(*)
        from auth.users u
        where u.created_at >= since
          and u.last_sign_in_at is not null),
      'profiles_public', (select count(*)
        from auth.users u
        join public.profiles p
          on p.user_id = u.id
        where u.created_at >= since
          and p.is_public),
      'profiles_private', (select count(*)
        from auth.users u
        join public.profiles p
          on p.user_id = u.id
        where u.created_at >= since
          and not coalesce(p.is_public,
            false)),
      'members', (select count(*)
        from auth.users),
      'active_7d', (select count(*)
        from auth.users u
        where u.last_sign_in_at
          > now() - interval '7 days')),
    'series', (select jsonb_agg(
        jsonb_build_object(
        'day', x.day,
        'visits_anon', (select count(*) from a
          where (a.first_at at time zone tz)
            ::date = x.day),
        'visits_signed', (select count(*)
          from s where s.first_signed
            and (s.first_at at time zone tz)
              ::date = x.day),
        'signups', (select count(*)
          from auth.users u
          where (u.created_at at time zone tz)
            ::date = x.day),
        'profiles', (select count(*)
          from auth.users u
          join public.profiles p
            on p.user_id = u.id
          where (u.created_at at time zone tz)
            ::date = x.day))
        order by x.day)
      from days x),
    'pages', (select coalesce(jsonb_agg(
        jsonb_build_object('page', y.page,
          'views_anon', y.va,
          'views_signed', y.vs,
          'landed', y.landed,
          'left', y.left_here)
        order by y.va + y.vs desc),
        '[]'::jsonb)
      from (select p.page,
          count(*) filter (where not e.signed
            and e.kind = 'view') va,
          count(*) filter (where e.signed
            and e.kind = 'view') vs,
          (select count(*) from a
            where a.landing = p.page) landed,
          (select count(*) from a
            where a.last_page = p.page)
            left_here
        from (select distinct page from ev) p
        join ev e on e.page = p.page
        group by p.page) y),
    'actions', (select coalesce(jsonb_agg(
        jsonb_build_object('name', z.name,
          'anon', z.an, 'signed', z.sg)
        order by z.an + z.sg desc),
        '[]'::jsonb)
      from (select name,
          count(*) filter (where not signed) an,
          count(*) filter (where signed) sg
        from ev where kind = 'action'
        group by name) z),
    'refs', (select coalesce(jsonb_agg(
        jsonb_build_object('ref', r.ref,
          'visits', r.n) order by r.n desc),
        '[]'::jsonb)
      from (select coalesce(ref, '') ref,
          count(*) n from a
        group by 1 order by 2 desc
        limit 8) r),
    'devices', (select coalesce(
        jsonb_object_agg(coalesce(dev, '?'),
          n), '{}'::jsonb)
      from (select dev, count(*) n from a
        group by dev) v))
    into res;
  return res;
end $$;
revoke all on function
  public.admin_stats(int) from public, anon;
grant execute on function
  public.admin_stats(int) to authenticated;
