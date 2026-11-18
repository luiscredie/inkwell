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
// Each run reads history newest first, from (newest stored game − OVERLAP_DAYS) — or the whole history on a first sync,
// or further back when a game waiting for its replay is due — and imports up to MAX_PER_RUN games: games never tried
// first (newest first), then retries due now (oldest first) with the slots left.
// The read moves past a page only once every game never tried on it got its try; otherwise it stops there and saves the
// position (`scan`), and the next runs go on from it (a first sync, a long backlog, more than MAX_PAGES pages).
// A replay duels.ink does not have (404) puts the game on a wait list (30 min, 1 h, 2 h … then once a day): it does not
// use a slot again before its time, so it cannot hold back the games after it. The list keeps WAIT_MAX games one by one;
// the rest are summed up (`more`: a range of start times and a count), wait the same way and are looked for again daily.
// Nothing is dropped, and the state stays a few KB however many games wait.
// The state (position, list, summary) is saved in last_result and read back by duels_sync_begin
// (supabase/duels_sync_state.sql). No token, e-mail or opponent name in the result (account_name is the display name
// of the duels.ink account the token reads, so the player can check it is theirs).
import { convert, type Catalog, type Json } from "./convert.ts";

export const MAX_PER_RUN = 12;     // replays asked per run (imported, or put on the wait list)
export const MAX_PAGES = 8;        // history pages per run (window + scan)
export const OVERLAP_DAYS = 7;     // history re-read before the newest stored game
export const WAIT_MAX = 100;       // games with their own retry time in the state (the oldest); the rest: `more`
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
// Games waiting for a replay beyond WAIT_MAX are not dropped: they are summed up as a range of start times, how many, and
// when to look again (once a day). A missing game in that range, not on the list, waits for that day like a listed one;
// on that day the read reaches back to `oldest` and tries each of them again. The count is exact after any run that read
// the whole range (an estimate in between).
export type More = { oldest: string; newest: string; n: number; next: string; done?: string | null };   // done: tried up to, in a look
export type SyncState = { scan?: Scan | null; wait?: Record<string, Wait>; more?: More | null };

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

// The shared token (DUELS_TOKEN secret) reads one duels.ink account, the owner's. It is tied explicitly to one Inkwell
// account by the secret DUELS_TOKEN_USER (that account's user id). Without it the shared token is not used at all; for any
// other account it is refused. Belt and braces: if the account's newest stored game carries a duels.ink account id
// (source_ref.duels_user_id, the id of GET /api/me) and the token now reads another account, it is refused too.
export async function sharedTokenCheck(userId: string, me: { id?: string | null } | null, io: SyncIO, ownerId: string | null): Promise<string | null> {
  if (!ownerId) return "the shared duels.ink token is not tied to an Inkwell account (DUELS_TOKEN_USER is not set)";
  if (ownerId !== userId) return "no duels.ink token saved (the shared token belongs to another account)";
  const rows = await io.db(`game_logs?user_id=eq.${userId}&source=eq.duels_ink&select=ref:log->source_ref&order=played_at.desc.nullslast&limit=1`);
  const storedId = rows?.[0]?.ref?.duels_user_id;
  if (storedId && storedId !== me?.id) return "the shared duels.ink token now reads another duels.ink account";
  return null;
}

const newestOf = (xs: (string | null | undefined)[]) => xs.filter(Boolean).sort().pop() ?? null;
const byStart = (a: Json, b: Json) => String(a.started_at).localeCompare(String(b.started_at));

