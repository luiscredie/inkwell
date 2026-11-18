// duels-sync (issue #241): runs of one player against a fake duels.ink that follows https://duels.ink/api-docs.md
// (finished games newest first by last-update time; `from` bounds that time; keyset cursor "<updated_at>|<game_id>";
// a game updated later moves to the top; /g 404s) and an in-memory game_logs that counts duplicates. The state each run returns is passed to the next,
// as duels_sync_begin does after supabase/duels_sync_state.sql. A fake clock moves between runs. No network, no SQL.
//   node tools/duels-sync.test.mjs
import { syncUser, classify, sharedTokenAllowed, MAX_PER_RUN, MAX_PAGES, OVERLAP_DAYS } from '../supabase/functions/duels-sync/sync.ts';
import { Catalog } from '../supabase/functions/duels-sync/convert.ts';

let pass = 0, fail = 0;
const ck = (n, c, extra = '') => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n + (c || !extra ? '' : `  → ${extra}`)); };
const cat = new Catalog([]);
const U = '11111111-1111-1111-1111-111111111111';
const T0 = Date.UTC(2026, 10, 16, 0, 0);
const at = (h) => new Date(T0 + h * 3600e3).toISOString();         // hours from 16/11 00:00 UTC

function world({ games = [], pageSize = 250, noReplay = [], meName = 'Luís', meId = 'u_luis' } = {}) {
  const w = { games, store: new Map(), dupes: 0, noReplay: new Set(noReplay), refuse: null, t: T0, state: null, last: null, runs: 0, asked: new Map() };
  const duels = async (path, binary) => {
    if (path === '/api/me') return { id: meId, name: meName };
    if (path.startsWith('/api/me/match-history')) {
      const q = new URL('https://x' + path).searchParams;
      const from = q.get('from'), cur = q.get('cursor'), lim = Math.min(Number(q.get('limit')), pageSize);
      if (cur && cur === w.refuse) { w.refuse = null; return { error: 'invalid cursor' }; }   // this one cursor, once
      const upd = (g) => g.updated_at || g.started_at;
      const key = (g) => `${upd(g)}|${g.game_id}`;
      const list = w.games.filter((g) => Date.parse(upd(g)) <= w.t && (!from || upd(g) >= from))
        .sort((a, b) => key(b).localeCompare(key(a)));                      // newest first by last-update time
      const rest = cur ? list.filter((g) => key(g) < cur) : list;            // keyset: strictly after the cursor row
      const page = rest.slice(0, lim);
      return { games: page, next_cursor: rest.length > lim ? key(page[page.length - 1]) : null };
    }
    if (path.startsWith('/g/')) { const id = decodeURIComponent(path.slice(3)); w.asked.set(id, (w.asked.get(id) || 0) + 1); return w.noReplay.has(id) ? null : []; }
    throw new Error('unexpected ' + path);
  };
  const db = async (path, init = {}) => {
    const all = () => [...w.store.values()].sort((a, b) => b.played_at.localeCompare(a.played_at));
    if (path.includes('select=players:log->players')) return all().slice(0, 1).map((r) => ({ players: r.log.players, ref: r.log.source_ref }));
    if (path.includes('order=played_at.desc')) return all().slice(0, 1).map((r) => ({ played_at: r.played_at }));
    if (path.includes('game_id=in.(')) {
      const ids = decodeURIComponent(path.split('game_id=in.(')[1].split(')')[0]).split(',').map((x) => x.replace(/"/g, ''));
      return ids.filter((id) => w.store.has(id)).map((game_id) => ({ game_id }));
    }
    if (path.startsWith('game_logs?on_conflict')) {
      for (const r of JSON.parse(init.body)) { if (w.store.has(r.game_id)) w.dupes++; else w.store.set(r.game_id, r); }
      return null;
    }
    throw new Error('unexpected db ' + path);
  };
  w.io = { duels, db, sleep: async () => {}, now: () => w.t };
  // one scheduled run, 30 minutes after the previous one, with the state the previous run saved
  w.run = async (opts = {}) => {
    w.t += opts.advance ?? 30 * 60e3; w.runs++;
    const r = await syncUser(U, cat, w.io, { state: w.state, ...opts });
    w.state = r.state; w.last = r; return r;
  };
  w.runUntil = async (done, max = 400) => { for (let i = 0; i < max && !done(); i++) await w.run(); return done(); };
  return w;
}
const game = (id, h, over = {}) => ({ game_id: id, started_at: at(h), result: 'win', opp_is_bot: false, your_player: 1, queue_name: 'Core Set 14 BO3', opp_deck_colors: 'Amethyst/Ruby', ...over });
const many = (prefix, n, h0, step = 0.05) => Array.from({ length: n }, (_, i) => game(prefix + String(i).padStart(4, '0'), h0 + i * step));
const allStored = (w, ids) => ids.every((id) => w.store.has('duels-' + id));

// ---------------------------------------------------------------- the case in #241
{
  const w = world({ games: [game('a', -3), game('b', -2.9)] });
  w.t = Date.parse(at(-1)); await w.run({ advance: 0 });
  w.t = Date.parse(at(23.5)); const r1 = await w.run({ advance: 0 });                 // the 23:30 UTC check
  w.games.push(game('amy1', 23.66), game('amy2', 23.82));                              // played 23:39 and 23:49 UTC
  w.t = Date.parse(at(24)); const r2 = await w.run({ advance: 0 });                    // 00:00 UTC
  ck('#241: the check before the games existed reports complete, nothing missing', r1.added === 0 && r1.status === 'complete', JSON.stringify(r1));
  ck('#241: the next run imports both games', r2.added === 2 && allStored(w, ['amy1', 'amy2']) && r2.status === 'complete');
  ck('#241: the result names the account the token reads', r2.account_name === 'Luís');
  const r3 = await w.run();
  ck('a run again adds nothing, no duplicate', r3.added === 0 && w.dupes === 0 && w.store.size === 4);
}

// ---------------------------------------------------------------- 1. a replay missing for longer than the window
{
  const w = world({ games: [game('seed', 0), game('late', 1)], noReplay: ['late'] });
  w.t = Date.parse(at(2)); await w.run({ advance: 0 });
  // newer games keep coming for 12 days (more than OVERLAP_DAYS) while 'late' has no replay
  for (let d = 1; d <= 12; d++) { w.games.push(game('d' + d, 24 * d)); w.t = Date.parse(at(24 * d + 1)); await w.run({ advance: 0 }); }
  const waitingBefore = w.last.replay_missing === 1 && !w.store.has('duels-late');
  ck(`replay missing for 12 days (window ${OVERLAP_DAYS}): kept on the wait list, never dropped`, waitingBefore && !!w.state.wait.late, JSON.stringify(w.last));
  w.noReplay.clear();
  const ok = await w.runUntil(() => w.store.has('duels-late'), 60);
  ck('…and imported once its replay exists, with no duplicate', ok && w.dupes === 0 && w.last.replay_missing === 0, JSON.stringify(w.last));
  ck('…the newer games were all imported meanwhile', allStored(w, Array.from({ length: 12 }, (_, i) => 'd' + (i + 1))));
}

// ---------------------------------------------------------------- 2. first sync: the whole history, every page
{
  const gs = many('h', 60, -100);                                                      // 60 games, pages of 7
  const w = world({ games: gs, pageSize: 7 });
  w.t = Date.parse(at(0));
  const r1 = await w.run({ advance: 0 });
  ck('first sync: not just the newest page (it goes on in the next runs)', r1.added === MAX_PER_RUN && r1.more === true && r1.status === 'incomplete', JSON.stringify(r1));
  const ok = await w.runUntil(() => w.last.status === 'complete', 50);
  ck('first sync: all 60 games of 9 pages imported, no duplicate', ok && allStored(w, gs.map((g) => g.game_id)) && w.dupes === 0 && w.store.size === 60, `runs ${w.runs}, stored ${w.store.size}`);
  ck(`first sync: each run imports its ${MAX_PER_RUN} until done (60 games: 5 runs + the last check)`, w.runs <= 7, `runs ${w.runs}`);
}

// ---------------------------------------------------------------- 3. replays 404 do not hold back the games after them
{
  const blocked = many('x', MAX_PER_RUN + 4, 1, 0.01);                                 // 16 games with no replay, oldest
  const w = world({ games: [game('seed', 0), ...blocked], noReplay: blocked.map((g) => g.game_id) });
  w.t = Date.parse(at(0.5)); await w.run({ advance: 0 });
  w.t = Date.parse(at(2)); await w.run({ advance: 0 });                                // tries 12 of them: all 404
  w.games.push(game('next1', 2.5), game('next2', 2.6));
  w.t = Date.parse(at(3)); const r = await w.run({ advance: 0 });
  ck('404s wait their turn: the next games are imported on the next run', allStored(w, ['next1', 'next2']), JSON.stringify(r));
  ck('…the 404 games stay on the wait list (16), none dropped', w.last.replay_missing === blocked.length || Object.keys(w.state.wait).length === blocked.length, JSON.stringify(w.state.wait && Object.keys(w.state.wait).length));
  const runAt = w.t + 5 * 60e3;
  const notYet = Object.entries(w.state.wait).filter(([, v]) => Date.parse(v.next) > runAt).map(([id]) => id);
  const before = notYet.map((id) => w.asked.get(id) || 0);
  await w.run({ advance: 5 * 60e3 });
  ck('…and none is asked again before its time', notYet.length > 0 && notYet.every((id, i) => (w.asked.get(id) || 0) === before[i]), `${notYet.length} not due`);
  w.noReplay.clear();
  const ok = await w.runUntil(() => allStored(w, blocked.map((g) => g.game_id)), 60);
  ck('…all imported when the replays come, no duplicate', ok && w.dupes === 0);
}

// ---------------------------------------------------------------- 4. more than MAX_PAGES pages: goes on, safely
{
  const old = many('o', 40, -60, 0.1);                                                 // one stored game, then 40 in pages of 2
  const w = world({ games: [game('seed', -61)], pageSize: 2 });
  w.t = Date.parse(at(-60.5)); await w.run({ advance: 0 });
  w.games.push(...old);
  w.t = Date.parse(at(0)); const r1 = await w.run({ advance: 0 });
  ck(`window of 20 pages > ${MAX_PAGES}: the run says incomplete and keeps where it stopped`, r1.more === true && r1.status === 'incomplete' && !!w.state.scan, JSON.stringify(r1));
  const ok = await w.runUntil(() => w.last.status === 'complete', 60);
  ck('…the next runs read the rest: all 40 imported, no duplicate', ok && allStored(w, old.map((g) => g.game_id)) && w.dupes === 0, `runs ${w.runs}, stored ${w.store.size}`);
  // missing games under more than MAX_PAGES pages of games already stored: only a saved position gets there
  const deep = many('deep', 6, -40, 0.1), top = many('top', 30, -30, 0.1);
  const w3 = world({ games: [...deep, ...top], pageSize: 2 });
  for (const g of top) w3.store.set('duels-' + g.game_id, { game_id: 'duels-' + g.game_id, played_at: g.started_at, log: { players: [{ is_me: true, name: 'Luís' }] } });
  w3.t = Date.parse(at(0));
  const ok3 = await w3.runUntil(() => allStored(w3, deep.map((g) => g.game_id)), 20);
  ck(`6 missing games under 15 pages already stored (> ${MAX_PAGES} per run): reached by going on from the saved position`, ok3 && w3.dupes === 0, `runs ${w3.runs}, stored ${w3.store.size}, last ${JSON.stringify(w3.last).slice(0,160)}`);
  // a saved position refused (not expected: duels.ink cursors are keyset values): go on page by page, nothing lost or doubled
  const w2 = world({ games: many('c', 30, -50, 0.1), pageSize: 2 });
  w2.t = Date.parse(at(0)); await w2.run({ advance: 0 });
  w2.refuse = w2.state.scan.cursor;                                                     // the saved position is refused once
  let restarted = false;
  const ok2 = await w2.runUntil(() => { restarted ||= !!w2.last?.scan_restarted; return w2.last?.status === 'complete' && w2.runs > 1; }, 60);
  ck('a refused position: the read goes on page by page, all 30 imported, no duplicate', w2.refuse === null && restarted && ok2 && w2.store.size === 30 && w2.dupes === 0, `refused ${w2.refuse === null}, restarted ${restarted}, stored ${w2.store.size}`);
}

// ---------------------------------------------------------------- a game updated later moves to the top (duels.ink orders by update time)
{
  const deep = many('u', 30, -40, 0.1);
  const w = world({ games: [game('seed', -41), ...deep], pageSize: 2, noReplay: ['u0000'] });
  w.t = Date.parse(at(0)); await w.run({ advance: 0 });
  await w.runUntil(() => !w.state.scan, 30);                                            // read whole; u0000 waits (404)
  const moved = w.games.find((g) => g.game_id === 'u0000');
  moved.updated_at = new Date(w.t + 60e3).toISOString();                                // its log is ready: updated now
  w.noReplay.clear();
  const ok = await w.runUntil(() => w.store.has('duels-u0000'), 60);
  ck('a game updated later (moves to the top of the history) is still imported, once', ok && w.dupes === 0 && allStored(w, deep.map((g) => g.game_id)), `runs ${w.runs}`);
}

// ---------------------------------------------------------------- 5. the shared token (DUELS_TOKEN) is the owner's only
{
  const owner = world({ games: [game('o1', 1)] });
  owner.t = Date.parse(at(2)); await owner.run({ advance: 0 });                       // the owner's games, already stored
  owner.games.push(game('o2', 3));
  const r = await owner.run({ shared: { ownerId: null }, advance: 2 * 3600e3 });
  ck('shared token: the owner (stored games of this duels.ink account) keeps syncing', r.added === 1 && owner.store.has('duels-o2'));
  const stranger = world({ games: [game('o1', 1), game('o2', 3)] });                   // the same duels.ink history…
  let err = null; try { await stranger.run({ shared: { ownerId: null } }); } catch (e) { err = String(e.message); }
  ck('shared token: a new account with no games of its own is refused, nothing stored', /another account/.test(err || '') && stranger.store.size === 0, err);
  const other = world({ games: [game('p1', 1)], meName: 'Someone', meId: 'u_someone' });
  other.t = Date.parse(at(2)); await other.run({ advance: 0 });                       // has games for "Someone"
  const viaOwner = world({ games: [game('o3', 4)], meName: 'Luís' }); viaOwner.store = other.store;
  err = null; try { await viaOwner.run({ shared: { ownerId: null } }); } catch (e) { err = String(e.message); }
  ck('shared token: an account whose games are another duels.ink account is refused', /another account/.test(err || '') && !other.store.has('duels-o3'), err);
  // duels.ink: tie an account by the id of /api/me, never by the name. New games keep the id; it wins over the name.
  ck('new games keep the duels.ink account id (source_ref.duels_user_id)', owner.store.get('duels-o2')?.log?.source_ref?.duels_user_id === 'u_luis');
  const renamed = world({ games: [game('o4', 5)], meName: 'Luís Credie', meId: 'u_luis' }); renamed.store = owner.store; renamed.t = Date.parse(at(6));
  let rr = null; try { rr = await renamed.run({ shared: { ownerId: null }, advance: 0 }); } catch (e) { rr = { error: String(e.message) }; }
  ck('shared token: the owner after changing the display name (same account id) keeps syncing', rr?.added === 1, JSON.stringify(rr));
  const sameName = world({ games: [game('o5', 7)], meName: 'Luís Credie', meId: 'u_someone_else' }); sameName.store = owner.store; sameName.t = Date.parse(at(8));
  err = null; try { await sameName.run({ shared: { ownerId: null }, advance: 0 }); } catch (e) { err = String(e.message); }
  ck('shared token: same display name but another duels.ink account (id) is refused', /another account/.test(err || '') && !owner.store.has('duels-o5'), err);
  ck('shared token: DUELS_TOKEN_USER names the owner (allowed) and only the owner (refused)',
    (await sharedTokenAllowed(U, null, stranger.io, U)) === true && (await sharedTokenAllowed(U, { id: 'u_luis', name: 'Luís' }, owner.io, '22222222-2222-2222-2222-222222222222')) === false);
}

// ---------------------------------------------------------------- what is left out, broken answers, privacy
{
  const { wanted, excluded } = classify([game('w', 1), game('L', 1, { result: 'LOSS' }), game('bot', 1, { opp_is_bot: true }), game('live', 1, { result: 'in_progress' }), game('none', 1, { result: null })]);
  ck('classify: bots and unfinished games are left out and counted by reason; "LOSS" counts', wanted.length === 2 && excluded.bot === 1 && excluded.result.in_progress === 1 && excluded.result.none === 1);
  const w = world({ games: [game('seed', 0), game('live', 1, { result: 'in_progress' })] });
  w.t = Date.parse(at(2)); await w.run({ advance: 0 });
  w.games.find((g) => g.game_id === 'live').result = 'loss';
  const r = await w.run();
  ck('a game left out while running is imported once it ends', r.added === 1 && w.store.has('duels-live'));
  const b = world(); b.io.duels = async (p) => (p === '/api/me' ? { name: 'x' } : null);
  let err = null; try { await b.run(); } catch (e) { err = String(e.message); }
  ck('history without a games list is an error, not ok with nothing added', /did not answer/.test(err || ''), err);
  const p = world({ games: [game('seed', 0, { opp_display_name: 'Rival123' })] }); p.t = Date.parse(at(1));
  const rp = await p.run({ advance: 0 });
  ck('the result carries no token, user id or opponent name', !/Rival123|1111-1111|token/i.test(JSON.stringify(rp)));
  ck('the state stays small (no history rows in it)', JSON.stringify(w.state).length < 2000, JSON.stringify(w.state).length);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
