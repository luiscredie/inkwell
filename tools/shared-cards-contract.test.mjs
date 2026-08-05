// M2.3 Shared Cards & Portfolio UX contract (deterministic, no deps).
//   node tools/shared-cards-contract.test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('✓', name); };

// Extract one class method by brace matching, so neighbouring methods never leak in.
function lift(startMarker, fnName, Component) {
  const s = html.indexOf(startMarker);
  assert.ok(s > 0, fnName + ' source not found');
  let i = html.indexOf('{', s), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > s, fnName + ' braces unbalanced');
  const src = html.slice(s, end).replace(/^static\s+/, '').replace(new RegExp('^' + fnName), 'function ' + fnName);
  // Component is injected so lifted methods can call the static optimizer.
  return Function('Component', `${src}; return ${fnName};`)(Component);
}

const computeDeckPortfolioPlan = lift('static computeDeckPortfolioPlan(', 'computeDeckPortfolioPlan');
const Component = { computeDeckPortfolioPlan };
const sharedMatrix = lift('sharedMatrix(){', 'sharedMatrix', Component);
const deckNeeds = lift('deckNeeds(deck){', 'deckNeeds', Component);
const portfolioInventory = lift('portfolioInventory(){', 'portfolioInventory', Component);

// ---------- harness ----------
const CARDS = [
  { card_id: 'a1', name_en: 'Shared Star', set_code: 'TFC' },
  { card_id: 'b1', name_en: 'Solo Act', set_code: 'TFC' },
  { card_id: 'c1', name_en: 'Other Solo', set_code: 'TFC' }
];
function ctx(decks, collection) {
  const byId = {}; for (const c of CARDS) byId[c.card_id] = c;
  return {
    cards: CARDS, byId,
    state: { decks, collection },
    nameKey(n) { return String(n || '').toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim(); },
    priceOr0() { return 0; },
    t(k, p) { return k + (p ? ':' + JSON.stringify(p) : ''); },
    deckNeeds, portfolioInventory, sharedMatrix
  };
}
const D = (id, name, cards, extra) => Object.assign({ id, name, cards }, extra || {});

// ---------- 1. no decks ----------
check('no decks yields an explicit empty result, not a crash', () => {
  const r = sharedMatrix.call(ctx([], {}));
  assert.equal(r.empty, true);
  assert.deepEqual(r.decks, []);
  assert.equal(r.contestedTotal, 0);
});

// ---------- 2. two decks contesting one card ----------
// Each deck wants 4 Shared Star. Only 4 copies owned. Deck A also wants Solo Act (owned).
const contested = ctx(
  [D('dA', 'Aurora', { a1: 4, b1: 2 }), D('dB', 'Belle', { a1: 4, c1: 2 })],
  { a1: { n: 4, f: 0 }, b1: { n: 2, f: 0 }, c1: { n: 2, f: 0 } }
);
const RC = sharedMatrix.call(contested);

check('every deck is represented', () => {
  assert.equal(RC.decks.length, 2);
  assert.deepEqual(RC.decks.map(d => d.name), ['Aurora', 'Belle']);
});
check('the deck-first block lists all of that deck\'s cards', () => {
  const a = RC.decks.find(d => d.name === 'Aurora');
  assert.equal(a.cardCount, 2);
  assert.deepEqual(a.rows.map(r => r.name).sort(), ['Shared Star', 'Solo Act']);
});
check('a card used by 2+ decks is marked contested', () => {
  const a = RC.decks.find(d => d.name === 'Aurora');
  const shared = a.rows.find(r => r.name === 'Shared Star');
  const solo = a.rows.find(r => r.name === 'Solo Act');
  assert.equal(shared.contested, true);
  assert.equal(solo.contested, false);
});
check('an uncontested card is not reported as shared', () => {
  const b = RC.decks.find(d => d.name === 'Belle');
  assert.equal(b.rows.find(r => r.name === 'Other Solo').contested, false);
});
check('demand across decks exceeds inventory, so the card is scarce', () => {
  const shared = RC.decks[0].rows.find(r => r.name === 'Shared Star');
  assert.equal(shared.owned, 4);
  assert.equal(shared.demandTotal, 8);
  assert.equal(shared.scarce, true);
});
check('exactly one of the two decks is left short', () => {
  const rows = RC.decks.map(d => d.rows.find(r => r.name === 'Shared Star'));
  const shortCount = rows.filter(r => r.short > 0).length;
  const okCount = rows.filter(r => r.short === 0 && r.alloc === 4).length;
  assert.equal(shortCount, 1, 'one deck must be short');
  assert.equal(okCount, 1, 'the other must be fully allocated');
});
check('allocation never exceeds what is owned', () => {
  const rows = RC.decks.map(d => d.rows.find(r => r.name === 'Shared Star'));
  assert.equal(rows.reduce((s, r) => s + r.alloc, 0), 4);
});
check('the reverse path names the competing decks', () => {
  const a = RC.decks.find(d => d.name === 'Aurora');
  const shared = a.rows.find(r => r.name === 'Shared Star');
  assert.equal(shared.hasCompetitors, true);
  assert.deepEqual(shared.competitors.map(c => c.deck), ['Belle']);
  assert.equal(shared.competitors[0].need, 4);
});
check('a contested scarce card carries a recommendation with a reason', () => {
  const shared = RC.decks[0].rows.find(r => r.name === 'Shared Star');
  assert.equal(shared.hasRec, true);
  assert.ok(shared.recDeck, 'a deck must be named');
  assert.match(shared.recWhy, /^sharedWhy/);
});
check('an uncontested card carries no recommendation', () => {
  const solo = RC.decks[0].rows.find(r => r.name === 'Solo Act');
  assert.equal(solo.hasRec, false);
  assert.equal(solo.recDeck, '');
});
check('short rows sort above the rest', () => {
  const short = ctx(
    [D('dA', 'Aurora', { a1: 4, b1: 2 }), D('dB', 'Belle', { a1: 4 })],
    { a1: { n: 1, f: 0 }, b1: { n: 2, f: 0 } }
  );
  const d = sharedMatrix.call(short).decks[0];
  assert.equal(d.rows[0].short > 0, true, 'the short card must come first');
});
check('totals aggregate across decks', () => {
  assert.equal(RC.contestedTotal, 2, 'Shared Star is contested from both sides');
  assert.equal(RC.shortTotal, 1);
});

