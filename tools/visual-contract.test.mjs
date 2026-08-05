// M3V visual/product contract tests (deterministic, no deps).
// Extracts site/index.html source and asserts token/foundation/i18n invariants.
//   node tools/visual-contract.test.mjs
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const mirror = await readFile(new URL('../Inkwell.dc.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n); };

// 1. core tokens present exactly once
for (const v of ['--surface-panel', '--accent', '--ink-amber', '--focus-ring', '--sp-4', '--r-lg', '--dur-med']) {
  ck(`token ${v} defined once`, html.split(v + ':').length - 1 === 1);
}
// 2. reduced-motion
ck('prefers-reduced-motion rule present', /@media \(prefers-reduced-motion: reduce\)/.test(html));
ck('skeleton disabled under reduced-motion', /prefers-reduced-motion[^}]*\}\s*\.ink-sk\{animation:none\}/.test(html.replace(/\s+/g, ' ')) || html.includes('.ink-sk{animation:none}'));
// 3. focus-visible uses token
ck(':focus-visible uses focus-ring token', html.includes('outline:var(--focus-ring)'));
// 4. no infinite animation on repeated card tiles (grids must not use *-infinite on card imgs)
ck('no infinite animation on collection card tiles', !/pageCards[\s\S]{0,4000}animation:[^;"]*infinite/.test(html));
// 5. skeleton has stable dimensions class
ck('skeleton class present', html.includes('.ink-sk{'));
// 6. mobile 44px targets
ck('mobile 44px target rule', html.includes('min-height:44px') && html.includes('min-width:44px'));
// 7. no structural horizontal overflow guard
ck('overflow-x hidden guard on main', html.includes('#ink-main{overflow-x:hidden}'));
// 8/9. i18n parity + no raw keys rendered
function dictKeys(lang) {
  const s = html.indexOf(lang + ': {'); let i = html.indexOf('{', s), depth = 0, end = -1;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) { end = i; break; } } }
  const body = html.slice(s, end); const keys = new Set();
  for (const m of body.matchAll(/(?:^|[\s{,])([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) keys.add(m[1]);
  keys.delete('en'); keys.delete('pt'); return keys;
}
const en = dictKeys('en'), pt = dictKeys('pt');
const used = new Set(); for (const m of html.matchAll(/this\.t\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*[),]/g)) used.add(m[1]);
ck('EN/PT key parity', [...en].every(k => pt.has(k)) && [...pt].every(k => en.has(k)));
ck('every used i18n key exists in EN and PT', [...used].every(k => en.has(k) && pt.has(k)));
ck('no raw portfolio keys rendered as text', !/>\s*(portfolioHead|portfolioMissing)\s*</.test(html) && !html.includes('{{ portfolioHead }}') && !html.includes('{{ portfolioMissing }}'));
// 10. deploy root preserved
ck('site/ deploy root: mirror byte-identical', html === mirror);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
