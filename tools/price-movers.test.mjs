// Canonical price-movers unit tests (M1P). No deps.
// Extracts the pure static Component.computeMovers(series, period, resolveName)
// from site/index.html and exercises the calculation without rendering the app.
//   node tools/price-movers.test.mjs
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const s = html.indexOf('static computeMovers');
const body = html.slice(s, html.indexOf('\n  priceMovers(period)', s));
// Wrap the static method body into a standalone function.
const fnSrc = 'return function computeMovers' + body.slice('static computeMovers'.length) + '\n;';
const computeMovers = new Function(fnSrc)();

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n); };
const day = (d, prices) => ({ date: d, prices });

// base: two dates, normal prices
const base = [
  day('2026-07-20', { 'A-1': { nl: 10 }, 'B-2': { nl: 20 }, 'C-3': { nl: 5 } }),
  day('2026-07-26', { 'A-1': { nl: 15 }, 'B-2': { nl: 16 }, 'C-3': { nl: 5 } }),
];
let r = computeMovers(base, 'latest');
ck('1 largest gainer = A-1 (+50%)', r.gainers[0].id === 'A-1' && r.gainers[0].pct === 50);
ck('2 largest loser = B-2 (-20%)', r.losers[0].id === 'B-2' && r.losers[0].pct === -20);

// 3 tie-break: equal pct → abs → id
const tie = [
  day('2026-07-20', { 'X-1': { nl: 10 }, 'Y-2': { nl: 100 }, 'Z-3': { nl: 10 } }),
  day('2026-07-26', { 'X-1': { nl: 11 }, 'Y-2': { nl: 110 }, 'Z-3': { nl: 11 } }),
];
r = computeMovers(tie, 'latest'); // all +10%; abs: Y-2 10 > X-1/Z-3 1; then id X-1 before Z-3
ck('3 tie-break pct→abs→id', r.gainers.map(x => x.id).join(',') === 'Y-2,X-1,Z-3');

// 4 normal + foil independent
const nf = [
  day('2026-07-20', { 'A-1': { nl: 10, fl: 40 } }),
  day('2026-07-26', { 'A-1': { nl: 12, fl: 30 } }),
];
r = computeMovers(nf, 'latest');
ck('4 normal gainer + foil loser independent',
  r.gainers.some(x => x.id === 'A-1' && x.finish === 'normal') &&
  r.losers.some(x => x.id === 'A-1' && x.finish === 'foil'));

// 5 missing → priced excluded
r = computeMovers([day('2026-07-20', { 'A-1': {} }), day('2026-07-26', { 'A-1': { nl: 9 } })], 'latest');
ck('5 missing→priced excluded', r.gainers.length === 0 && r.losers.length === 0);
// 6 priced → missing excluded
r = computeMovers([day('2026-07-20', { 'A-1': { nl: 9 } }), day('2026-07-26', { 'A-1': {} })], 'latest');
ck('6 priced→missing excluded', r.gainers.length === 0 && r.losers.length === 0);
// 7 zero/null/NaN excluded
r = computeMovers([day('2026-07-20', { 'A-1': { nl: 0 }, 'B-2': { nl: null }, 'C-3': { nl: NaN } }),
                   day('2026-07-26', { 'A-1': { nl: 5 }, 'B-2': { nl: 5 }, 'C-3': { nl: 5 } })], 'latest');
ck('7 zero/null/NaN excluded', r.gainers.length === 0);

// 8 one snapshot → insufficient
ck('8 one snapshot → null', computeMovers([day('2026-07-26', { 'A-1': { nl: 5 } })], 'latest') === null);

// 9/10 nearest snapshot selection
const multi = [
  day('2026-06-26', { 'A-1': { nl: 100 } }), // 30d
  day('2026-07-19', { 'A-1': { nl: 80 } }),  // 7d
  day('2026-07-25', { 'A-1': { nl: 60 } }),  // 1d
  day('2026-07-26', { 'A-1': { nl: 50 } }),  // latest
];
ck('9 1d selects 07-25', computeMovers(multi, '1d').from === '2026-07-25');
ck('10 7d selects 07-19, 30d selects 06-26',
  computeMovers(multi, '7d').from === '2026-07-19' && computeMovers(multi, '30d').from === '2026-06-26');

// 11 duplicate card/finish prevented
const dup = [day('2026-07-20', { 'A-1': { nl: 10 } }), day('2026-07-26', { 'A-1': { nl: 20 } })];
r = computeMovers(dup, 'latest');
ck('11 no duplicate card/finish', r.gainers.filter(x => x.id === 'A-1' && x.finish === 'normal').length === 1);

// 12 card_id preserved for modal navigation
ck('12 card_id preserved', r.gainers[0].id === 'A-1');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
