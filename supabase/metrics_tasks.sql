-- Roadmap 2027, R02: the task events in the Admin panel.
-- Definitions: docs/metricas.md, "Tarefas".
--
-- What this migration changes (and nothing
-- else; tools/metrics_tasks_sql_test.sh checks):
--   new   public.admin_task_metrics(int)
-- It only reads private.page_events, the table
-- public.track() already fills. No new table,
-- no change to track(), admin_metrics() or
-- the 90-day retention.
-- One transaction. Safe to run again.
-- Run after metrics_p0.sql (needs
-- private.is_admin() and private.event_name()).

begin;

create or replace function
  public.admin_task_metrics(p_days int)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare
  d int := least(90, greatest(1,
    coalesce(p_days, 14)));
  tz text := 'America/Sao_Paulo';
  since timestamptz;
  -- the order the panel shows them in; the
  -- *_open events are already sent and are
  -- the denominators of two rates
  names text[] := array[
    'home_keep_deck', 'home_keep_collection',
    'home_keep_event', 'home_first_collection',
    'home_first_deck', 'home_first_event',
    'scan_open', 'scan_saved', 'scan_fixed',
    'scan_asked', 'import_open', 'import_done',
    'loan_requested', 'loan_saved',
    'event_marked', 'game_added'];
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
    select sid, signed,
      private.event_name(name) as ev
      from private.page_events
     where at >= since and kind = 'action'
       and name = any (names))
  select jsonb_build_object(
    'generated_at', now(),
    'since', since,
    'days', d,
    'events', (select jsonb_agg(
      jsonb_build_object('name', n,
        'count', (select count(*) from ev
          where ev.ev = n),
        'visits', (select count(distinct sid)
          from ev where ev.ev = n),
        'signed', (select count(*) from ev
          where ev.ev = n and signed))
      order by o)
      from unnest(names)
        with ordinality t(n, o)))
    into res;
  return res;
end $$;
revoke all on function
  public.admin_task_metrics(int)
  from public, anon;
grant execute on function
  public.admin_task_metrics(int)
  to authenticated;

commit;

-- Rollback (if ever needed):
--   drop function public.admin_task_metrics(int);
