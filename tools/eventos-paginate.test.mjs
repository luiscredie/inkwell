// Reading every Play Hub page (supabase/functions/rph-events/paginate.js):  node tools/eventos-paginate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchAll, PAGE_SIZE, RETRY_SIZE } from '../supabase/functions/rph-events/paginate.js';

const REAL = JSON.parse(readFileSync(new URL('./fixtures/rph-events-pagination-2026-11-05.json', import.meta.url)));
const kinds = (r) => r.issues.map((i) => i.kind);
const unique = (r) => new Set(r.events.map((e) => e.id)).size === r.events.length;

// the recorded answer: the pages the Play Hub really sent for each page size on 05/11/2026
const recorded = (calls = []) => async (page, size) => {
  calls.push([page, size]);
  const pages = REAL.by_page_size[String(Math.min(size, 250))];
  if (!pages) throw new Error('no recording for ' + size);
  return { count: REAL.count, results: (pages[page - 1] || []).map((id) => ({ id })), next_page_number: page < pages.length ? page + 1 : null };
};

// a fake Play Hub: offset pages over `n` events, page_size capped at 250, and the real bug on demand — at a
// boundary listed in ties[size], the event before and after it swap places between the two pages (same start
// time, no fixed order), so one comes twice and the other never.
function fake(n, { ties = {}, failAt = null, calls = [] } = {}) {
  const base = Array.from({ length: n }, (_, i) => ({ id: 1000 + i }));
  return async (page, asked) => {
    calls.push([page, asked]);
    if (failAt && failAt(page, asked)) throw new Error('play hub 503');
    const size = Math.min(asked, 250), view = base.slice(), b = (page - 1) * size;
    if ((ties[size] || []).includes(b)) [view[b - 1], view[b]] = [view[b], view[b - 1]];
    const results = view.slice(b, b + size);
    return { count: n, results, next_page_number: b + size < n ? page + 1 : null };
  };
}

test('real pages of 05/11/2026: with page_size 100 the Play Hub repeats #968324 and skips #1188577', async () => {
  const pages100 = REAL.by_page_size['100'].flat();
  assert.equal(pages100.length, 428);
  assert.equal(new Set(pages100).size, 427);
  assert.equal(pages100.filter((id) => id === 968324).length, 2);
  assert.ok(!pages100.includes(1188577));
  for (const s of ['250', '200']) assert.equal(new Set(REAL.by_page_size[s].flat()).size, 428, s);
});

test('real pages: the default read (250 a page) gets all 428 in 2 calls, no retry', async () => {
  const calls = [], r = await fetchAll(recorded(calls));
  assert.equal(PAGE_SIZE, 250);
  assert.deepEqual([r.received, r.count, r.complete, calls.length], [428, 428, true, 2]);
  assert.deepEqual(r.issues, []);
});

test('real pages: a read that comes short (100 a page) recovers #1188577 with a second read of other boundaries', async () => {
  const calls = [], r = await fetchAll(recorded(calls), { pageSize: 100, retrySize: 250 });
  assert.equal(r.first_pass, 427);
  assert.deepEqual([r.received, r.complete], [428, true]);
  assert.ok(r.events.some((e) => e.id === 1188577) && unique(r));
  assert.deepEqual(kinds(r), ['retry', 'repeated']);
  assert.equal(r.issues[0].recovered, 1);
  assert.equal(calls.length, 5 + 2);
});

test('more than 500 events: no fixed 5-page limit', async () => {
  const calls = [], r = await fetchAll(fake(1234, { calls }));
  assert.deepEqual([r.received, r.count, r.complete, calls.length], [1234, 1234, true, 5]);
  const big = await fetchAll(fake(3100));
  assert.deepEqual([big.received, big.complete], [3100, true]);   // 13 pages
  assert.ok(unique(big));
});

test('a tie at a page boundary: the repeat is dropped and the skipped event comes back on the retry', async () => {
  const r = await fetchAll(fake(600, { ties: { 250: [250, 500] } }));
  assert.equal(r.first_pass, 598);
  assert.deepEqual([r.received, r.complete], [600, true]);
  assert.ok(unique(r));
  assert.deepEqual(r.issues, [{ kind: 'retry', size: RETRY_SIZE, recovered: 2 }, { kind: 'repeated', repeated: 2 }]);
});

test('still short after the retry: reported as incomplete with the numbers, never hidden', async () => {
  // reads of 250 and 200 trip on different boundaries: the second brings back what the first skipped
  const ok = await fetchAll(fake(700, { ties: { 250: [500], 200: [400] } }));
  assert.deepEqual([ok.received, ok.complete], [700, true]);
  // the same boundary in both reads: one event can't be reached
  const stuck = await fetchAll(fake(700, { ties: { 250: [500] } }), { retrySize: 250 });
  assert.deepEqual([stuck.received, stuck.complete], [699, false]);
  assert.deepEqual(stuck.issues.find((i) => i.kind === 'missing'), { kind: 'missing', count: 700, received: 699, missing: 1 });
  assert.ok(unique(stuck));
});

test('the API stops answering mid-way: keep what came, say it is incomplete', async () => {
  const r = await fetchAll(fake(900, { failAt: (page) => page === 3 }));
  assert.deepEqual([r.received, r.count, r.complete], [500, 900, false]);
  assert.deepEqual(kinds(r), ['error', 'missing']);
  assert.match(r.issues[0].error, /503/);
});

test('the first page fails: an error, as before (the page shows "Tentar de novo")', async () => {
  await assert.rejects(fetchAll(fake(300, { failAt: (page) => page === 1 })), /503/);
});

test('the retry read fails too: what came is kept, the missing event is reported', async () => {
  const r = await fetchAll(fake(600, { ties: { 250: [250] }, failAt: (page, size) => size === 200 && page === 2 }));
  assert.equal(r.received, 599);   // the skipped event (index 250) was on the retry's page 2
  assert.equal(r.complete, false);
  assert.deepEqual(kinds(r), ['error', 'retry', 'missing', 'repeated']);
});

test('safety caps: at most MAX_EVENTS and the time budget, both reported', async () => {
  const cap = await fetchAll(fake(6000));
  assert.deepEqual([cap.received, cap.complete], [5000, false]);
  assert.deepEqual(cap.issues[0], { kind: 'page_cap', pages: 20, size: 250, max_events: 5000 });
  let t = 0; const slow = await fetchAll(fake(2000), { now: () => (t += 10000) });
  assert.equal(slow.complete, false);
  assert.ok(kinds(slow).includes('time_budget'));
  assert.ok(slow.received > 0 && slow.received < 2000);
});
