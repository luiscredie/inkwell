-- Automatic duels.ink sync: the duels-sync Edge Function, run every 30 minutes by pg_cron.
-- Run after game_logs_summary.sql. Before running, replace CHANGE-ME with a long random key
-- (e.g. the output of: python -c "import secrets; print(secrets.token_hex(24))").
-- Then: Edge Functions > Secrets > add DUELS_TOKEN (your duels.ink API token), and deploy
-- the function from the Inkwell 2 repo (supabase/functions/duels-sync, verify JWT off: it checks the key itself).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create schema if not exists private;

create table if not exists private.duels_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_result jsonb,
  last_added_at timestamptz
);

select vault.create_secret('CHANGE-ME', 'duels_sync_key', 'Key the scheduled job sends to the duels-sync function');

create or replace function public.duels_sync_begin(p_key text) returns table (user_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_key is null or p_key <> (select decrypted_secret from vault.decrypted_secrets where name = 'duels_sync_key') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select s.user_id from private.duels_sync s where s.enabled;
end $$;

create or replace function public.duels_sync_finish(p_key text, p_user uuid, p_result jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null or p_key <> (select decrypted_secret from vault.decrypted_secrets where name = 'duels_sync_key') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update private.duels_sync set last_run_at = now(), last_result = p_result,
    last_added_at = case when coalesce((p_result->>'added')::int, 0) > 0 then now() else last_added_at end
  where user_id = p_user;
end $$;
revoke all on function public.duels_sync_begin(text) from public, anon, authenticated;
revoke all on function public.duels_sync_finish(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.duels_sync_begin(text) to service_role;
grant execute on function public.duels_sync_finish(text, uuid, jsonb) to service_role;

-- A player's own sync status, shown in Coach Review (returns only the caller's row).
create or replace function public.my_duels_sync() returns table (enabled boolean, last_run_at timestamptz, last_result jsonb, last_added_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.enabled, s.last_run_at, s.last_result, s.last_added_at from private.duels_sync s where s.user_id = (select auth.uid());
$$;
revoke all on function public.my_duels_sync() from public, anon;
grant execute on function public.my_duels_sync() to authenticated;

create or replace function private.run_duels_sync() returns bigint
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://sorefaetiaebmjploanp.supabase.co/functions/v1/duels-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'duels_sync_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
$$;
revoke all on function private.run_duels_sync() from public, anon, authenticated;

select cron.schedule('duels-sync', '*/30 * * * *', 'select private.run_duels_sync()');

-- Turn it on for a player (their duels.ink token is the DUELS_TOKEN secret; one player for now):
-- insert into private.duels_sync (user_id) select id from auth.users where email = 'you@example.com';
