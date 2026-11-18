#!/usr/bin/env bash
# duels_sync_state.sql (#241) on a throwaway Postgres: same owner and grants as production (service_role only), the key
# check, the state returned, and the old function's callers unaffected. Needs a local Postgres (PGHOST/PGPORT/PGUSER).
#   PGHOST=/var/tmp/pgt PGPORT=5544 PGUSER=postgres bash tools/duels_sync_state_sql_test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=duels_state_test
psql -q -X -d postgres -c "drop database if exists $DB" -c "create database $DB"
q() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d $DB "$@"; }
q <<'SQL'
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema vault; create schema private;
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('duels_sync_key', 'k');
create table private.duels_sync (user_id uuid primary key, enabled boolean, token text, last_result jsonb);
insert into private.duels_sync values
  ('00000000-0000-0000-0000-000000000001', true, 'tok', '{"ok":true,"state":{"scan":null,"wait":{"g1":{"s":"2026-11-16T01:00:00Z","n":1,"next":"2026-11-16T02:00:00Z"}}}}'),
  ('00000000-0000-0000-0000-000000000002', true, null, '{"ok":true}'),
  ('00000000-0000-0000-0000-000000000003', false, 'tok', null);
grant usage on schema public, private, vault to anon, authenticated, service_role;
grant select on all tables in schema private, vault to anon, authenticated, service_role;
-- production default: functions created in public are executable by anon, authenticated and service_role
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
-- the function as it is today (duels_tokens.sql)
create function public.duels_sync_begin(p_key text, p_user uuid default null) returns table (user_id uuid, token text)
language plpgsql stable security definer set search_path = '' as $f$ begin
  return query select s.user_id, s.token from private.duels_sync s where s.enabled; end $f$;
SQL
pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "✓ $1"; else fail=$((fail+1)); echo "✗ $1: got [$2] want [$3]"; fi; }
for i in 1 2; do q -f supabase/duels_sync_state.sql; done
ck "applies twice (idempotent)" "ok" "ok"
ck "one definition left" "$(q -c "select count(*) from pg_proc where proname='duels_sync_begin'")" "1"
ck "owner postgres, ACL service_role only" "$(q -c "select pg_get_userbyid(proowner)||' '||proacl::text from pg_proc where proname='duels_sync_begin'")" "postgres {postgres=X/postgres,service_role=X/postgres}"
ck "security definer, empty search_path" "$(q -c "select prosecdef::text||' '||array_to_string(proconfig,',') from pg_proc where proname='duels_sync_begin'")" 'true search_path=""'
ck "returns the saved state" "$(q -c "select state->'wait'->'g1'->>'n' from public.duels_sync_begin('k') where user_id='00000000-0000-0000-0000-000000000001'")" "1"
ck "a row without state returns null state" "$(q -c "select coalesce(state::text,'null') from public.duels_sync_begin('k') where user_id='00000000-0000-0000-0000-000000000002'")" "null"
ck "only enabled rows" "$(q -c "select count(*) from public.duels_sync_begin('k')")" "2"
ck "one player" "$(q -c "select count(*) from public.duels_sync_begin('k','00000000-0000-0000-0000-000000000002')")" "1"
ck "user_id and token still come first (the current function reads them by name)" "$(q -c "select user_id::text||' '||coalesce(token,'-') from public.duels_sync_begin('k','00000000-0000-0000-0000-000000000001')")" "00000000-0000-0000-0000-000000000001 tok"
ck "a wrong key is refused" "$(q -c "select count(*) from public.duels_sync_begin('x')" 2>&1 | grep -c forbidden)" "1"
ck "anon cannot run it" "$(q -c "set role anon; select count(*) from public.duels_sync_begin('k')" 2>&1 | grep -c 'permission denied')" "1"
ck "authenticated cannot run it" "$(q -c "set role authenticated; select count(*) from public.duels_sync_begin('k')" 2>&1 | grep -c 'permission denied')" "1"
ck "service_role can" "$(q -c "set role service_role; select count(*) from public.duels_sync_begin('k')")" "2"
psql -q -X -d postgres -c "drop database $DB"
echo; echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
