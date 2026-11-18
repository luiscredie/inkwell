// duels-sync (issue #241): one player's run against a fake duels.ink (honours from, cursor, limit, 404 replays)
// and an in-memory game_logs (refuses duplicates). No network, no SQL.
//   node --experimental-strip-types tools/duels-sync.test.mjs   (Node 23.6+: plain node)
import { syncUser, classify, MAX_PER_RUN, OVERLAP_DAYS } from '../supabase/functions/duels-sync/sync.ts';
import { Catalog } from '../supabase/functions/duels-sync/convert.ts';

let pass = 0, fail = 0;
const ck = (n, c, extra = '') => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n + (c || !extra ? '' : `  → ${extra}`)); };
const cat = new Catalog([]);
const U = '11111111-1111-1111-1111-111111111111';
const at = (h) => new Date(Date.UTC(2026, 10, 16, 0, 0) + h * 3600e3).toISOString();   // hours from 16/11 00:00 UTC

function world({ games = [], pageSize = 250, noReplay = new Set(), brokenHistory = false } = {}) {
  const store = new Map();           // game_id -> row
  let dupes = 0;
  const calls = [];
  const duels = async (path, binary) => {
    calls.push(path);
    if (path === '/api/me') return { name: 'Luís' };
    if (path.startsWith('/api/me/match-history')) {
      if (brokenHistory) return null;
      const q = new URL('https://x' + path).searchParams;
      const from = q.get('from'), start = Number(q.get('cursor') || 0), lim = Math.min(Number(q.get('limit')), pageSize);
      const list = games.filter((g) => !from || g.started_at >= from).sort((a, b) => b.started_at.localeCompare(a.started_at));   // newest first
      const page = list.slice(start, start + lim);
      return { games: page, next_cursor: start + lim < list.length ? String(start + lim) : null };
    }
    if (path.startsWith('/g/')) return noReplay.has(decodeURIComponent(path.slice(3))) ? null : [];
    throw new Error('unexpected ' + path);
  };
  const db = async (path, init = {}) => {
    if (path.startsWith('game_logs?user_id=eq.') && path.includes('order=played_at.desc')) {
      const all = [...store.values()].sort((a, b) => b.played_at.localeCompare(a.played_at));
      return all.length ? [{ played_at: all[0].played_at }] : [];
    }
    if (path.includes('game_id=in.(')) {
      const ids = decodeURIComponent(path.split('game_id=in.(')[1].split(')')[0]).split(',').map((x) => x.replace(/"/g, ''));
      return ids.filter((id) => store.has(id)).map((game_id) => ({ game_id }));
    }
    if (path.startsWith('game_logs?on_conflict')) {
      for (const r of JSON.parse(init.body)) { if (store.has(r.game_id)) dupes++; else store.set(r.game_id, r); }
      return null;
    }
    throw new Error('unexpected db ' + path);
  };
  return { store, calls, get dupes() { return dupes; }, games, noReplay, io: { duels, db, sleep: async () => {} } };
}
const game = (id, h, over = {}) => ({ game_id: id, started_at: at(h), result: 'win', opp_is_bot: false, your_player: 1, queue_name: 'Core Set 14 BO3', opp_deck_colors: 'Amethyst/Ruby', ...over });

// 1. The case in #241: the check runs before the games exist; the next run brings them, once.
{
  const w = world({ games: [game('a', 2), game('b', 2.1)] });
  await syncUser(U, cat, w.io);
  const r1 = await syncUser(U, cat, w.io);                       // 23:30 UTC check: nothing new yet
  w.games.push(game('amy1', 23.66), game('amy2', 23.82));         // played 23:39 and 23:49 UTC
  const r2 = await syncUser(U, cat, w.io);                        // 00:00 UTC run
  ck('#241: a check before the games were played reports complete with nothing missing', r1.added === 0 && r1.status === 'complete' && r1.newest_api_game_at === r1.newest_stored_game_at, JSON.stringify(r1));
  ck('#241: the next run imports both new games, oldest first', r2.added === 2 && w.store.has('duels-amy1') && w.store.has('duels-amy2') && r2.status === 'complete', JSON.stringify(r2));
  ck('#241: the result names the newest game on duels.ink and the newest stored', r2.newest_api_game_at === at(23.82) && r2.newest_stored_game_at === at(23.82));
  ck('the result names the duels.ink account the token reads (to check it is the player\'s own)', r2.account_name === 'Luís');
  const r3 = await syncUser(U, cat, w.io);
  ck('a run again adds nothing and writes no duplicate', r3.added === 0 && w.dupes === 0 && w.store.size === 4);
}

// 2. Cursor: history longer than one page is read to the end (from the overlap on).
{
  const gs = Array.from({ length: 9 }, (_, i) => game('p' + i, i * 0.5));
  const w = world({ games: [game('seed', 0)], pageSize: 3 });
  await syncUser(U, cat, w.io);
  w.games.push(...gs);
  const r = await syncUser(U, cat, w.io);
  ck('cursor: every page is read (10 games in pages of 3)', r.raw === 10 && r.pages === 4 && r.added === 9 && !r.more, JSON.stringify(r));
}

// 3. What is left out, and why: bots, unfinished games; a result in capitals still counts.
{
  const { wanted, excluded } = classify([game('w', 1), game('L', 1, { result: 'LOSS' }), game('bot', 1, { opp_is_bot: true }), game('live', 1, { result: 'in_progress' }), game('none', 1, { result: null })]);
  ck('classify: bot and unfinished games are left out and counted by reason', wanted.length === 2 && excluded.bot === 1 && excluded.result.in_progress === 1 && excluded.result.none === 1, JSON.stringify(excluded));
  ck('classify: "LOSS" is read as a loss', wanted.find((r) => r.game_id === 'L')?.result === 'loss');
  const w = world({ games: [game('seed', 0), game('bot', 1, { opp_is_bot: true }), game('live', 2, { result: 'in_progress' })] });
  const r = await syncUser(U, cat, w.io);
  ck('a run reports raw rows and the left-out counts (no silent drop)', r.raw === 3 && r.seen === 1 && r.excluded_bot === 1 && r.excluded_result.in_progress === 1, JSON.stringify(r));
  w.games.find((g) => g.game_id === 'live').result = 'loss';      // the game ends later
  const r2 = await syncUser(U, cat, w.io);
  ck('a game left out while still running is imported once it ends', r2.added === 1 && w.store.has('duels-live'));
}

// 4. Replay not ready yet (404): counted, not lost; imported on a later run, once.
{
  const w = world({ games: [game('seed', 0), game('late', 1)], noReplay: new Set(['late']) });
  await syncUser(U, cat, w.io);                                    // first run: seed only (late has no replay)
  w.games.push(game('newer', 5));
  const r = await syncUser(U, cat, w.io);
  ck('replay 404: the game is reported as replay_missing and the status pending', r.replay_missing === 1 && r.status === 'pending' && r.waiting === 0 && !w.store.has('duels-late'), JSON.stringify(r));
  w.noReplay.clear();
  const r2 = await syncUser(U, cat, w.io);
  ck('replay 404: once the replay exists the game is imported, no duplicate', r2.added === 1 && w.store.has('duels-late') && w.dupes === 0 && r2.status === 'complete');
}

// 5. An older missing game behind newer stored ones (the old 2-day window lost it; the window is now OVERLAP_DAYS).
{
  const w = world({ games: [game('old', 0)], noReplay: new Set(['old']) });
  w.games.push(game('n1', 3 * 24), game('n2', 3 * 24 + 1));      // 3 days later, while old's replay is still missing
  await syncUser(U, cat, w.io);                                    // stores n1, n2 only... (first run: newest page)
  w.noReplay.clear();
  const r = await syncUser(U, cat, w.io);
  ck(`a game 3 days older than the newest stored is still found (window ${OVERLAP_DAYS} days)`, OVERLAP_DAYS >= 3 && w.store.has('duels-old') && r.added === 1, JSON.stringify(r));
  ck('the request asks duels.ink from the newest stored game minus the overlap', r.from === new Date(Date.parse(at(73)) - OVERLAP_DAYS * 864e5).toISOString());
}

// 6. More missing than one run may import: the rest is "waiting", and arrives on the next runs.
{
  const w = world({ games: [game('seed', 0)] });
  await syncUser(U, cat, w.io);
  w.games.push(...Array.from({ length: MAX_PER_RUN + 3 }, (_, i) => game('m' + String(i).padStart(2, '0'), 1 + i * 0.1)));
  const r = await syncUser(U, cat, w.io);
  const r2 = await syncUser(U, cat, w.io);
  ck(`limit: ${MAX_PER_RUN} per run, the rest waiting (pending), then imported`, r.added === MAX_PER_RUN && r.waiting === 3 && r.status === 'pending' && r2.added === 3 && r2.status === 'complete' && w.dupes === 0, JSON.stringify([r, r2]));
}

// 7. History past the page limit: reported as incomplete, not as complete.
{
  const w = world({ games: [game('seed', 0)], pageSize: 1 });
  await syncUser(U, cat, w.io);
  w.games.push(...Array.from({ length: 10 }, (_, i) => game('x' + i, 1 + i)));
  const r = await syncUser(U, cat, w.io);
  ck('more history than MAX_PAGES: more=true, status incomplete', r.more === true && r.status === 'incomplete', JSON.stringify(r));
}

// 8. duels.ink answers without a games list: an error, not ok with nothing added.
{
  const w = world({ brokenHistory: true });
  let err = null;
  try { await syncUser(U, cat, w.io); } catch (e) { err = String(e.message); }
  ck('history without a games list throws (index.ts records ok:false with the reason)', /did not answer/.test(err || ''), err);
}

// 9. Nothing private in the result.
{
  const w = world({ games: [game('seed', 0, { opp_display_name: 'Rival123' })] });
  const r = await syncUser(U, cat, w.io);
  ck('the result carries no token, user id or opponent name', !/Rival123|1111-1111|token/i.test(JSON.stringify(r)), JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
