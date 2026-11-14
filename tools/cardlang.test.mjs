// Idioma das cartas (src/site/cardlang.js): the same rules as supabase/card_langs.sql, and the pasted lists.
//   node --test tools/cardlang.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const here = new URL('.', import.meta.url);
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../src/site/collimport.js', here), 'utf8'), ctx);
vm.runInNewContext(fs.readFileSync(new URL('../src/site/cardlang.js', here), 'utf8'), ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));
const L = ctx.window.INKWELL_CARD_LANG, parse = ctx.window.INKWELL_COLL_IMPORT.parse;
const cat = JSON.parse(fs.readFileSync(new URL('../site/data/cards.json', here), 'utf8'));
const cards = cat.cards.map((c) => ({ id: c.card_id, name: c.name_en, set: c.set_code, num: c.card_number }));
const sets = cat.sets || [];
const plan = (text, col) => plain(L.plan(text, col, cards, sets, parse));
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'none'; };

test('split: copies with and without a language', () => {
  assert.deepEqual(plain(L.split({ n: 3, f: 1, l: { ja: { n: 1, f: 1 } } })), { n: 3, f: 1, l: { ja: { n: 1, f: 1 } }, known: { n: 1, f: 1 }, unknown: { n: 2, f: 0 } });
  assert.deepEqual(plain(L.split({ n: 2, f: 0 })).unknown, { n: 2, f: 0 }, 'an old card: all sem idioma');
  assert.deepEqual(plain(L.split({ n: 1, f: 0, l: { xx: { n: 1 }, en: { n: 0 } } })).l, {}, 'unknown languages and zeros are ignored');
});

test('apply follows the server: add, remove, ask', () => {
  assert.deepEqual(plain(L.apply({ n: 2, f: 1 }, 'n', 1, 'it')), { n: 3, f: 1, l: { it: { n: 1 } } });
  assert.deepEqual(plain(L.apply({ n: 3, f: 1, l: { it: { n: 1 } } }, 'n', -1)), { n: 2, f: 1, l: { it: { n: 1 } } }, 'sem idioma goes first');
  assert.deepEqual(plain(L.apply({ n: 1, f: 0, l: { it: { n: 1 } } }, 'n', -1)), { n: 0, f: 0 }, 'only IT left');
  const mushu = { n: 2, f: 1, l: { en: { n: 1 }, it: { n: 1 } } };
  assert.equal(code(() => L.apply(mushu, 'n', -1)), 'lang_required', 'EN or IT?');
  assert.deepEqual(plain(L.apply(mushu, 'n', -1, 'it')), { n: 1, f: 1, l: { en: { n: 1 } } });
  assert.equal(code(() => L.apply(mushu, 'n', -2, 'it')), 'lang_short');
  assert.deepEqual(plain(L.apply(mushu, 'n', -2)), { n: 0, f: 1 }, 'every copy of the finish: no choice needed');
  assert.deepEqual(plain(L.apply(mushu, 'f', -1)), { n: 2, f: 0, l: { en: { n: 1 }, it: { n: 1 } } }, 'the foil had no language');
});

test('removeChoice: asks only when it must', () => {
  assert.equal(L.removeChoice({ n: 2, f: 0, l: { en: { n: 1 } } }, 'n'), null, 'one sem idioma left');
  assert.equal(L.removeChoice({ n: 1, f: 0, l: { en: { n: 1 } } }, 'n'), null, 'the last copy');
  assert.deepEqual(plain(L.removeChoice({ n: 2, f: 0, l: { en: { n: 1 }, it: { n: 1 } } }, 'n')), [{ lang: 'en', count: 1 }, { lang: 'it', count: 1 }]);
});

