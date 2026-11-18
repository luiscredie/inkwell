# duels.ink sync: issue #241 (17–18/11/2026)

## What was reported
On 16/11, games just finished against Amethyst/Ruby did not appear in Jogos. The run checked at 23:30 UTC answered
`{ok:true, seen:43, already:43, added:0, waiting:0}`.

## What the data shows (read-only queries, no token read)
- The two Amethyst/Ruby games of that account started at **23:39 and 23:49 UTC** on 16/11. The 23:30 run was before
  they existed. The **00:00 UTC** run on 17/11 imported both (game_logs.created_at 00:00:14). Nothing was lost.
- Since 15/11, every account with sync on has had each game stored 0.1 to 0.7 h after it started (one outlier of
  9.9 h on 15/11 for one account).
- The deployed function (v8) is the same code as `supabase/functions/duels-sync/index.ts` on main.

**Cause of the report:** timing. The sync runs every 30 minutes, and Jogos said "Última verificação 23:28, nada novo"
without saying when the next check would be, so "not yet" looked like "missing".

## Loss paths in v8, and what replaces them
| v8 | Now |
|---|---|
| Reads history from the newest stored game − 2 days. A game missing longer (late replay, backlog) falls out and is never tried again, while the run says `ok:true`. | A game whose replay is missing goes on a **wait list** (30 min, 1 h, 2 h … then daily) and is **never dropped**. When one is due, the read reaches back to it, however old it is. Past 100 games, the rest are **summed up** (a range of start times and a count) and looked for again daily, the same way. |
| First sync reads only the newest page (250 games). | A first sync reads the **whole history**, a few pages per run, until the end. |
| A 404 counts as "waiting" and is asked again on every run, oldest first: 12 such games block every game after them. | Games never tried go **first**; retries only take the slots left, and a waiting game is not asked before its time. Retries never hold the read on a page. |
| History past 8 pages is cut silently. | The read stops at a **saved position** (the first page not fully handled) and the next run goes on from there. |
| An answer without a games list gives `ok:true`, nothing added. | It is an error (`ok:false` with the reason, shown in Jogos). |
| Bots and unfinished games are dropped without a count. | Counted by reason (`excluded_bot`, `excluded_result`). |

**The rule that keeps it safe:** the read goes newest first and moves past a page only when every game on it that was
never tried got its try in this run (the rest are stored, or kept in the state as waiting). The saved position is the
first page not done; pages above it are all done, and new games only come in at the top. So a run jumps to the saved
position once a page at the top has nothing new. Retries (games on the wait list or in the summed-up range, due now) are
kept in the state; they take the slots left at the end of a run and never hold the read on a page. A wait that comes
due above the position is reached by the next pass, which starts from the top. A refused position: the run goes on page
by page from the top (`scan_restarted`). Inserting ignores duplicates, so a page read twice never stores a game twice.

