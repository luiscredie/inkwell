// i18n contract test (M1.6.1). No deps.
// Enumerates every static this.t('key') call in site/index.html and fails if any
// key is missing from EN or PT. Also fails if a raw i18n identifier is rendered.
//   node tools/i18n-contract.test.mjs
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');

// Extract the two dictionaries by slicing the I18N literal.
function dictKeys(lang) {
  const marker = lang + ': {';
  const s = html.indexOf(marker);
  if (s < 0) throw new Error('dictionary not found: ' + lang);
  // find matching close by brace depth
  let i = html.indexOf('{', s), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = html.slice(s, end);
  const keys = new Set();
  for (const m of body.matchAll(/(?:^|[\s{,])([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) keys.add(m[1]);
  keys.delete('en'); keys.delete('pt'); // outer wrapper property names
  return keys;
}
const en = dictKeys('en');
const pt = dictKeys('pt');

// Collect COMPLETE static this.t('key') calls (closing quote followed by ) or , — not '+' dynamic prefix).
const used = new Set();
for (const m of html.matchAll(/this\.t\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*[),]/g)) used.add(m[1]);

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n); };

const missEn = [...used].filter(k => !en.has(k));
const missPt = [...used].filter(k => !pt.has(k));
ck('every this.t() key exists in EN' + (missEn.length ? ' — missing: ' + missEn.join(', ') : ''), missEn.length === 0);
ck('every this.t() key exists in PT' + (missPt.length ? ' — missing: ' + missPt.join(', ') : ''), missPt.length === 0);
ck('EN and PT have identical key sets',
  [...en].every(k => pt.has(k)) && [...pt].every(k => en.has(k)));

// Guard: portfolio identifiers must be real keys, not rendered literals.
for (const k of ['portfolioHead', 'portfolioMissing', 'activeDeckSet', 'optimizedPlan', 'physicalCopies']) {
  ck(`key present in both dicts: ${k}`, en.has(k) && pt.has(k));
}
ck('used-key count is non-trivial', used.size > 50);

console.log(`\n${pass} passed, ${fail} failed (keys used: ${used.size}, EN: ${en.size}, PT: ${pt.size})`);
if (fail) process.exit(1);
