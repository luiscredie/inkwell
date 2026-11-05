#!/usr/bin/env bash
# Tests supabase/community_store.sql (store communities linked to a Play Hub store) on a scratch Postgres shaped like
# production (tools/fixtures/prod_shape.2026-11-04.sql + communities.sql + community_admin.sql), with production's
# default grant of EXECUTE to anon on new functions.
#   PGHOST=/var/tmp/pgtest PGPORT=5544 PGUSER=postgres bash tools/community_store_sql_test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=community_store_test
P=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb -T template0 "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
for r in anon authenticated service_role; do psql -X -q -d "$DB" -c "do \$\$ begin create role $r nologin; exception when duplicate_object then null; end \$\$" >/dev/null; done
"${P[@]}" -f "$ROOT/tools/fixtures/prod_shape.2026-11-04.sql" >/dev/null
"${P[@]}" -c "alter default privileges in schema public grant execute on functions to anon, authenticated"
"${P[@]}" -c "insert into auth.users (id, email) select ('00000000-0000-4000-a000-00000000000' || i)::uuid, 'mock' || i from generate_series(1, 9) i"   # communities.sql's examples
"${P[@]}" -f "$ROOT/supabase/communities.sql" >/dev/null
"${P[@]}" -f "$ROOT/supabase/community_admin.sql" >/dev/null
"${P[@]}" -f "$ROOT/supabase/community_store.sql" >/dev/null
"${P[@]}" -f "$ROOT/supabase/community_store.sql" >/dev/null   # safe to run again

O=bbbbbbbb-0000-4000-8000-000000000001; A=bbbbbbbb-0000-4000-8000-000000000002; M=bbbbbbbb-0000-4000-8000-000000000003
X=bbbbbbbb-0000-4000-8000-000000000004; D=bbbbbbbb-0000-4000-8000-000000000005
"${P[@]}" <<SQL
insert into auth.users (id, email) values ('$O','o@t.invalid'),('$A','a@t.invalid'),('$M','m@t.invalid'),('$X','x@t.invalid'),('$D','d@t.invalid');
insert into public.profiles (user_id, display_name, adult, is_public) values ('$O','Dono',true,true),('$A','Adm',true,true),('$M','Membro',true,true),('$X','Outro',true,true),('$D','Site',true,true);
insert into public.admins (user_id) values ('$D');
insert into public.communities (id, slug, name, kind, created_by) values
  ('cccccccc-0000-4000-8000-000000000001', 'loja-um', 'Loja Um', 'store', '$O'),
  ('cccccccc-0000-4000-8000-000000000002', 'loja-dois', 'Loja Dois', 'store', '$X'),
  ('cccccccc-0000-4000-8000-000000000003', 'cidade', 'Cidade', 'city', '$O'),
  ('cccccccc-0000-4000-8000-000000000004', 'loja-tres', 'Loja Três', 'store', '$X');
insert into public.community_members (community_id, user_id, role) values
  ('cccccccc-0000-4000-8000-000000000001', '$O', 'owner'), ('cccccccc-0000-4000-8000-000000000001', '$A', 'admin'),
  ('cccccccc-0000-4000-8000-000000000001', '$M', 'member'), ('cccccccc-0000-4000-8000-000000000002', '$X', 'owner'),
  ('cccccccc-0000-4000-8000-000000000003', '$O', 'owner'), ('cccccccc-0000-4000-8000-000000000004', '$X', 'owner');
