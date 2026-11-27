// Scanner 2.0 measurements: run "Escanear página" on a folder of binder photos with known answers and report
// accuracy, time and how many pockets need the person. Not part of CI (it needs a generated or real photo set).
// The report (tools/pagescan-report.mjs) says whether the set covers the protocol before judging any target:
//
//   python3 tools/pagescan_synth.py /tmp/ps --pages 8          (or a folder of real photos with the same truth.json)
//   PAGESCAN_DIR=/tmp/ps PAGESCAN_OUT=/tmp/ps/report.json PAGESCAN_MD=/tmp/ps/report.md [PAGESCAN_EXP=nodetrend] npx playwright test --project=chromium tools/pagescan-bench.spec.mjs
//
// The scanner gets truth.json's "user" corners (a page lined up by hand), never the true ones.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { report as makeReport, markdown } from './pagescan-report.mjs';

const DIR = process.env.PAGESCAN_DIR;
const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';

test.skip(!DIR, 'PAGESCAN_DIR not set');
test('Escanear página: accuracy and time on a photo set', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
  await page.route('**/__pagescan/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(path.join(DIR, decodeURIComponent(route.request().url().split('/__pagescan/')[1]))) }));
  if (process.env.PAGESCAN_EXP) await page.addInitScript((x) => { window.INKWELL_SCAN_EXP = x; }, process.env.PAGESCAN_EXP);   // e.g. nodetrend
  await page.goto(new URL('colecao/', ROOT).href);
  await page.waitForFunction(() => typeof window.__inkwellScanPage === 'function');
  // Real photos are annotated with exact corners; a person lines the page up by hand. PAGESCAN_JITTER=0.02 moves each
  // corner by up to 2% of the page size (same pseudo-random moves on every run).
  const J = +(process.env.PAGESCAN_JITTER || 0); let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  const jitter = (q) => { if (!J) return q; const w = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), h = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]); return q.map(([x, y]) => [x + rnd() * J * w, y + rnd() * J * h]); };
  const rows = [];
  for (const p of truth.pages) {
    const r = await page.evaluate(async ({ file, quad }) => {
      // fetch + createImageBitmap: decoded for sure before drawing (Image.decode() sometimes drew nothing, #333);
      // a phone photo's EXIF orientation is applied, as the annotation tool does
      const img = await createImageBitmap(await (await fetch(new URL('/__pagescan/' + encodeURIComponent(file), location.href).href)).blob(), { imageOrientation: 'from-image' });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
      return window.__inkwellScanPage(ctx.getImageData(0, 0, c.width, c.height), quad);
    }, { file: p.file, quad: jitter(p.user) });
    r.pockets.forEach((k, i) => rows.push({ file: p.file, cond: p.cond, device: p.device || '', where: p.where || '', i, truth: p.cards[i], ...k, desktop_ms: r.ms.total,
      device_s: typeof p.device_s === 'number' ? p.device_s : null }));
  }
  const report = makeReport(truth, rows, { jitter: J });
  if (process.env.PAGESCAN_OUT) fs.writeFileSync(process.env.PAGESCAN_OUT, JSON.stringify(report, null, 1));
  if (process.env.PAGESCAN_MD) fs.writeFileSync(process.env.PAGESCAN_MD, markdown(report) + '\n');
  console.log(markdown(report));
  expect(rows.length).toBe(truth.pages.length * 9);
});
