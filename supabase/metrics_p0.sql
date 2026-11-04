-- Issue #145, P0-B: product metrics with an
-- explicit schema, real counts only, no PII.
-- Definitions: docs/metricas.md.
--
-- What this migration changes (and nothing
-- else; tools/metrics_p0_sql_test.sh checks):
--   new   private.member_days (table)
--   new   private.event_name(text)
--   new   public.admin_metrics(int)
--   repl. public.track(6 x text)
--   repl. private.trim_page_events()
--   repl. public.my_data_export()
--           (same keys + active_days)
-- One transaction: if anything fails, nothing
-- changes. Safe to run again.
-- Run after site_stats.sql and feedback.sql.

begin;

-- Stop (changing nothing) if
-- my_data_export() is not the version this
-- file was written against, so an export key
-- added elsewhere is never dropped by the
-- full replacement below.
do $$
declare d text := pg_get_functiondef(
  'public.my_data_export()'::regprocedure);
begin
  if md5(d) <> '512c960ad77521c6f20670dfc2'
       || '3bb314'
     and position('active_days' in d) = 0
  then
    raise exception 'my_data_export() is '
      'not the expected version (md5 %); '
      'nothing was changed', md5(d);
  end if;
end $$;

-- ---------- active members ----------------
-- (account, day) only: no page, no action.
-- Gone with the account (cascade) and after
-- 90 days (trim below).
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
create index if not exists member_days_day
  on private.member_days (day);

-- ---------- tracking ----------------------
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
  -- a flood (many tabs or a script): over
  -- 600 events in the last minute, site-wide,
  -- the rest of that minute is not counted
  if (select count(*)
        from private.page_events
       where at > now() - interval '1 minute')
     >= 600 then
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

-- 90 days, both tables (cron
-- inkwell-trim-stats calls this daily)
create or replace function
  private.trim_page_events()
returns void
language sql security definer
set search_path = '' as $$
  delete from private.page_events
   where at < now() - interval '90 days';
  delete from private.member_days
   where day < (now() at time zone
     'America/Sao_Paulo')::date - 90;
$$;
revoke all on function
  private.trim_page_events() from public;

-- older event names, under the new ones
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
revoke all on function
  private.event_name(text) from public;

-- ---------- the report (admins only) ------
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
     where at >= since),
  newu as (
    select id from auth.users
     where created_at >= since)
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
    -- from the database, not the browser:
    -- these cannot be inflated by track()
    'members', (select count(*)
      from auth.users),
    'accounts_created', (select count(*)
      from newu),
    'new_with_profile', (select count(*)
      from newu
      join public.profiles p
        on p.user_id = newu.id),
    'new_with_deck', (select count(*)
      from newu where exists (
        select 1
          from public.inkwell_profiles ip,
               jsonb_array_elements(
                 case when jsonb_typeof(
                   ip.data->'decks') = 'array'
                 then ip.data->'decks'
                 else '[]'::jsonb end) x(d)
         where ip.user_id = newu.id
           and coalesce(x.d->>'name', '')
             <> '')),
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
  public.admin_metrics(int)
  from public, anon;
grant execute on function
  public.admin_metrics(int) to authenticated;

-- ---------- "Baixar meus dados" -----------
-- The same keys as before (written out in
-- full), plus active_days.
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
       where x.user_id = u), '[]'),
    'comment_likes', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.comment_likes x
       where x.user_id = u), '[]'),
    'feedback_sent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', x.kind, 'body', x.body,
        'at', x.created_at))
        from private.feedback x
       where x.user_id = u), '[]'),
    'active_days', coalesce((
      select jsonb_agg(x.day order by x.day)
        from private.member_days x
       where x.user_id = u), '[]'));
end $$;
revoke all on function
  public.my_data_export() from public, anon;
grant execute on function
  public.my_data_export() to authenticated;

commit;
