// A3 — controlled comparison of video frame vs photo (docs/scanner-2.0-avaliacao.md §6).
//
// The site, opened with ?medicao=a3, saves one JSON per page shot ("Baixar medição"): the video frame and the photo of the
// same instant and framing, the scanner's corners for each, resolutions, times, alignment, fallback, and what the scanner
// read in each pocket from each picture. This script scores both against the same gabarito.
//
//   node tools/a3_compare.mjs extract DIR        writes DIR/<name>-foto.jpg (or -video.jpg when there is no photo) to annotate
//                                                with tools/pagescan-annotate.html; its truth.json goes in DIR
//   node tools/a3_compare.mjs report DIR [OUT]   prints the comparison (Markdown) and writes OUT (JSON) if given
//
// The pictures stay local (own collection); only the aggregated report goes to the PR.
import fs from 'node:fs';
import path from 'node:path';
import { a3Compare, a3Markdown } from './pagescan-report.mjs';

const [cmd, DIR, OUT] = process.argv.slice(2);
if (!cmd || !DIR) { console.error('usage: node tools/a3_compare.mjs extract|report DIR [OUT.json]'); process.exit(2); }
const recs = fs.readdirSync(DIR).filter((f) => /^a3-.*\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))).filter((r) => r.a3 === 1);
if (!recs.length) { console.error(`no a3-*.json in ${DIR}`); process.exit(2); }

if (cmd === 'extract') {
  for (const r of recs) for (const k of ['foto', 'video']) {
    const m = r.modes[k]; if (!m?.jpeg) continue;
    fs.writeFileSync(path.join(DIR, `${r.name}-${k}.jpg`), Buffer.from(m.jpeg.split(',')[1], 'base64'));
  }
  console.log(`${recs.length} pages: annotate the -foto.jpg files (the -video.jpg of a page without photo) in tools/pagescan-annotate.html, export truth.json into ${DIR}`);
  process.exit(0);
}
if (cmd !== 'report') { console.error(`unknown command ${cmd}`); process.exit(2); }

// gabarito: truth.json from the annotation tool. Verdicts, summaries, coverage of the protocol (§1) and the §6.4
// criteria come from tools/pagescan-report.mjs, the same rules as the bench (§4): no second set of metrics.
const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
const report = a3Compare(recs, truth);
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(a3Markdown(report));
