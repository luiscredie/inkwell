// Event types for Eventos (supabase/functions/rph-events/categories.js):  node tools/eventos-categories.test.mjs
// Uses the real Play Hub answer of 05/11/2026 (tools/fixtures/rph-events-2026-11-05.json) where it matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { categorize, classify, reviewObserved, OBSERVED, OBSERVED_AT } from '../supabase/functions/rph-events/categories.js';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/rph-events-2026-11-05.json', import.meta.url)));
const TPL = Object.fromEntries(FIX.templates.map((t) => [t.id, t.name]));
const RAW = FIX.pages.flatMap((p) => p.results);
const uniq = (list) => { const s = new Set(); return list.filter((e) => !s.has(e.id) && s.add(e.id)); };   // as rph-events does
const ALL = uniq(RAW);
const SET = 'b6f02bc3-b546-4672-94e3-d1e7d5d075a3', PRE = 'e476de35-1806-4a10-9b7b-876a26ebb93a', RUSH = '6f672fc7-21cd-4b60-85a5-db97e1bfb3bf', CELEB = '823bdeec-b59e-47b0-87d7-be6fe7c2f55c';
const ev = (id, tpl, name, store = 'Loja ' + id) => ({ id, name, event_configuration_template: tpl, store: { id: store, name: store } });

test('the four observed ids are documented with category, count, evidence and date', () => {
  assert.equal(OBSERVED_AT, '2026-11-05');
  assert.deepEqual(Object.keys(OBSERVED).sort(), [SET, PRE, RUSH, CELEB].sort());
  for (const [id, o] of Object.entries(OBSERVED)) {
    assert.ok(o.category && o.evidence && o.status === 'active');
    assert.equal(ALL.filter((e) => e.event_configuration_template === id).length, o.events, id);   // counts match the snapshot
    assert.ok(!(id in TPL), 'not listed by the templates endpoint');
  }
});

test('real data: all 25 events of the Set Championship template are Set Championship, #1007371 "liga" included', () => {
  const set = ALL.filter((e) => e.event_configuration_template === SET).map((e) => ({ id: e.id, ...categorize(e, TPL) }));
  assert.equal(set.length, 25);
  assert.ok(set.every((c) => c.category === 'set_championship' && c.category_source === 'observed'));
  assert.deepEqual(set.filter((c) => c.name_divergence).map((c) => c.id), [1007371]);
});

test('real data: #1007371 raises a divergence for investigation, the template is not suspended', () => {
  const d = reviewObserved(ALL, TPL);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0], { template_id: SET, category: 'set_championship', events: 25, stores: 23, divergent: [{ id: 1007371, name: 'liga', store: 'Garbosa TCG' }], divergent_stores: 1, share: 0.04, needs_review: false });
});

test('real data: current Pré-release events are Pré-release; Weekly Play Constructed, Draft and Sealed are Weekly Play', () => {
  const of = (tpl) => ALL.filter((e) => e.event_configuration_template === tpl).map((e) => categorize(e, TPL));
  for (const tpl of [PRE, RUSH]) assert.ok(of(tpl).every((c) => c.category === 'prerelease' && c.category_source === 'observed' && !c.name_divergence));
  assert.equal(of(PRE).length + of(RUSH).length, 30);
  for (const name of ['Weekly Play (Constructed)', 'Weekly Play (Draft)', 'Weekly Play (Sealed)']) {
    const id = FIX.templates.find((t) => t.name === name).id;
    assert.deepEqual(classify(id, TPL), { template_id: id, template_name: name, category: 'weekly', category_source: 'api' });
  }
  assert.ok(ALL.every((e) => e.event_type === 'LOCALS'), 'event_type says nothing about the category');
});

test('real data: no event is lost, every one gets a category; the one repeated across pages is counted once', () => {
  assert.equal(RAW.length, 428);
  assert.equal(ALL.length, 427);   // #968324 came on pages 1 and 2
  const out = ALL.map((e) => categorize(e, TPL));
  assert.equal(out.length, ALL.length);
  const n = {}; for (const c of out) n[c.category] = (n[c.category] || 0) + 1;
  assert.deepEqual(n, { weekly: 349, set_championship: 25, prerelease: 30, celebration: 15, other: 8 });
});

test('the same event gets the same category per page, in another location search and in the single lookup', () => {
  const full = new Map(ALL.map((e) => [e.id, categorize(e, TPL)]));
  for (const p of FIX.pages) for (const e of p.results) assert.deepEqual(categorize(e, TPL), full.get(e.id), `page ${p.page} #${e.id}`);
  const nearer = ALL.filter((_, i) => i % 3 === 0);   // a smaller radius returns a subset, in another order
  for (const e of nearer.reverse()) assert.deepEqual(categorize(e, TPL), full.get(e.id));
  for (const e of ALL) assert.deepEqual(categorize(e, TPL), full.get(e.id), `lookup #${e.id}`);   // ?id= runs it on one event
});

test('an unknown id goes to "other" / unknown, even when the event name looks like a known type', () => {
  const out = [ev(1, '00000000-0000-4000-8000-000000000000', 'Lorwyn Set Championship Prerelease'), ev(2, null, 'Weekly Play')].map((e) => categorize(e, TPL));
  assert.deepEqual(out.map((o) => [o.category, o.category_source, !!o.name_divergence]), [['other', 'unknown', false], ['other', 'unknown', false]]);
  assert.equal(out[0].template_id, '00000000-0000-4000-8000-000000000000');
});

test('divergent names never change the category; needs_review only when the disagreement is spread and large', () => {
  const one = reviewObserved([ev(1, CELEB, 'Celebration'), ev(2, CELEB, 'Weekly Play da loja', 'A'), ev(3, CELEB, 'Weekly Play', 'A')]);
  assert.equal(one[0].needs_review, false, 'two names, one store');
  const many = [ev(1, CELEB, 'World Championship Celebration'), ev(2, CELEB, 'Weekly Play', 'A'), ev(3, CELEB, 'Liga de sábado', 'B')];
  assert.equal(reviewObserved(many)[0].needs_review, true, 'two stores, 2/3 of the names');
  assert.ok(many.map((e) => categorize(e)).every((c) => c.category === 'celebration' && c.category_source === 'observed'));
  assert.deepEqual(reviewObserved([ev(1, PRE, 'Torneio da Forja'), ev(2, SET, 'Campeonato de sábado')]), [], 'names that name no type are neutral');
});

test('the API wins over the observed table when it starts listing an id; a suspended id would go to Outros', () => {
  assert.deepEqual(classify(SET, { ...TPL, [SET]: 'Set Championship' }), { template_id: SET, template_name: 'Set Championship', category: 'set_championship', category_source: 'api' });
  const saved = OBSERVED[SET].status;
  try { OBSERVED[SET].status = 'suspended'; assert.deepEqual(classify(SET, TPL), { template_id: SET, template_name: null, category: 'other', category_source: 'unknown' }); }
  finally { OBSERVED[SET].status = saved; }
});

test('templates endpoint down: API types fall to Outros, observed ones keep their type, nothing is lost', () => {
  const out = ALL.map((e) => categorize(e, {}));
  assert.equal(out.length, 427);
  assert.equal(out.filter((c) => c.category === 'set_championship').length, 25);
  assert.equal(out.filter((c) => c.category === 'other' && c.category_source === 'unknown').length, 357);
});
