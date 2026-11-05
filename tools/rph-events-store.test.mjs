// The rph-events function itself (supabase/functions/rph-events/index.ts) for store communities, run in Node
// against recorded Play Hub answers (tools/fixtures/rph-stores-2026-11-05.json):  node tools/rph-events-store.test.mjs
// ?stores= (pick a store), ?store= (its events, wherever the visitor is), and that both reuse the categories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FN = new URL('../supabase/functions/rph-events/', import.meta.url);
const FIX = JSON.parse(readFileSync(new URL('./fixtures/rph-stores-2026-11-05.json', import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'rph-'));
for (const f of ['categories.js', 'paginate.js']) copyFileSync(new URL(f, FN), join(dir, f));
writeFileSync(join(dir, 'index.mts'), readFileSync(new URL('index.ts', FN), 'utf8').replace(/^import "jsr:.*$/m, ''));

let handler, calls = [], answer = () => null;
globalThis.Deno = { serve: (h) => { handler = h; } };
globalThis.fetch = async (url) => {
  const u = new URL(String(url)); calls.push(u);
  const body = answer(u);
  if (body instanceof Error) return new Response('{}', { status: 503 });
  return new Response(JSON.stringify(body ?? { count: 0, results: [] }), { status: 200 });
};
await import(join(dir, 'index.mts'));
let ip = 0;
const get = async (qs) => { const r = await handler(new Request('https://x.test/rph-events?' + qs, { headers: { 'x-forwarded-for': '10.0.0.' + (++ip % 250) } })); return { status: r.status, body: await r.json() }; };
const playHub = (u) => {
  if (u.pathname.endsWith('/game-stores/')) return FIX.game_stores;
  if (u.pathname.endsWith('/event-configuration-templates/')) return [];
  if (u.pathname.endsWith('/events/')) return u.searchParams.get('store') === '17617' ? FIX.store_events : { count: 0, results: [], next_page_number: null };
};

test('?stores=: Lorcana stores only, each store once, with id, city and address', async () => {
  answer = playHub; calls = [];
  const { status, body } = await get('stores=Colecionaveis');
  assert.equal(status, 200);
  assert.deepEqual(body.stores.map((s) => s.id), [17531, 17617, 17543]);   // 6 rows (Lorcana + Riftbound) -> 3 stores
  assert.equal(body.complete, true);
  const s = body.stores.find((x) => x.id === 17617);
  assert.equal(s.city, 'Campinas');
  assert.ok(!/\n/.test(s.address) && /Av Brasil 1456/.test(s.address));
  const q = calls.at(-1).searchParams;
  assert.deepEqual([q.get('search'), q.get('game_id'), q.get('page_size')], ['Colecionaveis', '1', '100']);   // Lorcana filtered on the Play Hub's side
  assert.deepEqual((await get('stores=a')).body, { stores: [], total: 0, complete: true });   // too short: no call
});

// /game-stores/ pages (game_id=1, 05/11/2026: "games" matched 1540 Lorcana stores; page_size up to 1000 accepted)
const gsRow = (i, game = 'disney-lorcana') => ({ id: 'gs-' + i + game, game: { slug: game }, store: { id: 30000 + i, name: 'Loja ' + i, city: 'Cidade ' + i, full_address: 'Rua ' + i } });
const gsPages = (rows, size) => (u) => {
  if (!u.pathname.endsWith('/game-stores/')) return playHub(u);
  const page = +u.searchParams.get('page'), n = +u.searchParams.get('page_size') || size, b = (page - 1) * n;
  return { count: rows.length, results: rows.slice(b, b + n), next_page_number: b + n < rows.length ? page + 1 : null };
};
test('?stores=: a Lorcana store that is only on the second page is found; each store once', async () => {
  const rows = [...Array.from({ length: 100 }, (_, i) => gsRow(i)), gsRow(150), { ...gsRow(3), id: 'gs-3-second-row' }, gsRow(151, 'riftbound')];   // #30150 on page 2; #30003 in a second row
  answer = gsPages(rows); calls = [];
  const { body } = await get('stores=Loja2');
  assert.ok(body.stores.some((s) => s.id === 30150), 'store from page 2');
  assert.equal(body.stores.length, 101);
  assert.equal(new Set(body.stores.map((s) => s.id)).size, 101);
  assert.ok(!body.stores.some((s) => s.id === 30151), 'other games out');
  assert.equal(body.complete, true);
  assert.deepEqual(calls.filter((u) => u.pathname.endsWith('/game-stores/')).map((u) => u.searchParams.get('page')), ['1', '2']);
});
test('?stores=: more rows than the safe limit (300) or a page that fails: marked incomplete, not hidden', async () => {
  answer = gsPages(Array.from({ length: 1540 }, (_, i) => gsRow(i))); calls = [];
  const big = (await get('stores=games')).body;
  assert.deepEqual([big.stores.length, big.total, big.complete], [300, 1540, false]);
  assert.equal(calls.filter((u) => u.pathname.endsWith('/game-stores/')).length, 3);
  const rows = Array.from({ length: 150 }, (_, i) => gsRow(1000 + i));
  answer = (u) => (u.pathname.endsWith('/game-stores/') && u.searchParams.get('page') === '2' ? new Error('down') : gsPages(rows)(u));
  const cut = (await get('stores=cut')).body;
  assert.deepEqual([cut.stores.length, cut.complete], [100, false]);
});

test('?store_info=: the Play Hub\'s own name and address for a store id (from its events); unknown ids are not found', async () => {
  answer = (u) => (u.pathname.endsWith('/events/') ? (u.searchParams.get('store') === '17617' ? { count: 23, results: [FIX.store_events.results[0]] } : { count: 0, results: [] }) : playHub(u));
  calls = [];
  const ok = (await get('store_info=17617')).body;
  assert.equal(ok.found, true);
  assert.equal(ok.store.id, 17617);
  assert.match(ok.store.name, /Muito Colecionaveis/);
  assert.equal(ok.events, 23);
  const q = calls.at(-1).searchParams;
  assert.ok(!q.has('display_statuses'), 'past events count too');
  assert.deepEqual((await get('store_info=424242')).body, { found: false, store: null, events: 0 });
  for (const bad of ['x', '0', '1234567890123']) assert.equal((await get('store_info=' + bad)).status, 400);
});

test('?store=: the store\'s events with the same categories, no location needed', async () => {
  answer = playHub; calls = [];
  const { status, body } = await get('store=17617');
  assert.equal(status, 200);
  assert.deepEqual([body.complete, body.total, body.received], [true, 3, 3]);
  assert.deepEqual(body.events.map((e) => e.category).sort(), ['celebration', 'prerelease', 'set_championship']);
  assert.ok(body.events.every((e) => e.category_source === 'observed' && e.store.id === 17617 && e.url.startsWith('https://tcg.ravensburgerplay.com/events/')));
  const q = calls.find((u) => u.pathname.endsWith('/events/')).searchParams;
  assert.equal(q.get('store'), '17617');
  assert.ok(!q.has('latitude') && !q.has('num_miles'));
});

test('?store=: a store with no events answers an empty, complete list (not an error)', async () => {
  answer = playHub;
  const { status, body } = await get('store=999999');
  assert.equal(status, 200);
  assert.deepEqual([body.events.length, body.complete], [0, true]);
});

test('?store=: bad ids are refused; a Play Hub failure is a 502, not "no events"', async () => {
  for (const bad of ['abc', '0', '-3', '1234567890123']) assert.equal((await get('store=' + bad)).status, 400, bad);
  answer = (u) => (u.pathname.endsWith('/events/') ? new Error('down') : playHub(u));
  const r = await get('store=424242');
  assert.equal(r.status, 502);
  assert.match(r.body.error, /play hub 503/);
});

test('?store=: duplicates across pages are dropped and an incomplete read is flagged', async () => {
  const ev = (id) => ({ ...FIX.store_events.results[0], id, name: 'E' + id });
  answer = (u) => {
    if (!u.pathname.endsWith('/events/')) return playHub(u);
    const page = +u.searchParams.get('page'), size = +u.searchParams.get('page_size');
    if (size === 250) return page === 1 ? { count: 252, results: Array.from({ length: 250 }, (_, i) => ev(5000 + i)), next_page_number: 2 } : { count: 252, results: [ev(5249), ev(5250)], next_page_number: null };
    return page === 1 ? { count: 252, results: Array.from({ length: 200 }, (_, i) => ev(5000 + i)), next_page_number: 2 } : new Error('down');
  };
  const { body } = await get('store=777');
  assert.equal(body.events.length, 251);
  assert.equal(new Set(body.events.map((e) => e.id)).size, 251);
  assert.equal(body.complete, false);
  assert.ok(body.issues.some((i) => i.kind === 'missing'));
});
