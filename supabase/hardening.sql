-- Security hardening (audit, 28/10/2026).
--  1. Limits against spam where there were
--     none: friend requests, join requests,
--     new tables (Mesas & Ligas). A small log
--     counts them (cancel + ask again counts).
--  2. The functions push-send / events-near
--     use: only the server (service_role).
--  3. Second layer: visitors without an
--     account lose the default table rights
--     (row security already blocks them), and
--     nobody can TRUNCATE.
-- Safe to run again.

-- ---------- 1. limits ----------
create table if not exists private.rate_log (
  user_id uuid not null,
  kind text not null,
  at timestamptz not null default now());
create index if not exists rate_log_user
  on private.rate_log (user_id, kind, at);

-- count one more; refuse past the limit
create or replace function
  private.rate_hit(
    p_kind text, p_max int, p_per interval)
returns void
language plpgsql security definer
set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then return; end if;
  -- (no user: the server itself)
  if (select count(*) from private.rate_log
       where user_id = u and kind = p_kind
         and at > now() - p_per) >= p_max
  then
    raise exception 'too_many_%', p_kind
      using errcode = 'P0001',
        hint = 'Try again later.';
  end if;
  insert into private.rate_log (user_id, kind)
  values (u, p_kind);
end $$;

create or replace function
  private.limit_friend_request()
returns trigger
language plpgsql security definer
set search_path = '' as $$
begin
  perform private.rate_hit(
    'friend_requests', 40, interval '1 day');
  return new;
end $$;
drop trigger if exists friendships_limit
  on public.friendships;
create trigger friendships_limit
  before insert on public.friendships
  for each row
  execute function
    private.limit_friend_request();

create or replace function
  private.limit_join_request()
returns trigger
language plpgsql security definer
set search_path = '' as $$
begin
  perform private.rate_hit(
    'join_requests', 30, interval '1 day');
  return new;
end $$;
drop trigger if exists community_requests_limit
  on public.community_requests;
create trigger community_requests_limit
  before insert on public.community_requests
  for each row
  execute function private.limit_join_request();

create or replace function
  private.limit_new_table()
returns trigger
language plpgsql security definer
set search_path = '' as $$
begin
  perform private.rate_hit(
    'tables', 20, interval '1 day');
  return new;
end $$;
drop trigger if exists events_limit
  on public.events;
create trigger events_limit
  before insert on public.events
  for each row
  execute function private.limit_new_table();

-- the log only needs the last few days
create or replace function
  private.trim_rate_log()
returns void
language sql security definer
set search_path = '' as $$
  delete from private.rate_log
   where at < now() - interval '3 days';
$$;
select cron.unschedule('inkwell-trim-rate-log')
 where exists (select 1 from cron.job
   where jobname = 'inkwell-trim-rate-log');
select cron.schedule('inkwell-trim-rate-log',
  '41 6 * * *',
  'select private.trim_rate_log()');

-- ---------- 2. server-only ----------
do $$
declare f text;
begin
  foreach f in array array[
    'push_payload(uuid, text)',
    'push_gone(text, text)',
    'near_places(text)',
    'near_events(text, uuid, jsonb)']
  loop
    execute format('revoke all on function'
      || ' public.%s from public, anon,'
      || ' authenticated', f);
    execute format('grant execute on function'
      || ' public.%s to service_role', f);
  end loop;
end $$;

-- ---------- 3. second layer ----------
do $$
declare t text;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n
        on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
  loop
    execute format('revoke all on table'
      || ' public.%I from anon', t);
    execute format('revoke truncate, trigger,'
      || ' references on table public.%I'
      || ' from authenticated', t);
  end loop;
end $$;
-- tables created later start the same way
alter default privileges in schema public
  revoke all on tables from anon;
