// Simulator readiness contract: classification, deck list export, launch URL.
//   node tools/sim-readiness-contract.test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('✓', name); };

function lift(startMarker, fnName) {
  const s = html.indexOf(startMarker);
  assert.ok(s > 0, fnName + ' source not found');
  let i = html.indexOf('{', s), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > s, fnName + ' braces unbalanced');
  const src = html.slice(s, end).replace(new RegExp('^' + fnName), 'function ' + fnName);
  return Function('URLSearchParams', `${src}; return ${fnName};`)(URLSearchParams);
}

const cardSimTier = lift('cardSimTier(card){', 'cardSimTier');
const deckSimReadiness = lift('deckSimReadiness(deck){', 'deckSimReadiness');
const deckToList = lift('deckToList(deck){', 'deckToList');
const simUrlFor = lift('simUrlFor(a,b){', 'simUrlFor');

// ---------- classification ----------
check('a card with no abilities is vanilla', () => {
  assert.equal(cardSimTier({ name_en: 'A' }), 'vanilla');
  assert.equal(cardSimTier({ name_en: 'A', abilities: [] }), 'vanilla');
});
check('a card whose abilities are all keywords is mechanical', () => {
  assert.equal(cardSimTier({ abilities: [{ type: 'keyword', name: 'Evasive' }, { type: 'keyword', name: 'Rush' }] }), 'keyword');
});
check('one non-keyword ability makes the whole card hand-coded', () => {
  for (const t of ['triggered', 'static', 'activated', 'rules_text']) {
    const c = { abilities: [{ type: 'keyword', name: 'Shift' }, { type: t, effect: 'x' }] };
    assert.equal(cardSimTier(c), 'manual', t + ' cannot be auto-generated');
  }
});
check('a null or malformed card does not throw', () => {
  assert.equal(cardSimTier(null), 'vanilla');
  assert.equal(cardSimTier({ abilities: [null] }), 'manual', 'an unreadable ability is never assumed safe');
});

// ---------- readiness ----------
const CARDS = {
  v: { card_id: 'v', name_en: 'Vanilla Guy' },
  k: { card_id: 'k', name_en: 'Keyword Guy', abilities: [{ type: 'keyword', name: 'Evasive' }] },
  k2: { card_id: 'k2', name_en: 'Shifty', abilities: [{ type: 'keyword', name: 'Shift', parameter: '5 {i}' }] },
  m: { card_id: 'm', name_en: 'Complex Guy', abilities: [{ type: 'triggered', effect: 'Draw a card.' }] },
  m2: { card_id: 'm2', name_en: 'Another Complex', abilities: [{ type: 'static', effect: 'x' }] }
};
function ctx(cards) {
  return {
    byId: CARDS, state: { decks: [] },
    deckEntries(deck) {
      return Object.entries((deck && deck.cards) || {})
        .map(([id, ct]) => ({ card: CARDS[id], count: ct })).filter(x => x.card);
    },
    cardSimTier, deckSimReadiness, deckToList, simUrlFor,
    _deck: { id: 'd', name: 'D', cards }
  };
}
const read = (cards) => { const c = ctx(cards); return deckSimReadiness.call(c, c._deck); };

check('an empty deck has no readiness rather than 0%', () => {
  assert.equal(read({}), null, 'zero cards is unknown, not unready');
});
check('a deck of vanilla and keyword cards is playable', () => {
  const r = read({ v: 4, k: 4, k2: 2 });
  assert.equal(r.playable, true);
  assert.equal(r.pct, 100);
  assert.equal(r.blockedCopies, 0);
});
check('one hand-coded card blocks the deck', () => {
  const r = read({ v: 4, m: 1 });
  assert.equal(r.playable, false, 'the engine would silently misplay that card');
  assert.equal(r.blockedCopies, 1);
  assert.equal(r.blockedNames, 1);
});
check('the percentage counts copies, not distinct names', () => {
  const r = read({ v: 9, m: 1 });
  assert.equal(r.total, 10);
  assert.equal(r.readyCopies, 9);
  assert.equal(r.pct, 90, 'one blocked name of two is still 90% of copies');
});
check('groups list each card with its count', () => {
  const r = read({ v: 4, k: 3, m: 2 });
  assert.deepEqual(r.groups.vanilla.map(x => x.name), ['Vanilla Guy']);
  assert.deepEqual(r.groups.keyword.map(x => x.name), ['Keyword Guy']);
  assert.deepEqual(r.groups.manual.map(x => x.name), ['Complex Guy']);
  assert.equal(r.groups.manual[0].count, 2);
});
check('keyword cards report their keywords with parameters', () => {
  const r = read({ k2: 4 });
  assert.deepEqual(r.groups.keyword[0].kws, ['Shift 5 {i}'], 'the parameter is what makes it mechanical');
});
check('the biggest blocker sorts first', () => {
  const r = read({ m: 1, m2: 4 });
  assert.equal(r.groups.manual[0].name, 'Another Complex', 'four copies matter more than one');
});

