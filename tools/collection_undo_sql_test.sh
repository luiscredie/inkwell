#!/usr/bin/env bash
# Tests supabase/collection_undo.sql (add_collection_op / undo_collection_op) on a scratch copy of a local Postgres
# shaped like production: auth.users, auth.uid() reading the t.uid setting, public.inkwell_profiles, production's
# delta functions and its trigger (tools/fixtures/collection_delta.prod-2026-11-04.sql), and production's default
# grant of EXECUTE to anon on new functions.
#   PGHOST=/var/tmp/pgtest PGPORT=5544 PGUSER=postgres bash tools/collection_undo_sql_test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=collection_undo_test
P=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb -T postgres "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
A=aaaaaaaa-0000-4000-8000-000000000001; B=aaaaaaaa-0000-4000-8000-000000000002
"${P[@]}" -f "$ROOT/tools/fixtures/collection_delta.prod-2026-11-04.sql" 2>/dev/null
"${P[@]}" -c "alter default privileges in schema public grant execute on functions to anon, authenticated"
reset_db() { "${P[@]}" <<SQL
delete from public.collection_added;
delete from public.inkwell_profiles;
insert into auth.users (id, email) values ('$A', 'a@test.invalid'), ('$B', 'b@test.invalid') on conflict (id) do nothing;
insert into public.inkwell_profiles (user_id, profile, data, revision) values
  ('$A', 'principal', '{"collection": {"LOR10-1": {"n": 10, "f": 0}, "LOR1-216": {"n": 0, "f": 1}}}', 1),
  ('$B', 'principal', '{"collection": {"LOR10-1": {"n": 9, "f": 0}}}', 1);
SQL
}
q() { "${P[@]}" -c "$1"; }
as() { "${P[@]}" -c "set t.uid = '$1'; $2"; }
n() { q "select data->'collection'->'$2'->>'${3:-n}' from public.inkwell_profiles where user_id = '$1' and profile = 'principal'"; }
rev() { q "select revision from public.inkwell_profiles where user_id = '$1' and profile = 'principal'"; }
fails() { if "${P[@]}" -c "set t.uid = '$1'; $2" >/dev/null 2>/tmp/cu_err.txt; then echo "FAIL expected an error ($3): $2"; exit 1; fi; grep -q "$3" /tmp/cu_err.txt || { echo "FAIL wrong error ($3): $(cat /tmp/cu_err.txt)"; exit 1; }; }
ok() { echo "ok   $*"; }
md5s() { q "select string_agg(p.oid::regprocedure::text || '=' || md5(pg_get_functiondef(p.oid)), ' ' order by 1) from pg_proc p where p.oid in ('public.apply_collection_delta(text,jsonb)'::regprocedure, 'private.collection_delta_for(uuid,text,jsonb)'::regprocedure, 'public.stamp_collection_added()'::regprocedure)"; }
ADD4='[{"card_id":"LOR10-1","qty":4,"foil":false}]'
op() { printf '00000000-0000-4000-8000-%012d' "$1"; }

# 0. the problem, on the previous draft (undo_collection_delta): the same undo twice takes pre-existing copies
reset_db
"${P[@]}" -f "$ROOT/tools/fixtures/collection_undo.v1-draft.sql" >/dev/null
as $A "select public.apply_collection_delta('principal', '$ADD4')"
as $A "select public.undo_collection_delta('principal', '$ADD4')"
as $A "select public.undo_collection_delta('principal', '$ADD4')"
[ "$(n $A LOR10-1)" = "6" ] || { echo "FAIL could not reproduce the double undo: $(n $A LOR10-1)"; exit 1; }
ok "REPRODUCED on the previous draft: 10 + 4, undo, the same undo again → 6 (4 of the original 10 taken)"

# the migration, twice
before_md5=$(md5s)
"${P[@]}" -f "$ROOT/supabase/collection_undo.sql" >/dev/null
"${P[@]}" -f "$ROOT/supabase/collection_undo.sql" >/dev/null
[ "$(md5s)" = "$before_md5" ] || { echo "FAIL existing functions changed"; exit 1; }
[ "$(q "select to_regprocedure('public.undo_collection_delta(text,jsonb)') is null")" = t ] || { echo "FAIL old draft kept"; exit 1; }
ok "migration runs twice; apply_collection_delta, collection_delta_for and the trigger function are unchanged; the old draft is gone"
reset_db

