// M2.6 Beginner Journey + acquisition cost / portfolio ROI contract.
//   node tools/journey-cost-contract.test.mjs
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
  const src = html.slice(s, end).replace(/^static\s+/, '').replace(new RegExp('^' + fnName), 'function ' + fnName);
  return Function(`${src}; return ${fnName};`)();
}

const parseMoney = lift('parseMoney(raw){', 'parseMoney');
const addAcquisition = lift('addAcquisition(acc,id,qty,unitOrTotal,isTotal){', 'addAcquisition');
const portfolioRoi = lift('portfolioRoi(){', 'portfolioRoi');
const acquisitionUnit = lift('acquisitionUnit(id){', 'acquisitionUnit');
const beginnerJourney = lift('beginnerJourney(){', 'beginnerJourney');

// ---------- money parsing ----------
check('Brazilian and English money formats both parse', () => {
  assert.equal(parseMoney('R$ 12,50'), 12.5);
  assert.equal(parseMoney('12.50'), 12.5);
  assert.equal(parseMoney('1.234,56'), 1234.56);
  assert.equal(parseMoney('1,234.56'), 1234.56);
  assert.equal(parseMoney('12'), 12);
  assert.equal(parseMoney('R$ 0,99'), 0.99);
});
check('junk, blank and negative prices are rejected, never coerced to 0', () => {
  for (const v of ['', '   ', 'abc', null, undefined, '-5', 'R$ -3,00']) {
    assert.equal(parseMoney(v), null, JSON.stringify(v) + ' must be rejected');
  }
});
check('a price is never stored as NaN', () => {
  const vals = ['12,50', 'abc', '', '1.234,56', '0'];
  for (const v of vals) { const r = parseMoney(v); assert.ok(r === null || Number.isFinite(r)); }
});

// ---------- accumulation ----------
check('a unit price is multiplied by the quantity', () => {
  const acc = {};
  addAcquisition(acc, 'a', 3, 10, false);
  assert.deepEqual(acc.a, { paid: 30, qty: 3 });
});
check('a total price is taken as-is', () => {
  const acc = {};
  addAcquisition(acc, 'a', 3, 30, true);
  assert.deepEqual(acc.a, { paid: 30, qty: 3 });
});
check('two purchases of the same card average honestly, not naively', () => {
  const acc = {};
  addAcquisition(acc, 'a', 2, 10, false);   // 2 at 10
  addAcquisition(acc, 'a', 1, 40, false);   // 1 at 40
  assert.deepEqual(acc.a, { paid: 60, qty: 3 });
  const unit = acquisitionUnit.call({ state: { acquisition: acc } }, 'a');
  assert.equal(unit, 20, 'weighted by quantity: 60/3 = 20, not (10+40)/2 = 25');
});
check('zero, negative or missing quantities and prices are ignored', () => {
  const acc = {};
  addAcquisition(acc, 'a', 0, 10, false);
  addAcquisition(acc, 'a', -1, 10, false);
  addAcquisition(acc, 'a', 2, null, false);
  addAcquisition(acc, null, 2, 10, false);
  assert.deepEqual(acc, {}, 'nothing partial should be recorded');
});
check('accumulated totals stay rounded to cents', () => {
  const acc = {};
  addAcquisition(acc, 'a', 3, 3.333, false);
  assert.equal(acc.a.paid, 10, 'no floating-point tail');
});
check('a card with no recorded cost has no unit price rather than zero', () => {
  assert.equal(acquisitionUnit.call({ state: { acquisition: {} } }, 'a'), null);
  assert.equal(acquisitionUnit.call({ state: { acquisition: { a: { paid: 0, qty: 0 } } } }, 'a'), null);
});

// ---------- ROI ----------
function roiCtx(collection, acquisition, prices) {
  const byId = {}; for (const id in collection) byId[id] = { card_id: id };
  return { byId, state: { collection, acquisition }, priceOr0(c) { return prices[c.card_id] || 0; }, portfolioRoi };
}

