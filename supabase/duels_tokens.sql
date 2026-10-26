-- Each player connects their own duels.ink.
-- Run after duels_sync.sql. The token stays in the
-- private schema (not reachable through the API);
-- only the duels-sync function reads it.
-- A row without a token uses the DUELS_TOKEN secret.

alter table private.duels_sync
  add column if not exists token text;

drop function if exists
  public.duels_sync_begin(text);
drop function if exists
  public.duels_sync_begin(text, uuid);

create function public.duels_sync_begin(
  p_key text, p_user uuid default null)
returns table (user_id uuid, token text)
language plpgsql stable security definer
set search_path = '' as $$
begin
  if p_key is null or p_key <> (
    select decrypted_secret
      from vault.decrypted_secrets
     where name = 'duels_sync_key') then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;
  return query
    select s.user_id, s.token
      from private.duels_sync s
     where s.enabled
       and (p_user is null
            or s.user_id = p_user);
end $$;

revoke all on function
  public.duels_sync_begin(text, uuid)
  from public, anon, authenticated;
grant execute on function
  public.duels_sync_begin(text, uuid)
  to service_role;

-- The job can run for everyone (cron)
-- or for one player (right after they connect).
drop function if exists
  private.run_duels_sync();
drop function if exists
  private.run_duels_sync(uuid);

create function private.run_duels_sync(
  p_user uuid default null)
returns bigint
language sql security definer
set search_path = '' as $$
  select net.http_post(
    url := 'https://sorefaetiaebmjploanp'
      || '.supabase.co/functions/v1/duels-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-key', (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'duels_sync_key')),
    body := jsonb_build_object('user', p_user),
    timeout_milliseconds := 150000);
$$;

revoke all on function
  private.run_duels_sync(uuid)
  from public, anon, authenticated;

-- Save my token (96 hex characters) and sync now.
create or replace function
  public.set_my_duels_token(p_token text)
returns void
language plpgsql security definer
set search_path = '' as $$
declare
  u uuid := auth.uid();
  t text := btrim(coalesce(p_token, ''));
begin
  if u is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if t !~ '^[0-9a-fA-F]{96}$' then
    raise exception 'bad token'
      using errcode = '22023';
  end if;
  insert into private.duels_sync
    (user_id, token, enabled)
  values (u, t, true)
  on conflict (user_id) do update
    set token = excluded.token,
        enabled = true,
        last_run_at = null,
        last_result = null;
  perform private.run_duels_sync(u);
end $$;

revoke all on function
  public.set_my_duels_token(text)
  from public, anon;
grant execute on function
  public.set_my_duels_token(text)
  to authenticated;

-- "Sincronizar agora" (at most once a minute).
create or replace function
  public.sync_my_duels_now()
returns void
language plpgsql security definer
set search_path = '' as $$
declare
  u uuid := auth.uid();
begin
  if u is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from private.duels_sync s
     where s.user_id = u and s.enabled
       and (s.last_run_at is null
            or s.last_run_at
               < now() - interval '1 minute'))
  then
    perform private.run_duels_sync(u);
  end if;
end $$;

revoke all on function
  public.sync_my_duels_now()
  from public, anon;
grant execute on function
  public.sync_my_duels_now()
  to authenticated;

-- "Desconectar": forget my token and stop.
-- Games already imported stay.
create or replace function
  public.stop_my_duels_sync()
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  delete from private.duels_sync
   where user_id = auth.uid();
end $$;

revoke all on function
  public.stop_my_duels_sync()
  from public, anon;
grant execute on function
  public.stop_my_duels_sync()
  to authenticated;
