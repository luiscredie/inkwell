// Event types for Eventos (supabase/functions/rph-events/categories.js):  node tools/eventos-categories.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, checkObserved, OBSERVED, OBSERVED_AT } from '../supabase/functions/rph-events/categories.js';

const SET = 'b6f02bc3-b546-4672-94e3-d1e7d5d075a3', PRE = 'e476de35-1806-4a10-9b7b-876a26ebb93a', RUSH = '6f672fc7-21cd-4b60-85a5-db97e1bfb3bf', CELEB = '823bdeec-b59e-47b0-87d7-be6fe7c2f55c';
const TEMPLATES = {   // as /event-configuration-templates/ answered on 05/11/2026 (part)
  '810d4ea0-3ea8-4c67-9381-4c4840330cf8': 'Weekly Play (Constructed)',
  '7cd013ab-7eb6-4adc-9563-ce2a073628e8': 'Weekly Play (Draft)',
  '4a011d41-38f2-4860-90e4-62843c2ec2dd': 'Weekly Play (Sealed)',
  '90ffa746-317d-4c39-b825-5d3f2041eaaa': 'Learn-to-Play',
};
const ev = (id, tpl, name) => ({ id, name, event_configuration_template: tpl });
const run = (events, templates = TEMPLATES) => { const { suspended, divergences } = checkObserved(events); return { divergences, out: events.map((e) => ({ id: e.id, ...classify(e.event_configuration_template, templates, suspended) })) }; };

test('the four observed ids are documented with category, count, evidence and date', () => {
  assert.equal(OBSERVED_AT, '2026-11-05');
  assert.deepEqual(Object.keys(OBSERVED).sort(), [SET, PRE, RUSH, CELEB].sort());
  for (const o of Object.values(OBSERVED)) { assert.ok(o.category && o.events > 0 && o.evidence); }
});

test('current Pré-release and Set Championship events are recognised, marked "observed"', () => {
  const { out, divergences } = run([ev(1, PRE, 'Saturday Morning Into the Inkdark Prerelease (Sealed)'), ev(2, PRE, 'Evento de Lançamento de Into the Inkdark!'),
    ev(3, RUSH, 'Sunday Morning Into the Inkdark Prerelease (Pack Rush)'), ev(4, SET, 'Gold House Hyperia City Set Championship'), ev(5, CELEB, 'World Championship Celebration: Infinity')]);
  assert.deepEqual(divergences, []);
  assert.deepEqual(out.map((o) => [o.category, o.category_source, o.template_name]), [['prerelease', 'observed', null], ['prerelease', 'observed', null], ['prerelease', 'observed', null], ['set_championship', 'observed', null], ['celebration', 'observed', null]]);
  assert.equal(out[3].template_id, SET);
});

test('Weekly Play Constructed, Draft and Sealed are all Weekly Play, from the API name', () => {
  const { out } = run(Object.keys(TEMPLATES).slice(0, 3).map((t, i) => ev(i, t, 'qualquer nome')));
  assert.deepEqual(out.map((o) => [o.category, o.category_source]), Array(3).fill(['weekly', 'api']));
  assert.deepEqual(out.map((o) => o.template_name), ['Weekly Play (Constructed)', 'Weekly Play (Draft)', 'Weekly Play (Sealed)']);
});

test('an unknown id goes to "other" / unknown, even when the event name looks like a known type', () => {
  const { out } = run([ev(1, '00000000-0000-4000-8000-000000000000', 'Lorwyn Set Championship Prerelease'), ev(2, null, 'Weekly Play')]);
  assert.deepEqual(out.map((o) => [o.category, o.category_source]), [['other', 'unknown'], ['other', 'unknown']]);
  assert.equal(out[0].template_id, '00000000-0000-4000-8000-000000000000');
});

test('an API template with another name stays "other" but keeps its name', () => {
  const { out } = run([ev(1, '90ffa746-317d-4c39-b825-5d3f2041eaaa', 'WEEKLY PLAY - LORCANA')]);
  assert.deepEqual(out[0], { id: 1, template_id: '90ffa746-317d-4c39-b825-5d3f2041eaaa', template_name: 'Learn-to-Play', category: 'other', category_source: 'api' });
});

test('an observed id with an incompatible event name is suspended (logged), the others are not', () => {
  // the real case on 05/11/2026: #1007371 "liga" under the Set Championship id
  const { out, divergences } = run([ev(1, SET, 'Hyperia City Set Championship'), ev(1007371, SET, 'liga'), ev(3, PRE, 'Into the Inkdark Prerelease'), ev(4, CELEB, 'Weekly Play da loja')]);
  assert.deepEqual(divergences.map((d) => [d.template_id, d.category, d.mismatched.map((m) => m.id)]), [[SET, 'set_championship', [1007371]], [CELEB, 'celebration', [4]]]);
  assert.deepEqual(out.map((o) => [o.id, o.category, o.category_source]), [[1, 'other', 'unknown'], [1007371, 'other', 'unknown'], [3, 'prerelease', 'observed'], [4, 'other', 'unknown']]);
});

test('names that name no type do not suspend an observed id', () => {
  assert.deepEqual(checkObserved([ev(1, PRE, 'Torneio da Forja'), ev(2, SET, 'Campeonato de sábado')]).divergences, []);
});

test('the API wins over the observed table when it starts listing an id', () => {
  const { out } = run([ev(1, SET, 'Hyperia City Set Championship')], { ...TEMPLATES, [SET]: 'Set Championship' });
  assert.deepEqual([out[0].category, out[0].category_source, out[0].template_name], ['set_championship', 'api', 'Set Championship']);
});

test('no event is lost: every input comes out, with or without the templates endpoint', () => {
  const events = [ev(1, SET, 'x'), ev(2, PRE, 'y'), ev(3, '810d4ea0-3ea8-4c67-9381-4c4840330cf8', 'z'), ev(4, 'nope', 'w'), ev(5, undefined, 'v')];
  for (const t of [TEMPLATES, {}]) {
    const { out } = run(events, t);
    assert.deepEqual(out.map((o) => o.id), [1, 2, 3, 4, 5]);
    assert.ok(out.every((o) => ['prerelease', 'set_championship', 'weekly', 'celebration', 'other'].includes(o.category)));
  }
  assert.equal(run(events, {}).out[2].category_source, 'unknown');   // templates down: Weekly Play falls to "other", not out
});
