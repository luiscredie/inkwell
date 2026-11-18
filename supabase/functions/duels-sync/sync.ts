// duels-sync, one player's run (issue #241). Kept apart from index.ts so it can be tested without network or SQL:
// io.duels / io.db / io.sleep / io.now are the real helpers in the function, fakes in tools/duels-sync.test.mjs.
//
// duels.ink API (https://duels.ink/api-docs.md): match-history lists finished games, newest first by last-update time;
// `from` is a lower bound on that time (never earlier than the start, so a bound taken from started_at is safe); the
// cursor is a keyset value ("<updated-at>|<game-id>") that does not expire; a game updated later moves to the top.
// /g/{id} answers 404 alike for "not yours", "does not exist" and "not authenticated"; for a finished game of the
// player's own history it should not happen, so such a game waits and is tried again rather than being dropped.
// Limits: match-history 20 requests/min, /g 30/min per user (the pauses below stay under both).
//
// Rule: no finished game is lost for good, and none is stored twice (insert, ignore duplicates).
// Each run:
//   1. window: re-reads history from (newest stored game − OVERLAP_DAYS), so new games come in on the next run;
//   2. scan: a read of older history that goes on over several runs, a page at a time, and moves past a page only
//      once every finished game on it is stored or waiting for its replay. It is used for a first sync (the whole
//      history, not just the newest page), when the window itself went past MAX_PAGES, and to reach back to a game
//      waiting for its replay that is older than the window;
//   3. imports up to MAX_PER_RUN games (window first, then the scan page; games never tried before replays due again,
//      oldest first).
// A replay duels.ink does not have yet (404) puts the game on a wait list (30 min, 1 h, 2 h … then once a day): it does
// not use a slot again before its time, so it cannot hold back the games after it, and it is never dropped.
// The scan position and the wait list are a small `state`, saved in last_result and read back by duels_sync_begin
// (supabase/duels_sync_state.sql). No token, e-mail or opponent name in the result (account_name is the display name
// of the duels.ink account the token reads, so the player can check it is theirs).
import { convert, type Catalog, type Json } from "./convert.ts";

export const MAX_PER_RUN = 12;     // replays asked per run (imported, or put on the wait list)
export const MAX_PAGES = 8;        // history pages per run (window + scan)
export const OVERLAP_DAYS = 7;     // history re-read before the newest stored game
export const WAIT_MAX = 300;       // games on the wait list kept in the state (the oldest are kept)
const FINISHED = new Set(["win", "loss", "draw"]);
const MIN = 60e3, HOUR = 60 * MIN;
export const backoff = (tries: number) => Math.min(24 * HOUR, 30 * MIN * 2 ** Math.max(0, tries - 1));

export type SyncIO = {
  duels: (path: string, binary?: boolean) => Promise<any>;
  db: (path: string, init?: RequestInit) => Promise<any>;
  sleep: (ms: number) => Promise<unknown>;
  now?: () => number;
};
export type Scan = { from: string | null; cursor: string | null };
export type Wait = { s: string; n: number; next: string };   // started_at, tries, next try
export type SyncState = { scan?: Scan | null; wait?: Record<string, Wait> };

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

// The shared token (DUELS_TOKEN secret) reads one duels.ink account, the owner's. A row without its own token may use it
// only if that row is the owner's: the user named by DUELS_TOKEN_USER when that secret is set; otherwise a user whose
// newest stored duels.ink game was imported for this same duels.ink account. duels.ink says to tie a token to an account
// by the id of GET /api/me, never by the name (players can change it): new games keep that id (source_ref.duels_user_id)
// and it is what is compared; games stored before that carry only the name, used until a newer game carries the id.
// A new account, or another one, is refused.
export async function sharedTokenAllowed(userId: string, me: { id?: string | null; name?: string | null } | null, io: SyncIO, ownerId: string | null) {
  if (ownerId) return ownerId === userId;
  const rows = await io.db(`game_logs?user_id=eq.${userId}&source=eq.duels_ink&select=players:log->players,ref:log->source_ref&order=played_at.desc.nullslast&limit=1`);
  const last = rows?.[0];
  if (!last) return false;
  const storedId = last.ref?.duels_user_id;
  if (storedId) return !!me?.id && storedId === me.id;
  return !!me?.name && (last.players || []).some((p: Json) => p?.is_me === true && p?.name === me.name);
}

