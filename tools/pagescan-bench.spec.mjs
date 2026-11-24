// Scanner 2.0 measurements: run "Escanear página" on a folder of binder photos with known answers and report
// accuracy, time and how many pockets need the person. Not part of CI (it needs a generated or real photo set):
//
//   python3 tools/pagescan_synth.py /tmp/ps --pages 8          (or a folder of real photos with the same truth.json)
//   PAGESCAN_DIR=/tmp/ps PAGESCAN_OUT=/tmp/ps/report.json [PAGESCAN_EXP=nodetrend] npx playwright test --project=chromium tools/pagescan-bench.spec.mjs
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
      const img = new Image(); img.src = new URL('/__pagescan/' + encodeURIComponent(file), location.href).href; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
      return window.__inkwellScanPage(ctx.getImageData(0, 0, c.width, c.height), quad);
    }, { file: p.file, quad: jitter(p.user) });
    r.pockets.forEach((k, i) => rows.push({ file: p.file, cond: p.cond, device: p.device || '', i, truth: p.cards[i], ...k, ms: r.ms }));
  }
  // one verdict per pocket (the categories the Council asked for, 24/11)
  //   auto-right       recognised alone and right: nothing for the person to do
  //   false-positive   recognised alone but wrong card, or a card "found" in an empty pocket: the dangerous case
  //   first-right      the person is asked, and the first answer offered (suggestion / printing) is right
  //   alt-right        the person is asked, the right card is among the other suggestions or printings
  //   not-offered      the right card is not offered: the person must search by name
  //   card-as-empty    a card read as an empty pocket: it would be left out unless the person looks
  //   empty-right / empty-asked   an empty pocket read as empty / sent to the person
  const verdict = (x) => {
    if (!x.truth) return x.status === 'empty' ? 'empty-right' : x.status === 'ok' ? 'false-positive' : 'empty-asked';
    if (x.status === 'empty') return 'card-as-empty';
    if (x.status === 'ok') return x.id === x.truth ? 'auto-right' : 'false-positive';
    if (x.id === x.truth) return 'first-right';
    if (x.group.includes(x.truth) || x.top.some((t) => t.id === x.truth)) return 'alt-right';
    return 'not-offered';
  };
  for (const x of rows) x.v = verdict(x);
  const sum = (list) => {
    const cards = list.filter((x) => x.truth), n = cards.length, empties = list.length - n, c = (v, l = list) => l.filter((x) => x.v === v).length;
    const pct = (k, d = n) => (d ? Math.round((1000 * k) / d) / 10 : null);
    const pages = [...new Set(list.map((x) => x.file))].map((f) => list.find((x) => x.file === f).ms);
    const ms = pages.map((m) => m.total).sort((a, b) => a - b);
    return {
      pages: pages.length, cards: n, empty_pockets: empties,
      auto_right_pct: pct(c('auto-right')),
      first_right_pct: pct(c('first-right')),
      alt_right_pct: pct(c('alt-right')),
      not_offered_pct: pct(c('not-offered')),
      card_as_empty: c('card-as-empty'),
      false_positive: c('false-positive'),                          // cards + empty pockets
      // "identified": the right card is what the scanner puts first (alone or as the first suggestion)
      identified_pct: pct(c('auto-right') + c('first-right')),
      // "within reach": identified, or one tap away among the suggestions
      within_reach_pct: pct(c('auto-right') + c('first-right') + c('alt-right')),
      needs_person_pct: pct(cards.filter((x) => x.status !== 'ok').length),
      empty_right: c('empty-right'), empty_asked: c('empty-asked'),
      ms_median: ms[Math.floor(ms.length / 2)], ms_max: ms[ms.length - 1],
    };
  };
  const conds = [...new Set(rows.map((x) => x.cond))];
  const devices = [...new Set(rows.map((x) => x.device).filter(Boolean))];
  const report = { photos: truth.real ? 'real' : 'synthetic', jitter: J, all: sum(rows), by_device: Object.fromEntries(devices.map((d) => [d, sum(rows.filter((x) => x.device === d))])), by_cond: Object.fromEntries(conds.map((k) => [k, sum(rows.filter((x) => x.cond === k))])), verdicts: rows.map(({ file, i, truth, status, id, score, gap, tex, v }) => ({ file, i, truth, status, id, score: +score.toFixed(3), gap: +gap.toFixed(3), tex, v })) };
  if (process.env.PAGESCAN_OUT) fs.writeFileSync(process.env.PAGESCAN_OUT, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ photos: report.photos, all: report.all, by_device: report.by_device, by_cond: report.by_cond }, null, 1));
  expect(rows.length).toBe(truth.pages.length * 9);
});
