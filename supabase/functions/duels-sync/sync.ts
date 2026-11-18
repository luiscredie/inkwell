// duels-sync, one player's run (issue #241). Kept apart from index.ts so it can be tested without network or SQL:
// io.duels / io.db / io.sleep are the real fetch helpers in the function, fakes in tools/duels-sync.test.mjs.
//
// What a run does, and what it reports (private.duels_sync.last_result, shown to the player in Jogos):
//   - reads match history from (newest stored game − OVERLAP_DAYS), page by page with the cursor (at most MAX_PAGES);
//   - keeps finished games against people (win / loss / draw, not bots) and counts what it left out and why;
//   - imports up to MAX_PER_RUN games not stored yet, oldest first; a game whose replay is not available yet
//     (duels.ink answers 404) is counted, not dropped: it stays in the window and is tried again next run.
// Nothing here writes outside game_logs (insert, ignore duplicates). No token, e-mail or opponent name in the result
// (account_name is the display name of the player's own duels.ink account, so they can check the token is theirs).
import { convert, type Catalog, type Json } from "./convert.ts";

export const MAX_PER_RUN = 12;
export const MAX_PAGES = 8;
// Overlap re-read on every run. Was 2 days: a game whose replay came late, or a long game that started before a newer
// one stored, could fall out of the window and never be imported. 7 days of history is one page for most players.
export const OVERLAP_DAYS = 7;
const FINISHED = new Set(["win", "loss", "draw"]);

export type SyncIO = {
  duels: (path: string, binary?: boolean) => Promise<any>;
  db: (path: string, init?: RequestInit) => Promise<any>;
  sleep: (ms: number) => Promise<unknown>;
};

// Which history rows become games, and why the others do not.
export function classify(rows: Json[]) {
  const wanted: Json[] = [];
  const excluded = { bot: 0, result: {} as Record<string, number> };
  for (const r of rows) {
    if (r?.opp_is_bot) { excluded.bot++; continue; }
    const res = String(r?.result ?? "").toLowerCase();
    if (!FINISHED.has(res)) { const k = res || "none"; excluded.result[k] = (excluded.result[k] || 0) + 1; continue; }
    wanted.push(res === r.result ? r : { ...r, result: res });
  }
  return { wanted, excluded };
}

const newestOf = (xs: (string | null | undefined)[]) => xs.filter(Boolean).sort().pop() ?? null;

export async function syncUser(userId: string, cat: Catalog, io: SyncIO) {
  const newest = await io.db(`game_logs?user_id=eq.${userId}&source=eq.duels_ink&select=played_at&order=played_at.desc.nullslast&limit=1`);
  const storedBefore: string | null = newest?.[0]?.played_at ?? null;
  const since = storedBefore ? new Date(Date.parse(storedBefore) - OVERLAP_DAYS * 864e5).toISOString() : null;
  const me = await io.duels("/api/me");
  const rows: Json[] = [];
  let cursor: string | null = null, pages = 0;
  for (; pages < MAX_PAGES; ) {
    const q = new URLSearchParams({ format: "json", limit: "250", ...(cursor ? { cursor } : {}), ...(since ? { from: since } : {}) });
    const res = await io.duels(`/api/me/match-history?${q}`);
    pages++;
    // An answer without a games list is not "no new games": say so instead of ok with nothing added.
    if (!res || !Array.isArray(res.games)) throw new Error(pages === 1 ? "duels.ink match history did not answer (no games list)" : `duels.ink match history stopped answering at page ${pages}`);
    rows.push(...res.games);
    cursor = res.next_cursor || null;
    if (!cursor || !since) break;          // first run without a stored game: the newest page is enough here
    await io.sleep(3100);
  }
  const { wanted, excluded } = classify(rows);
  const ids = wanted.map((r) => `duels-${r.game_id}`);
  const have = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100).map((x) => `"${x}"`).join(",");
    for (const r of (await io.db(`game_logs?user_id=eq.${userId}&game_id=in.(${chunk})&select=game_id`)) || []) have.add(r.game_id);
  }
  const missing = wanted.filter((r) => !have.has(`duels-${r.game_id}`)).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  const todo = missing.slice(0, MAX_PER_RUN);
  const logs: Json[] = [];
  let replayMissing = 0;
  for (const r of todo) {
    const events = await io.duels(`/g/${encodeURIComponent(r.game_id)}`, true);
    if (events) logs.push(convert(r, events, cat, me?.name || "Me")); else replayMissing++;
    await io.sleep(2100);
  }
  if (logs.length) {
    await io.db("game_logs?on_conflict=user_id,game_id", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(logs.map((l) => ({ user_id: userId, game_id: l.game_id, source: "duels_ink", played_at: l.played_at, log: l, visibility: "private" }))),
    });
  }
  const waiting = Math.max(0, missing.length - todo.length);        // beyond this run's limit: next runs
  const more = !!(cursor && since);                                  // history went past MAX_PAGES: not all of it was read
  const newestApi = newestOf(wanted.map((r) => r.started_at));
  const newestStored = newestOf([storedBefore, ...logs.map((l) => l.played_at)]);
  return {
    // same four numbers as before (Jogos reads them); waiting now excludes the games whose replay is not ready
    seen: wanted.length, already: have.size, added: logs.length, waiting,
    replay_missing: replayMissing,
    raw: rows.length, excluded_bot: excluded.bot, excluded_result: excluded.result,
    pages, more,
    // the duels.ink account the token reads (its public display name), to check it is the player's own
    account_name: typeof me?.name === "string" ? me.name.slice(0, 60) : null,
    from: since, newest_api_game_at: newestApi, newest_stored_game_at: newestStored,
    // "complete": every finished game in the window is stored; otherwise what is still missing is named above
    status: more ? "incomplete" : (waiting || replayMissing) ? "pending" : "complete",
  };
}
