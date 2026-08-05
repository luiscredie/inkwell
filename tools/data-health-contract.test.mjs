// M2.2 Import Safety & Data Health contract (deterministic, no deps).
// Extracts logic from site/index.html and asserts the M2.2 guarantees.
//   node tools/data-health-contract.test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('✓', name); };

// ---------- extract a class method as a standalone function ----------
function lift(startMarker, endMarker, fnName) {
  const s = html.indexOf(startMarker);
  const e = html.indexOf(endMarker, s);
  assert.ok(s > 0 && e > s, fnName + ' source not found');
  const src = html.slice(s, e).replace(/^\s*/, '').replace(new RegExp('^' + fnName), 'function ' + fnName);
  return Function(`${src}; return ${fnName};`)();
}

// ---------- 1. a price failure must never block the app ----------
check('prices never return a fatal', () => {
  const s = html.indexOf('let prices={}, priceSource=\'\', warning=null;');
  const block = html.slice(s, html.indexOf('// optional artifacts', s));
  assert.doesNotMatch(block, /return \{ fatal:/, 'a price failure still aborts boot');
  assert.match(block, /this\.priceFailure='fetch'/);
  assert.match(block, /this\.priceFailure='schema'/);
  assert.match(block, /this\.priceFailure='absent'/);
});
check('legacy boot degrades the same way', () => {
  const s = html.indexOf('async bootLegacy()');
  const block = html.slice(s, html.indexOf('verifyHashes', s));
  assert.match(block, /this\.priceFailure='fetch'/);
  assert.match(block, /this\.priceFailure='schema'/);
  assert.doesNotMatch(block, /return \{ fatal:'Prices/);
});
check('cards remain fatal (the app cannot run without them)', () => {
  assert.match(html, /Could not load cards\.json/);
});

// ---------- 2. staleness classification ----------
const priceHealth = lift('priceHealth(){', '\n  priceDateLabel()', 'priceHealth');
const priceAgeDays = lift('priceAgeDays(){', '\n  priceHealth()', 'priceAgeDays');
const ctx = (over) => Object.assign({ priceFailure: null, pricesDate: null, PRICE_STALE_DAYS: 3, priceAgeDays }, over);
const day = 86400000;
const iso = (ms) => new Date(Date.now() - ms).toISOString().slice(0, 10);

check('a failure reports unavailable, not stale', () => {
  assert.deepEqual(priceHealth.call(ctx({ priceFailure: 'fetch', pricesDate: iso(0) })), { state: 'unavailable', days: null });
});
check('missing date reports unknown', () => {
  assert.deepEqual(priceHealth.call(ctx({})), { state: 'unknown', days: null });
});
check('today and 2 days old are fresh', () => {
  assert.equal(priceHealth.call(ctx({ pricesDate: iso(0) })).state, 'fresh');
  assert.equal(priceHealth.call(ctx({ pricesDate: iso(2 * day) })).state, 'fresh');
});
check('3 days old crosses into stale', () => {
  const h = priceHealth.call(ctx({ pricesDate: iso(3 * day) }));
  assert.equal(h.state, 'stale');
  assert.equal(h.days, 3);
});
check('age is never negative for a future date', () => {
  assert.equal(priceAgeDays.call({ pricesDate: iso(-5 * day) }), 0);
});

// ---------- 3. import audit ----------
const mergeStart = html.indexOf('static mergeCollections(');
const mergeSrc = html.slice(mergeStart, html.indexOf('\n  importCollection =', mergeStart))
  .replace(/^static mergeCollections/, 'function mergeCollections');
const mergeCollections = Function(`${mergeSrc}; return mergeCollections;`)();
const buildImportAudit = lift('buildImportAudit(p,before,after,mode,snapKey){', '\n  downloadImportAudit', 'buildImportAudit');

const byId = { A: { name_en: 'Mickey', set_code: 'TFC' }, C: { name_en: 'Elsa', set_code: 'TFC' } };
const before = { A: { n: 2, f: 0 }, B: { n: 1, f: 1 } };
const incoming = { A: { n: 1, f: 2 }, C: { n: 3, f: 0 } };
const preview = { collection: incoming, fileName: 'dreamborn.csv', rejects: [{ where: '7', raw: 'Bogus', reason: 'no_match' }] };
const auditCtx = { byId, APP_VERSION: 'test', state: { activeUser: 'luiscredie' } };

const after = mergeCollections(before, incoming, 'merge-max');
const audit = buildImportAudit.call(auditCtx, preview, before, after, 'merge-max', 'snap_1');

check('audit records mode, source and timestamp', () => {
  assert.equal(audit.schema, 'inkwell-import-audit/1');
  assert.equal(audit.merge_mode, 'merge-max');
  assert.equal(audit.source_file, 'dreamborn.csv');
  assert.match(audit.imported_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(audit.user, 'luiscredie');
});
check('audit carries before/incoming/after per card', () => {
  const a = audit.accepted.find(r => r.card_id === 'A');
  assert.deepEqual(a.before, { n: 2, f: 0 });
  assert.deepEqual(a.incoming, { n: 1, f: 2 });
  assert.deepEqual(a.after, { n: 2, f: 2 });
  assert.equal(a.name, 'Mickey');
});
check('audit counts created vs increased correctly', () => {
  // A already existed and gained a foil; C is new
  assert.equal(audit.summary.cards_created, 1);
  assert.equal(audit.summary.cards_increased, 1);
  assert.equal(audit.summary.cards_unchanged, 0);
});
check('audit reports collection size on both sides', () => {
  assert.equal(audit.summary.collection_size_before, 2);
  assert.equal(audit.summary.collection_size_after, 3);
});
check('audit lists rejected rows with reasons', () => {
  assert.equal(audit.summary.rows_rejected, 1);
  assert.deepEqual(audit.rejected, [{ where: '7', raw: 'Bogus', reason: 'no_match' }]);
});
check('audit names the rollback snapshot', () => {
  assert.equal(audit.rollback.snapshot_key, 'snap_1');
});
check('audit never mutates the collections it describes', () => {
  assert.deepEqual(before, { A: { n: 2, f: 0 }, B: { n: 1, f: 1 } });
  assert.deepEqual(incoming, { A: { n: 1, f: 2 }, C: { n: 3, f: 0 } });
});
check('a card untouched by the import is absent from accepted rows', () => {
  assert.equal(audit.accepted.some(r => r.card_id === 'B'), false);
});

// ---------- 4. rejected rows are reported, not silently dropped ----------
check('every skip path records a reason', () => {
  const s = html.indexOf('importCollection = (e)=>');
  const body = html.slice(s, html.indexOf('setImportMode=', s));
  assert.doesNotMatch(body, /unresolved\+\+/, 'a skip path still only increments a counter');
  assert.equal((body.match(/rejects\.push\(/g) || []).length, 4);
  for (const reason of ['unknown_id', 'no_match', 'bad_row']) {
    assert.ok(body.includes("reason:'" + reason + "'"), 'missing reason ' + reason);
  }
});
check('preview carries the reject list into state', () => {
  assert.match(html, /importPreview:\{collection:coll,fileName:file\.name,matched,unresolved:rejects\.length,rejects/);
});
check('rejected rows are surfaced in the dialog', () => {
  assert.match(html, /list="\{\{ importRejects \}\}"/);
  assert.match(html, /\{\{ importRowsToggleLabel \}\}/);
});

// ---------- 5. the audit download is offered on every import ----------
check('apply opens a result panel instead of only a toast', () => {
  const s = html.indexOf('applyCollectionImport=()=>');
  const body = html.slice(s, html.indexOf('setImpRef', s));
  assert.match(body, /importResult:audit/);
  assert.match(body, /audit\.applied=true/);
});
check('result panel and preview both expose a download', () => {
  assert.match(html, /\{\{ downloadImportAudit \}\}/);
  assert.match(html, /\{\{ downloadPreviewAudit \}\}/);
  assert.match(html, /'inkwell-import-audit\/1-dryrun'/);
});

// ---------- 6. data health surface ----------
check('technical details are collapsed by default', () => {
  assert.match(html, /dhTechOpen: false/);
  assert.match(html, /V\.reportOpen=!!rep&&st\.dhTechOpen/);
});
check('plain-language rows exist for players', () => {
  assert.match(html, /list="\{\{ dhRows \}\}"/);
  assert.match(html, /V\.dhRows=\[/);
});
check('stale and unavailable have distinct player-facing copy', () => {
  for (const key of ['pricesStaleAlert', 'pricesUnavailAlert', 'pricesUnavailShort']) {
    assert.equal((html.match(new RegExp(key + ':', 'g')) || []).length, 2, key + ' must exist in EN and PT');
  }
  assert.match(html, /list="\{\{ dhRows \}\}"|\{\{ priceAlert \}\}/);
});
check('the alert is dismissible and links to details', () => {
  assert.match(html, /\{\{ dismissPriceAlert \}\}/);
  assert.match(html, /\{\{ openDataHealth \}\}/);
});

// ---------- 7. mirror ----------
check('site/index.html and Inkwell.dc.html stay byte-identical', () => {
  const mirror = fs.readFileSync(new URL('../Inkwell.dc.html', import.meta.url), 'utf8');
  assert.equal(html, mirror);
});

console.log(`\n${passed} passed`);
