-- duels-sync (#241): duels_sync_begin also returns the sync's saved state, so the function can go on where the last run
-- stopped (history read in parts over several runs, games waiting for their replay). Run after duels_tokens.sql.
-- The state is a small JSON object the function itself writes in last_result (duels_sync_finish, unchanged):
-- last_result->'state' = {"scan": {...} | null, "wait": {game_id: {...}}}. No table change; no new data.
-- Same owner, same grants (service_role only), same key check as before. One transaction: the job never sees the
-- function missing. The current function (v8) reads only user_id and token, so it keeps working with this.
begin;

drop function if exists public.duels_sync_begin(text, uuid);

create function public.duels_sync_begin(
  p_key text, p_user uuid default null)
returns table (user_id uuid, token text, state jsonb)
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
    select s.user_id, s.token, s.last_result -> 'state'
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

commit;
