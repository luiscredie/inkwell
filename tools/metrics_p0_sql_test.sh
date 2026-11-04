#!/usr/bin/env bash
# Tests supabase/metrics_p0.sql on a scratch copy of a local Postgres that has the Inkwell schema stubs
# (auth.users, auth.uid() reading the t.uid setting, public.admins, private.page_events, ...).
#   PGHOST=/var/tmp/pgtest PGPORT=5544 PGUSER=postgres bash tools/metrics_p0_sql_test.sh
# Checks: only the expected functions change; running it twice changes nothing more; the export has the active days;
# deleting the account removes them; 90-day retention; only admins read the metrics; the tables are closed to the API
# roles; repeated events and floods are not counted; and a different my_data_export() stops the migration with nothing
# changed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=metrics_p0_test
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb -T postgres "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT

# the state production had before this migration
"${PSQL[@]}" <<'SQL'
drop table if exists private.member_days cascade;
drop function if exists private.event_name(text);
drop function if exists public.admin_metrics(int);
create or replace function private.my_data_export_base() returns jsonb language sql stable as $$ select '{"base": true}'::jsonb $$;
delete from public.admins;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'admin@test.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'member@test.invalid')
  on conflict (id) do nothing;
insert into public.admins (user_id) values ('aaaaaaaa-0000-4000-8000-000000000001');
SQL
"${PSQL[@]}" -f "$ROOT/supabase/site_stats.sql" >/dev/null 2>&1
"${PSQL[@]}" -f "$ROOT/tools/fixtures/my_data_export.prod-2026-11-03.sql"
test "$("${PSQL[@]}" -c "select md5(pg_get_functiondef('public.my_data_export()'::regprocedure))")" = 512c960ad77521c6f20670dfc23bb314

snap() { "${PSQL[@]}" -c "select p.oid::regprocedure || ' ' || md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private','auth') and p.prokind = 'f' order by 1"; }
snap > /tmp/m_before.txt
"${PSQL[@]}" -f "$ROOT/supabase/metrics_p0.sql"
snap > /tmp/m_after.txt
changed=$( (diff /tmp/m_before.txt /tmp/m_after.txt || true) | grep -E '^[<>]' | sed -E 's/^[<>] //; s/ [0-9a-f]{32}$//' | sort -u | tr '\n' ' ')
expected="admin_metrics(integer) my_data_export() private.event_name(text) private.trim_page_events() track(text,text,text,text,text,text) "
[ "$changed" = "$expected" ] || { echo "FAIL changed functions: $changed"; exit 1; }
echo "ok   only the expected functions changed: $changed"
"${PSQL[@]}" -f "$ROOT/supabase/metrics_p0.sql"
snap > /tmp/m_again.txt
diff -q /tmp/m_after.txt /tmp/m_again.txt >/dev/null || { echo "FAIL a second run changed functions"; exit 1; }
echo "ok   a second run changes nothing"
norm() { "${PSQL[@]}" -c "select md5(replace(pg_get_functiondef('public.my_data_export()'::regprocedure), chr(13), ''))"; }
[ "$(norm)" = d56e421601e41eabc2ea03422360cb03 ] || { echo "FAIL the migrated my_data_export() is not the approved one: $(norm)"; exit 1; }
echo "ok   my_data_export() is exactly the approved migrated version"

"${PSQL[@]}" <<'SQL'
\set QUIET on
-- export: active days
set t.uid = 'aaaaaaaa-0000-4000-8000-000000000002';
select public.track('bbbbbbbbbbbbbbbbbbbbbbbb', 'feed', 'view', null, null, 'mobile');
do $$ declare e jsonb := public.my_data_export(); begin
  if jsonb_array_length(e->'active_days') <> 1 then raise exception 'FAIL export active_days: %', e->'active_days'; end if;
  if not (e ? 'feedback_sent' and e ? 'comment_likes' and e ? 'collection_shares' and e->>'base' = 'true') then raise exception 'FAIL export lost keys: %', e; end if;
  raise notice 'ok   export: same keys + active_days';
