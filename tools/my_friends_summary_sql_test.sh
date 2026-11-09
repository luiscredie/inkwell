#!/usr/bin/env bash
# Tests supabase/my_friends_summary.sql (Amigos 2.0, etapa B, issue #164) on a scratch database of a local Postgres.
# Self-contained: builds minimal stubs (auth.uid() reads the t.uid setting) and loads the real private.face,
# private.are_friends and public.friend_collection from supabase/*.sql to compare against.
#   PGHOST=/var/tmp/pgtest PGPORT=5544 PGUSER=postgres bash tools/my_friends_summary_sql_test.sh
# Checks: only accepted friends with a public profile and a collection opened to friends; same card count and
# lend flag as friend_collection(handle, false) for each of them; no 24 limit; only id/view/lend/cards come back;
# pending, private, closed and strangers never appear; anon cannot run it; no session gives []; security definer
# with an empty search_path; stable; running the file twice changes nothing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=my_friends_summary_test
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
grant usage on schema auth, private, public to anon, authenticated;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table public.profiles (user_id uuid primary key references auth.users(id), display_name text not null, handle text,
  avatar_card text, is_public boolean not null default false, adult boolean not null default true, hidden_by_admin boolean not null default false);
create table public.friendships (requester uuid not null references auth.users(id), addressee uuid not null references auth.users(id),
  status text not null default 'pending', created_at timestamptz not null default now(), accepted_at timestamptz, primary key (requester, addressee));
create table public.inkwell_profiles (user_id uuid not null references auth.users(id), profile text not null, data jsonb not null default '{}',
  primary key (user_id, profile));
create table public.collection_privacy (user_id uuid primary key references auth.users(id), profile text not null,
  friends_view boolean not null default false, friends_lend boolean not null default false,
  foreign key (user_id, profile) references public.inkwell_profiles (user_id, profile));
create function private.lent_out(p_user uuid) returns table (card_id text, qty int) language sql stable as $$ select null::text, 0 where false $$;   -- only used with p_full
alter table public.friendships enable row level security;
alter table public.inkwell_profiles enable row level security;
alter table public.collection_privacy enable row level security;
SQL
# the real helpers and the per-friend function this one replaces
awk '/^create or replace function private.face/{f=1} f{print} f&&/\$\$;$/{exit}' "$ROOT/supabase/communities.sql" | "${PSQL[@]}"
awk '/^create or replace function private.are_friends/{f=1} f{print} f&&/\$\$;$/{exit}' "$ROOT/supabase/friends.sql" | "${PSQL[@]}"
awk '/^-- a friend.s collection, by their handle/{f=1} f{print} f&&/^end \$\$;/{exit}' "$ROOT/supabase/collection_shares.sql" | "${PSQL[@]}"
"${PSQL[@]}" -c "grant execute on function public.friend_collection(text, boolean) to authenticated"

# me; A public friend who opened (lends, 3 cards); B private-profile friend who opened; C public friend, closed;
# D public, request pending; E public stranger who opened; F public friend, opened, empty collection; H hidden by admin
# friend who opened; G01..G30 more public friends who opened (past the old 24 limit), G30 sent the request.
"${PSQL[@]}" <<'SQL'
create function pg_temp.u(n text) returns uuid language sql as $$ select md5(n)::uuid $$;
insert into auth.users select pg_temp.u(n), n || '@test.invalid' from unnest(array['me','ana','bia','caio','davi','eva','fabio','hugo']) n;
insert into auth.users select pg_temp.u('g' || i), 'g' || i || '@test.invalid' from generate_series(1, 30) i;
insert into public.profiles (user_id, display_name, handle, is_public) values
  (pg_temp.u('me'), 'Me', 'me', true), (pg_temp.u('ana'), 'Ana', 'ana', true), (pg_temp.u('bia'), 'Bia', 'bia', false),
  (pg_temp.u('caio'), 'Caio', 'caio', true), (pg_temp.u('davi'), 'Davi', 'davi', true), (pg_temp.u('eva'), 'Eva', 'eva', true),
  (pg_temp.u('fabio'), 'Fabio', 'fabio', true), (pg_temp.u('hugo'), 'Hugo', 'hugo', true);
update public.profiles set hidden_by_admin = true where user_id = pg_temp.u('hugo');
insert into public.profiles (user_id, display_name, handle, is_public) select pg_temp.u('g' || i), 'G' || i, 'g' || i, true from generate_series(1, 30) i;
insert into public.friendships (requester, addressee, status) values
  (pg_temp.u('me'), pg_temp.u('ana'), 'accepted'), (pg_temp.u('bia'), pg_temp.u('me'), 'accepted'), (pg_temp.u('me'), pg_temp.u('caio'), 'accepted'),
  (pg_temp.u('me'), pg_temp.u('davi'), 'pending'), (pg_temp.u('me'), pg_temp.u('fabio'), 'accepted'), (pg_temp.u('hugo'), pg_temp.u('me'), 'accepted');
insert into public.friendships (requester, addressee, status) select pg_temp.u('me'), pg_temp.u('g' || i), 'accepted' from generate_series(1, 29) i;
insert into public.friendships (requester, addressee, status) values (pg_temp.u('g30'), pg_temp.u('me'), 'accepted');
insert into public.inkwell_profiles (user_id, profile, data)
  select id, 'principal', jsonb_build_object('collection', jsonb_build_object('LOR1-1', jsonb_build_object('n', 2), 'LOR1-2', jsonb_build_object('n', 1, 'f', 1), 'LOR1-3', jsonb_build_object('n', 4)), 'decks', '[]'::jsonb)
    from auth.users;
