// Scanner 2.0 measurements: run "Escanear página" on a folder of binder photos with known answers and report
// accuracy, time and how many pockets need the person. Not part of CI (it needs a generated or real photo set):
//
//   python3 tools/pagescan_synth.py /tmp/ps --pages 8          (or a folder of real photos with the same truth.json)
//   PAGESCAN_DIR=/tmp/ps PAGESCAN_OUT=/tmp/ps/report.json npx playwright test --project=chromium tools/pagescan-bench.spec.mjs
//
// The scanner gets truth.json's "user" corners (a page lined up by hand), never the true ones.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.PAGESCAN_DIR;
const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';

test.skip(!DIR, 'PAGESCAN_DIR not set');
test('Escanear página: accuracy and time on a photo set', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
  await page.route('**/__pagescan/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(path.join(DIR, decodeURIComponent(route.request().url().split('/__pagescan/')[1]))) }));
  await page.goto(new URL('colecao/', ROOT).href);
  await page.waitForFunction(() => typeof window.__inkwellScanPage === 'function');
  const rows = [];
  for (const p of truth.pages) {
    const r = await page.evaluate(async ({ file, quad }) => {
      const img = new Image(); img.src = new URL('/__pagescan/' + encodeURIComponent(file), location.href).href; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
      return window.__inkwellScanPage(ctx.getImageData(0, 0, c.width, c.height), quad);
    }, { file: p.file, quad: p.user });
    r.pockets.forEach((k, i) => rows.push({ file: p.file, cond: p.cond, i, truth: p.cards[i], ...k, ms: r.ms }));
  }
  // one verdict per pocket
  const verdict = (x) => {
    if (!x.truth) return x.status === 'empty' ? 'empty-ok' : x.status === 'ok' ? 'wrong-auto' : 'empty-flagged';
    if (x.status === 'empty') return 'missed-as-empty';
    if (x.status === 'ok') return x.id === x.truth ? 'auto-right' : 'wrong-auto';
    if (x.status === 'choose') return x.group.includes(x.truth) ? 'pick-right' : 'pick-wrong';
    if (x.status === 'check') return x.id === x.truth ? 'check-right' : x.top.some((t) => t.id === x.truth) ? 'check-in-suggestions' : 'check-wrong';
    return x.top.some((t) => t.id === x.truth) ? 'unknown-in-suggestions' : 'unknown';
  };
  for (const x of rows) x.v = verdict(x);
  const sum = (list) => {
    const cards = list.filter((x) => x.truth), n = cards.length, c = (...v) => list.filter((x) => v.includes(x.v)).length;
    const pct = (k, d = n) => (d ? Math.round((1000 * k) / d) / 10 : null);
    const pages = [...new Set(list.map((x) => x.file))].map((f) => list.find((x) => x.file === f).ms);
    const ms = pages.map((m) => m.total).sort((a, b) => a - b);
    return {
      pages: pages.length, cards: n, empty: list.length - n,
      // the card itself is right: recognised alone, or among the printings offered, or the suggestion to confirm
      identified_pct: pct(c('auto-right', 'pick-right', 'check-right')),
      auto_right_pct: pct(c('auto-right')),                                 // no action needed and right
      needs_person_pct: pct(cards.filter((x) => x.status !== 'ok').length), // pick a printing, confirm, search or skip
      wrong_auto: c('wrong-auto'),                                         // the dangerous one: confident and wrong
      in_suggestions_pct: pct(c('check-in-suggestions', 'unknown-in-suggestions')),
      empty_right: c('empty-ok'), missed_as_empty: c('missed-as-empty'),
      ms_median: ms[Math.floor(ms.length / 2)], ms_max: ms[ms.length - 1],
    };
  };
  const conds = [...new Set(rows.map((x) => x.cond))];
  const report = { all: sum(rows), by_cond: Object.fromEntries(conds.map((k) => [k, sum(rows.filter((x) => x.cond === k))])), verdicts: rows.map(({ file, i, truth, status, id, score, gap, tex, v }) => ({ file, i, truth, status, id, score: +score.toFixed(3), gap: +gap.toFixed(3), tex, v })) };
  if (process.env.PAGESCAN_OUT) fs.writeFileSync(process.env.PAGESCAN_OUT, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ all: report.all, by_cond: report.by_cond }, null, 1));
  expect(rows.length).toBe(truth.pages.length * 9);
});
