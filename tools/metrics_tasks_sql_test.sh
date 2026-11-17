#!/usr/bin/env bash
# Tests supabase/metrics_tasks.sql on a scratch database with minimal stubs of what it reads
# (private.page_events, private.is_admin() reading the t.uid setting, private.event_name()).
#   PGHOST=/var/tmp/pgt PGPORT=5544 PGUSER=postgres bash tools/metrics_tasks_sql_test.sh
# The scratch database copies what production has (read on 17/11/2026, read-only queries): functions created in public
# are executable by anon, authenticated and service_role by default (pg_default_acl, set by postgres); the functions,
# private.page_events and the private schema belong to postgres; authenticated has USAGE on private.
# Checks: it creates only public.admin_task_metrics(int), owned by postgres, SECURITY DEFINER, search_path ''; its
# privileges end exactly like production's admin_metrics(int) (postgres, authenticated, service_role; never anon);
# running it twice changes nothing; as the real roles: anon is refused, a signed-in member is refused, an admin reads;
# counts are by event and by visit (tab) within the period; other events, page views and old events are ignored.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=metrics_tasks_test
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT

"${PSQL[@]}" <<'SQL'
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
-- production's default: every new function in public is executable by the API roles (pg_default_acl, by postgres)
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema private;
grant usage on schema private to authenticated;
grant usage on schema public to anon, authenticated, service_role;
create table private.page_events (id bigint generated always as identity primary key, at timestamptz not null default now(),
  sid text not null, page text not null, kind text not null, name text, signed boolean not null default false, ref text, dev text);
alter table private.page_events enable row level security;   -- like production: no policy, the API roles read nothing
create table private.admins (user_id uuid primary key);
insert into private.admins values ('aaaaaaaa-0000-4000-8000-000000000001');
create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admins where user_id = nullif(current_setting('t.uid', true), '')::uuid) $$;
create function private.event_name(p text) returns text language sql immutable set search_path = '' as $$ select case p when 'deck_sample' then 'deck_sample_loaded' else p end $$;
revoke all on function private.event_name(text) from public;
-- the reference: production's admin_metrics privileges, written as production has them
create function public.admin_metrics(p_days int) returns jsonb language sql stable security definer set search_path = '' as $$ select '{}'::jsonb $$;
revoke all on function public.admin_metrics(int) from public, anon;
grant execute on function public.admin_metrics(int) to authenticated;
insert into private.page_events (sid, page, kind, name, signed, at) values
  ('t1', 'cards', 'action', 'scan_open', true, now()),
  ('t1', 'cards', 'action', 'scan_saved', true, now()),
  ('t1', 'cards', 'action', 'scan_fixed', true, now()),
  ('t2', 'cards', 'action', 'scan_open', false, now()),
  ('t2', 'cards', 'action', 'scan_saved', false, now()),
  ('t2', 'cards', 'action', 'scan_saved', false, now()),   -- two page views in the same tab
  ('t3', 'feed', 'action', 'home_keep_deck', true, now()),
  ('t4', 'cards', 'action', 'scan_saved', true, now() - interval '40 days'),   -- outside a 14-day period
  ('t5', 'cards', 'view', null, true, now()),
  ('t5', 'decks', 'action', 'deck_saved', true, now());   -- not a task event
SQL

snap() { "${PSQL[@]}" -c "select p.oid::regprocedure || ' ' || md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') order by 1"; }
snap > /tmp/mt_before.txt
"${PSQL[@]}" -f "$ROOT/supabase/metrics_tasks.sql"
snap > /tmp/mt_after.txt
changed=$( (diff /tmp/mt_before.txt /tmp/mt_after.txt || true) | grep -E '^[<>]' | sed -E 's/^[<>] //; s/ [0-9a-f]{32}$//' | sort -u | tr '\n' ' ')
[ "$changed" = "admin_task_metrics(integer) " ] || { echo "FAIL changed functions: $changed"; exit 1; }
acl1=$("${PSQL[@]}" -c "select proacl::text from pg_proc where oid = 'public.admin_task_metrics(int)'::regprocedure")
"${PSQL[@]}" -f "$ROOT/supabase/metrics_tasks.sql"
"${PSQL[@]}" -f "$ROOT/supabase/metrics_tasks.sql"   # three runs in all
snap > /tmp/mt_again.txt
diff -q /tmp/mt_after.txt /tmp/mt_again.txt >/dev/null || { echo "FAIL running it again changed a function"; exit 1; }
[ "$("${PSQL[@]}" -c "select proacl::text from pg_proc where oid = 'public.admin_task_metrics(int)'::regprocedure")" = "$acl1" ] || { echo "FAIL running it again changed the privileges"; exit 1; }

