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
| Reads history from the newest stored game − 2 days. A game missing longer (late replay, backlog) falls out and is never tried again, while the run says `ok:true`. | A game whose replay is missing goes on a **wait list** (30 min, 1 h, 2 h … then daily) and is **never dropped**. When one is due, the read reaches back to it, however old it is. |
| First sync reads only the newest page (250 games). | A first sync reads the **whole history**, a few pages per run, until the end. |
| A 404 counts as "waiting" and is asked again on every run, oldest first: 12 such games block every game after them. | Games never tried go **before** replays due again; a waiting game is not asked before its time. |
| History past 8 pages is cut silently. | The read stops at a **saved position** (the first page not fully handled) and the next run goes on from there. |
| An answer without a games list gives `ok:true`, nothing added. | It is an error (`ok:false` with the reason, shown in Jogos). |
| Bots and unfinished games are dropped without a count. | Counted by reason (`excluded_bot`, `excluded_result`). |

**The rule that keeps it safe:** the read goes newest first and moves past a page only when every finished game on it
is stored, waiting for its replay, or tried in this run. The saved position is the first page not done; pages above it
are all done, and new games only come in at the top. So a run jumps to the saved position only after a page at the top
needed nothing, and never while a waiting replay is due (it may sit above the position). A position duels.ink no longer
accepts: the run goes on page by page from the top (`scan_restarted`). Inserting ignores duplicates, so a page read
twice never stores a game twice.

**Shared token (`DUELS_TOKEN`).** It reads one duels.ink account, the owner's. A row without its own token may now use
it only if the row is the owner's: the user named by the secret `DUELS_TOKEN_USER` when it is set, otherwise a user whose
stored duels.ink games were imported for that same duels.ink account. The owner's current connection matches (its
stored games are of that account) and keeps working with no secret changed. A new account, or one whose games are
another duels.ink account, is refused ("the shared token belongs to another account") and nothing is read for it. The
same check guards the deck-list refresh. If the owner ever changes the duels.ink display name, the check fails safely
(refused, shown in Jogos); setting `DUELS_TOKEN_USER` to the owner's user id then fixes it for good.

## State between runs
Two things need memory: the saved position and the wait list. They live in `last_result.state` (written by
`duels_sync_finish`, unchanged). The function reads them back through `duels_sync_begin`, which now also returns
`state` (`supabase/duels_sync_state.sql`). No table change, no new data; owner, grants (service_role only) and key
check stay the same; the current function v8 reads only user_id and token, so the SQL can go first without breaking it.
A failed run keeps the previous state. The state holds game ids, start times and a cursor, no history rows (under 2 KB in
the tests; the wait list keeps at most 300 games, the oldest). Players see their own state in their own sync row only.
If the function ran before the SQL, each result says `state_read: false`.

## What a run reports (`last_result`)
`seen, already, added, waiting` (as before; `waiting` = games not tried yet) + `replay_missing` (wait list size),
`oldest_replay_missing_at, tried, raw, excluded_bot, excluded_result, pages, more, scan_restarted, from,
newest_api_game_at, newest_stored_game_at, account_name, status` (`complete` / `pending` / `incomplete`), `state`.
No token, e-mail, user id or opponent name.

## Tests
- `tools/duels-sync.test.mjs` (27, in CI): runs one after another against a fake duels.ink (from, keyset cursor, page
  size, 404 replays, a refused cursor) and an in-memory game_logs that counts duplicates, with the state of each run
  passed to the next and a fake clock. Scenarios: the #241 timing case; a replay missing for 12 days (window 7);
  a first sync of 60 games in 9 pages; 16 games with no replay before 2 new ones; 40 games in 20 pages; 6 missing games
  under 15 pages already stored; a refused cursor; the shared token for the owner, a new account, another account, and
  `DUELS_TOKEN_USER`; filters; a broken answer; no private data. Every scenario checks no duplicate.
- Mutations, each one making its tests fail: no wait list kept (5 fail); first sync reads only the newest page (3);
  retries before new games (2); no position saved at the page limit (2, and that run says `complete` with 6 games
  missing); shared token unchecked (3).
- `tools/duels_sync_state_sql_test.sh` (13, local Postgres): applies twice; one definition; owner postgres and ACL
  `{postgres, service_role}` like production; security definer with empty search_path; returns the state; only enabled
  rows; one player; wrong key refused; anon and authenticated refused, service_role allowed. With the `revoke` removed,
  3 checks fail.
- `tools/coach.spec.mjs`: the Jogos line (next check, replays, account, stalled sync), 320–1280 px.

## Publishing (needs the owner's authorization), in this order
1. SQL: `supabase/duels_sync_state.sql` (safe with the current function).
2. Function: deploy `duels-sync` (`index.ts`, `sync.ts`, `convert.ts`). No secret to change.
3. Site: merge (the Jogos line).

## Rollback
- Function: deploy `index.ts` + `convert.ts` from the commit before this PR (v8). It ignores `state` and the new fields.
- SQL: optional (v8 works with the new `duels_sync_begin`); to undo, run the `duels_sync_begin` part of
  `supabase/duels_tokens.sql`.
- Site: revert the merge. The old Jogos line reads only `added` and `waiting`.
- No data to undo: the function only inserts games, ignoring duplicates.

## Known limits
- duels.ink's API is not documented here; the fake follows what v8 relies on (`from`, a cursor that keeps its place).
  If duels.ink cursors expired between runs, a very deep read would restart from the top each run and only reach 8
  pages: the result would say `incomplete` and `scan_restarted`, never `complete`.
- A first sync of a long history takes about one run per 12 games (as before: duels.ink's rate limits).
