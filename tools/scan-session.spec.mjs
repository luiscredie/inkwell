// Coleção › Escanear, continuous mode (one card at a time): a session of 20 consecutive cards passed under a still
// phone, with repeats (two copies in a row, and cards that come back later) and foils (rainbow sheen drawn over the
// card). Measures latency per card, accuracy, duplicates, misses and the taps the person had to make; checks the
// session strip, count and running value, and that nothing is saved before the final confirmation.
// Fake camera and fake Supabase; Chromium. SESSION_OUT=<file> writes the measurements as JSON; SESSION_HOLD / SESSION_GAP
// (ms) change how long each card stays and the pause between cards; SESSION_OCR=off runs without the OCR stand-in.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = new URL('colecao/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';
const HOLD = +(process.env.SESSION_HOLD || 2200), GAP = +(process.env.SESSION_GAP || 600);

// 16 different cards (fixed seed, from the recognition index, JPG images), 20 passes:
// pass 6 = a second copy right after pass 5, passes 13 and 18 = cards seen earlier, passes 4, 9, 15 and 20 foil.
function sequence() {
  const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
  const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/scan-index.json'), 'utf8')).ids;
  const files = new Map();
  for (const f of fs.readdirSync(path.join(ROOT, 'site/lorcana-card-images/images'))) { const m = f.match(/__([A-Z0-9]+-[0-9A-Za-z-]+)\.jpg$/); if (m) files.set(m[1], f); }
  const pool = ids.filter((i) => files.has(i) && /^LOR\d+-\d+$/.test(i)).sort();
  let seed = 20261124; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const pick = []; while (pick.length < 16) { const id = pool[Math.floor(rnd() * pool.length)]; if (!pick.includes(id)) pick.push(id); }
  const order = [0, 1, 2, 3, 4, 4, 5, 6, 7, 8, 9, 10, 2, 11, 12, 13, 14, 8, 15, 3];
  const foil = new Set([3, 8, 14, 19]);
  return order.map((k, n) => ({ id: pick[k], file: files.get(pick[k]), foil: foil.has(n) }));
}