**Shared token (`DUELS_TOKEN`).** It reads one duels.ink account, the owner's. It is now tied **explicitly** to one
Inkwell account by the secret `DUELS_TOKEN_USER` (that account's user id). Without that secret the shared token is not
used at all ("not tied to an Inkwell account"); for any other account it is refused. As a second check, new games keep
the duels.ink account id (`source_ref.duels_user_id`, the id of `GET /api/me`, which duels.ink says to use, never the
name); if the shared token ever reads another duels.ink account than the one of the owner's newest stored game, it is
refused too. No name matching is left. The same checks guard the deck-list refresh. Procedure below.

## State between runs
Three things need memory: the saved position (`scan`), the wait list (`wait`, at most 100 games, each with its next
try) and the summed-up rest (`more`: oldest and newest start time, a count, the next look). They live in
`last_result.state` (written by `duels_sync_finish`, unchanged). The function reads them back through
`duels_sync_begin`, which now also returns `state` (`supabase/duels_sync_state.sql`). No table change, no new data;
owner, grants (service_role only) and key check stay the same; the current function v8 reads only user_id and token, so
the SQL can go first without breaking it. A failed run keeps the previous state.

**Bounded, and nothing dropped.** The state holds no history rows and stays about 8 KB however many games wait (tested
with 320). A game in the summed-up range is not on the list but is not forgotten: it waits for the range's next look
like a listed game; a look goes on run after run (12 a run, oldest first, `done` marks how far it got) and ends once
every game of the range got a try, then the next look is a day later. While nothing comes back, a waiting game costs
about one request a day. As soon as one waiting game's replay is back, every waiting game (listed or summed up) is due
at once, and each run imports 12 until none is left. The count is exact after any run that read the whole range, an
estimate in between. If the function ran before the SQL, each result says `state_read: false`.

## What a run reports (`last_result`)
`seen, already, added, waiting` (as before; `waiting` = games not tried yet) + `replay_missing` (all games waiting for a
replay), `replay_missing_listed`, `replay_missing_more` (summed up),
`oldest_replay_missing_at, tried, raw, excluded_bot, excluded_result, pages, more, scan_restarted, from,
newest_api_game_at, newest_stored_game_at, account_name, status` (`complete` / `pending` / `incomplete`), `state`.
No token, e-mail, user id or opponent name.

## Tests
- `tools/duels-sync.test.mjs` (38, in CI): runs one after another against a fake duels.ink that follows the reference
  (update-time order, `from`, keyset cursor, page size, 404 replays, a refused position) and an in-memory game_logs that
  counts duplicates, with the state of each run passed to the next and a fake clock. Scenarios: the #241 timing case; a
  replay missing for 12 days (window 7); a first sync of 60 games in 9 pages; 16 games with no replay before 2 new ones;
  40 games in 20 pages; 6 missing games under 15 pages already stored; a game updated later (moves to the top); a
  refused position; **320 games with no replay** (all accounted for: 100 listed + 220 summed up, state about 8 KB, new
  games still imported meanwhile, then all 320 imported in 27 runs, the minimum at 12 a run); **the queue at the real
  pace** (a run every 30 minutes): with 320 waiting and nothing coming back, about one request per game per day (210 a
  day) and the state the same size; replays back while nothing is due: recovery starts at the next look (1.5 h in the
  test, 24 h at most by construction), then 12 a run until done (27 runs, 13.5 h), no duplicate; the shared token with
  `DUELS_TOKEN_USER` set to the account, not set, set to another account, a token now reading another duels.ink account,
  and the owner after a name change; filters; a broken answer; no private data. Every scenario checks no duplicate.
- Mutations, each one making its tests fail: rest of the list dropped instead of summed up (1); no wait list kept (5);
  first sync reads only the newest page (2 + a crash); retries competing with new games for the slots (1); no position
  saved at the page limit (2, and that run says `complete` with 6 games missing); shared token used without
  `DUELS_TOKEN_USER` (1); shared token without the duels.ink account check (1); a look at the summed-up range without
  its progress mark (1: the range stays due forever, 12 requests every run); no wake-up when a replay comes back (1:
  recovery takes 22.5 h instead of 13.5 h).
- `tools/duels_sync_state_sql_test.sh` (13, local Postgres): applies twice; one definition; owner postgres and ACL
  `{postgres, service_role}` like production; security definer with empty search_path; returns the state; only enabled
  rows; one player; wrong key refused; anon and authenticated refused, service_role allowed. With the `revoke` removed,
  3 checks fail.
- `tools/coach.spec.mjs`: the Jogos line (next check, replays, account, stalled sync), 320–1280 px.

## Tying DUELS_TOKEN to the owner's account (DUELS_TOKEN_USER)
Nothing here reads or shows the token. The user id is not a secret; the token stays where it is.
1. **Find the account.** In the SQL editor (read only):
   `select user_id, enabled, last_run_at, last_result->>'ok' as ok from private.duels_sync where token is null;`
   Today this returns **one** row: the owner's connection, the one that uses the shared token. Confirm it is your
   account: `select id, created_at from auth.users where id = '<that user_id>';` (or Authentication › Users, search by
   the id).
2. **Set the secret** (production change: needs the owner's go-ahead). Dashboard: Edge Functions › Secrets › Add
   `DUELS_TOKEN_USER` = that user id. Or `supabase secrets set DUELS_TOKEN_USER=<user_id> --project-ref
   sorefaetiaebmjploanp`. The current function (v8) ignores this secret, so setting it first changes nothing today.
3. **Check it is there without reading it:** `supabase secrets list --project-ref sorefaetiaebmjploanp` (names and
   digests only) or the Secrets page.
4. **After the deploy (step 3 of Publishing),** run the owner's sync once and read the result:
   `select private.run_duels_sync('<user_id>');` then, a minute later,
   `select last_run_at, last_result->>'ok' ok, last_result->>'error' error, last_result->>'account_name' account,
   last_result->>'state_read' state_read from private.duels_sync where user_id = '<user_id>';`
   Expected: `ok = true`, no error, your duels.ink name, `state_read` empty (null). And
   `select count(*) from private.duels_sync where token is null;` still 1.
5. **If it says "not tied to an Inkwell account":** the secret is missing or has another id; fix step 2 and run step 4
   again. Nothing is lost meanwhile: the state is kept and the window reads the missed games again.

## Publishing (needs the owner's authorization), in this order
1. Secret `DUELS_TOKEN_USER` (procedure above, steps 1–3). Safe with the current function.
2. SQL: `supabase/duels_sync_state.sql`. Safe with the current function.
3. Function: deploy `duels-sync` (`index.ts`, `sync.ts`, `convert.ts`).
4. Validate (procedure above, step 4), for the owner; then look at the other accounts' `last_result->>'ok'` after the
   next scheduled run (every 30 minutes).
5. Site: merge (the Jogos line).
Doing 3 before 1 does no harm to data, but the owner's sync would stop with "not tied to an Inkwell account" until the
secret is set.

## Publication checklist (18/11)
| Item | State |
|---|---|
| Authorized account for the shared token | Exactly **one** row without its own token (`private.duels_sync`, read only): user id `68dad53f…`, enabled, 982 duels.ink games, last run ok, and the only row in `public.admins` (account created 26/07/2026). No token read. |
| SQL test (`tools/duels_sync_state_sql_test.sh`, local Postgres 16, production default privileges) | 13/13; with the `revoke` removed, 3 fail |
| Production function today | v8, identical to main's `index.ts` (read 17/11); `duels_sync_begin` ACL `{postgres, service_role}` (read 18/11) |
| Sync tests (`tools/duels-sync.test.mjs`) | 38/38, in CI; every mutation above makes its test fail |
| Queue moves on, run after run | 320 waiting: recovery starts at the next look (≤ 24 h), then 12 a run until done, 27 runs = 13.5 h at one run per 30 min; new games are never held back meanwhile |
| CI on the PR head | green (python, js, smoke, journeys-webkit) |
| Rollback | below; no data to undo |

## Rollback
- Function: deploy `index.ts` + `convert.ts` from the commit before this PR (v8). It ignores `state`, the new fields and
  `DUELS_TOKEN_USER`.
- SQL: optional (v8 works with the new `duels_sync_begin`); to undo, run the `duels_sync_begin` part of
  `supabase/duels_tokens.sql`.
- Secret: `DUELS_TOKEN_USER` can stay (v8 ignores it) or be removed.
- Site: revert the merge. The old Jogos line reads only `added` and `waiting`.
- No data to undo: the function only inserts games, ignoring duplicates.

## What the duels.ink reference says (https://duels.ink/api-docs.md, read 18/11)
- `match-history` lists **finished** games, newest first by **last-update time**; `from`/`to` bound that time. A bound
  taken from `started_at` is safe (the update time is never earlier). A game updated later moves to the top.
- The cursor is a keyset value (`"<updated-at>|<game-id>"`), stable under new games; it does not expire. The saved
  position can therefore be kept between runs; a refused one is still handled (`scan_restarted`).
- `/g/{game_id}` answers 404 alike for "not a participant", "does not exist" and "not authenticated". For a finished game
  of the player's own history it should not happen; such a game waits and is tried again instead of being dropped.
- Limits: `match-history` 20 requests/min (3 at once), `/g` 30/min per user. The pauses between requests (3.1 s and 2.1 s)
  stay under both.
- `result` can also be `abandoned` or null; those rows are not imported (as in v8) and are counted in `excluded_result`.
- The tests' fake duels.ink follows these rules (update-time order, `from` on update time, keyset cursor).

## Known limits
- A first sync of a long history takes about one run per 12 games (as before: duels.ink's rate limits).
- Games with `result: "abandoned"` are not imported (unchanged from v8); if players want them, that is a product decision.