test('progress and summary', () => {
  assert.deepEqual(plain(L.progress({ a: { n: 4, f: 1, l: { en: { n: 4 } } }, b: { n: 1, f: 0 } })), { copies: 6, known: 4, unknown: 2, pct: 66 });
  assert.equal(L.summary({ n: 3, f: 1, l: { it: { n: 1 }, en: { n: 1, f: 1 } } }, 'pt', 'en'), 'EN 1 + 1 foil · IT 1 · 1 sem idioma');
});

test('blocks: headings in Portuguese, English or code', () => {
  const b = plain(L.blocks('Inglês\n2 Mushu - Majestic Dragon\n\nItaliano:\n1 Mushu - Majestic Dragon\nJP\n1 Mickey Mouse - Brave Little Tailor'));
  assert.deepEqual(b.map((x) => x.lang), ['en', 'it', 'ja']);
  assert.equal(L.headOf('2 Mushu'), null);
});

const COL = { 'LOR7-137': { n: 3, f: 1 }, 'LOR1-115': { n: 1, f: 0 }, 'LOR1-42': { n: 2, f: 0 } };

test('plan: the example from the Conselho document', () => {
  const p = plan('Inglês\n2 Mushu - Majestic Dragon\n1 Mushu - Majestic Dragon (foil)\n\nItaliano\n1 Mushu - Majestic Dragon\n\nJaponês\n1 Mickey Mouse - Brave Little Tailor', COL);
  assert.deepEqual(p.conflicts, []);
  assert.deepEqual(p.problems, []);
  assert.equal(p.marked, 5);
  assert.deepEqual(p.items.sort((a, b) => (a.card_id + a.lang + a.foil).localeCompare(b.card_id + b.lang + b.foil)), [
    { card_id: 'LOR1-115', lang: 'ja', qty: 1, foil: false },
    { card_id: 'LOR7-137', lang: 'en', qty: 2, foil: false },
    { card_id: 'LOR7-137', lang: 'en', qty: 1, foil: true },
    { card_id: 'LOR7-137', lang: 'it', qty: 1, foil: false },
  ]);
});

test('plan: normal and foil are apart', () => {
  const p = plan('Inglês\n2 Mushu - Majestic Dragon (foil)', COL);
  assert.equal(p.items.length, 0);
  assert.equal(p.conflicts.length, 1, '1 foil sem idioma, the list asks 2');
  assert.equal(p.conflicts[0].k, 'f');
});

test('plan: the same copies in two languages is a conflict, never split by itself', () => {
  const p = plan('Inglês\n3 Mushu - Majestic Dragon\nItaliano\n1 Mushu - Majestic Dragon', COL);
  assert.equal(p.items.length, 0);
  assert.equal(p.conflicts[0].have, 3);
  assert.equal(p.conflicts[0].multi, true);
  assert.deepEqual(p.conflicts[0].asks.map((a) => [a.lang, a.qty]), [['en', 3], ['it', 1]]);
  assert.equal(plan('Inglês\n2 Mushu - Majestic Dragon\nItaliano\n1 Mushu - Majestic Dragon', COL).conflicts.length, 0, 'EN 2 + IT 1 of 3: fine');
});

test('plan: copies already marked are not marked again', () => {
  const p = plan('Italiano\n1 Mushu - Majestic Dragon', { 'LOR7-137': { n: 1, f: 0, l: { en: { n: 1 } } } });
  assert.equal(p.conflicts[0].have, 0);
});

test('plan: a name finds the printing the player owns', () => {
  const p = plan('Inglês\n2 Elsa - Spirit of Winter', { 'LOR1-207': { n: 2, f: 0 } });
  assert.deepEqual(p.items, [{ card_id: 'LOR1-207', lang: 'en', qty: 2, foil: false }]);
});

test('plan: lines it cannot use', () => {
  const p = plan('2 Mushu - Majestic Dragon\nInglês\n1 Carta Que Nao Existe\n1 Stitch - Rock Star', COL);
  assert.deepEqual(p.problems.map((x) => x.reason).sort(), ['no_lang', 'no_match', 'not_owned']);
  assert.equal(p.marked, 0);
});
