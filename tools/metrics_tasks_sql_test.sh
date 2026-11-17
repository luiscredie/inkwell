#!/usr/bin/env bash
# Tests supabase/metrics_tasks.sql on a scratch database with minimal stubs of what it reads
# (private.page_events, private.is_admin() reading the t.uid setting, private.event_name()).
#   PGHOST=/var/tmp/pgt PGPORT=5544 PGUSER=postgres bash tools/metrics_tasks_sql_test.sh
# Checks: it creates only public.admin_task_metrics(int); running it twice changes nothing more; only admins can read
# it; anon cannot execute it; counts are by event and by visit (tab) within the period; other events, page views and
# events older than the period are ignored; every task event is listed, with zero when nothing happened.
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
create schema private;
create table private.page_events (id bigint generated always as identity primary key, at timestamptz not null default now(),
  sid text not null, page text not null, kind text not null, name text, signed boolean not null default false, ref text, dev text);
create table private.admins (user_id uuid primary key);
insert into private.admins values ('aaaaaaaa-0000-4000-8000-000000000001');
create function private.is_admin() returns boolean language sql stable as $$
  select exists (select 1 from private.admins where user_id = nullif(current_setting('t.uid', true), '')::uuid) $$;
create function private.event_name(p text) returns text language sql immutable as $$ select case p when 'deck_sample' then 'deck_sample_loaded' else p end $$;
grant usage on schema public to anon, authenticated;
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
"${PSQL[@]}" -f "$ROOT/supabase/metrics_tasks.sql"
snap > /tmp/mt_again.txt
diff -q /tmp/mt_after.txt /tmp/mt_again.txt >/dev/null || { echo "FAIL second run changed something"; exit 1; }

# only admins
if "${PSQL[@]}" -c "set t.uid = 'aaaaaaaa-0000-4000-8000-000000000002'; select public.admin_task_metrics(14)" >/dev/null 2>&1; then echo "FAIL a member read the task metrics"; exit 1; fi
[ "$("${PSQL[@]}" -c "select has_function_privilege('anon', 'public.admin_task_metrics(int)', 'execute')")" = f ] || { echo "FAIL anon can execute"; exit 1; }
[ "$("${PSQL[@]}" -c "select has_function_privilege('authenticated', 'public.admin_task_metrics(int)', 'execute')")" = t ] || { echo "FAIL authenticated cannot execute"; exit 1; }

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