# 1. undo once: back to exactly 10; the revision moves on each change (other devices pull it)
r0=$(rev $A)
[ "$(as $A "select public.add_collection_op('principal', '$ADD4', '$(op 1)')->>'status'")" = applied ] || { echo "FAIL add"; exit 1; }
[ "$(n $A LOR10-1)/$(rev $A)" = "14/$((r0 + 1))" ] || { echo "FAIL after add $(n $A LOR10-1)"; exit 1; }
[ "$(as $A "select public.undo_collection_op('$(op 1)')->>'status'")" = undone ] || { echo "FAIL undo"; exit 1; }
[ "$(n $A LOR10-1)/$(rev $A)" = "10/$((r0 + 2))" ] || { echo "FAIL after undo"; exit 1; }
ok "undo once: 10 → 14 → 10; revision +1 at each step"
# 2. the same undo again (a second tap, a retry after a lost answer, a direct API call)
fails $A "select public.undo_collection_op('$(op 1)')" "already_undone"
[ "$(n $A LOR10-1)" = "10" ] || { echo "FAIL second undo changed"; exit 1; }
ok "the same undo again → already_undone; the original 10 stay"
# 3. the same add again (a retry after a lost answer): added once
as $A "select public.add_collection_op('principal', '$ADD4', '$(op 2)')" >/dev/null
[ "$(as $A "select public.add_collection_op('principal', '$ADD4', '$(op 2)')->>'status'")" = already_applied ] || { echo "FAIL retry add"; exit 1; }
[ "$(n $A LOR10-1)" = "14" ] || { echo "FAIL retry added twice"; exit 1; }
as $A "select public.undo_collection_op('$(op 2)')" >/dev/null
ok "the same add again (lost answer) → already_applied, 14 not 18; undo back to 10"
# 4. two undo requests at the same time: one undoes, the other waits for the lock and gets already_undone
as $A "select public.add_collection_op('principal', '$ADD4', '$(op 3)')" >/dev/null
( "${P[@]}" -c "begin; select 1 from public.inkwell_profiles where user_id = '$A' for update; select pg_sleep(1); commit;" >/dev/null ) &
sleep 0.3
( "${P[@]}" -c "set t.uid = '$A'; select public.undo_collection_op('$(op 3)')->>'status'" > /tmp/cu_r1.txt 2>&1 || true ) &
( "${P[@]}" -c "set t.uid = '$A'; select public.undo_collection_op('$(op 3)')->>'status'" > /tmp/cu_r2.txt 2>&1 || true ) &
wait
res=$(cat /tmp/cu_r1.txt /tmp/cu_r2.txt | grep -oE "^undone$|already_undone" | sort | tr '\n' ' ')
[ "$res" = "already_undone undone " ] || { echo "FAIL simultaneous undos: $res"; exit 1; }
[ "$(n $A LOR10-1)" = "10" ] || { echo "FAIL simultaneous result $(n $A LOR10-1)"; exit 1; }
ok "two undos at the same time → one 'undone', one 'already_undone'; 10 stay (4 taken once)"
# 5. another device changes the collection while the undo runs: the undo waits, then both changes count
as $A "select public.add_collection_op('principal', '$ADD4', '$(op 4)')" >/dev/null   # 14
( "${P[@]}" -c "begin; set local t.uid = '$A'; select public.apply_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":-2}]'); select pg_sleep(1.2); commit;" >/dev/null ) &
sleep 0.3
t0=$(date +%s.%N); as $A "select public.undo_collection_op('$(op 4)')" >/dev/null; t1=$(date +%s.%N); wait
[ "$(n $A LOR10-1)" = "8" ] || { echo "FAIL concurrent change $(n $A LOR10-1)"; exit 1; }
python3 -c "import sys; sys.exit(0 if $t1 - $t0 >= 0.6 else 1)" || { echo "FAIL the undo did not wait"; exit 1; }
ok "another device takes 2 out during the undo: the undo waits ($(python3 -c "print(round($t1 - $t0, 1))")s), then 14 − 2 − 4 = 8 (both kept)"
as $A "select public.apply_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":2}]')" >/dev/null   # back to 10
# 6. copies added later stay
as $A "select public.add_collection_op('principal', '$ADD4', '$(op 5)')" >/dev/null       # 14
as $A "select public.apply_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":3}]')" >/dev/null   # 17
as $A "select public.undo_collection_op('$(op 5)')" >/dev/null
[ "$(n $A LOR10-1)" = "13" ] || { echo "FAIL later adds"; exit 1; }
ok "copies added later stay: 14 + 3 − 4 = 13"
as $A "select public.apply_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":-3}]')" >/dev/null   # 10
# 7. copies removed later: refused, nothing changes, the op can still be undone once they are back
as $A "select public.add_collection_op('principal', '$ADD4', '$(op 6)')" >/dev/null       # 14
as $A "select public.apply_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":-11}]')" >/dev/null   # 3
r=$(rev $A); fails $A "select public.undo_collection_op('$(op 6)')" "collection_changed"
grep -q "LOR10-1 n 3 < 4" /tmp/cu_err.txt || { echo "FAIL detail"; exit 1; }
[ "$(n $A LOR10-1)/$(rev $A)" = "3/$r" ] || { echo "FAIL refused undo changed"; exit 1; }
ok "copies removed later (14 → 3): collection_changed (LOR10-1 n 3 < 4); nothing changes"
# 8. changed and then put back to the same numbers: counts, not copies → it can be undone
as $A "select public.apply_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":11}]')" >/dev/null   # 14 again
[ "$(as $A "select public.undo_collection_op('$(op 6)')->>'status'")" = undone ] || { echo "FAIL restored"; exit 1; }
[ "$(n $A LOR10-1)" = "10" ] || { echo "FAIL restored result"; exit 1; }
ok "changed and put back to 14: undone once (counts, not copies) → 10"
# 9. someone else's operation or collection
as $A "select public.add_collection_op('principal', '$ADD4', '$(op 7)')" >/dev/null       # A: 14
fails $B "select public.undo_collection_op('$(op 7)')" "op_not_found"
fails $B "select public.add_collection_op('principal', '$ADD4', '$(op 7)')" "op_conflict"
fails $B "select public.add_collection_op('nope', '$ADD4', '$(op 8)')" "profile not found"
[ "$(n $A LOR10-1)/$(n $B LOR10-1)" = "14/9" ] || { echo "FAIL third party changed"; exit 1; }
as $A "select public.undo_collection_op('$(op 7)')" >/dev/null
ok "B cannot undo A's op (op_not_found) nor reuse its id (op_conflict); B's 9 and A's 14 untouched"
# 10. signed out, anon, the table
"${P[@]}" -c "reset t.uid" >/dev/null
if "${P[@]}" -c "select public.undo_collection_op('$(op 7)')" >/dev/null 2>/tmp/cu_err.txt; then echo "FAIL signed out undo"; exit 1; fi
grep -q authentication_required /tmp/cu_err.txt || { echo "FAIL signed out error"; exit 1; }
if "${P[@]}" -c "select public.add_collection_op('principal', '$ADD4', '$(op 9)')" >/dev/null 2>/tmp/cu_err.txt; then echo "FAIL signed out add"; exit 1; fi
grep -q authentication_required /tmp/cu_err.txt || { echo "FAIL signed out add error"; exit 1; }
for f in 'public.add_collection_op(text,jsonb,uuid)' 'public.undo_collection_op(uuid)'; do
  [ "$(q "select has_function_privilege('anon', '$f', 'execute')")$(q "select has_function_privilege('public', '$f', 'execute')")" = ff ] || { echo "FAIL anon/public on $f"; exit 1; }
  [ "$(q "select has_function_privilege('authenticated', '$f', 'execute')")" = t ] || { echo "FAIL authenticated on $f"; exit 1; }
