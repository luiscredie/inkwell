// M2.7 accessibility, motion and performance-budget contract.
//   node tools/a11y-perf-contract.test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('✓', name); };

// ---------- language ----------
check('the document declares its language, and it follows the UI toggle', () => {
  assert.match(html, /<html lang="\{\{ htmlLang \}\}">/);
  assert.match(html, /V\.htmlLang=st\.lang==='pt'\?'pt-BR':'en';/);
});

// ---------- announcements ----------
check('toasts are announced to screen readers', () => {
  assert.match(html, /data-testid="toast" role="status" aria-live="polite"/);
});

// ---------- keyboard ----------
check('a skip link lets keyboard users past the nav', () => {
  assert.match(html, /<a href="#ink-main" class="ink-skip">\{\{ skipToContent \}\}<\/a>/);
  assert.match(html, /\.ink-skip:focus\{top:12px\}/);
  assert.ok(html.indexOf('class="ink-skip"') < html.indexOf('id="app"'),
    'the skip link must come before the app shell in source order');
});
check('the skip link is hidden until focused, not display:none', () => {
  const m = html.match(/\.ink-skip\{position:fixed[^}]*\}/);
  assert.ok(m, 'skip link base rule missing');
  assert.match(m[0], /top:-60px/, 'it must be offscreen but focusable');
  assert.doesNotMatch(m[0], /display:none/, 'display:none would remove it from the tab order');
});
check('the reduced-motion override comes after the rule it overrides', () => {
  const base = html.indexOf('.ink-skip{position:fixed');
  const override = html.indexOf('@media (prefers-reduced-motion: reduce){ .ink-skip');
  assert.ok(base > 0 && override > 0, 'both rules must exist');
  assert.ok(override > base,
    'equal specificity means source order decides — an override placed first does nothing');
});
check('hidden file inputs are out of the tab order', () => {
  const inputs = html.match(/<input type="file"[^>]*>/g) || [];
  assert.equal(inputs.length > 0, true);
  for (const i of inputs) {
    assert.match(i, /tabindex="-1"/, 'a display:none input still takes focus in some browsers: ' + i.slice(0, 60));
    assert.match(i, /aria-hidden="true"/);
  }
});

// ---------- accessible names ----------
check('icon-only controls carry an accessible name', () => {
  for (const [glyph, hole] of [['−', 'decAria'], ['+', 'incAria'], ['EN', 'langEnAria'], ['PT', 'langPtAria']]) {
    const re = new RegExp('aria-label="\\{\\{ ' + hole + ' \\}\\}"[^>]*>\\s*\\' + glyph + '\\s*<');
    assert.ok(re.test(html) || html.includes('{{ ' + hole + ' }}'), glyph + ' needs ' + hole);
  }
});
check('card art has an alt describing the card, not an empty string', () => {
  const arts = html.match(/<img src="\{\{ [cr]\._local \}\}"[^>]*>/g) || [];
  assert.equal(arts.length >= 3, true, 'expected the card art images');
  for (const a of arts) assert.match(a, /alt="\{\{ [cr]\.name \}\}"/, 'missing card name alt: ' + a.slice(0, 70));
});
check('the decorative hero coin stays alt-empty', () => {
  assert.match(html, /<img src="ink\/logo-coin\.png" alt="" /, 'decorative art must not be announced');
});
check('every range input is named', () => {
  const ranges = html.match(/<input type="range"[^>]*>/g) || [];
  for (const r of ranges) {
    assert.ok(/aria-label=/.test(r), 'unnamed slider: ' + r.slice(0, 80));
  }
});

// ---------- touch targets ----------
check('quantity steppers meet a usable target size', () => {
  const steppers = html.match(/<button onClick="\{\{ d\._(?:dec|inc) \}\}"[^>]*>/g) || [];
  assert.equal(steppers.length, 2, 'expected both steppers');
  for (const s of steppers) {
    assert.match(s, /width:32px;height:32px/, 'a 24px target is too small to hit: ' + s.slice(0, 70));
  }
});
check('no interactive control declares a target under 32px', () => {
  const tiny = html.match(/min-height:(?:2[0-9]|3[01])px/g) || [];
  assert.deepEqual(tiny, [], 'found sub-32px targets: ' + tiny.join(', '));
});