# owner, SECURITY DEFINER, empty search_path, and privileges exactly like production's admin_metrics
row=$("${PSQL[@]}" -c "select pg_get_userbyid(proowner) || '|' || prosecdef || '|' || array_to_string(proconfig, ',') from pg_proc where oid = 'public.admin_task_metrics(int)'::regprocedure")
[ "$row" = "postgres|true|search_path=\"\"" ] || { echo "FAIL owner/definer/search_path: $row"; exit 1; }
acl() { "${PSQL[@]}" -c "select array_to_string(array(select g from unnest(proacl::text[]) g order by 1), ' ') from pg_proc where oid = '$1'::regprocedure"; }
[ "$(acl 'public.admin_task_metrics(int)')" = "$(acl 'public.admin_metrics(int)')" ] || { echo "FAIL privileges differ from admin_metrics: $(acl 'public.admin_task_metrics(int)') vs $(acl 'public.admin_metrics(int)')"; exit 1; }
[ "$(acl 'public.admin_task_metrics(int)')" = "authenticated=X/postgres postgres=X/postgres service_role=X/postgres" ] || { echo "FAIL privileges: $(acl 'public.admin_task_metrics(int)')"; exit 1; }
for r in anon authenticated service_role; do echo "$r: $("${PSQL[@]}" -c "select has_function_privilege('$r', 'public.admin_task_metrics(int)', 'execute')")"; done | tr '\n' ' ' | grep -q "anon: f authenticated: t service_role: t" || { echo "FAIL execute privileges by role"; exit 1; }
# as the real roles, the way PostgREST calls it
if "${PSQL[@]}" -c "set role anon; select public.admin_task_metrics(14)" >/tmp/mt_anon.txt 2>&1; then echo "FAIL anon ran it"; exit 1; fi
grep -q "permission denied for function admin_task_metrics" /tmp/mt_anon.txt || { echo "FAIL anon error: $(cat /tmp/mt_anon.txt)"; exit 1; }
if "${PSQL[@]}" -c "set role authenticated; set t.uid = 'aaaaaaaa-0000-4000-8000-000000000002'; select public.admin_task_metrics(14)" >/tmp/mt_member.txt 2>&1; then echo "FAIL a member read the task metrics"; exit 1; fi
grep -q "not allowed" /tmp/mt_member.txt || { echo "FAIL member error: $(cat /tmp/mt_member.txt)"; exit 1; }
if "${PSQL[@]}" -c "set role authenticated; select count(*) from private.page_events" >/dev/null 2>&1; then
  [ "$("${PSQL[@]}" -c "set role authenticated; select count(*) from private.page_events" | tail -1)" = 0 ] || { echo "FAIL authenticated reads page_events directly"; exit 1; }
fi
[ "$("${PSQL[@]}" -c "set role authenticated; set t.uid = 'aaaaaaaa-0000-4000-8000-000000000001'; select jsonb_array_length(public.admin_task_metrics(14)->'events')" | tail -1)" = 16 ] || { echo "FAIL admin as authenticated"; exit 1; }

q() { "${PSQL[@]}" -c "set t.uid = 'aaaaaaaa-0000-4000-8000-000000000001'; select $1 from jsonb_array_elements(public.admin_task_metrics($2)->'events') e where e->>'name' = '$3'" | tail -1; }
[ "$(q "e->>'count'" 14 scan_saved)" = 3 ] || { echo "FAIL scan_saved count"; exit 1; }
[ "$(q "e->>'visits'" 14 scan_saved)" = 2 ] || { echo "FAIL scan_saved visits"; exit 1; }
[ "$(q "e->>'signed'" 14 scan_saved)" = 1 ] || { echo "FAIL scan_saved signed"; exit 1; }
[ "$(q "e->>'visits'" 90 scan_saved)" = 3 ] || { echo "FAIL 90-day period"; exit 1; }
[ "$(q "e->>'visits'" 14 scan_fixed)" = 1 ] || { echo "FAIL scan_fixed"; exit 1; }
[ "$(q "e->>'count'" 14 game_added)" = 0 ] || { echo "FAIL zero row"; exit 1; }
n=$("${PSQL[@]}" -c "set t.uid = 'aaaaaaaa-0000-4000-8000-000000000001'; select jsonb_array_length(public.admin_task_metrics(14)->'events')" | tail -1)
[ "$n" = 16 ] || { echo "FAIL expected 16 events, got $n"; exit 1; }
[ "$("${PSQL[@]}" -c "set t.uid = 'aaaaaaaa-0000-4000-8000-000000000001'; select (public.admin_task_metrics(999)->>'days')" | tail -1)" = 90 ] || { echo "FAIL period cap"; exit 1; }
echo "metrics_tasks.sql: all checks passed"