check('with no recorded cost there is no ROI, not a zero', () => {
  assert.equal(portfolioRoi.call(roiCtx({ a: { n: 2, f: 0 } }, {}, { a: 10 })), null);
});
check('a gain is reported with the right delta and percentage', () => {
  const r = portfolioRoi.call(roiCtx({ a: { n: 2, f: 0 } }, { a: { paid: 20, qty: 2 } }, { a: 30 }));
  assert.equal(r.paid, 20);
  assert.equal(r.nowVal, 60);
  assert.equal(r.delta, 40);
  assert.equal(r.pct, 200);
});
check('a loss is reported as a negative delta', () => {
  const r = portfolioRoi.call(roiCtx({ a: { n: 1, f: 0 } }, { a: { paid: 100, qty: 1 } }, { a: 40 }));
  assert.equal(r.delta, -60);
  assert.ok(r.pct < 0);
});
check('ROI only covers copies whose cost is known', () => {
  const r = portfolioRoi.call(roiCtx(
    { a: { n: 1, f: 0 }, b: { n: 3, f: 0 } },
    { a: { paid: 10, qty: 1 } },
    { a: 20, b: 50 }
  ));
  assert.equal(r.covered, 1, 'only the costed card counts');
  assert.equal(r.ownedTotal, 4);
  assert.equal(r.nowVal, 20, 'the uncosted card must not inflate current value');
  assert.equal(r.partial, true);
  assert.equal(r.pricedMissing, 3);
});
check('owning more copies than were costed does not extrapolate the cost', () => {
  const r = portfolioRoi.call(roiCtx({ a: { n: 10, f: 0 } }, { a: { paid: 20, qty: 2 } }, { a: 15 }));
  assert.equal(r.covered, 2, 'cost is known for 2 copies, so only 2 are compared');
  assert.equal(r.paid, 20);
  assert.equal(r.nowVal, 30);
});
check('coverage is reported as a percentage of copies owned', () => {
  const r = portfolioRoi.call(roiCtx(
    { a: { n: 1, f: 0 }, b: { n: 1, f: 0 } },
    { a: { paid: 5, qty: 1 } }, { a: 5, b: 5 }
  ));
  assert.equal(r.coveragePct, 50);
});
check('foils count toward owned copies', () => {
  const r = portfolioRoi.call(roiCtx({ a: { n: 1, f: 1 } }, { a: { paid: 20, qty: 2 } }, { a: 15 }));
  assert.equal(r.covered, 2);
});
check('a card in the cost map but no longer owned is skipped', () => {
  const r = portfolioRoi.call(roiCtx({ a: { n: 1, f: 0 } }, { a: { paid: 10, qty: 1 }, gone: { paid: 500, qty: 5 } }, { a: 10 }));
  assert.equal(r.paid, 10, 'a sold-off card must not linger in the total');
});