done
[ "$(q "select has_function_privilege('authenticated', 'private.collection_op_delta(jsonb)', 'execute')")" = f ] || { echo "FAIL helper open"; exit 1; }
for r in anon authenticated; do [ "$(q "select has_table_privilege('$r', 'private.collection_ops', 'select')")" = f ] || { echo "FAIL $r reads ops"; exit 1; }; done
ok "signed out: authentication_required; anon cannot run either function (even with production's default grant); the table is closed to the API roles"
# 11. bad input: refused, nothing changes
for bad in '[]' '{}' 'null' '[1]' '[{"card_id":"LOR10-1","qty":0}]' '[{"card_id":"LOR10-1","qty":-1}]' '[{"card_id":"LOR10-1","qty":1.5}]' \
  '[{"card_id":"LOR10-1","qty":"1"}]' '[{"card_id":"LOR10-1","qty":1000}]' '[{"card_id":"","qty":1}]' '[{"card_id":"LOR10-1","qty":1,"foil":"x"}]' \
  "[{\"card_id\":\"$(printf 'X%.0s' {1..41})\",\"qty\":1}]"; do
  fails $A "select public.add_collection_op('principal', '$bad', '$(op 10)')" "bad delta"
done
big=$(python3 -c "import json; print(json.dumps([{'card_id':'LOR10-1','qty':1}]*401))")
fails $A "select public.add_collection_op('principal', '$big', '$(op 10)')" "bad delta"
fails $A "select public.add_collection_op('principal', '$ADD4', null)" "bad op"
fails $A "select public.undo_collection_op(null)" "bad op"
fails $A "select public.undo_collection_op('not-a-uuid')" "uuid"
[ "$(n $A LOR10-1)/$(q "select count(*) from private.collection_ops where op_id = '$(op 10)'")" = "10/0" ] || { echo "FAIL bad input changed"; exit 1; }
ok "bad input refused (empty, not a list, null, not objects, 0, −1, 1.5, text, 1000, no card, 41 letters, foil not true/false, 401 items, no op, not a uuid); nothing changes"
# 12. the same id for a different add: refused
as $A "select public.add_collection_op('principal', '$ADD4', '$(op 11)')" >/dev/null       # 14
fails $A "select public.add_collection_op('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":5}]', '$(op 11)')" "op_conflict"
[ "$(n $A LOR10-1)" = "14" ] || { echo "FAIL op conflict changed"; exit 1; }
as $A "select public.undo_collection_op('$(op 11)')" >/dev/null
ok "the same id with a different list → op_conflict, nothing added"
# 13. compatibility with what exists: the trigger stamps the add; apply_collection_delta works as before
[ "$(q "select qty from public.collection_added where user_id = '$A' and card_id = 'LOR10-1'")" = "4" ] || { echo "FAIL trigger stamp"; exit 1; }
as $A "select public.apply_collection_delta('principal', '[{\"card_id\":\"LOR1-216\",\"qty\":1,\"foil\":true}]')"
[ "$(n $A LOR1-216 f)" = "2" ] || { echo "FAIL apply_collection_delta"; exit 1; }
ok "production's trigger stamps the add (qty 4); the undo adds no stamp; apply_collection_delta works as before"
# 14. old ops: no undo after 10 minutes; gone after 1 day; gone with the account
as $A "select public.add_collection_op('principal', '$ADD4', '$(op 12)')" >/dev/null       # 14
q "update private.collection_ops set created_at = now() - interval '11 minutes' where op_id = '$(op 12)'"
fails $A "select public.undo_collection_op('$(op 12)')" "undo_expired"
[ "$(n $A LOR10-1)" = "14" ] || { echo "FAIL expired changed"; exit 1; }
q "update private.collection_ops set created_at = now() - interval '2 days' where op_id = '$(op 12)'"
as $A "select public.add_collection_op('principal', '[{\"card_id\":\"LOR10-2\",\"qty\":1}]', '$(op 13)')" >/dev/null
[ "$(q "select count(*) from private.collection_ops where op_id = '$(op 12)'")" = "0" ] || { echo "FAIL retention"; exit 1; }
fails $A "select public.undo_collection_op('$(op 12)')" "op_not_found"
q "delete from auth.users where id = '$A'"
[ "$(q "select count(*) from private.collection_ops where user_id = '$A'")" = "0" ] || { echo "FAIL account deletion"; exit 1; }
ok "after 10 min: undo_expired (nothing changes); after 1 day the op is deleted; deleting the account deletes its ops"
# 15. rollback: only what the migration created goes; collections and existing functions stay; it can come back
snapB=$(n $B LOR10-1)
"${P[@]}" -f "$ROOT/supabase/collection_undo_rollback.sql" >/dev/null
"${P[@]}" -f "$ROOT/supabase/collection_undo_rollback.sql" >/dev/null
[ "$(q "select (to_regprocedure('public.add_collection_op(text,jsonb,uuid)') is null)::text || (to_regprocedure('public.undo_collection_op(uuid)') is null)::text || (to_regclass('private.collection_ops') is null)::text")" = truetruetrue ] || { echo "FAIL rollback left objects"; exit 1; }
[ "$(md5s)" = "$before_md5" ] && [ "$(n $B LOR10-1)" = "$snapB" ] || { echo "FAIL rollback changed something else"; exit 1; }
"${P[@]}" -f "$ROOT/supabase/collection_undo.sql" >/dev/null
[ "$(q "select to_regprocedure('public.undo_collection_op(uuid)') is not null")" = t ] || { echo "FAIL reinstall"; exit 1; }
ok "rollback (run twice) removes only the two functions, the check and the table; collections and existing functions unchanged; reinstall works"
echo "PASS collection_undo.sql"
