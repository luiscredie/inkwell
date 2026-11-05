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
  assert.deepEqual(body.map((s) => s.id), [17531, 17617, 17543]);   // 6 rows (Lorcana + Riftbound) -> 3 stores
  const s = body.find((x) => x.id === 17617);
  assert.equal(s.city, 'Campinas');
  assert.ok(!/\n/.test(s.address) && /Av Brasil 1456/.test(s.address));
  assert.equal(calls.at(-1).searchParams.get('search'), 'Colecionaveis');
  assert.deepEqual((await get('stores=a')).body, []);   // too short: no call
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