SQL
C1=cccccccc-0000-4000-8000-000000000001; C2=cccccccc-0000-4000-8000-000000000002; C4=cccccccc-0000-4000-8000-000000000004
q() { "${P[@]}" -c "$1"; }
as() { "${P[@]}" -c "set t.uid = '$1'; $2"; }
fails() { if "${P[@]}" -c "set t.uid = '$1'; $2" >/dev/null 2>/tmp/cs_err.txt; then echo "FAIL expected an error ($3): $2"; exit 1; fi; grep -q "$3" /tmp/cs_err.txt || { echo "FAIL wrong error ($3): $(cat /tmp/cs_err.txt)"; exit 1; }; }
eq() { [ "$1" = "$2" ] || { echo "FAIL $3: got [$1] want [$2]"; exit 1; }; }
ok() { echo "ok   $*"; }
STORE='{"id":"17617","name":"Muito Colecionaveis","city":"Campinas","address":"Av Brasil 1456"}'
view() { as "$1" "select coalesce(public.community_store('$2')::text, 'null')"; }

# 1. valid request: pending, shown to everyone as not verified
eq "$(as $O "select public.request_community_store('loja-um', '$STORE')->>'status'")" pending "request"
eq "$(view '' loja-um | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["store_id"],d["status"],d["verified"],"note" in d)')" "17617 pending False False" "public view"
eq "$(view $O loja-um | python3 -c 'import json,sys;print("requested_at" in json.load(sys.stdin))')" True "manager view"
ok "1. owner asks for store 17617: pending, public sees it unverified, only managers see the request details"

# 2. bad ids (the existence of an id is checked on the Play Hub when picking it, and by the admin before approving)
for bad in '"abc"' '"0"' '"-5"' '"1234567890123"' '17.5' 'null'; do fails $O "select public.request_community_store('loja-um', '{\"id\":$bad,\"name\":\"X\"}')" bad_store_id; done
fails $O "select public.request_community_store('loja-um', '{\"id\":\"5\",\"name\":\"  \"}')" bad_store_name
ok "2. ids that are not a positive whole number (or missing names) are refused"

# 3. same name, different ids: two separate links
as $X "select public.request_community_store('loja-dois', '{\"id\":\"999\",\"name\":\"Muito Colecionaveis\",\"city\":\"Campinas\"}')" >/dev/null
eq "$(q "select string_agg(store_id::text, ',' order by store_id) from public.community_stores")" "999,17617" "two stores"
ok "3. two stores with the same name and different ids stay apart (the key is store_id)"

# 4. not allowed: a plain member, an outsider, a visitor, a city community, a mock one
fails $M "select public.request_community_store('loja-um', '$STORE')" "not allowed"
fails $X "select public.request_community_store('loja-um', '$STORE')" "not allowed"
fails '' "select public.request_community_store('loja-um', '$STORE')" "authentication_required"
fails $O "select public.request_community_store('cidade', '$STORE')" not_a_store
eq "$(view '' cidade)" null "city community has no store"
fails $M "select public.remove_community_store('loja-um')" "not allowed"
fails $X "select public.remove_community_store('loja-um')" "not allowed"
mock=$(q "select slug from public.communities where is_mock limit 1")
if [ -n "$mock" ]; then fails $D "select public.request_community_store('$mock', '$STORE')" "not allowed"; fi
ok "4. members, outsiders, visitors can't ask or remove; city and example communities can't have a store"

# 5. approving: only a site admin; the owner can't approve their own request
fails $O "select public.decide_community_store('$C1', 'approved')" "not allowed"
fails $A "select public.decide_community_store('$C1', 'approved')" "not allowed"
fails $O "select public.admin_community_stores()" "not allowed"
eq "$(as $D "select jsonb_array_length(public.admin_community_stores())")" 2 "admin queue"
fails $D "select public.decide_community_store('$C1', 'maybe')" bad_decision
as $D "select public.decide_community_store('$C1', 'approved', 'conferido no Play Hub')" >/dev/null
eq "$(view '' loja-um | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["status"],d["verified"])')" "approved True" "approved"
ok "5. only a site admin approves; owner/admin of the community can't; the page then says verified"