// ---------- deck list export ----------
check('the exported list is one line per card, count first', () => {
  const c = ctx({ v: 4, k: 2 });
  const txt = deckToList.call(c, c._deck);
  assert.deepEqual(txt.split('\n'), ['2 Keyword Guy', '4 Vanilla Guy']);
});
check('the export carries no set-number suffix', () => {
  const c = ctx({ v: 4 });
  assert.doesNotMatch(deckToList.call(c, c._deck), /\(\d+-\d+\)/,
    'the suffix is exactly what the simulator parser used to choke on');
});
check('the launch URL passes both decks as parameters', () => {
  const c = ctx({ v: 4 });
  const url = simUrlFor.call(c, c._deck, c._deck);
  assert.match(url, /^sim\/game\.html\?/);
  const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  assert.equal(q.get('deck1'), '4 Vanilla Guy');
  assert.equal(q.get('deck2'), '4 Vanilla Guy');
});
check('a missing opponent deck omits its parameter instead of sending empty', () => {
  const c = ctx({ v: 4 });
  const q = new URLSearchParams(simUrlFor.call(c, c._deck, null).split('?')[1]);
  assert.equal(q.has('deck2'), false);
});
check('the URL is relative, so it works from a project subpath', () => {
  const c = ctx({ v: 4 });
  assert.ok(!simUrlFor.call(c, c._deck, null).startsWith('/'), 'an absolute path breaks GitHub Pages project sites');
});

// ---------- wiring ----------
check('readiness renders in the deck detail view', () => {
  assert.match(html, /<sc-if value="\{\{ dd\.hasSim \}\}"/);
  assert.match(html, /list="\{\{ dd\.sim\.blocked \}\}"/);
  assert.match(html, /\{\{ dd\.sim\.pct \}\}/);
});
check('the blocked list is collapsed by default', () => {
  assert.match(html, /simDetailOpen: false/);
  assert.match(html, /<sc-if value="\{\{ dd\.sim\.open \}\}"/);
});
check('the play button only appears with a second deck to face', () => {
  assert.match(html, /<sc-if value="\{\{ dd\.sim\.hasOpp \}\}"/);
  assert.match(html, /hasOpp:!!opp/);
});
check('the opponent picker is labelled for screen readers', () => {
  const i = html.indexOf('{{ dd.sim._onOpp }}');
  assert.match(html.slice(i - 60, i + 200), /aria-label="\{\{ dd\.sim\.oppLabel \}\}"/);
});
check('the simulator opens in a new tab without window access', () => {
  assert.match(html, /window\.open\(this\.simUrlFor\(a,b\),'_blank','noopener'\)/);
});
check('the readiness note explains what the number means', () => {
  assert.match(html, /\{\{ dd\.sim\.note \}\}/);
  assert.equal((html.match(/simNote:/g) || []).length, 2);
});
check('nothing claims to auto-generate card rules', () => {
  const i = html.indexOf('SIM_KEYWORDS:');
  const block = html.slice(i - 500, i);
  assert.match(block, /Nao "codifica" carta/, 'the comment must state the limit honestly');
});
check('every new key exists in EN and PT', () => {
  for (const k of ['simTitle', 'simReady', 'simBlocked', 'simReadyCopies', 'simBlockedLabel',
    'simKeywordLabel', 'simNote', 'simOpponent', 'simPlay']) {
    assert.equal((html.match(new RegExp('\\b' + k + ':', 'g')) || []).length, 2, k);
  }
});
check('site/index.html and Inkwell.dc.html stay byte-identical', () => {
  assert.equal(html, fs.readFileSync(new URL('../Inkwell.dc.html', import.meta.url), 'utf8'));
});

console.log(`\n${passed} passed`);
