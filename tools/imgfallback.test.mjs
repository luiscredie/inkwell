// Image-fallback identity regression (M0R). No deps; extracts the live handlers
// from site/index.html and runs the A→B reused-tile scenario.
//   node tools/imgfallback.test.mjs
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const start = html.indexOf('window.imgError = function');
const end = html.indexOf('</script>', start);
const win = {};
new Function('window', html.slice(start, end))(win);

function makeImg(cid, local, remote){
  const ph = { style: { display: 'none' } };
  const el = { dataset: { cid, local, remote }, style: { display: '' }, src: local,
    parentElement: { querySelector: () => ph } };
  el._ph = ph; return el;
}
let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n); };

const el = makeImg('A', 'A_local', 'A_remote');
win.imgError({ target: el }); ck('A local→remote fallback', el.src === 'A_remote');
win.imgError({ target: el }); ck('A remote fail → placeholder', el.style.display === 'none' && el._ph.style.display === 'flex');
// reuse the same index-keyed node as Card B
el.dataset.cid = 'B'; el.dataset.local = 'B_local'; el.dataset.remote = 'B_remote'; el.src = 'B_local';
win.imgError({ target: el }); ck('B identity reset → tries B remote', el.src === 'B_remote' && el.style.display === '' && el._ph.style.display === 'none');
win.imgLoad({ target: el }); ck('B remote loads → visible, no placeholder', el.style.display === '' && el._ph.style.display === 'none');

const templateImages = [...html.matchAll(/<img[^>]+data-local="\{\{ [cr]\._local \}\}"[^>]+data-remote="\{\{ [cr]\._remote \}\}"[^>]+data-cid="\{\{ [cr]\.cid \}\}"[^>]+onLoad="\{\{ imgLoad \}\}"/g)];
ck('collection/builder/deck templates carry full image identity', templateImages.length === 3);

const variantStart = html.indexOf('const variants=vlist.map');
const variantEnd = html.indexOf('V.cm=', variantStart);
const variantCode = html.slice(variantStart, variantEnd);
ck('variant thumbnails carry full image identity',
  variantCode.includes("'data-local':vcv._local") &&
  variantCode.includes("'data-remote':vcv._remote") &&
  variantCode.includes("'data-cid':vc.card_id"));
ck('variant thumbnails reset on successful load',
  variantCode.includes('onLoad:window.imgLoad'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