export async function syncUser(userId: string, cat: Catalog, io: SyncIO,
  opts: { state?: SyncState | null; shared?: { ownerId: string | null } } = {}) {
  const now = io.now ? io.now() : Date.now();
  const wait: Record<string, Wait> = { ...(opts.state?.wait || {}) };
  const more: More | null = opts.state?.more ?? null;
  const dueMore = more && Date.parse(more.next) <= now ? more : null;
  let scan: Scan | null = opts.state?.scan ?? null;

  const me = await io.duels("/api/me");
  const meName = typeof me?.name === "string" ? me.name : null;
  const meId = typeof me?.id === "string" ? me.id : null;
  if (opts.shared) { const no = await sharedTokenCheck(userId, me, io, opts.shared.ownerId); if (no) throw new Error(no); }

  const newest = await io.db(`game_logs?user_id=eq.${userId}&source=eq.duels_ink&select=played_at&order=played_at.desc.nullslast&limit=1`);
  const storedBefore: string | null = newest?.[0]?.played_at ?? null;
  const since = storedBefore ? new Date(Date.parse(storedBefore) - OVERLAP_DAYS * 864e5).toISOString() : null;
  // lower bound of the read: the window; while a read is unfinished, its own bound; a due replay older than both
  const lower = (...xs: (string | null | undefined)[]) => xs.some((x) => x === null) ? null : xs.filter(Boolean).sort()[0] ?? null;
  const dueOld = [...Object.values(wait).filter((w) => Date.parse(w.next) <= now).map((w) => w.s), ...(dueMore ? [dueMore.oldest] : [])]
    .map((x) => new Date(Date.parse(x) - MIN).toISOString()).sort()[0];
  const from = !storedBefore ? null : lower(since, ...(scan ? [scan.from] : []), dueOld);
  // a read going on jumps to its saved position (pages above it were handled in this pass); a wait that comes due above it
  // is reached by the next pass, which starts from the top once this one has ended
  const target = scan?.cursor ?? null;

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
  const inMore = (r: Json) => !!more && !wait[String(r.game_id)] && String(r.started_at) >= more.oldest && String(r.started_at) <= more.newest;
  // a game of the summed-up range waits until the range's look; during the look (12 a run, oldest first) the ones already
  // tried in it (up to `done`) wait for the next look
  const isWaiting = (r: Json) => {
    const w = wait[String(r.game_id)];
    if (w) return Date.parse(w.next) > now;
    return inMore(r) && (!dueMore || (!!dueMore.done && String(r.started_at) <= dueMore.done));
  };
  // games never tried come first, newest first (a new game is never held back by old ones looked for again); then
  // retries (on the list, or in the summed-up range), oldest first
  const retry = (r: Json) => !!wait[String(r.game_id)] || inMore(r);
  const order = (a: Json, b: Json) => {
    const ra = retry(a), rb = retry(b);
    return Number(ra) - Number(rb) || (ra ? byStart(a, b) : byStart(b, a));
  };
  const queue: Json[] = [], retries: Json[] = [];
  const queued = new Set<string>();
  const toDo = (rows: Json[]) => classify(rows).wanted.filter((r) => !have.has(`duels-${r.game_id}`) && !isWaiting(r) && !queued.has(String(r.game_id))).sort(order);

  // Read newest first. Each page's games never tried get a try in this run, or the read stops there and that page is
  // where the next run goes on ("position"). Pages above the position were all handled; new games only come in at the
  // top. So once a page at the top has nothing new, the read jumps to the saved position. Retries met on the way (games
  // on the wait list or in the summed-up range, due now) take the budget left at the end.
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
    const fresh = todo.filter((r) => !retry(r));
    for (const r of todo) if (retry(r)) retries.push(r);                     // tried after, with what budget is left
    const take = fresh.slice(0, budget);
    for (const r of take) { queue.push(r); queued.add(String(r.game_id)); }
    budget -= take.length;
    // a page is done when every game never tried on it gets its try; retries are kept in the state (list or range) and
    // come again, so they never hold the read on a page
    if (fresh.length > take.length) { stop = { cursor }; break; }          // not done: the next run starts here
    if (!p.next) break;                                                     // the end of the history (or of `from`)
    if (!budget) { stop = { cursor: p.next }; break; }
    if (!fresh.length && target && !jumped && !scanRestarted) { jumped = true; afterTop = p.next; cursor = target; continue; }
    cursor = p.next;
  }
  scan = stop ? { from, cursor: stop.cursor } : null;
  for (const r of retries.sort(byStart)) {                                  // retries with the budget left, oldest first
    if (budget <= 0) break;
    if (queued.has(String(r.game_id))) continue;
    queue.push(r); queued.add(String(r.game_id)); budget--;
  }

  // 3. replays
  const logs: Json[] = [];
  let tried = 0, recovered = false;
  const rangeTried = queue.filter((r) => inMore(r)).map((r) => String(r.started_at)).sort();   // before the tries change `wait`
  for (const r of queue) {
    tried++;
    const id = String(r.game_id);
    const events = await io.duels(`/g/${encodeURIComponent(id)}`, true);
    if (events) {
      if (retry(r)) recovered = true;                                       // a replay that was missing is back
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
  const listed = Object.entries(wait).sort((a, b) => a[1].s.localeCompare(b[1].s));
  const kept = listed.slice(0, WAIT_MAX), over = listed.slice(WAIT_MAX);
  const { wanted, excluded } = classify(counted);
  const stored = (r: Json) => have.has(`duels-${r.game_id}`) || logs.some((l) => l.game_id === `duels-${r.game_id}`);
  const keptIds = new Set(kept.map(([id]) => id));
  // the summary (games past the list): the earlier range joined with the games that just left the list
  const span = [...over.map(([, w]) => w.s), ...(more ? [more.oldest, more.newest] : [])].sort();
  let nextMore: More | null = null;
  if (span.length) {
    const lo = span[0], hi = span[span.length - 1];
    const covered = !scan && (from === null || from <= lo);           // this run read every page of the range
    const missingIn = wanted.filter((r) => !stored(r) && !keptIds.has(String(r.game_id)) && String(r.started_at) >= lo && String(r.started_at) <= hi);
    // a look at the range goes on run after run (12 a run, oldest first, `done` = tried up to); it ends once every game
    // of the range got a try, then the next look is a day later
    const done = dueMore ? [dueMore.done, rangeTried[rangeTried.length - 1]].filter(Boolean).sort().pop() ?? null : null;
    const lookOver = !!dueMore && covered && missingIn.every((r) => queued.has(String(r.game_id)) || (!!done && String(r.started_at) <= done));
    const next = dueMore ? (lookOver ? new Date(now + 24 * HOUR).toISOString() : dueMore.next)
      : [...over.map(([, w]) => w.next), ...(more ? [more.next] : [])].sort()[0];
    const keepDone = dueMore && !lookOver ? done : null;
    if (covered) {
      const ss = missingIn.map((r) => String(r.started_at)).sort();
      nextMore = ss.length ? { oldest: ss[0], newest: ss[ss.length - 1], n: ss.length, next, done: keepDone } : null;
    } else {
      // between exact counts: add only games that left the list now and were not in the range already (a game of the
      // range tried again and still missing is the same game, not one more)
      const fresh = over.filter(([, w]) => !more || w.s < more.oldest || w.s > more.newest).length;
      nextMore = { oldest: lo, newest: hi, n: (more?.n || 0) + fresh, next, done: keepDone };
    }
  }
  // A missing replay came back: duels.ink serves them again, so every waiting game is due now (MAX_PER_RUN a run) instead
  // of at its own time, up to a day away. Those still missing go back to waiting, with a longer pause.
  if (recovered) {
    const nowIso = new Date(now).toISOString();
    for (const [, w] of kept) w.next = nowIso;
    if (nextMore) { nextMore.next = nowIso; nextMore.done = null; }
  }
  const summed = (r: Json) => !!nextMore && !keptIds.has(String(r.game_id)) && String(r.started_at) >= nextMore.oldest && String(r.started_at) <= nextMore.newest;
  const waiting = wanted.filter((r) => !stored(r) && !wait[String(r.game_id)] && !summed(r)).length;   // not tried yet: next runs
  return {
    // same four numbers as before (Jogos reads them)
    seen: wanted.length, already: wanted.filter((r) => have.has(`duels-${r.game_id}`)).length, added: logs.length, waiting,
    // games waiting for their replay: tried again, never dropped (listed one by one, and the rest summed up)
    replay_missing: kept.length + (nextMore?.n || 0), replay_missing_listed: kept.length, replay_missing_more: nextMore?.n || 0,
    oldest_replay_missing_at: [kept[0]?.[1].s, nextMore?.oldest].filter(Boolean).sort()[0] ?? null,
    tried, raw: counted.length, excluded_bot: excluded.bot, excluded_result: excluded.result,
    pages, more: !!scan, scan_restarted: scanRestarted,
    from: since, newest_api_game_at: newestOf(wanted.map((r) => r.started_at)),
    newest_stored_game_at: newestOf([storedBefore, ...logs.map((l) => l.played_at)]),
    account_name: meName ? meName.slice(0, 60) : null,
    // complete: the history was read to the end and every finished game in it is stored
    status: scan ? "incomplete" : (waiting || kept.length || nextMore) ? "pending" : "complete",
    state: { scan, wait: Object.fromEntries(kept), more: nextMore },
  };
}
