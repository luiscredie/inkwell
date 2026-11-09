#!/usr/bin/env bash
# Tests supabase/trade_proposal_notice.sql (Amigos 2.0, etapa C4) on a scratch database of a local Postgres.
# Self-contained: minimal stubs (auth.uid() reads the t.uid setting) plus the real private.rate_log/rate_hit from
# supabase/hardening.sql.
#   PGHOST=/var/tmp/pgtest PGPORT=5544 PGUSER=postgres bash tools/trade_proposal_notice_sql_test.sh
# Checks: a proposal notifies the partner (kind trade_proposal, actor, ref); the same unanswered proposal is refused
# and leaves nothing behind; once answered it can be sent again; 20 proposals per 24 h, the 21st refused; two
# identical proposals sent at the same moment from two sessions: one goes through, the other is refused; the
# function is not callable by API roles; running the file twice changes nothing more.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=trade_proposal_notice_test
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
fail() { echo "FAIL $*"; exit 1; }

"${PSQL[@]}" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth; create schema private;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table public.user_trades (id uuid primary key default gen_random_uuid(), proposer uuid not null references auth.users(id),
  partner uuid not null references auth.users(id), gave jsonb not null default '[]', got jsonb not null default '[]',
  cash_brl numeric(10, 2) not null default 0, note text not null default '', status text not null default 'proposed');
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, kind text not null,
  actor uuid, ref jsonb not null default '{}', created_at timestamptz not null default now(), read_at timestamptz);
insert into auth.users values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
SQL
# the real rate limiter
awk '/^create table if not exists private.rate_log/{f=1} f{print} f&&/^end \$\$;/{exit}' "$ROOT/supabase/hardening.sql" | "${PSQL[@]}"

snap() { "${PSQL[@]}" -c "select p.oid::regprocedure || ' ' || md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') order by 1; select tgname || ' ' || tgrelid::regclass from pg_trigger where not tgisinternal order by 1"; }
snap > /tmp/tpn_before.txt
"${PSQL[@]}" -f "$ROOT/supabase/trade_proposal_notice.sql"
snap > /tmp/tpn_once.txt
"${PSQL[@]}" -f "$ROOT/supabase/trade_proposal_notice.sql"
snap > /tmp/tpn_twice.txt
changed=$( (diff /tmp/tpn_before.txt /tmp/tpn_once.txt || true) | grep -E '^[<>]' | sed -E 's/^[<>] //; s/ [0-9a-f]{32}$//' | sort -u | tr '\n' ' ')
[ "$changed" = "private.trade_proposal_notice() user_trades_notice user_trades " ] || fail "changed: $changed"
diff -q /tmp/tpn_once.txt /tmp/tpn_twice.txt >/dev/null || fail "second run changed something"

ME=11111111-1111-4111-8111-111111111111; ANA=22222222-2222-4222-8222-222222222222
q() { "${PSQL[@]}" -c "select set_config('t.uid', '$ME', false)" -c "$1" | tail -n +2; }
propose() { q "insert into public.user_trades (proposer, partner, got, cash_brl) values ('$ME', '$ANA', '[{\"card_id\":\"LOR10-10\",\"qty\":1}]', $1)" 2>&1; }

propose 0 >/dev/null || fail "first proposal"
[ "$(q "select kind || ' ' || actor || ' ' || (ref->>'n') || ' ' || (ref->>'trade' = (select id::text from public.user_trades)) from public.notifications where user_id = '$ANA'")" = "trade_proposal $ME 1 true" ] || fail "notice"
{ propose 0 || true; } | grep -q duplicate_trade_proposal || fail "duplicate not refused"
[ "$(q "select count(*) from public.user_trades") $(q "select count(*) from public.notifications") $(q "select count(*) from private.rate_log")" = "1 1 1" ] || fail "duplicate left something behind"
q "update public.user_trades set status = 'declined'" >/dev/null
propose 0 >/dev/null || fail "again after an answer"
for c in $(seq 1 18); do propose "$c" >/dev/null || fail "proposal $c within the limit"; done
[ "$(q "select count(*) from public.user_trades")" = 20 ] || fail "20 proposals"
{ propose 99 || true; } | grep -q too_many_trade_proposals || fail "21st not refused"
[ "$(q "select count(*) from public.user_trades") $(q "select count(*) from public.notifications")" = "20 20" ] || fail "21st left something behind"

# two identical proposals at the same moment: clear the log, then race two sessions
q "delete from public.user_trades; delete from public.notifications; delete from private.rate_log" >/dev/null
race() { "${PSQL[@]}" -c "select set_config('t.uid', '$ME', false)" -c "begin; insert into public.user_trades (proposer, partner, got, cash_brl) values ('$ME', '$ANA', '[{\"card_id\":\"LOR1-1\",\"qty\":1}]', 7); select pg_sleep(1); commit;" >/tmp/tpn_race_$1.txt 2>&1 && echo ok >>/tmp/tpn_race_$1.txt || true; }
rm -f /tmp/tpn_race_*.txt; race a & race b & wait
oks=$(cat /tmp/tpn_race_a.txt /tmp/tpn_race_b.txt | grep -c '^ok$' || true)
dups=$(cat /tmp/tpn_race_a.txt /tmp/tpn_race_b.txt | grep -c duplicate_trade_proposal || true)
[ "$oks $dups" = "1 1" ] || fail "race: ok=$oks duplicate=$dups"
[ "$(q "select count(*) from public.user_trades") $(q "select count(*) from public.notifications")" = "1 1" ] || fail "race left two"

for r in anon authenticated; do
  [ "$("${PSQL[@]}" -c "select has_function_privilege('$r', 'private.trade_proposal_notice()', 'execute')")" = f ] || fail "$r can execute"
done
echo "PASS trade_proposal_notice.sql"