# 6. no second verified community for the same store
fails $X "select public.request_community_store('loja-dois', '$STORE')" store_taken
"${P[@]}" -c "insert into public.community_stores (community_id, store_id, store_name, status) values ('$C4', 17617, 'X', 'pending')"
fails $D "select public.decide_community_store('$C4', 'approved')" store_taken
if "${P[@]}" -c "update public.community_stores set status = 'approved' where community_id = '$C4'" >/dev/null 2>&1; then echo "FAIL unique index"; exit 1; fi
"${P[@]}" -c "delete from public.community_stores where community_id = '$C4'"
eq "$(as $O "select public.request_community_store('loja-um', '$STORE')->>'status'")" approved "asking again for the same store keeps it verified"
ok "6. a store verified for one community can't be asked or approved for another (also a unique index)"

# 7. change and remove: the community admin changes the store -> pending again; removal; everything logged
eq "$(as $A "select public.request_community_store('loja-um', '{\"id\":\"23418\",\"name\":\"Garbosa TCG\"}')->>'status'")" pending "change"
eq "$(view '' loja-um | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["store_id"],d["verified"])')" "23418 False" "changed"
as $D "select public.decide_community_store('$C1', 'rejected', 'loja não confirmou')" >/dev/null
eq "$(view '' loja-um)" null "rejected is hidden from the public"
eq "$(view $O loja-um | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["status"],d["note"])')" "rejected loja não confirmou" "manager sees why"
as $O "select public.remove_community_store('loja-um')" >/dev/null
eq "$(view $O loja-um)" null "removed"
eq "$(q "select string_agg(action, ',' order by id) from private.community_store_log where community_id = '$C1'")" "request,approve,request,reject,remove" "log"
eq "$(q "select count(*) from private.community_store_log where actor is null")" 0 "log has the actor"
ok "7. changing the store sends it back to pending; rejected shows only to managers; removal works; all logged with who"

# 8. RLS / grants: no direct table access; visitors only read the public view
for role in anon authenticated; do
  for t in public.community_stores private.community_store_log; do
    if "${P[@]}" -c "set role $role; select count(*) from $t" >/dev/null 2>&1; then echo "FAIL $role reads $t"; exit 1; fi
  done
  if "${P[@]}" -c "set role $role; insert into public.community_stores (community_id, store_id, store_name) values ('$C2', 1, 'x')" >/dev/null 2>&1; then echo "FAIL $role writes"; exit 1; fi
done
for f in "request_community_store('loja-um','{}')" "remove_community_store('loja-um')" "admin_community_stores()" "decide_community_store('$C1','approved')"; do
  if "${P[@]}" -c "set role anon; select public.$f" >/dev/null 2>/tmp/cs_err.txt; then echo "FAIL anon runs $f"; exit 1; fi
  grep -q "permission denied" /tmp/cs_err.txt || { echo "FAIL anon $f: $(cat /tmp/cs_err.txt)"; exit 1; }
done
"${P[@]}" -c "set role anon; select public.community_store('loja-dois')" >/dev/null
eq "$(q "select relrowsecurity from pg_class where oid = 'public.community_stores'::regclass")" t "rls on"
ok "8. RLS on, no table access for anon/authenticated; visitors can only call community_store"

# 9. rollback (twice) removes only what this file created; reinstall works
before=$(q "select count(*) from public.communities")
"${P[@]}" -f "$ROOT/supabase/community_store_rollback.sql" >/dev/null 2>&1
"${P[@]}" -f "$ROOT/supabase/community_store_rollback.sql" >/dev/null 2>&1
eq "$(q "select (to_regclass('public.community_stores') is null and to_regclass('private.community_store_log') is null and to_regprocedure('public.community_store(text)') is null and to_regprocedure('public.decide_community_store(uuid,text,text)') is null)::text")" true "rollback"
eq "$(q "select count(*) from public.communities")" "$before" "communities kept"
"${P[@]}" -f "$ROOT/supabase/community_store.sql" >/dev/null
ok "9. rollback (run twice) removes the table, the log and the functions only; communities stay; reinstall works"
echo "all community_store tests passed"
