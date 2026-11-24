// Inkwell Mobile — release web bundle: the app's own copy of the site, so it opens without loading inkwell.com.br.
//
//   node build-release.mjs            -> mobile/build/release (then INKWELL_TARGET=release npx cap sync)
//
// What goes in, and what stays on the network:
//   in    every page's HTML/CSS/JS, ui/, ink/ (icons), and the catalog data that rarely changes (cards, card text,
//         legality, archetypes, scanner index)
//   out   the card images (988 MB): loaded from https://inkwell.com.br/lorcana-card-images/ as on the web
//   out   prices and price history (change every day): fetched from https://inkwell.com.br/data/; without a
//         connection the pages open without prices, as the site already does when prices fail
//   out   pages no app page links to: ai-lab, 3d-demo, sim, coach-hub, dlc-londres
//
// Only the copies in build/release are rewritten (image and price URLs, and the page's connect-src so prices can be
// fetched). src/site and site/ are not touched. The site's commit is recorded in build/release/app-build.json.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SITE = path.resolve(HERE, '../site');
const OUT = path.resolve(HERE, 'build/release');
const REMOTE = 'https://inkwell.com.br/';
const SKIP_DIRS = new Set(['lorcana-card-images', 'ai-lab', '3d-demo', 'sim', 'coach-hub', 'dlc-londres']);   // none is linked from the app's pages
const DATA_IN = ['cards.json', 'card-text.json', 'legality.json', 'meta-archetypes.json', 'scan-index.json', 'scan-index.bin'];
const DATA_REMOTE = ['prices.json', 'prices-br.json', 'price-history.json', 'price-history-tcg.json'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let files = 0, bytes = 0;
const copy = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); files++; bytes += fs.statSync(dst).size; };
function walk(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) {
      if (!rel && (SKIP_DIRS.has(e.name) || e.name === 'data')) continue;
      walk(path.join(dir, e.name), r);
    } else if (e.isFile()) copy(path.join(dir, e.name), path.join(OUT, r));
  }
}
walk(SITE);
for (const f of DATA_IN) copy(path.join(SITE, 'data', f), path.join(OUT, 'data', f));

// rewrite the copied pages
const unknown = new Set();
let pages = 0;
for (const f of fs.readdirSync(OUT, { recursive: true })) {
  if (!f.endsWith('.html')) continue;
  const p = path.join(OUT, f);
  let h = fs.readFileSync(p, 'utf8');
  const before = h;
  h = h.replaceAll('../lorcana-card-images/', `${REMOTE}lorcana-card-images/`);
  for (const d of DATA_REMOTE) h = h.replaceAll(`../data/${d}`, `${REMOTE}data/${d}`);
  // the prices come from inkwell.com.br now: allow that origin to be fetched
  h = h.replace(/(connect-src [^;"]*)/, (m) => (m.includes(REMOTE.slice(0, -1)) ? m : `${m} ${REMOTE.slice(0, -1)}`));
  for (const m of h.matchAll(/\.\.\/data\/([A-Za-z0-9_.\-]+)/g)) if (!DATA_IN.includes(m[1])) unknown.add(`${f}: ${m[1]}`);
  if (h !== before) { fs.writeFileSync(p, h); pages++; }
}
if (unknown.size) { console.error('Data file neither bundled nor remote:\n  ' + [...unknown].join('\n  ')); process.exit(1); }

let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { cwd: SITE }).toString().trim(); } catch {}
const meta = { built_at: new Date().toISOString(), site_commit: commit, files, bytes, rewritten_pages: pages, remote: REMOTE, data_bundled: DATA_IN, data_remote: DATA_REMOTE, skipped: [...SKIP_DIRS] };
fs.writeFileSync(path.join(OUT, 'app-build.json'), JSON.stringify(meta, null, 1));
console.log(`release bundle: ${files} files, ${(bytes / 1048576).toFixed(1)} MB, ${pages} pages rewritten, site ${commit} -> ${path.relative(process.cwd(), OUT)}`);