const newestOf = (xs: (string | null | undefined)[]) => xs.filter(Boolean).sort().pop() ?? null;
const byStart = (a: Json, b: Json) => String(a.started_at).localeCompare(String(b.started_at));

export async function syncUser(userId: string, cat: Catalog, io: SyncIO,
  opts: { state?: SyncState | null; shared?: { ownerId: string | null } } = {}) {
  const now = io.now ? io.now() : Date.now();
  const wait: Record<string, Wait> = { ...(opts.state?.wait || {}) };
  let scan: Scan | null = opts.state?.scan ?? null;

  const me = await io.duels("/api/me");
  const meName = typeof me?.name === "string" ? me.name : null;
  const meId = typeof me?.id === "string" ? me.id : null;
  if (opts.shared && !(await sharedTokenAllowed(userId, me, io, opts.shared.ownerId)))
    throw new Error("no duels.ink token saved (the shared token belongs to another account)");

  const newest = await io.db(`game_logs?user_id=eq.${userId}&source=eq.duels_ink&select=played_at&order=played_at.desc.nullslast&limit=1`);
  const storedBefore: string | null = newest?.[0]?.played_at ?? null;
  const since = storedBefore ? new Date(Date.parse(storedBefore) - OVERLAP_DAYS * 864e5).toISOString() : null;
  // lower bound of the read: the window; while a read is unfinished, its own bound; a due replay older than both
  const lower = (...xs: (string | null | undefined)[]) => xs.some((x) => x === null) ? null : xs.filter(Boolean).sort()[0] ?? null;
  const dueOld = Object.values(wait).filter((w) => Date.parse(w.next) <= now).map((w) => new Date(Date.parse(w.s) - MIN).toISOString()).sort()[0];
  const from = !storedBefore ? null : lower(since, ...(scan ? [scan.from] : []), dueOld);
  // jump to the saved position only when no replay is due (a due one may sit above it) and there is a position
  const target = scan?.cursor && !dueOld ? scan.cursor : null;

  const have = new Set<string>();
  const lookup = async (rows: Json[]) => {
    const ids = rows.map((r) => `duels-${r.game_id}`).filter((id) => !have.has(id));
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100).map((x) => `"${x}"`).join(",");
      for (const r of (await io.db(`game_logs?user_id=eq.${userId}&game_id=in.(${chunk})&select=game_id`)) || []) have.add(r.game_id);
    }
  };
  let pages = 0, scanRestarted = false;
  const page = async (cursor: string | null) => {
    if (pages > 0) await io.sleep(3100);
    const q = new URLSearchParams({ format: "json", limit: "250", ...(cursor ? { cursor } : {}), ...(from ? { from } : {}) });
    const res = await io.duels(`/api/me/match-history?${q}`);
    pages++;
    return res && Array.isArray(res.games) ? { games: res.games as Json[], next: (res.next_cursor || null) as string | null } : null;
  };

  const seen = new Map<string, Json>();
  const counted: Json[] = [];
  const note = (games: Json[]) => { for (const g of games) if (g?.game_id != null && !seen.has(String(g.game_id))) { seen.set(String(g.game_id), g); counted.push(g); } };
  const isWaiting = (r: Json) => { const w = wait[String(r.game_id)]; return !!w && Date.parse(w.next) > now; };
  // games never tried come first, then replays due again: a game waiting for its replay never holds back new ones
  const order = (a: Json, b: Json) => Number(!!wait[String(a.game_id)]) - Number(!!wait[String(b.game_id)]) || byStart(a, b);
  const queue: Json[] = [];
  const queued = new Set<string>();
  const toDo = (rows: Json[]) => classify(rows).wanted.filter((r) => !have.has(`duels-${r.game_id}`) && !isWaiting(r) && !queued.has(String(r.game_id))).sort(order);

  // Read newest first. Each page's games not stored yet get a try in this run, or the read stops there and that page
  // is where the next run goes on ("position"). Pages above the position were all handled; new games only come in at
  // the top. So once a page at the top needs nothing, the read jumps to the saved position.
  let cursor: string | null = null, jumped = false, afterTop: string | null = null;
  let budget = MAX_PER_RUN, stop: { cursor: string | null } | null = null;
  for (;;) {
    if (pages >= MAX_PAGES) { stop = { cursor }; break; }
    let p = await page(cursor);
    if (!p && jumped && !scanRestarted) {          // the saved position refused (not expected: it is a keyset value)
      scanRestarted = true; jumped = false; cursor = afterTop; p = await page(cursor);
    }
    if (!p) throw new Error(pages === 1 ? "duels.ink match history did not answer (no games list)" : `duels.ink match history stopped answering at page ${pages}`);
    note(p.games);
    await lookup(p.games);
    const todo = toDo(p.games);
    const take = todo.slice(0, budget);
    for (const r of take) { queue.push(r); queued.add(String(r.game_id)); }
    budget -= take.length;
    if (todo.length > take.length) { stop = { cursor }; break; }          // this page is not done: start here next run
    if (!p.next) break;                                                     // the end of the history (or of `from`)
    if (!budget) { stop = { cursor: p.next }; break; }
    if (!todo.length && target && !jumped && !scanRestarted) { jumped = true; afterTop = p.next; cursor = target; continue; }
    cursor = p.next;
  }
  scan = stop ? { from, cursor: stop.cursor } : null;

  // 3. replays
  const logs: Json[] = [];
  let tried = 0;
  for (const r of queue) {
    tried++;
    const id = String(r.game_id);
    const events = await io.duels(`/g/${encodeURIComponent(id)}`, true);
    if (events) {
      const log = convert(r, events, cat, meName || "Me");
      if (meId) log.source_ref = { ...(log.source_ref || {}), duels_user_id: meId };   // the account, by its stable id
      logs.push(log); delete wait[id];
    }
    else { const n = (wait[id]?.n || 0) + 1; wait[id] = { s: String(r.started_at), n, next: new Date(now + backoff(n)).toISOString() }; }
    await io.sleep(2100);
  }
  if (logs.length) {
    await io.db("game_logs?on_conflict=user_id,game_id", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(logs.map((l) => ({ user_id: userId, game_id: l.game_id, source: "duels_ink", played_at: l.played_at, log: l, visibility: "private" }))),
    });
  }
  for (const id of Object.keys(wait)) if (have.has(`duels-${id}`)) delete wait[id];   // stored meanwhile
  const kept = Object.entries(wait).sort((a, b) => a[1].s.localeCompare(b[1].s)).slice(0, WAIT_MAX);

  const { wanted, excluded } = classify(counted);
  const stored = (r: Json) => have.has(`duels-${r.game_id}`) || logs.some((l) => l.game_id === `duels-${r.game_id}`);
  const waiting = wanted.filter((r) => !stored(r) && !wait[String(r.game_id)]).length;   // not tried yet: next runs
  return {
    // same four numbers as before (Jogos reads them)
    seen: wanted.length, already: wanted.filter((r) => have.has(`duels-${r.game_id}`)).length, added: logs.length, waiting,
    replay_missing: kept.length,                              // games waiting for their replay: tried again, never dropped
    oldest_replay_missing_at: kept[0]?.[1].s ?? null,
    tried, raw: counted.length, excluded_bot: excluded.bot, excluded_result: excluded.result,
    pages, more: !!scan, scan_restarted: scanRestarted,
    from: since, newest_api_game_at: newestOf(wanted.map((r) => r.started_at)),
    newest_stored_game_at: newestOf([storedBefore, ...logs.map((l) => l.played_at)]),
    account_name: meName ? meName.slice(0, 60) : null,
    // complete: the history was read to the end and every finished game in it is stored
    status: scan ? "incomplete" : (waiting || kept.length) ? "pending" : "complete",
    state: { scan, wait: Object.fromEntries(kept) },
  };
}