end $$;
-- the same event twice within 3 s counts once
select public.track('bbbbbbbbbbbbbbbbbbbbbbbb', 'decks', 'action', 'deck_sample_loaded', null, 'mobile');
select public.track('bbbbbbbbbbbbbbbbbbbbbbbb', 'decks', 'action', 'deck_sample_loaded', null, 'mobile');
do $$ begin
  if (select count(*) from private.page_events where name = 'deck_sample_loaded') <> 1 then raise exception 'FAIL dedupe'; end if;
  raise notice 'ok   a repeated event in 3 s counts once';
end $$;
-- admins only
do $$ begin
  begin perform public.admin_metrics(14); raise exception 'FAIL a member read the metrics';
  exception when insufficient_privilege then raise notice 'ok   a member cannot read the metrics'; end;
end $$;
reset t.uid;
set role anon;
do $$ begin
  begin perform public.admin_metrics(14); raise exception 'FAIL anon read the metrics';
  exception when insufficient_privilege then raise notice 'ok   anon cannot call admin_metrics'; end;
  begin perform 1 from private.member_days; raise exception 'FAIL anon read member_days';
  exception when insufficient_privilege then raise notice 'ok   anon cannot read member_days'; end;
end $$;
reset role;
set role authenticated;
do $$ begin
  begin perform 1 from private.member_days; raise exception 'FAIL authenticated read member_days';
  exception when insufficient_privilege then raise notice 'ok   authenticated cannot read member_days'; end;
end $$;
reset role;
set t.uid = 'aaaaaaaa-0000-4000-8000-000000000001';
do $$ declare m jsonb := public.admin_metrics(14); begin
  if jsonb_array_length(m->'events') <> 9 or (m->>'active_7d')::int <> 1 or (m->>'active_30d')::int <> 1 then raise exception 'FAIL admin report: %', m; end if;
  if (select (e->>'count')::int from jsonb_array_elements(m->'events') e where e->>'name' = 'signup_completed') <> 0 then raise exception 'FAIL zero'; end if;
  raise notice 'ok   an admin reads 9 events, zeros as zero, active 7d/30d';
end $$;
reset t.uid;
-- retention: 90 days
insert into private.member_days values ('aaaaaaaa-0000-4000-8000-000000000002', current_date - 91), ('aaaaaaaa-0000-4000-8000-000000000002', current_date - 89);
insert into private.page_events (at, sid, page, kind) values (now() - interval '91 days', 'cccccccccccccccccccccccc', 'feed', 'view');
select private.trim_page_events();
do $$ begin
  if exists (select 1 from private.member_days where day < current_date - 90) then raise exception 'FAIL old member days kept'; end if;
  if not exists (select 1 from private.member_days where day = current_date - 89) then raise exception 'FAIL recent member day removed'; end if;
  if exists (select 1 from private.page_events where at < now() - interval '90 days') then raise exception 'FAIL old events kept'; end if;
  raise notice 'ok   retention: older than 90 days removed, the rest kept';
end $$;
-- deleting the account removes its days
delete from auth.users where id = 'aaaaaaaa-0000-4000-8000-000000000002';
do $$ begin
  if exists (select 1 from private.member_days where user_id = 'aaaaaaaa-0000-4000-8000-000000000002') then raise exception 'FAIL days kept after the account was deleted'; end if;
  raise notice 'ok   deleting the account removes its days';
end $$;
-- a flood: over 600 events in a minute, the rest is not counted
insert into private.page_events (sid, page, kind) select lpad(to_hex(g), 24, 'd'), 'feed', 'view' from generate_series(1, 600) g;
select public.track('eeeeeeeeeeeeeeeeeeeeeeee', 'feed', 'view', null, null, 'desktop');
do $$ begin
  if exists (select 1 from private.page_events where sid = 'eeeeeeeeeeeeeeeeeeeeeeee') then raise exception 'FAIL flood counted'; end if;
  raise notice 'ok   a flood (600+/min) stops counting';
