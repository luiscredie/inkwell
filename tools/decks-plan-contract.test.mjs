// The Decks page (/decks/) must run the very same deck-portfolio optimizer as the Inkwell app.
//   node tools/decks-plan-contract.test.mjs      (rebuild with: python tools/build_site_decks.py)
import { readFile } from 'node:fs/promises';
const app = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const page = await readFile(new URL('../site/decks/index.html', import.meta.url), 'utf8');
const start = app.indexOf('static computeDeckPortfolioPlan(');
let depth = 0, end = app.indexOf('{', start);
for (; end < app.length; end++) { if (app[end] === '{') depth++; else if (app[end] === '}' && --depth === 0) break; }
const fn = 'function ' + app.slice(start + 'static '.length, end + 1);
const ok = start > 0 && page.includes(fn);
console.log((ok ? '✓ ' : '✗ ') + 'decks page uses the same computeDeckPortfolioPlan as the app');
console.log(`${ok ? 1 : 0} passed, ${ok ? 0 : 1} failed`);
if (!ok) process.exit(1);
