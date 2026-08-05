// M2.4 Meta-to-Collection Advisor contract (deterministic, no deps).
//   node tools/meta-advisor-contract.test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('✓', name); };

function lift(startMarker, fnName, scope) {
  const s = html.indexOf(startMarker);
  assert.ok(s > 0, fnName + ' source not found');
  let i = html.indexOf('{', s), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > s, fnName + ' braces unbalanced');
  const src = html.slice(s, end).replace(/^static\s+/, '').replace(new RegExp('^' + fnName), 'function ' + fnName);
  const names = Object.keys(scope || {});
  return Function(...names, `${src}; return ${fnName};`)(...names.map(n => scope[n]));
}

const metaCoverage = lift('metaCoverage(){', 'metaCoverage');
const metaCardFor = lift('metaCardFor(entry){', 'metaCardFor');
const deckNeeds = lift('deckNeeds(deck){', 'deckNeeds');
const portfolioInventory = lift('portfolioInventory(){', 'portfolioInventory');

// ---------- harness ----------
const CARDS = [
  { card_id: 'x1', name_en: 'Alpha Card', set_code: 'LOR12', ink_cost: 2, type: 'Character', ink: 'Amber' },
  { card_id: 'x2', name_en: 'Alpha Card', set_code: 'LOR12', ink_cost: 2, type: 'Character', ink: 'Amber' }, // reprint
  { card_id: 'y1', name_en: 'Beta Card', set_code: 'LOR13', ink_cost: 3, type: 'Character', ink: 'Ruby' },
  { card_id: 'z1', name_en: 'Gamma Card', set_code: 'LOR13', ink_cost: 3, type: 'Character', ink: 'Ruby' },
  { card_id: 'w1', name_en: 'Owned Sub', set_code: 'LOR13', ink_cost: 3, type: 'Character', ink: 'Ruby' }
];
const PRICES = { x1: 5, x2: 5, y1: 10, z1: 2, w1: 1 };

function ctx(collection, decks, meta) {
  const byId = {}; for (const c of CARDS) byId[c.card_id] = c;
  return {
    cards: CARDS, byId, metaDecks: meta,
    state: { collection, decks: decks || [], lang: 'en', wishlist: {} },
    nameKey(n) { return String(n || '').toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim(); },
    cardByName(n) { const k = this.nameKey(n); return CARDS.find(c => this.nameKey(c.name_en) === k) || null; },
    inkList(c) { return c && c.ink ? [c.ink] : []; },
    priceOr0(c) { return (c && PRICES[c.card_id]) || 0; },
    price(c) { return (c && PRICES[c.card_id]) != null ? PRICES[c.card_id] : null; },
    hasRealPrice(c) { return !!(c && PRICES[c.card_id]); },
    fmt(v) { return '$' + Number(v || 0).toFixed(2); },
    fmtOrDash(v) { return v == null ? '—' : '$' + Number(v).toFixed(2); },
    ligaUrl() { return 'https://example.test'; },
    deckNeeds, portfolioInventory, metaCardFor, metaCoverage
  };
}
const META = {
  generated_at: '2026-07-29T15:00:00Z',
  sources: [{ name: 'Dreamborn.ink' }, { name: 'Duels.ink' }],
  decks: [{
    deck_id: 'm1', name: 'Toys', creator: 'Inkkery', inks: ['Amber', 'Emerald'], archetypes: ['Aggro'],
    source_url: 'https://dreamborn.ink/decks/m1', source_type: 'community_popular',
    evidence: { likes: 921, views: 53600, tournament_result: null },
    confidence: { level: 'community_reference', score: 0.66 },
    work_in_progress: true, card_count: 8,
    strategy: { en: { tagline: 'EN tagline', how_to_play: 'EN how', mulligan: 'EN mull', difficulty: 'beginner' },
                pt: { tagline: 'PT tagline', how_to_play: 'PT how', mulligan: 'PT mull', difficulty: 'iniciante' } },
    cards: [
      { card_name: 'Alpha Card', canonical_key: 'alpha card', quantity: 4, card_ids: ['x1', 'x2'], rotation: { legal: true } },
      { card_name: 'Beta Card', canonical_key: 'beta card', quantity: 4, card_ids: ['y1'], rotation: { legal: true } }
    ],
    rotation: { legal: true }
  }]
};