insert into public.inkwell_profiles (user_id, profile, data) values (pg_temp.u('ana'), 'troca', '{"collection": {"X": {"n": 9}}}');
update public.inkwell_profiles set data = '{}' where user_id = pg_temp.u('fabio');
insert into public.collection_privacy (user_id, profile, friends_view, friends_lend) values
  (pg_temp.u('ana'), 'principal', true, true), (pg_temp.u('bia'), 'principal', true, false), (pg_temp.u('caio'), 'principal', false, true),
  (pg_temp.u('davi'), 'principal', true, false), (pg_temp.u('eva'), 'principal', true, false), (pg_temp.u('fabio'), 'principal', true, false),
  (pg_temp.u('hugo'), 'principal', true, false);
insert into public.collection_privacy (user_id, profile, friends_view) select pg_temp.u('g' || i), 'principal', true from generate_series(1, 30) i;
SQL

snap() { "${PSQL[@]}" -c "select p.oid::regprocedure || ' ' || md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') order by 1"; }
snap > /tmp/mfs_before.txt
"${PSQL[@]}" -f "$ROOT/supabase/my_friends_summary.sql"
snap > /tmp/mfs_once.txt
"${PSQL[@]}" -f "$ROOT/supabase/my_friends_summary.sql"
snap > /tmp/mfs_twice.txt
changed=$( (diff /tmp/mfs_before.txt /tmp/mfs_once.txt || true) | grep -E '^[<>]' | sed -E 's/^[<>] //; s/ .*$//' | sort -u | tr '\n' ' ')
[ "$changed" = "my_friends_summary() " ] || fail "changed functions: $changed"
diff -q /tmp/mfs_once.txt /tmp/mfs_twice.txt >/dev/null || fail "second run changed something"

as() { "${PSQL[@]}" -c "set role $1; select set_config('t.uid', coalesce((select md5('$2')::uuid::text where '$2' <> ''), ''), false);" -c "$3" | tail -n +2; }
ME_SUM=$(as authenticated me "select public.my_friends_summary()")

# who: A, F, G01..G30 (33); never B (private), C (closed), D (pending), E (stranger), H (hidden by admin)
who=$("${PSQL[@]}" -c "create temp table got as select * from jsonb_to_recordset('$ME_SUM'::jsonb) as x(id uuid, view boolean, lend boolean, cards int);
  select string_agg(coalesce(p.handle, '?'), ',' order by p.handle) from got join public.profiles p on p.user_id = got.id")
expected=$("${PSQL[@]}" -c "select string_agg(h, ',' order by h) from unnest(array['ana','fabio'] || array(select 'g' || i from generate_series(1, 30) i)) h")
[ "$who" = "$expected" ] || fail "who: $who"
keys=$("${PSQL[@]}" -c "select string_agg(distinct k, ',' order by k) from jsonb_array_elements('$ME_SUM'::jsonb) e, jsonb_object_keys(e) k")
[ "$keys" = "cards,id,lend,view" ] || fail "keys: $keys"
"${PSQL[@]}" -c "select 1 from jsonb_array_elements('$ME_SUM'::jsonb) e where e::text ~* '@|ana|principal|LOR1'" | grep -q 1 && fail "summary leaks names, e-mails or cards"

# parity: for every friend with a public address, friend_collection(handle, false) says the same (view, cards, lend)
for h in ana bia caio davi eva fabio hugo g1 g24 g25 g30; do
  old=$(as authenticated me "select coalesce(x->>'view', 'null') || ' ' || coalesce(x->>'cards', '-') || ' ' || coalesce(x->>'lend', '-') from public.friend_collection('$h', false) x")
  new=$(as authenticated me "select coalesce((select 'true ' || (e->>'cards') || ' ' || (e->>'lend') from jsonb_array_elements(public.my_friends_summary()) e where (e->>'id')::uuid = md5('$h')::uuid), 'absent')")
  case "$h" in
    ana) [ "$old" = "true 3 true" ] && [ "$new" = "true 3 true" ] || fail "ana old=$old new=$new" ;;
    fabio) [ "$old" = "true 0 false" ] && [ "$new" = "true 0 false" ] || fail "fabio old=$old new=$new" ;;
    g*) [ "$old" = "true 3 false" ] && [ "$new" = "true 3 false" ] || fail "$h old=$old new=$new" ;;
    caio) [ "$old" = "false - -" ] && [ "$new" = "absent" ] || fail "caio old=$old new=$new" ;;
    *) [ "$new" = "absent" ] || fail "$h new=$new" ;;   # bia/hugo: no public address, the page never asked; davi/eva: not friends
  esac
done
[ "$(as authenticated me "select count(*) from jsonb_array_elements(public.my_friends_summary())")" = 32 ] || fail "count"

# a stranger gets []; Ana (my friend) gets nothing because I never opened my collection
[ "$(as authenticated eva "select public.my_friends_summary()")" = "[]" ] || fail "stranger"
[ "$(as authenticated ana "select string_agg(e->>'id', ',') from jsonb_array_elements(public.my_friends_summary()) e")" = "" ] || fail "ana sees me?"
# no session: []; anon: no EXECUTE
[ "$(as authenticated '' "select public.my_friends_summary()")" = "[]" ] || fail "no session"
if as anon me "select public.my_friends_summary()" >/dev/null 2>&1; then fail "anon can execute"; fi
# security definer, empty search_path, stable, owned grants
[ "$("${PSQL[@]}" -c "select prosecdef::text || ' ' || provolatile::text || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = 'public.my_friends_summary()'::regprocedure")" = "true s search_path=\"\"" ] || fail "definer/stable/search_path"
echo "PASS my_friends_summary.sql"
