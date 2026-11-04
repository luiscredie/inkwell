#!/usr/bin/env bash
# Tests supabase/collection_undo.sql on a scratch copy of a local Postgres with the Inkwell stubs
# (auth.users, auth.uid() reading the t.uid setting, public.inkwell_profiles) and production's delta functions.
#   PGHOST=/var/tmp/pgtest PGPORT=5544 PGUSER=postgres bash tools/collection_undo_sql_test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=collection_undo_test
P=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb -T postgres "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
A=aaaaaaaa-0000-4000-8000-000000000001; B=aaaaaaaa-0000-4000-8000-000000000002
"${P[@]}" -f "$ROOT/tools/fixtures/collection_delta.prod-2026-11-04.sql"
"${P[@]}" <<SQL
delete from public.collection_added;
delete from public.inkwell_profiles;
insert into auth.users (id, email) values ('$A', 'a@test.invalid'), ('$B', 'b@test.invalid') on conflict (id) do nothing;
insert into public.inkwell_profiles (user_id, profile, data, revision) values
  ('$A', 'principal', '{"collection": {"LOR10-1": {"n": 2, "f": 0}, "LOR1-216": {"n": 0, "f": 1}}}', 1),
  ('$B', 'principal', '{"collection": {"LOR10-1": {"n": 9, "f": 0}}}', 1);
SQL
# like production: new functions in public are executable by anon and authenticated by default (pg_default_acl)
"${P[@]}" -c "alter default privileges in schema public grant execute on functions to anon, authenticated"
"${P[@]}" -f "$ROOT/supabase/collection_undo.sql"
"${P[@]}" -f "$ROOT/supabase/collection_undo.sql"   # runs again: same result
echo "ok   runs twice"
q() { "${P[@]}" -c "$1"; }
as() { "${P[@]}" -c "set t.uid = '$1'; $2"; }
col() { q "select data->'collection'->'$2'->>'$3' from public.inkwell_profiles where user_id = '$1' and profile = 'principal'"; }
rev() { q "select revision from public.inkwell_profiles where user_id = '$1' and profile = 'principal'"; }
fails() { if "${P[@]}" -c "set t.uid = '$1'; $2" >/dev/null 2>/tmp/cu_err.txt; then echo "FAIL expected an error: $2"; exit 1; fi; grep -q "$3" /tmp/cu_err.txt || { echo "FAIL wrong error ($3): $(cat /tmp/cu_err.txt)"; exit 1; }; }
ADD='[{"card_id":"LOR10-1","qty":4,"foil":false},{"card_id":"LOR1-216","qty":1,"foil":true}]'
UNDO="$ADD"

# 1. add, then undo: exactly as before
as $A "select public.apply_collection_delta('principal', '$ADD')"
[ "$(col $A LOR10-1 n)/$(col $A LOR1-216 f)" = "6/2" ] || { echo "FAIL add"; exit 1; }
r=$(rev $A); as $A "select public.undo_collection_delta('principal', '$UNDO')"
[ "$(col $A LOR10-1 n)/$(col $A LOR1-216 f)" = "2/1" ] || { echo "FAIL undo"; exit 1; }
[ "$(rev $A)" = "$((r + 1))" ] || { echo "FAIL revision"; exit 1; }
echo "ok   undo takes out exactly what was added (6→2 normal, 2→1 foil) and bumps the revision"
# production's trigger: the add stamped the cards as added; the undo (a decrease) adds no stamp and does not fail
[ "$(q "select count(*) from public.collection_added where user_id = '$A'")" = "2" ] || { echo "FAIL stamps after add"; exit 1; }
[ "$(q "select qty from public.collection_added where user_id = '$A' and card_id = 'LOR10-1'")" = "4" ] || { echo "FAIL stamp qty"; exit 1; }
echo "ok   with production's trigger: the add is stamped (qty 4), the undo adds no stamp and does not fail"

# 2. a copy taken out after the add: the undo stops, nothing changes (not even the other card)
as $A "select public.apply_collection_delta('principal', '$ADD')"
as $A "select public.apply_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":-3,\"foil\":false}]')"   # 6 → 3
r=$(rev $A); fails $A "select public.undo_collection_delta('principal', '$UNDO')" "collection_changed"
[ "$(col $A LOR10-1 n)/$(col $A LOR1-216 f)/$(rev $A)" = "3/2/$r" ] || { echo "FAIL partial undo"; exit 1; }
grep -q "LOR10-1 n 3 < 4" /tmp/cu_err.txt || { echo "FAIL detail: $(cat /tmp/cu_err.txt)"; exit 1; }
echo "ok   a later removal blocks the undo; nothing changes, the error names the card (LOR10-1 n 3 < 4)"

# 3. copies added after the add stay
as $A "select public.apply_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":5,\"foil\":false}]')"   # 3 → 8
as $A "select public.undo_collection_delta('principal', '$UNDO')"
[ "$(col $A LOR10-1 n)/$(col $A LOR1-216 f)" = "4/1" ] || { echo "FAIL later adds"; exit 1; }
echo "ok   copies added later stay (8 − 4 = 4)"

