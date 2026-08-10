// M3 PWA contract: manifest, service worker caching policy, offline/update UX.
//   node tools/pwa-contract.test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('site/index.html');
const sw = read('site/sw.js');
const manifest = JSON.parse(read('site/manifest.webmanifest'));

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('✓', name); };

// ---------- manifest ----------
check('the manifest is valid JSON with the fields an install needs', () => {
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons', 'background_color', 'theme_color']) {
    assert.ok(manifest[k], 'missing ' + k);
  }
  assert.equal(manifest.display, 'standalone');
});
check('paths are relative, so the app installs from a project subpath', () => {
  assert.ok(!manifest.start_url.startsWith('/'), 'an absolute start_url breaks GitHub Pages project sites');
  assert.ok(!manifest.scope.startsWith('/'), 'an absolute scope breaks GitHub Pages project sites');
  for (const i of manifest.icons) assert.ok(!i.src.startsWith('/'), 'absolute icon path: ' + i.src);
});
check('both required icon sizes exist on disk and are declared', () => {
  const sizes = manifest.icons.map(i => i.sizes);
  assert.ok(sizes.includes('192x192'), '192 is required for Android');
  assert.ok(sizes.includes('512x512'), '512 is required for the splash screen');
  for (const i of manifest.icons) {
    assert.ok(fs.existsSync(new URL('site/' + i.src, root)), 'icon file missing: ' + i.src);
  }
});
check('a maskable icon is provided so Android does not crop the coin', () => {
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
});
check('the theme colour matches the app background', () => {
  assert.equal(manifest.background_color, '#0a0c10');
  assert.equal(manifest.theme_color, '#0a0c10');
  assert.match(html, /<meta name="theme-color" content="#0a0c10">/);
});
check('the page links the manifest and the iOS icon', () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="ink\/icon-192\.png">/);
  assert.match(html, /apple-mobile-web-app-capable/);
});

// ---------- service worker: policy, not just presence ----------
check('the service worker parses as JavaScript', () => {
  new Function('self', 'caches', 'fetch', 'URL', 'Promise', sw);
});
check('user data is never cached', () => {
  assert.match(sw, /path\.includes\('\/users\/'\) \|\| path\.includes\('sync-config'\)/);
  const i = sw.indexOf("path.includes('/users/')");
  const after = sw.slice(i, i + 120);
  assert.match(after, /return;/, 'the handler must bail out before any caching');
});
check('the root worker yields the /sim/ scope to the simulator', () => {
  assert.match(sw, /if \(path\.includes\('\/sim\/'\)\) return;/);
  const i = sw.indexOf("path.includes('/sim/')");
  const nav = sw.indexOf("req.mode === 'navigate'");
  assert.ok(i < nav, 'the bail-out must come before the navigation fallback');
});
check('cross-origin requests are left alone', () => {
  assert.match(sw, /if \(url\.origin !== self\.location\.origin\) return;/);
});
check('only GET is intercepted', () => {
  assert.match(sw, /if \(req\.method !== 'GET'\) return;/);
});
check('the version pointer is network-first, or the app would pin to an old build', () => {
  assert.match(sw, /path\.endsWith\('data-manifest\.json'\)[\s\S]{0,80}networkFirst/);
});
check('prices are network-first with a cached fallback', () => {
  const i = sw.indexOf("path.endsWith('prices.json')");
  assert.ok(i > 0, 'prices need their own rule — they change daily');
  assert.match(sw.slice(i - 60, i + 120), /networkFirst/);
});
check('versioned data is cache-first, since the manifest makes it immutable', () => {
  const i = sw.indexOf("path.endsWith('.json')");
  assert.match(sw.slice(i, i + 140), /cacheFirst/);
  assert.ok(sw.indexOf("path.endsWith('data-manifest.json')") < i,
    'the manifest rule must come before the generic .json rule or it never runs');
  assert.ok(sw.indexOf("path.endsWith('prices.json')") < i,
    'the prices rule must come before the generic .json rule');
});
check('the app shell is network-first, so an update can land', () => {
  const i = sw.indexOf("req.mode === 'navigate'");
  assert.match(sw.slice(i, i + 140), /networkFirst/);
});
check('a failed navigation falls back to the cached shell', () => {
  assert.match(sw, /caches\.match\('\.\/index\.html'\)/);
});
check('card art is capped, so a big collection cannot fill the disk', () => {
  assert.match(sw, /ART_MAX = \d+/);
  const cap = +(sw.match(/ART_MAX = (\d+)/) || [])[1];
  assert.ok(cap > 0 && cap <= 2000, 'the cap must be a real bound, got ' + cap);
  assert.match(sw, /cacheFirst\(req, ART, ART_MAX\)/);
  assert.match(sw, /async function trimCache/);
});
check('the trim keeps the newest entries and deletes the oldest', () => {
  const i = sw.indexOf('async function trimCache');
  const body = sw.slice(i, i + 400);
  assert.match(body, /keys\.slice\(0, keys\.length - max\)/, 'must delete from the front, not the back');
});
check('old cache versions are cleared on activate', () => {
  assert.match(sw, /keys\.filter\(k => !k\.startsWith\(VERSION\)\)\.map\(k => caches\.delete\(k\)\)/);
});
check('a missing shell file does not break the whole install', () => {
  assert.match(sw, /SHELL_URLS\.map\(u => c\.add\(u\)\.catch\(\(\) => \{\}\)\)/,
    'addAll would fail the entire install if one URL 404s');
});
check('the shell list covers the files the app actually loads', () => {
  for (const f of ['./index.html', './support.js', './match-center-engine.js', './manifest.webmanifest']) {
    assert.ok(sw.includes("'" + f + "'"), 'shell missing ' + f);
  }
});