// ---------- 3. pinned priority changes who is recommended ----------
check('a pinned deck is recommended and the reason says so', () => {
  const pinned = ctx(
    [D('dA', 'Aurora', { a1: 4 }), D('dB', 'Belle', { a1: 4 }, { portfolioPriority: 5 })],
    { a1: { n: 4, f: 0 } }
  );
  const r = sharedMatrix.call(pinned);
  const row = r.decks.find(d => d.name === 'Aurora').rows.find(x => x.name === 'Shared Star');
  assert.equal(row.recDeck, 'Belle');
  assert.equal(row.recWhy, 'sharedWhyPinned');
});

// ---------- 4. enough copies for everyone ----------
check('shared but sufficient reports shared, never short', () => {
  const plenty = ctx(
    [D('dA', 'Aurora', { a1: 2 }), D('dB', 'Belle', { a1: 2 })],
    { a1: { n: 4, f: 0 } }
  );
  const r = sharedMatrix.call(plenty);
  for (const d of r.decks) {
    const row = d.rows[0];
    assert.equal(row.contested, true);
    assert.equal(row.scarce, false);
    assert.equal(row.short, 0);
    assert.equal(row.state, 'shared');
    assert.equal(row.hasRec, false, 'no recommendation is needed when nobody loses');
  }
  assert.equal(r.shortTotal, 0);
});

// ---------- 5. duplicate deck names stay distinguishable ----------
check('two decks with the same name are disambiguated', () => {
  const dupe = ctx(
    [D('dA', 'Aurora', { a1: 4 }), D('dB', 'Aurora', { a1: 4 })],
    { a1: { n: 4, f: 0 } }
  );
  const names = sharedMatrix.call(dupe).decks.map(d => d.name);
  assert.equal(new Set(names).size, 2, 'names must be unique in the UI');
  assert.deepEqual(names, ['Aurora · 1', 'Aurora · 2']);
});

// ---------- 6. reprints pool by name ----------
check('reprints of the same card pool into one identity', () => {
  const cards = CARDS.concat([{ card_id: 'a2', name_en: 'Shared Star', set_code: 'LOR2' }]);
  const c = ctx([D('dA', 'Aurora', { a1: 2, a2: 2 })], { a1: { n: 2, f: 0 }, a2: { n: 2, f: 0 } });
  c.cards = cards; c.byId.a2 = cards[cards.length - 1];
  const d = sharedMatrix.call(c).decks[0];
  assert.equal(d.rows.length, 1, 'both printings are one row');
  assert.equal(d.rows[0].need, 4);
  assert.equal(d.rows[0].owned, 4);
  assert.equal(d.rows[0].short, 0);
});

// ---------- 7. the overview deck switcher is no longer truncated ----------
check('overview lists every other deck, not just four', () => {
  assert.match(html, /hasDeckSwitch:st\.decks\.length>1, others:st\.decks\.filter\(d=>d\.id!==ad\.id\)\.map\(/);
  assert.doesNotMatch(html, /others:st\.decks\.filter\(d=>d\.id!==ad\.id\)\.slice\(0,4\)/);
});

// ---------- 8. UI wiring ----------
check('the matrix renders deck-first inside the Decks view', () => {
  const s = html.indexOf('<sc-if value="{{ isDecks }}"');
  const e = html.indexOf('list="{{ deckCards }}"', s);
  const block = html.slice(s, e);
  assert.match(block, /list="\{\{ smDecks \}\}"/, 'the matrix must be in the Decks view');
  assert.match(block, /list="\{\{ sd\.rows \}\}"/);
  assert.match(block, /list="\{\{ r\.competitors \}\}"/);
  assert.match(block, /\{\{ r\.recText \}\}/);
});
check('rows and deck headers are 44px touch targets', () => {
  const s = html.indexOf('list="{{ smDecks }}"');
  const block = html.slice(s, html.indexOf('list="{{ deckCards }}"', s));
  assert.equal((block.match(/min-height:44px/g) || []).length >= 2, true);
});
check('the show-all toggle exists for the full inventory view', () => {
  assert.match(html, /\{\{ smToggleAll \}\}/);
  assert.match(html, /sharedAllCards: false/);
  assert.match(html, /st\.sharedAllCards\?d\.rows:d\.rows\.filter\(r=>r\.contested\)/);
});
check('every new key exists in EN and PT', () => {
  for (const k of ['smTitle', 'smSummaryShort', 'smSummaryShared', 'smSummaryClear', 'smShowAll', 'smOnlyShared',
    'smSharedWith', 'smDeckShort', 'smDeckShared', 'smDeckClear', 'smNoShared', 'smRecommend',
    'sharedWhyPinned', 'sharedWhyCompletes', 'sharedWhySatisfied', 'sharedWhyFewest']) {
    assert.equal((html.match(new RegExp(k + ':', 'g')) || []).length, 2, k);
  }
});

// ---------- 9. mirror ----------
check('site/index.html and Inkwell.dc.html stay byte-identical', () => {
  assert.equal(html, fs.readFileSync(new URL('../Inkwell.dc.html', import.meta.url), 'utf8'));
});

console.log(`\n${passed} passed`);