// ---------- 1. absent or empty data is inert ----------
check('no meta dataset returns null instead of throwing', () => {
  assert.equal(metaCoverage.call(ctx({}, [], null)), null);
  assert.equal(metaCoverage.call(ctx({}, [], { decks: [] })), null);
});
check('the loader never makes a missing file fatal', () => {
  const s = html.indexOf('async loadMetaDecks()');
  const body = html.slice(s, html.indexOf('metaCardFor(entry)', s));
  assert.match(body, /try\{/);
  assert.match(body, /catch\(e\)\{\}/);
  assert.doesNotMatch(body, /fatal/);
});
check('meta is loaded outside the hash-verified manifest artifacts', () => {
  assert.match(html, /metaDecks = null;\s*\/\/ M2\.4/);
  assert.doesNotMatch(html, /loadArtifact\('meta/);
});

// ---------- 2. coverage math ----------
const own2 = metaCoverage.call(ctx({ x1: { n: 2, f: 0 } }, [], META));
check('coverage counts owned copies against required copies', () => {
  const d = own2.decks[0];
  assert.equal(d.total, 8);
  assert.equal(d.have, 2);
  assert.equal(d.missingUnits, 6);
  assert.equal(d.pct, 25);
});
check('owning more copies than the list needs does not inflate coverage', () => {
  const d = metaCoverage.call(ctx({ x1: { n: 9, f: 0 } }, [], META)).decks[0];
  assert.equal(d.have, 4, 'capped at the 4 the list asks for');
  assert.equal(d.pct, 50);
});
check('reprints of one card pool together', () => {
  const d = metaCoverage.call(ctx({ x1: { n: 2, f: 0 }, x2: { n: 2, f: 0 } }, [], META)).decks[0];
  assert.equal(d.have, 4, 'two printings of Alpha satisfy the 4 required');
});
check('foils count toward ownership', () => {
  const d = metaCoverage.call(ctx({ x1: { n: 1, f: 3 } }, [], META)).decks[0];
  assert.equal(d.have, 4);
});
check('a fully owned list reports 100% and no missing rows', () => {
  const d = metaCoverage.call(ctx({ x1: { n: 4, f: 0 }, y1: { n: 4, f: 0 } }, [], META)).decks[0];
  assert.equal(d.pct, 100);
  assert.equal(d.missingUnits, 0);
  assert.deepEqual(d.missing, []);
});

// ---------- 3. cost to complete ----------
check('cost multiplies unit price by copies still needed', () => {
  const d = own2.decks[0];
  // Alpha: 2 short at $5 = 10; Beta: 4 short at $10 = 40
  assert.equal(d.cost, 50);
});
check('missing rows carry per-line cost and the shortfall', () => {
  const beta = own2.decks[0].missing.find(m => m.name === 'Beta Card');
  assert.equal(beta.need, 4);
  assert.equal(beta.of, 4);
  assert.equal(beta.owned, 0);
  assert.equal(beta.lineCost, '$40.00');
});
check('unpriced missing cards are counted, not silently zeroed', () => {
  const c = ctx({}, [], META);
  c.hasRealPrice = (card) => card && card.card_id !== 'y1';
  c.priceOr0 = (card) => (card && card.card_id === 'y1') ? 0 : (PRICES[card.card_id] || 0);
  const d = metaCoverage.call(c).decks[0];
  assert.equal(d.unpriced, 1, 'Beta has no real price and must be reported');
});
check('missing rows sort by how many copies are needed', () => {
  const m = own2.decks[0].missing;
  assert.equal(m[0].need >= m[m.length - 1].need, true);
});

// ---------- 4. evidence is carried through honestly ----------
check('popularity evidence and confidence survive to the view', () => {
  const d = own2.decks[0];
  assert.equal(d.likes, 921);
  assert.equal(d.views, 53600);
  assert.equal(d.confScore, 66);
  assert.equal(d.confLevel, 'community_reference');
  assert.equal(d.evidenceKind, 'community_popular');
});
check('absent tournament data is reported as absent, never implied', () => {
  assert.equal(own2.decks[0].hasTournament, false);
  assert.equal(own2.anyTournament, false);
});
check('the work-in-progress flag is preserved', () => {
  assert.equal(own2.decks[0].wip, true);
});
check('the disclaimer only hides when tournament evidence exists', () => {
  const withT = JSON.parse(JSON.stringify(META));
  withT.decks[0].evidence.tournament_result = { event: 'Regionals', placement: 1, players: 64 };
  const r = metaCoverage.call(ctx({}, [], withT));
  assert.equal(r.anyTournament, true);
  assert.equal(r.decks[0].hasTournament, true);
});
check('the UI shows the no-tournament disclaimer', () => {
  assert.match(html, /V\.mtShowEvidenceNote=!cov\.anyTournament/);
  assert.match(html, /\{\{ mtEvidenceNote \}\}/);
});

// ---------- 5. strategy text follows the language ----------
check('strategy text follows the selected language', () => {
  const en = metaCoverage.call(ctx({}, [], META)).decks[0];
  assert.equal(en.tagline, 'EN tagline');
  const c = ctx({}, [], META); c.state.lang = 'pt';
  assert.equal(metaCoverage.call(c).decks[0].tagline, 'PT tagline');
});
check('an unknown language falls back to English rather than blank', () => {
  const c = ctx({}, [], META); c.state.lang = 'de';
  assert.equal(metaCoverage.call(c).decks[0].tagline, 'EN tagline');
});

// ---------- 6. overlap with the player's own decks ----------
check('overlap names the player deck sharing the most cards', () => {
  const decks = [
    { id: 'd1', name: 'Mine A', cards: { x1: 4 } },
    { id: 'd2', name: 'Mine B', cards: { x1: 4, y1: 4 } }
  ];
  const d = metaCoverage.call(ctx({}, decks, META)).decks[0];
  assert.equal(d.overlapName, 'Mine B');
  assert.equal(d.overlapCount, 2);
});
check('no overlap is reported as none, not as zero-named', () => {
  const d = metaCoverage.call(ctx({}, [{ id: 'd1', name: 'Mine', cards: { z1: 4 } }], META)).decks[0];
  assert.equal(d.overlapCount, 0);
  assert.equal(d.overlapName, '');
});

// ---------- 7. substitutions ----------
check('substitutions come from cards the player owns', () => {
  // Owned Sub shares ink+cost+type with Beta Card
  const d = metaCoverage.call(ctx({ w1: { n: 2, f: 0 } }, [], META)).decks[0];
  const beta = d.missing.find(m => m.name === 'Beta Card');
  assert.deepEqual(beta.subs, ['Owned Sub']);
  assert.equal(beta.hasSubs, true);
});
check('a substitution never suggests the missing card itself', () => {
  const d = metaCoverage.call(ctx({ y1: { n: 1, f: 0 } }, [], META)).decks[0];
  const beta = d.missing.find(m => m.name === 'Beta Card');
  assert.equal(beta.subs.includes('Beta Card'), false);
});
check('no owned match yields no substitutions rather than a guess', () => {
  const d = metaCoverage.call(ctx({}, [], META)).decks[0];
  assert.equal(d.missing.find(m => m.name === 'Beta Card').hasSubs, false);
});
check('substitutions are capped so the row stays readable', () => {
  const many = { w1: { n: 1, f: 0 }, z1: { n: 1, f: 0 } };
  const d = metaCoverage.call(ctx(many, [], META)).decks[0];
  assert.equal(d.missing.find(m => m.name === 'Beta Card').subs.length <= 2, true);
});
check('the substitution caveat is shown, not buried', () => {
  assert.match(html, /\{\{ mt\.subsNote \}\}/);
  assert.equal((html.match(/mtSubsNote:/g) || []).length, 2);
});

// ---------- 8. wishlist action ----------
check('adding to wishlist only adds resolvable cards and never removes', () => {
  const s = html.indexOf('wishlistMetaMissing=(deckId)=>');
  const body = html.slice(s, html.indexOf('metaCoverage(){', s));
  assert.match(body, /\{\.\.\.\(this\.state\.wishlist\|\|\{\}\)\}/, 'must copy the existing wishlist');
  assert.match(body, /if\(m\.cid&&!w\[m\.cid\]\)/, 'must skip unresolved cards and existing entries');
  assert.doesNotMatch(body, /delete w\[/, 'must never remove a wishlist entry');
  assert.match(body, /this\.saveLocal\(\)/);
});

// ---------- 9. UI wiring ----------
check('the section renders inside the Decks view', () => {
  const s = html.indexOf('<sc-if value="{{ isDecks }}"');
  const block = html.slice(s, html.indexOf('list="{{ deckCards }}"', s));
  assert.match(block, /list="\{\{ mtDecks \}\}"/);
  assert.match(block, /list="\{\{ mt\.missing \}\}"/);
  assert.match(block, /\{\{ mt\.wishlistLabel \}\}/);
});
check('one list is expanded at a time', () => {
  assert.match(html, /metaOpenDeck: null/);
  assert.match(html, /metaOpenDeck:open\?null:d\.id/);
});
check('the source link is safe to open', () => {
  const s = html.indexOf('{{ mt.openLabel }}');
  const around = html.slice(s - 400, s + 40);
  assert.match(around, /target="_blank"/);
  assert.match(around, /rel="noopener"/);
});
check('every new key exists in EN and PT', () => {
  for (const k of ['mtTitle', 'mtSub', 'mtEvidence', 'mtEvidenceLine', 'mtConfidence', 'mtWip', 'mtIllegal',
    'mtCoverage', 'mtMissingUnits', 'mtComplete', 'mtCost', 'mtUnpriced', 'mtOverlap', 'mtNoOverlap',
    'mtMissingTitle', 'mtSubs', 'mtSubsNote', 'mtWishlist', 'mtWishlistDone', 'mtOpen', 'mtHowTo', 'mtMulligan']) {
    assert.equal((html.match(new RegExp(k + ':', 'g')) || []).length, 2, k);
  }
});

// ---------- 10. mirror ----------
check('site/index.html and Inkwell.dc.html stay byte-identical', () => {
  assert.equal(html, fs.readFileSync(new URL('../Inkwell.dc.html', import.meta.url), 'utf8'));
});

console.log(`\n${passed} passed`);