# 4. the same card twice in one undo counts twice
fails $A "select public.undo_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":3},{\"card_id\":\"LOR10-1\",\"qty\":2}]')" "collection_changed"
[ "$(col $A LOR10-1 n)" = "4" ] || { echo "FAIL duplicate"; exit 1; }
as $A "select public.undo_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":2},{\"card_id\":\"LOR10-1\",\"qty\":2}]')"
[ "$(col $A LOR10-1 n)" = "0" ] || { echo "FAIL duplicate sum"; exit 1; }
echo "ok   the same card twice is summed (3 + 2 > 4 refused; 2 + 2 = 4 taken)"

# 5. only your own collection; signed out: nothing
fails $B "select public.undo_collection_delta('nope', '[{\"card_id\":\"LOR10-1\",\"qty\":1}]')" "profile not found"
as $B "select public.undo_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":1}]')"
[ "$(col $B LOR10-1 n)/$(col $A LOR1-216 f)" = "8/1" ] || { echo "FAIL other user"; exit 1; }
"${P[@]}" -c "reset t.uid" >/dev/null
if "${P[@]}" -c "select public.undo_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":1}]')" >/dev/null 2>/tmp/cu_err.txt; then echo "FAIL signed out"; exit 1; fi
grep -q authentication_required /tmp/cu_err.txt || { echo "FAIL signed out error"; exit 1; }
echo "ok   B's undo only touches B's collection (9 → 8; A unchanged); signed out: authentication_required"

# 6. bad input: nothing changes
for bad in '[]' '{}' '[{"card_id":"LOR10-1","qty":0}]' '[{"card_id":"LOR10-1","qty":-1}]' '[{"card_id":"LOR10-1","qty":1.5}]' '[{"card_id":"","qty":1}]' '[{"card_id":"LOR10-1","qty":"1"}]'; do
  fails $B "select public.undo_collection_delta('principal', '$bad')" "bad delta"
done
big=$(python3 -c "import json; print(json.dumps([{'card_id':'LOR10-1','qty':1}]*401))")
fails $B "select public.undo_collection_delta('principal', '$big')" "bad delta"
[ "$(col $B LOR10-1 n)" = "8" ] || { echo "FAIL bad input changed"; exit 1; }
fails $B "select public.undo_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":1,\"foil\":\"talvez\"}]')" "boolean"
[ "$(col $B LOR10-1 n)" = "8" ] || { echo "FAIL bad foil changed"; exit 1; }
echo "ok   bad input refused: empty, not a list, 0, negative, 1.5, no card, text, 401 items, foil not true/false"

# 7. grants: anon cannot call it, authenticated can
[ "$(q "select has_function_privilege('anon', 'public.undo_collection_delta(text,jsonb)', 'execute')")" = f ] || { echo "FAIL anon"; exit 1; }
[ "$(q "select has_function_privilege('authenticated', 'public.undo_collection_delta(text,jsonb)', 'execute')")" = t ] || { echo "FAIL authenticated"; exit 1; }
[ "$(q "select has_function_privilege('public', 'public.undo_collection_delta(text,jsonb)', 'execute')")" = f ] || { echo "FAIL public"; exit 1; }
echo "ok   anon cannot run it (even with production's default grant to anon); authenticated can"

# 8. at the same time: another device takes copies out while the undo runs. The undo waits for the lock and then
#    sees the new number, so it refuses instead of taking the same copies twice
as $A "select public.apply_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":4,\"foil\":false}]')"   # 0 → 4
( "${P[@]}" -c "begin; set local t.uid = '$A'; select public.apply_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":-2,\"foil\":false}]'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5
t0=$(date +%s.%N)
if "${P[@]}" -c "set t.uid = '$A'; select public.undo_collection_delta('principal', '[{\"card_id\":\"LOR10-1\",\"qty\":4,\"foil\":false}]')" >/dev/null 2>/tmp/cu_err.txt; then echo "FAIL concurrent undo went through"; exit 1; fi
t1=$(date +%s.%N); wait
grep -q collection_changed /tmp/cu_err.txt || { echo "FAIL concurrent error: $(cat /tmp/cu_err.txt)"; exit 1; }
waited=$(python3 -c "print(round($t1 - $t0, 1))")
[ "$(col $A LOR10-1 n)" = "2" ] || { echo "FAIL concurrent result $(col $A LOR10-1 n)"; exit 1; }
python3 -c "import sys; sys.exit(0 if $t1 - $t0 >= 1.0 else 1)" || { echo "FAIL the undo did not wait for the lock ($waited s)"; exit 1; }
echo "ok   concurrent: the undo waited ${waited}s for the other change, saw 2 < 4 and refused; 2 stay"
echo "PASS collection_undo.sql"