end $$;
SQL

# a function already migrated but changed afterwards (it still has active_days): the migration stops and changes nothing
dropdb --if-exists "${DB}_3" >/dev/null 2>&1 || true
createdb -T "$DB" "${DB}_3"
P3=(psql -X -q -At -v ON_ERROR_STOP=1 -d "${DB}_3")
"${P3[@]}" -c "select pg_get_functiondef('public.my_data_export()'::regprocedure)" | sed "s/'active_days', coalesce((/'added_later', 1, 'active_days', coalesce((/" > /tmp/m_changed.sql
echo ";" >> /tmp/m_changed.sql
"${P3[@]}" -f /tmp/m_changed.sql
grep -q added_later <("${P3[@]}" -c "select pg_get_functiondef('public.my_data_export()'::regprocedure)") || { echo "FAIL could not prepare the changed function"; exit 1; }
before3=$("${P3[@]}" -c "select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid in ('public.my_data_export()'::regprocedure, 'public.track(text,text,text,text,text,text)'::regprocedure, 'public.admin_metrics(integer)'::regprocedure) order by 1" | tr '\n' ' ')
if "${P3[@]}" -f "$ROOT/supabase/metrics_p0.sql" >/dev/null 2>/tmp/m_err3.txt; then echo "FAIL it overwrote a migrated-then-changed my_data_export()"; exit 1; fi
grep -q "not a known version" /tmp/m_err3.txt || { echo "FAIL wrong error: $(cat /tmp/m_err3.txt)"; exit 1; }
after3=$("${P3[@]}" -c "select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid in ('public.my_data_export()'::regprocedure, 'public.track(text,text,text,text,text,text)'::regprocedure, 'public.admin_metrics(integer)'::regprocedure) order by 1" | tr '\n' ' ')
[ "$before3" = "$after3" ] || { echo "FAIL something changed"; exit 1; }
grep -q added_later <("${P3[@]}" -c "select pg_get_functiondef('public.my_data_export()'::regprocedure)") || { echo "FAIL the changed function was overwritten"; exit 1; }
dropdb "${DB}_3"
echo "ok   a migrated my_data_export() changed afterwards is not overwritten (the migration stops, nothing changes)"

# a my_data_export() that is not the expected one: the migration stops and changes nothing
dropdb --if-exists "${DB}_2" >/dev/null 2>&1 || true
createdb -T "$DB" "${DB}_2"
P2=(psql -X -q -At -v ON_ERROR_STOP=1 -d "${DB}_2")
"${P2[@]}" -c "drop table private.member_days cascade; drop function public.admin_metrics(int); create or replace function public.my_data_export() returns jsonb language sql stable as \$\$ select '{\"other\": 1}'::jsonb \$\$;"
before2=$("${P2[@]}" -c "select md5(pg_get_functiondef('public.track(text,text,text,text,text,text)'::regprocedure))")
if "${P2[@]}" -f "$ROOT/supabase/metrics_p0.sql" >/dev/null 2>/tmp/m_err.txt; then echo "FAIL it ran over an unexpected my_data_export()"; exit 1; fi
grep -q "not a known version" /tmp/m_err.txt || { echo "FAIL wrong error: $(cat /tmp/m_err.txt)"; exit 1; }
[ "$("${P2[@]}" -c "select to_regclass('private.member_days') is null")" = t ] || { echo "FAIL a table was created"; exit 1; }
[ "$("${P2[@]}" -c "select md5(pg_get_functiondef('public.track(text,text,text,text,text,text)'::regprocedure))")" = "$before2" ] || { echo "FAIL track() changed"; exit 1; }
dropdb "${DB}_2"
echo "ok   an unexpected my_data_export() stops the migration with nothing changed"
echo "PASS metrics_p0.sql"
