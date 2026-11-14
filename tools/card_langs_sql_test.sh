#!/usr/bin/env bash
# Tests supabase/card_langs.sql (idioma das cartas) on a scratch local Postgres shaped like production
# (tools/fixtures/card_langs.prod-2026-11-13.sql), then checks that card_langs_rollback.sql brings production's
# functions back byte for byte.
#   PGHOST=/var/tmp/pgtest PGPORT=5544 PGUSER=postgres bash tools/card_langs_sql_test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=card_langs_test
P=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
A=aaaaaaaa-0000-4000-8000-000000000001; B=aaaaaaaa-0000-4000-8000-000000000002; C=aaaaaaaa-0000-4000-8000-000000000003
"${P[@]}" -f "$ROOT/tools/fixtures/card_langs.prod-2026-11-13.sql" >/dev/null
md5s() { "${P[@]}" -c "select string_agg(p.oid::regprocedure::text || '=' || md5(pg_get_functiondef(p.oid)), ' ' order by 1) from pg_proc p
  where p.oid in ('private.valid_items(jsonb)'::regprocedure, 'private.collection_delta_for(uuid,text,jsonb)'::regprocedure,
                  'private.collection_op_delta(jsonb)'::regprocedure, 'public.undo_collection_op(uuid)'::regprocedure)"; }
BEFORE=$(md5s)
"${P[@]}" -f "$ROOT/supabase/card_langs.sql" >/dev/null
"${P[@]}" -f "$ROOT/supabase/card_langs.sql" >/dev/null   # safe to run twice

reset_db() { "${P[@]}" <<SQL
delete from private.collection_lang_ops; delete from private.collection_ops; delete from public.collection_shares;
delete from public.collection_added; delete from public.inkwell_profiles; delete from public.loans;
insert into auth.users (id, email) values ('$A', 'a@t.invalid'), ('$B', 'b@t.invalid'), ('$C', 'c@t.invalid') on conflict (id) do nothing;
insert into public.inkwell_profiles (user_id, profile, data, revision) values
  ('$A', 'principal', '{"collection": {"MUSHU": {"n": 2, "f": 1}, "MICKEY": {"n": 1, "f": 0}, "ELSA": {"n": 3, "f": 0}}}', 1),
  ('$B', 'principal', '{"collection": {"MUSHU": {"n": 1, "f": 0}}}', 1);
insert into public.collection_shares (owner, profile, member, can_edit) values ('$A', 'principal', '$B', true), ('$A', 'principal', '$C', false);
SQL
}
q() { "${P[@]}" -c "$1"; }
as() { "${P[@]}" -c "set t.uid = '$1'; $2" | grep -v '^$' || true; }
card() { q "select data->'collection'->'$2' from public.inkwell_profiles where user_id = '$1' and profile = 'principal'"; }
rev() { q "select revision from public.inkwell_profiles where user_id = '$1' and profile = 'principal'"; }
eq() { if [ "$2" != "$3" ]; then echo "FAIL $1: got $2, expected $3"; exit 1; fi; echo "ok   $1"; }
jeq() { local got; got=$(q "select ('$2'::jsonb = '$3'::jsonb)::text"); if [ "$got" != "true" ]; then echo "FAIL $1: got $2, expected $3"; exit 1; fi; echo "ok   $1"; }
fails() { if "${P[@]}" -c "set t.uid = '$1'; $2" >/dev/null 2>/tmp/cl_err.txt; then echo "FAIL expected an error ($3): $2"; exit 1; fi
  grep -q "$3" /tmp/cl_err.txt || { echo "FAIL wrong error ($3): $(cat /tmp/cl_err.txt)"; exit 1; }; echo "ok   refused: $3 — ${4:-}"; }
op() { printf '00000000-0000-4000-8000-%012d' "$1"; }
delta() { as $A "select public.apply_collection_delta('principal', '$1')"; }

# 1. a collection without languages behaves exactly as before
reset_db
delta '[{"card_id":"ELSA","qty":1,"foil":false}]'; jeq "add without language: total only" "$(card $A ELSA)" '{"n":4,"f":0}'
delta '[{"card_id":"ELSA","qty":-2,"foil":false}]'; jeq "remove without language: total only" "$(card $A ELSA)" '{"n":2,"f":0}'
delta '[{"card_id":"ELSA","qty":-9,"foil":false}]'; jeq "removing more than owned still clamps at 0" "$(card $A ELSA)" '{"n":0,"f":0}'

# 2. adding and removing with a language
reset_db
delta '[{"card_id":"MUSHU","qty":1,"foil":false,"lang":"it"}]'
jeq "add 1 Mushu IT" "$(card $A MUSHU)" '{"n":3,"f":1,"l":{"it":{"n":1}}}'
delta '[{"card_id":"MICKEY","qty":1,"foil":true,"lang":"ja"}]'
jeq "add 1 Mickey JA foil" "$(card $A MICKEY)" '{"n":1,"f":1,"l":{"ja":{"f":1}}}'
fails $A "select public.apply_collection_delta('principal', '[{\"card_id\":\"MUSHU\",\"qty\":1,\"lang\":\"pt\"}]')" "bad delta item" "no Portuguese printing"
fails $A "select public.apply_collection_delta('principal', '[{\"card_id\":\"MUSHU\",\"qty\":-2,\"lang\":\"it\"}]')" "lang_short" "only 1 IT"
delta '[{"card_id":"MUSHU","qty":-1,"foil":false}]'
jeq "remove without language takes a copy sem idioma first" "$(card $A MUSHU)" '{"n":2,"f":1,"l":{"it":{"n":1}}}'
delta '[{"card_id":"MUSHU","qty":-1,"foil":false}]'
jeq "…and again: the IT copy is kept" "$(card $A MUSHU)" '{"n":1,"f":1,"l":{"it":{"n":1}}}'
delta '[{"card_id":"MUSHU","qty":-1,"foil":false}]'
jeq "only IT left: it is the one removed (no doubt)" "$(card $A MUSHU)" '{"n":0,"f":1}'

# 3. two languages, nothing sem idioma: a removal must say which
reset_db
delta '[{"card_id":"MUSHU","qty":-2,"foil":false},{"card_id":"MUSHU","qty":1,"lang":"en"},{"card_id":"MUSHU","qty":1,"lang":"it"}]'
jeq "Mushu: 1 EN + 1 IT" "$(card $A MUSHU)" '{"n":2,"f":1,"l":{"en":{"n":1},"it":{"n":1}}}'
fails $A "select public.apply_collection_delta('principal', '[{\"card_id\":\"MUSHU\",\"qty\":-1,\"foil\":false}]')" "lang_required" "EN or IT?"
jeq "refused: nothing changed" "$(card $A MUSHU)" '{"n":2,"f":1,"l":{"en":{"n":1},"it":{"n":1}}}'
delta '[{"card_id":"MUSHU","qty":-1,"foil":false,"lang":"it"}]'
jeq "remove the IT one by name" "$(card $A MUSHU)" '{"n":1,"f":1,"l":{"en":{"n":1}}}'
delta '[{"card_id":"MUSHU","qty":-1,"foil":true}]'
jeq "the foil had no language: removed as before, EN untouched" "$(card $A MUSHU)" '{"n":1,"f":0,"l":{"en":{"n":1}}}'
reset_db
delta '[{"card_id":"MUSHU","qty":-2,"foil":false},{"card_id":"MUSHU","qty":1,"lang":"en"},{"card_id":"MUSHU","qty":1,"lang":"it"}]'
delta '[{"card_id":"MUSHU","qty":-2,"foil":false}]'
jeq "removing every copy of the finish needs no choice" "$(card $A MUSHU)" '{"n":0,"f":1}'

# 4. home / trade moves and shared collections keep the split
reset_db
delta '[{"card_id":"ELSA","qty":1,"lang":"de"}]'
as $A "select public.collection_change('principal', '[]', '[{\"card_id\":\"ELSA\",\"qty\":2}]')"
jeq "moving to Casa does not touch the split" "$(card $A ELSA)" '{"n":4,"f":0,"l":{"de":{"n":1}}}'
as $B "select public.shared_collection_change('$A', 'principal', '[{\"card_id\":\"ELSA\",\"qty\":1,\"lang\":\"fr\"}]', '[]')"
jeq "a member who can edit adds an FR copy" "$(card $A ELSA)" '{"n":5,"f":0,"l":{"de":{"n":1},"fr":{"n":1}}}'

# 5. the logged add and its undo take back the same copies
reset_db
as $A "select public.add_collection_op('principal', '[{\"card_id\":\"MICKEY\",\"qty\":2,\"foil\":false,\"lang\":\"ja\"}]', '$(op 1)')"
jeq "logged add of 2 JA" "$(card $A MICKEY)" '{"n":3,"f":0,"l":{"ja":{"n":2}}}'
eq "the log keeps the language" "$(q "select delta->0->>'lang' from private.collection_ops where op_id = '$(op 1)'")" "ja"
as $A "select public.undo_collection_op('$(op 1)')"
jeq "undo removes the 2 JA, not the old copy" "$(card $A MICKEY)" '{"n":1,"f":0}'
as $A "select public.add_collection_op('principal', '[{\"card_id\":\"ELSA\",\"qty\":2,\"foil\":false}]', '$(op 2)')"
as $A "select public.mark_unknown_langs(null, 'principal', '[{\"card_id\":\"ELSA\",\"lang\":\"en\",\"qty\":4}]', null, $(rev $A), '$(op 3)')"
fails $A "select public.undo_collection_op('$(op 2)')" "collection_changed" "the added copies were marked EN meanwhile"
jeq "refused undo changed nothing" "$(card $A ELSA)" '{"n":5,"f":0,"l":{"en":{"n":4}}}'

# 6. marking old copies: limits per finish, conflicts, revision, all or nothing, undo
reset_db
R=$(rev $A)
fails $A "select public.mark_unknown_langs(null, 'principal', '[{\"card_id\":\"MUSHU\",\"lang\":\"en\",\"qty\":2,\"foil\":true}]', null, $R, '$(op 10)')" "lang_conflict" "only 1 foil sem idioma (3 copies in all)"
fails $A "select public.mark_unknown_langs(null, 'principal', '[{\"card_id\":\"MUSHU\",\"lang\":\"en\",\"qty\":2},{\"card_id\":\"MUSHU\",\"lang\":\"it\",\"qty\":1}]', null, $R, '$(op 11)')" "lang_conflict" "EN 2 + IT 1 of 2 copies"
fails $A "select public.mark_unknown_langs(null, 'principal', '[{\"card_id\":\"ELSA\",\"lang\":\"en\",\"qty\":1},{\"card_id\":\"NOPE\",\"lang\":\"en\",\"qty\":1}]', null, $R, '$(op 12)')" "lang_conflict" "a card not in the collection"
jeq "refused: Elsa untouched (all or nothing)" "$(card $A ELSA)" '{"n":3,"f":0}'
fails $A "select public.mark_unknown_langs(null, 'principal', '[{\"card_id\":\"ELSA\",\"lang\":\"en\",\"qty\":1}]', null, $((R - 1)), '$(op 13)')" "collection_changed" "changed on another device"
OUT=$(as $A "select public.mark_unknown_langs(null, 'principal', '[{\"card_id\":\"MUSHU\",\"lang\":\"en\",\"qty\":1},{\"card_id\":\"MUSHU\",\"lang\":\"it\",\"qty\":1},{\"card_id\":\"MICKEY\",\"lang\":\"ja\",\"qty\":1}]', 'en', $R, '$(op 14)')")
eq "mark: 2 + 1 listed, the other 4 (3 Elsa + 1 Mushu foil) as EN" "$(q "select ('$OUT'::jsonb->>'copies')")" "7"
jeq "Mushu after" "$(card $A MUSHU)" '{"n":2,"f":1,"l":{"en":{"n":1,"f":1},"it":{"n":1}}}'
jeq "Mickey after" "$(card $A MICKEY)" '{"n":1,"f":0,"l":{"ja":{"n":1}}}'
jeq "Elsa after" "$(card $A ELSA)" '{"n":3,"f":0,"l":{"en":{"n":3}}}'
eq "totals never change" "$(q "select sum((v->>'n')::int + (v->>'f')::int) from public.inkwell_profiles, jsonb_each(data->'collection') x(k, v) where user_id = '$A'")" "7"
eq "the same op again is not applied twice" "$(as $A "select public.mark_unknown_langs(null, 'principal', '[]', 'en', 0, '$(op 14)')->>'status'")" "already_applied"
eq "last_lang_op finds it after a reload" "$(as $A "select public.last_lang_op(null, 'principal')->>'op_id'")" "$(op 14)"
eq "another player does not see it" "$(as $B "select coalesce(public.last_lang_op('$A', 'principal')::text, 'none')")" "none"
fails $B "select public.undo_lang_op('$(op 14)')" "op_not_found" "only who did it undoes it"
as $A "select public.undo_lang_op('$(op 14)')"
jeq "undo: Mushu back to sem idioma" "$(card $A MUSHU)" '{"n":2,"f":1}'
jeq "undo: Elsa back to sem idioma" "$(card $A ELSA)" '{"n":3,"f":0}'
fails $A "select public.undo_lang_op('$(op 14)')" "already_undone" "twice"
# undo refused when the card changed after the mark-up
R=$(rev $A)
as $A "select public.mark_unknown_langs(null, 'principal', '[]', 'ja', $R, '$(op 15)')"
delta '[{"card_id":"ELSA","qty":-1,"foil":false}]'
fails $A "select public.undo_lang_op('$(op 15)')" "collection_changed" "Elsa lost a JA copy since"
q "update private.collection_lang_ops set created_at = now() - interval '25 hours' where op_id = '$(op 15)'"
fails $A "select public.undo_lang_op('$(op 15)')" "undo_expired" "after a day"

# 7. who may do it
reset_db
fails $C "select public.mark_unknown_langs('$A', 'principal', '[]', 'en', 1, '$(op 20)')" "not allowed" "a member who can only view"
fails $B "select public.set_card_langs(null, 'principal', 'NOPE', '{}', '$(op 21)')" "card not found" "B's own collection"
eq "a member who can edit marks A's collection" "$(as $B "select public.mark_unknown_langs('$A', 'principal', '[]', 'it', $(rev $A), '$(op 22)')->>'copies'")" "7"
fails "" "select public.set_collection_prefs(null, 'principal', '{\"card_lang\":\"en\"}')" "not allowed" "signed out"
eq "anon cannot execute" "$(q "select has_function_privilege('anon', 'public.mark_unknown_langs(uuid,text,jsonb,text,bigint,uuid)', 'execute')")" "f"

# 8. one card's split from the card sheet
reset_db
as $A "select public.set_card_langs(null, 'principal', 'MUSHU', '{\"en\":{\"n\":1},\"it\":{\"n\":1,\"f\":1}}', '$(op 30)')"
jeq "set: Mushu EN 1, IT 1 + foil" "$(card $A MUSHU)" '{"n":2,"f":1,"l":{"en":{"n":1},"it":{"n":1,"f":1}}}'
fails $A "select public.set_card_langs(null, 'principal', 'MUSHU', '{\"en\":{\"n\":3}}', '$(op 31)')" "too_many" "3 EN of 2"
fails $A "select public.set_card_langs(null, 'principal', 'MUSHU', '{\"xx\":{\"n\":1}}', '$(op 32)')" "bad langs" "unknown language"
as $A "select public.undo_lang_op('$(op 30)')"
jeq "undo the set" "$(card $A MUSHU)" '{"n":2,"f":1}'
as $A "select public.set_card_langs(null, 'principal', 'MUSHU', '{\"en\":{\"n\":0}}', '$(op 33)')"
jeq "a split of zeros leaves no l" "$(card $A MUSHU)" '{"n":2,"f":1}'

# 9. preferences
reset_db
as $A "select public.set_collection_prefs(null, 'principal', '{\"card_lang\":\"it\",\"card_lang_ask\":true}')"
as $A "select public.set_collection_prefs(null, 'principal', '{\"card_lang_prompt\":\"later\"}')"
jeq "prefs merge" "$(q "select data->'prefs' from public.inkwell_profiles where user_id = '$A'")" '{"card_lang":"it","card_lang_ask":true,"card_lang_prompt":"later"}'
as $A "select public.set_collection_prefs(null, 'principal', '{\"card_lang_prompt\":null}')"
jeq "a null clears one" "$(q "select data->'prefs' from public.inkwell_profiles where user_id = '$A'")" '{"card_lang":"it","card_lang_ask":true}'
fails $A "select public.set_collection_prefs(null, 'principal', '{\"theme\":\"dark\"}')" "bad prefs" "only the three keys"
eq "state: revision and prefs for the owner" "$(as $A "select (public.collection_lang_state(null, 'principal')->>'revision') = '$(rev $A)' and public.collection_lang_state(null, 'principal')->'prefs'->>'card_lang' = 'it'")" "t"
eq "state for a member who can edit" "$(as $B "select public.collection_lang_state('$A', 'principal')->'prefs'->>'card_lang'")" "it"
fails $C "select public.collection_lang_state('$A', 'principal')" "not allowed" "view-only member"
jeq "the collection is untouched by prefs" "$(card $A MUSHU)" '{"n":2,"f":1}'

# 10. loans may carry a language
reset_db
as $A "set role authenticated; insert into public.loans (user_id, direction, person, items) values ('$A', 'lent', 'Ana', '[{\"card_id\":\"MICKEY\",\"qty\":1,\"foil\":false,\"lang\":\"ja\"}]')"   # as a player: the CHECK calls lang_ok
eq "loan with lang saved" "$(q "select items->0->>'lang' from public.loans")" "ja"
fails $A "insert into public.loans (user_id, direction, person, items) values ('$A', 'lent', 'Ana', '[{\"card_id\":\"MICKEY\",\"qty\":1,\"lang\":\"klingon\"}]')" "loans_items_check" "unknown language"
as $A "insert into public.loans (user_id, direction, person, items) values ('$A', 'lent', 'Ana', '[{\"card_id\":\"MICKEY\",\"qty\":1}]')"
echo "ok   loan without lang still accepted"

# 11. rollback brings production back
"${P[@]}" -f "$ROOT/supabase/card_langs_rollback.sql" >/dev/null
eq "rollback restores production's functions" "$(md5s)" "$BEFORE"
eq "rollback removes the new functions" "$(q "select count(*) from pg_proc where proname in ('set_card_langs','mark_unknown_langs','undo_lang_op','last_lang_op','set_collection_prefs','collection_lang_state','entry_apply','lang_ok')")" "0"
echo "all card_langs SQL tests passed"
