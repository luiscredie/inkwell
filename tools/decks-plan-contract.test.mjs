// The Decks page (/decks/) must run the very same deck-portfolio optimizer as the Inkwell app.
//   node tools/decks-plan-contract.test.mjs      (rebuild with: python tools/build_site_decks.py)
import { readFile } from 'node:fs/promises';
const app = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const page = await readFile(new URL('../site/decks/index.html', import.meta.url), 'utf8');
const start = app.indexOf('static computeDeckPortfolioPlan(');
let depth = 0, end = app.indexOf('{', start);
for (; end < app.length; end++) { if (app[end] === '{') depth++; else if (app[end] === '}' && --depth === 0) break; }
const fn = 'function ' + app.slice(start + 'static '.length, end + 1);
let ok = start > 0 && page.includes(fn);
// Preços uses the app's computeMovers the same way
const precos = await readFile(new URL('../site/precos/index.html', import.meta.url), 'utf8');
const ms = app.indexOf('static computeMovers('); let md = 0, me = app.indexOf('{', ms);
for (; me < app.length; me++) { if (app[me] === '{') md++; else if (app[me] === '}' && --md === 0) break; }
const movers = ms > 0 && precos.includes('function ' + app.slice(ms + 'static '.length, me + 1));
console.log((movers ? '✓ ' : '✗ ') + 'prices page uses the same computeMovers as the app');
ok = ok && movers;
console.log((ok ? '✓ ' : '✗ ') + 'decks page uses the same computeDeckPortfolioPlan as the app');
console.log(`${ok ? 1 : 0} passed, ${ok ? 0 : 1} failed`);
if (!ok) process.exit(1);