// ---------- registration ----------
check('registration is guarded against file:// and unsupported browsers', () => {
  assert.match(html, /if\(!\('serviceWorker' in navigator\)\) return;/);
  assert.match(html, /if\(!\/\^https\?:\$\/\.test\(location\.protocol\)\) return;/,
    'the .dc.html mirror opens from file:// where registration throws');
});
check('registration failure is swallowed rather than breaking boot', () => {
  assert.match(html, /navigator\.serviceWorker\.register\('sw\.js'\)[\s\S]{0,600}\.catch\(\(\)=>\{\}\)/);
});
check('PWA setup runs on mount and is torn down on unmount', () => {
  assert.match(html, /componentDidMount\(\) \{\s*this\.initPwa\(\);/);
  assert.match(html, /componentWillUnmount\(\)\{[^}]*this\.releasePwa\(\);/);
});
check('online and offline listeners are both added and removed', () => {
  for (const ev of ['online', 'offline', 'beforeinstallprompt']) {
    assert.ok(html.includes("window.addEventListener('" + ev + "'"), 'missing add: ' + ev);
    assert.ok(html.includes("window.removeEventListener('" + ev + "'"), 'missing remove: ' + ev);
  }
});

// ---------- UX ----------
check('an update is offered, never forced mid-task', () => {
  assert.match(html, /w\.state==='installed'&&navigator\.serviceWorker\.controller\) this\.setState\(\{swUpdate:true\}\)/);
  assert.match(html, /\{\{ doUpdate \}\}/, 'the reload must be user-initiated');
  assert.doesNotMatch(html, /updatefound[\s\S]{0,400}location\.reload\(\)/,
    'reloading automatically would discard an in-progress import');
});
check('the offline banner tells the user what still works', () => {
  assert.match(html, /\{\{ offlineText \}\}/);
  for (const lang of ['offlineBanner']) {
    assert.equal((html.match(new RegExp('\\b' + lang + ':', 'g')) || []).length, 2);
  }
  assert.match(html, /offlineBanner:'You are offline\. Your collection and decks still work/);
});
check('offline and update banners are announced', () => {
  const off = html.indexOf('{{ offlineText }}');
  assert.match(html.slice(off - 260, off), /role="status" aria-live="polite"/);
  const up = html.indexOf('{{ updateText }}');
  assert.match(html.slice(up - 420, up), /role="status" aria-live="polite"/);
});
check('the install button only shows when the browser offers it', () => {
  assert.match(html, /<sc-if value="\{\{ canInstall \}\}"/);
  assert.match(html, /V\.canInstall=!!st\.installPrompt/);
  assert.match(html, /e\.preventDefault\(\); this\.setState\(\{installPrompt:e\}\)/);
});
check('the install prompt is cleared after use, since it cannot be reused', () => {
  const i = html.indexOf('promptInstall=async()=>{');
  assert.match(html.slice(i, i + 260), /this\.setState\(\{installPrompt:null\}\)/);
});
check('the install button does not sit on top of the perf toggle', () => {
  const i = html.indexOf('{{ installText }}');
  assert.match(html.slice(i - 400, i), /bottom:64px/, 'the perf pill is at bottom:18px');
});
check('every new key exists in EN and PT', () => {
  for (const k of ['offlineBanner', 'updateReady', 'updateNow', 'installCta']) {
    assert.equal((html.match(new RegExp('\\b' + k + ':', 'g')) || []).length, 2, k);
  }
});

// ---------- mirror ----------
check('site/index.html and Inkwell.dc.html stay byte-identical', () => {
  assert.equal(html, read('Inkwell.dc.html'));
});

console.log(`\n${passed} passed`);