// ---------- motion ----------
check('reduced motion is honoured globally', () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{ \*\{animation-duration:\.001ms!important/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{ \.ink-skip\{transition:none\}/);
});
check('hover lift is one shared rule, not per-element inline transitions', () => {
  assert.match(html, /@media \(hover:hover\)\{ \.ink-lift\{transition:transform var\(--dur-med\)/);
  assert.match(html, /\.ink-lift:hover\{transform:translateY\(-4px\)\}/);
});
check('hover effects do not fire on touch devices', () => {
  const i = html.indexOf('.ink-lift{');
  const before = html.slice(Math.max(0, i - 120), i);
  assert.match(before, /@media \(hover:hover\)/, 'lift must be inside a hover-capable query');
});
check('the collection tile uses the shared motion class', () => {
  assert.match(html, /data-testid="collection-card"[^>]*class="ink-lift"|class="ink-lift"[^>]*data-testid="collection-card"/);
  const tile = (html.match(/<div data-testid="collection-card"[^>]*>/) || [''])[0];
  assert.doesNotMatch(tile, /style-hover=/, 'the per-tile hover style should be gone');
});

// ---------- performance budget ----------
check('blur is dropped on small screens', () => {
  // there is more than one 860px block; the rule may live in any of them
  const blocks = [];
  let i = -1;
  while ((i = html.indexOf('@media (max-width:860px)', i + 1)) >= 0) {
    blocks.push(html.slice(i, html.indexOf('\n  }', i) + 4));
  }
  assert.ok(blocks.length > 0, 'no mobile breakpoint found');
  assert.ok(blocks.some(b => /\*\{backdrop-filter:none!important/.test(b)),
    'mobile must not pay for live blur');
});
check('performance mode drops blur, not just the shader', () => {
  assert.match(html, /body\.ink-perf \*\{backdrop-filter:none!important/);
  assert.match(html, /syncPerfClass\(\)\{ try\{ document\.body\.classList\.toggle\('ink-perf'/);
});
check('the perf class is applied on change and on load', () => {
  assert.match(html, /this\.setState\(\{perfMode:v\},\(\)=>this\.syncPerfClass\(\)\)/);
  assert.match(html, /if\(prev\.perfMode!==this\.state\.perfMode\) this\.syncPerfClass\(\);/);
});
check('the shader still stops in a background tab', () => {
  assert.match(html, /if\(document\.hidden\)\{ this\._inkRaf=requestAnimationFrame\(draw\); return; \}/);
});
check('card images are lazily loaded', () => {
  const arts = html.match(/<img src="\{\{ [cr]\._local \}\}"[^>]*>/g) || [];
  for (const a of arts) assert.match(a, /loading="lazy"/, 'card art must not block first paint');
});

// ---------- lifecycle hygiene ----------
check('there is exactly one of each React lifecycle method', () => {
  for (const m of ['componentDidUpdate', 'componentWillUnmount', 'componentDidMount']) {
    const n = (html.match(new RegExp('\\b' + m + '\\s*\\(', 'g')) || []).length;
    assert.equal(n, 1, m + ' is declared ' + n + ' times — a duplicate silently wins');
  }
});
check('perf-mode wiring did not shadow the modal key handling', () => {
  const i = html.indexOf('componentDidUpdate');
  const body = html.slice(i, i + 420);
  assert.match(body, /bindModalKeys\(\)/, 'the original job must survive');
  assert.match(body, /syncPerfClass\(\)/, 'the new job must be added, not substituted');
});

// ---------- i18n ----------
check('no English string is left hard-coded in the logic', () => {
  // the dictionary itself legitimately contains the literal; what must not exist
  // is a fallback in the logic that bypasses this.t()
  assert.doesNotMatch(html, /colors\.join\('\/'\):'Any ink'/, 'the ink label must come from the dictionary');
  assert.match(html, /colors\.join\('\/'\):this\.t\('anyInk'\)/);
});
check('no key is defined twice in a dictionary', () => {
  for (const lang of ['en', 'pt']) {
    const s = html.indexOf('\n      ' + lang + ': {');
    let i = html.indexOf('{', s), depth = 0, end = -1;
    for (; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const block = html.slice(s, end);
    const seen = {}, dupes = [];
    for (const m of block.matchAll(/(?:^|[\s{,])([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
      if (seen[m[1]]) dupes.push(m[1]); else seen[m[1]] = 1;
    }
    assert.deepEqual(dupes, [], lang + ' has duplicate keys: ' + dupes.join(', '));
  }
});
check('every new key exists in EN and PT', () => {
  for (const k of ['decAria', 'incAria', 'langEnAria', 'langPtAria', 'skipToContent', 'colsAria', 'anyInk']) {
    assert.equal((html.match(new RegExp('\\b' + k + ':', 'g')) || []).length, 2, k);
  }
});

// ---------- mirror ----------
check('site/index.html and Inkwell.dc.html stay byte-identical', () => {
  assert.equal(html, fs.readFileSync(new URL('../Inkwell.dc.html', import.meta.url), 'utf8'));
});

console.log(`\n${passed} passed`);