// ---------- import wiring ----------
check('both CSV shapes look for a price column, in PT and EN', () => {
  for (const col of ['price', 'paid', 'total', 'preço', 'custo', 'valor pago']) {
    assert.ok(html.includes("'" + col + "'"), 'missing header alias: ' + col);
  }
  assert.equal((html.match(/ci\(\['price','unit price','paid'/g) || []).length, 2,
    'both the Dreamborn and native branches must read cost');
});
check('cost is carried on the preview and committed with the confirm', () => {
  assert.match(html, /acquisition:acq,costRows/);
  assert.match(html, /const acquisition=\{\.\.\.\(this\.state\.acquisition\|\|\{\}\)\}/);
  assert.match(html, /this\.setState\(\{collection,acquisition,importPreview:null/);
});
check('the pre-import snapshot includes cost, so rollback is complete', () => {
  assert.match(html, /acquisition:this\.state\.acquisition\|\|\{\},source:p\.fileName/);
});
check('the audit reports how many rows carried cost', () => {
  assert.match(html, /audit\.acquisition=\{ rows_with_cost:p\.costRows\|\|0, cards_costed:costAdded \}/);
});
check('cost survives save, migration and both load paths', () => {
  assert.match(html, /acquisition:this\.state\.acquisition\|\|\{\}/);
  assert.match(html, /d\.acquisition = \(d\.acquisition && typeof d\.acquisition==='object'\)/);
  assert.equal((html.match(/acquisition:m\.acquisition\|\|\{\}/g) || []).length, 2, 'local and cloud load');
});
check('the import tells the user when no price column was found', () => {
  assert.match(html, /\{\{ impNoCostLine \}\}/);
  assert.match(html, /\{\{ impCostLine \}\}/);
  assert.equal((html.match(/acqNoneHint:/g) || []).length, 2);
});
check('the ROI panel states its coverage instead of implying a total', () => {
  assert.match(html, /\{\{ roi\.coverage \}\}/);
  assert.match(html, /\{\{ roi\.partialNote \}\}/);
});

// ---------- beginner journey ----------
function jctx(over) {
  return Object.assign({
    state: { learnDone: {}, collection: {}, decks: [], matches: [], goalProgress: null },
    deckSize(d) { return Object.values(d.cards || {}).reduce((s, x) => s + x, 0); },
    setState() {},
    t(k, p) { return p ? k + ':' + JSON.stringify(p) : k; },
    beginnerJourney
  }, over || {});
}

check('a brand-new user gets every step open and the first one current', () => {
  const j = beginnerJourney.call(jctx());
  assert.equal(j.doneCount, 0);
  assert.equal(j.steps.length, 6);
  assert.equal(j.steps[0].current, true);
  assert.equal(j.complete, false);
});
check('exactly one step is current at any time', () => {
  for (const state of [
    { learnDone: {}, collection: {}, decks: [], matches: [], goalProgress: null },
    { learnDone: { play: 1 }, collection: { a: { n: 1 } }, decks: [], matches: [], goalProgress: null },
    { learnDone: { play: 1 }, collection: { a: { n: 1 } }, decks: [{ id: 'd', name: 'D', cards: {} }], matches: [], goalProgress: null }
  ]) {
    const j = beginnerJourney.call(jctx({ state }));
    assert.equal(j.steps.filter(s => s.current).length, 1, 'one and only one current step');
  }
});
check('completed steps are read from real state, not a checklist flag', () => {
  const j = beginnerJourney.call(jctx({
    state: { learnDone: { play: 1 }, collection: { a: { n: 3 } }, decks: [], matches: [], goalProgress: null }
  }));
  assert.equal(j.steps.find(s => s.id === 'basics').done, true);
  assert.equal(j.steps.find(s => s.id === 'collect').done, true);
  assert.equal(j.steps.find(s => s.id === 'deck').done, false);
});
check('the 60-card step only completes at the legal minimum', () => {
  const small = beginnerJourney.call(jctx({
    state: { learnDone: {}, collection: {}, decks: [{ id: 'd', name: 'D', cards: { a: 40 } }], matches: [], goalProgress: null }
  }));
  assert.equal(small.steps.find(s => s.id === 'deck').done, true, 'any deck satisfies the create step');
  assert.equal(small.steps.find(s => s.id === 'legal').done, false, '40 cards is not legal');

  const legal = beginnerJourney.call(jctx({
    state: { learnDone: {}, collection: {}, decks: [{ id: 'd', name: 'D', cards: { a: 60 } }], matches: [], goalProgress: null }
  }));
  assert.equal(legal.steps.find(s => s.id === 'legal').done, true);
});
check('the review step is blocked, not merely undone, without a replay', () => {
  const noReplay = beginnerJourney.call(jctx({
    state: { learnDone: {}, collection: {}, decks: [], matches: [{ id: 'm', result: 'win' }], goalProgress: null }
  }));
  const step = noReplay.steps.find(s => s.id === 'review');
  assert.equal(step.blocked, true, 'a result with no replay log cannot be reviewed');
  assert.ok(step.blockedWhy, 'the block must explain itself');
});
check('a blocked step is never made the current step', () => {
  const j = beginnerJourney.call(jctx({
    state: {
      learnDone: { play: 1 }, collection: { a: { n: 1 } },
      decks: [{ id: 'd', name: 'D', cards: { a: 60 } }],
      matches: [{ id: 'm', result: 'win' }], goalProgress: null
    }
  }));
  const review = j.steps.find(s => s.id === 'review');
  assert.equal(review.blocked, true);
  assert.equal(review.current, false, 'the journey must not point at something impossible');
});
check('a replay present unblocks the review step', () => {
  const j = beginnerJourney.call(jctx({
    state: {
      learnDone: {}, collection: {}, decks: [],
      matches: [{ id: 'm', replay: { events: [{ text: 'a' }, { text: 'b' }] } }],
      goalProgress: null
    }
  }));
  assert.equal(j.steps.find(s => s.id === 'review').blocked, false);
});
check('reviewing a match completes the last step and the journey', () => {
  const j = beginnerJourney.call(jctx({
    state: {
      learnDone: { play: 1 }, collection: { a: { n: 1 } },
      decks: [{ id: 'd', name: 'D', cards: { a: 60 } }],
      matches: [{ id: 'm', replay: { events: [{ text: 'a' }, { text: 'b' }] } }],
      goalProgress: { week: 'w', reviewed: { m: 1 }, mulligans: 0 }
    }
  }));
  assert.equal(j.complete, true);
  assert.equal(j.pct, 100);
  assert.equal(j.steps.filter(s => s.current).length, 0, 'nothing is current once it is all done');
});
check('every step can act — no dead ends', () => {
  const j = beginnerJourney.call(jctx());
  for (const s of j.steps) {
    assert.equal(typeof s.go, 'function', s.id + ' must be actionable');
    assert.ok(s.label && s.why && s.cta, s.id + ' must explain itself');
  }
});
check('the journey is the first Academy tab and its own view', () => {
  assert.match(html, /\{id:'journey',label:this\.t\('acJourney'\)\}/);
  assert.match(html, /academyTab: 'journey'/);
  assert.match(html, /list="\{\{ bjSteps \}\}"/);
});
check('journey actions are 38px or larger touch targets', () => {
  const s = html.indexOf('list="{{ bjSteps }}"');
  assert.match(html.slice(s, s + 2600), /min-height:38px/);
});

// ---------- i18n ----------
check('every new key exists in EN and PT', () => {
  for (const k of ['acqFound', 'acqNoneHint', 'roiTitle', 'roiNow', 'roiCoverage', 'roiPartial',
    'acJourney', 'bjTitle', 'bjSub', 'bjComplete', 'bjBasics', 'bjBasicsWhy', 'bjBasicsCta',
    'bjCollect', 'bjCollectWhy', 'bjCollectCta', 'bjCollectDone', 'bjDeck', 'bjDeckWhy', 'bjDeckCta',
    'bjLegal', 'bjLegalWhy', 'bjLegalCta', 'bjMatch', 'bjMatchWhy', 'bjMatchCta', 'bjMatchDone',
    'bjReview', 'bjReviewWhy', 'bjReviewCta', 'bjReviewBlocked']) {
    assert.equal((html.match(new RegExp('\\b' + k + ':', 'g')) || []).length, 2, k);
  }
});

// ---------- mirror ----------
check('site/index.html and Inkwell.dc.html stay byte-identical', () => {
  assert.equal(html, fs.readFileSync(new URL('../Inkwell.dc.html', import.meta.url), 'utf8'));
});

console.log(`\n${passed} passed`);
