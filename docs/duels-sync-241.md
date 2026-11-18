# duels.ink sync: issue #241 (17/11/2026)

## What was reported
On 16/11, games just finished against Amethyst/Ruby did not appear in Jogos. The run checked at 23:30 UTC answered
`{ok:true, seen:43, already:43, added:0, waiting:0}`.

## What the data shows (read-only queries, no token read)
- The two Amethyst/Ruby games of that account started at **23:39 and 23:49 UTC** on 16/11. The 23:30 run was before
  they existed. The **00:00 UTC** run on 17/11 imported both (game_logs.created_at 00:00:14). Nothing was lost.
- Since 15/11, every account with sync on has had each game stored 0.1 to 0.7 h after it started (one
  outlier of 9.9 h on 15/11 for one account).
- The deployed function (v8) is the same code as `supabase/functions/duels-sync/index.ts` on main.

**Cause of the report:** timing. The sync runs every 30 minutes, and a game started at 23:49 can only arrive at
00:00 or 00:30. Jogos said "Última verificação 23:28, nada novo" and did not say when the next check would be, so
"not yet" looked like "missing".

## Real loss paths found in the code (not seen in this case, now covered)
1. **Window of 2 days.** Each run reads history from the newest stored game minus 2 days. A game missing for longer
   than that fell out of the window and was never tried again, while the run still said `ok:true`. This happens when
   duels.ink's replay is not ready yet (404) while newer games are stored, or with a long backlog. The window is now
   **7 days** (`OVERLAP_DAYS`), which is still one page of history for most players.
2. **Replay 404 counted as "waiting".** The game is now reported apart (`replay_missing`) and tried again on every run
   inside the window.
3. **Silent filters.** Bots and games without a final result (`in_progress`, empty, …) were dropped and not counted.
   Now `raw`, `excluded_bot` and `excluded_result` (by value) say how many were dropped and why. A result in capitals
   ("LOSS") counts as a finished game.
4. **History without a games list** (an unexpected answer) gave `ok:true` with nothing added. It is now an error
   (`ok:false` with the reason, shown in Jogos).
5. **More history than 8 pages** was cut silently. Now `more:true` and `status:"incomplete"`.

## What a run reports now (private.duels_sync.last_result)
`seen, already, added, waiting` (same meaning as before; `waiting` is now only games beyond this run's 12)
+ `replay_missing, raw, excluded_bot, excluded_result, pages, more, from, newest_api_game_at, newest_stored_game_at,
account_name, status` (`complete` / `pending` / `incomplete`). `account_name` is the public display name of the
duels.ink account the token reads, so the player can check it is theirs. There is no token, e-mail, user id or
opponent name in it.

In Jogos (Conexões e coaches › duels.ink) the line now also says:
- when the next check is ("Jogos terminados depois de uma verificação chegam na seguinte, por volta de 23:58");
- games waiting for their replay, and history left for the next checks;
- "Conta: <nome>";
- "precisa de atenção: nenhuma verificação desde …" when the last check is more than 75 minutes old, instead of
  "nada novo".

## Tests
- `tools/duels-sync.test.mjs` (18 checks, in CI): a fake duels.ink that honours `from`, the cursor, page size and replay
  404s, and an in-memory game_logs that counts duplicates. It covers the #241 timing case, the cursor, filters, a game
  that ends later, a late replay, a game 3 days older than the newest stored, the per-run limit, history past 8 pages,
  a broken answer, and no private data in the result.
  Mutations checked: with the window back at 2 days the "3 days older" game is never found and the run still says
  `complete`; without the games-list check the broken answer is not reported as an error.
- `tools/coach.spec.mjs`: the sync line (next check, replays, account, stalled sync), plus 320/390/768/860/1280 px
  with no sideways scroll (`docs/evidencias/duels-sync/`).

## Publishing (needs the owner's authorization)
Merging changes the site (the Jogos line). The function changes only when it is deployed:
`supabase functions deploy duels-sync` (or the Supabase MCP deploy with `index.ts`, `sync.ts`, `convert.ts`).
No SQL and no change to tables, secrets or the schedule.

## Rollback
- Function: deploy `index.ts` + `convert.ts` from the commit before this PR (v8). New fields in `last_result`
  are plain JSON and are ignored by the old site.
- Site: revert the merge commit. The old Jogos line reads only `added` and `waiting`, which keep their meaning.
- No data to undo: the function only inserts games, ignoring duplicates.

## Not changed, worth a decision later
- A row without its own token uses the `DUELS_TOKEN` secret. Today only one account (the owner's, set up by hand)
  has no token of its own. If another row were ever turned on without a token, it would read the owner's games. Safer:
  tie the secret to one user id (a secret `DUELS_TOKEN_USER`). That is a production change and needs authorization.