test('continuous scan: 20 consecutive cards, repeats and foils', async ({ page }) => {
  const SEQ = sequence();
  test.setTimeout(60000 + SEQ.length * (HOLD + GAP) * 2);
  const calls = [];
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), p = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, '');
    calls.push({ path: p, body: req.postData() ? JSON.parse(req.postData()) : null });
    if (p === 'inkwell_profiles') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ profile: 'luiscredie', updated_at: '2026-10-20T10:00:00Z', collection: {} }]) });
    if (p.startsWith('rpc/')) return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  // the camera: each pass shows one card in the frame (slightly off, as a hand puts it) for HOLD ms, then the empty
  // table for GAP ms. The schedule starts when the test calls __seqStart().
  await page.addInitScript(({ seq, HOLD, GAP, ocr }) => {
    window.__seq = { seq, start: null, shown: [] };
    // OCR of the collector line (reprints share the art): here a correct reading of the card in the frame, because the
    // test machine can't download Tesseract. SESSION_OCR=off measures the scanner with no OCR at all.
    if (ocr) window.INKWELL_SCAN_OCR = async () => { const k = window.__seqNow(); const m = k >= 0 && seq[k].id.match(/^LOR(\d+)-(\d+)/); return m ? `${m[2]}/204 · EN · ${m[1]}` : ''; };
    window.__seqStart = () => { window.__seq.start = performance.now(); };
    window.__seqNow = () => { const s = window.__seq; if (s.start == null) return -1; const k = Math.floor((performance.now() - s.start) / (HOLD + GAP)); return k < seq.length && (performance.now() - s.start) % (HOLD + GAP) < HOLD ? k : -1; };
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas'); c.width = 720; c.height = 1280; const ctx = c.getContext('2d');
      const imgs = seq.map((x) => { const i = new Image(); i.src = `../lorcana-card-images/images/${x.file}`; return i; });
      setInterval(() => {
        ctx.fillStyle = '#5a4535'; ctx.fillRect(0, 0, c.width, c.height);
        const k = window.__seqNow(), g = window.__inkwellScanGuide?.(); if (k < 0 || !g) return;
        const s = window.__seq; if (s.shown[k] == null) s.shown[k] = performance.now();
        const im = imgs[k]; if (!im.complete || !im.naturalWidth) return;
        const w = g.w * (0.9 + (k % 3) * 0.03), h = w * 88 / 63, dx = ((k % 5) - 2) * g.w * 0.015, dy = ((k % 4) - 1.5) * g.h * 0.012;
        ctx.save(); ctx.translate(g.x + g.w / 2 + dx, g.y + g.h / 2 + dy); ctx.rotate(((k % 7) - 3) * 0.006); ctx.drawImage(im, -w / 2, -h / 2, w, h);
        if (seq[k].foil) {   // foil: a rainbow sheen across the card
          const gr = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
          ['#ff4040', '#ffd040', '#40ff80', '#40c0ff', '#c040ff'].forEach((col, j) => gr.addColorStop(j / 4, col));
          ctx.globalAlpha = 0.22; ctx.fillStyle = gr; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.globalAlpha = 1;
        }
        ctx.restore();
      }, 60);
      return c.captureStream(15);
    };
  }, { seq: SEQ, HOLD, GAP, ocr: process.env.SESSION_OCR !== 'off' });

  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).first().click();
  await page.waitForFunction(() => document.getElementById('scanVideo')?.videoWidth > 0);
  await page.waitForFunction(() => window.__inkwellScanIdentify && document.querySelector('#scanSay')?.textContent.length > 0);
  await page.waitForTimeout(1500);   // the recognition index is loaded
  await page.evaluate(() => window.__seqStart());

  // the person: only acts when the scanner asks (a printing to pick) — each such answer is counted as a tap
  let taps = 0; const end = Date.now() + SEQ.length * (HOLD + GAP) + 3000;
  while (Date.now() < end) {
    const k = await page.evaluate(() => window.__seqNow());
    const ask = page.locator('#scanPick [data-pick]');
    if (k >= 0 && await ask.count()) {
      const want = page.locator(`#scanPick [data-pick="${SEQ[k].id}"]`);
      if (await want.count()) await want.first().click(); else await page.locator('#scanPick [data-pick=""]').first().click().catch(() => {});
      taps++;
    }
    await page.waitForTimeout(120);
  }
  const res = await page.evaluate(() => ({ added: window.__inkwellScanSession(), shown: window.__seq.shown }));

  // match each pass to what was added: in order, the first addition after it appeared and before the next pass ends
  const passes = SEQ.map((x, k) => ({ ...x, k, shownAt: res.shown[k] ?? null }));
  const used = new Set(), out = [];
  for (const p of passes) {
    const until = p.shownAt + HOLD + GAP;
    const j = res.added.findIndex((a, i) => !used.has(i) && a.at >= p.shownAt && a.at <= until);
    if (j >= 0) { used.add(j); out.push({ k: p.k, truth: p.id, foil: p.foil, got: res.added[j].id, gotFoil: res.added[j].foil, ms: Math.round(res.added[j].at - p.shownAt) }); }
    else out.push({ k: p.k, truth: p.id, foil: p.foil, got: null, ms: null });
  }
  const extra = res.added.filter((_, i) => !used.has(i)).map((a) => a.id);   // added but matching no pass: duplicates
  const right = out.filter((o) => o.got === o.truth).length, wrong = out.filter((o) => o.got && o.got !== o.truth).length;
  const lat = out.filter((o) => o.ms != null).map((o) => o.ms).sort((a, b) => a - b);
  const m = {
    passes: SEQ.length, added: res.added.length, right, wrong, missed: out.filter((o) => !o.got).length, extra: extra.length,
    foil_right: out.filter((o) => o.foil && o.got === o.truth).length + '/' + SEQ.filter((x) => x.foil).length,
    // the scanner does not tell foil from normal by itself: the Normal/Foil switch (top) or the review sets it
    foil_marked: out.filter((o) => o.foil && o.gotFoil).length + '/' + SEQ.filter((x) => x.foil).length,
    repeat_in_a_row_right: out[4].got === out[4].truth && out[5].got === out[5].truth,
    taps, latency_ms_median: lat[Math.floor(lat.length / 2)] ?? null, latency_ms_max: lat[lat.length - 1] ?? null,
    ocr: process.env.SESSION_OCR !== 'off' ? 'simulated (correct reading)' : 'off', session_s: Math.round(SEQ.length * (HOLD + GAP) / 100) / 10, hold_ms: HOLD, gap_ms: GAP, detail: out, extra_ids: extra,
  };
  console.log('SESSION', JSON.stringify({ ...m, detail: undefined }));
  if (process.env.SESSION_OUT) fs.writeFileSync(process.env.SESSION_OUT, JSON.stringify(m, null, 1));
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/sessao-20.png` });

  // the session view: strip (newest first), count and running value
  await expect(page.getByTestId('scan-count')).toHaveText(`${res.added.length} na lista`);
  const strip = page.getByTestId('scan-strip');
  await expect(strip).toBeVisible();
  await expect(strip.locator('.s-item')).toHaveCount(Math.min(12, res.added.length));
  await expect(page.getByTestId('scan-value')).toHaveText(/^≈ R\$\s?\d/);
  // safety: nothing saved before the confirmation; then one save with exactly the list
  expect(calls.filter((c) => c.path === 'rpc/apply_collection_delta')).toEqual([]);
  // floor for this fake camera: every pass read, no duplicate, the two copies in a row both counted
  expect({ wrong: m.wrong, extra: m.extra, rowOk: m.repeat_in_a_row_right }).toEqual({ wrong: 0, extra: 0, rowOk: true });
  if (process.env.SESSION_OCR !== 'off') expect(m.right).toBeGreaterThanOrEqual(18);
  await page.getByRole('button', { name: 'Concluir' }).click();
  const review = page.getByTestId('scan-review');
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: new RegExp(`Adicionar ${res.added.length} cartas`) }).click();
  await expect.poll(() => calls.filter((c) => c.path === 'rpc/apply_collection_delta').length).toBeGreaterThan(0);
  const net = {}; for (const d of calls.filter((c) => c.path === 'rpc/apply_collection_delta').flatMap((c) => c.body.p_delta)) net[d.card_id] = (net[d.card_id] || 0) + d.qty;
  const want = {}; for (const a of res.added) want[a.id] = (want[a.id] || 0) + 1;
  expect(net).toEqual(want);
});

test('continuous scan: the running value says when prices are missing or out of date', async ({ page }) => {
  test.setTimeout(90000);
  const SEQ = sequence().slice(0, 3);
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', (route) => { const p = new URL(route.request().url()).pathname.replace(/.*\/rest\/v1\//, '');
    if (p === 'inkwell_profiles') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ profile: 'luiscredie', updated_at: '2026-10-20T10:00:00Z', collection: {} }]) });
    return route.fulfill({ status: p.startsWith('rpc/') ? 204 : 200, contentType: 'application/json', body: p.startsWith('rpc/') ? '' : '[]' }); });
  // an old price file, and no price at all for the first card of the session
  await page.route('**/data/prices.json', async (route) => { const r = await route.fetch(); const j = await r.json(); j.generated_at = '2026-01-05T10:00:00Z'; delete j.prices[SEQ[0].id];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); });
  await page.route('**/data/prices-br.json', (route) => route.fulfill({ status: 404, body: '' }));
  await page.addInitScript(({ seq }) => {
    let start = null; window.__go = () => { start = performance.now(); };
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas'); c.width = 720; c.height = 1280; const ctx = c.getContext('2d');
      const imgs = seq.map((x) => { const i = new Image(); i.src = `../lorcana-card-images/images/${x.file}`; return i; });
      setInterval(() => { ctx.fillStyle = '#5a4535'; ctx.fillRect(0, 0, c.width, c.height); const g = window.__inkwellScanGuide?.(); if (start == null || !g) return;
        const t = performance.now() - start, k = Math.floor(t / 2800); if (k >= seq.length || t % 2800 > 2200) return; const im = imgs[k]; if (!im.naturalWidth) return;
        const w = g.w * 0.93, h = w * 88 / 63; ctx.drawImage(im, g.x + (g.w - w) / 2, g.y + (g.h - h) / 2, w, h); }, 60);
      return c.captureStream(15); };
  }, { seq: SEQ });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).first().click();
  await page.waitForFunction(() => document.getElementById('scanVideo')?.videoWidth > 0);
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__go());
  await expect(page.getByTestId('scan-count')).toHaveText('3 na lista', { timeout: 20000 });
  await expect(page.getByTestId('scan-value-note')).toContainText('1 sem preço');
  await expect(page.getByTestId('scan-value-note')).toContainText('desatualizados');
  await expect(page.getByTestId('scan-value-note')).toHaveClass(/price-warn/);
});
