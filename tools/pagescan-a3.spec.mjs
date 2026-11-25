// A3 procedure check (docs/scanner-2.0-avaliacao.md), end to end, the way the person will do it: photos of binder pages
// from three "devices" → annotated in tools/pagescan-annotate.html (corners clicked, cards typed, device, time on the
// phone, light) → "Exportar truth.json" → the same folder measured by the scanner → the report.
// The photos here are generated (cards drawn on a dark page), so the report must say "incompleto" and judge no target.
// It checks the procedure, not the scanner: no result of this test is a measurement of the product.
//
//   npx playwright test --project=chromium tools/pagescan-a3.spec.mjs      (writes A3_OUT or the test's output folder)
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { report as makeReport, markdown } from './pagescan-report.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const SITE = new URL('colecao/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const DEVICES = [['iPhone teste', 'app-ios', 2.4], ['Android A', 'app-android', 3.1], ['Android B (antigo)', 'navegador', 6.8]];
const PAGE = ['Rapunzel_-_Tower_Defender__LOR13-80', '4_Town_-_Hottest_Band_of_the_Year__LOR13-17', 'Owl_-_Hunny_Ranger__LOR13-185', 'Piglet_-_Hunny_Mage_Apprentice__LOR13-154',
  'Rabbit_-_Hunny_Paladin__LOR13-5', 'Elsa_-_Concerned_Sister__LOR11-125', null, 'Winnie_the_Pooh_-_Hunny_Archmage__LOR13-40', 'Junior_Woodchuck_Guidebook__LOR10-66'];
const ID = (f) => (f ? f.split('__')[1] : null);

test('A3 procedure: annotate → truth.json → scanner → report (generated photos: incomplete, no target judged)', async ({ page }, info) => {
  test.setTimeout(240000);
  const out = process.env.A3_OUT || info.outputPath('a3');
  fs.mkdirSync(out, { recursive: true });
  // 1. two photos per device (a second page rotated a little), as JPEG files on disk
  await page.goto(SITE);
  const photos = [];
  for (const [d] of DEVICES) for (let k = 0; k < 2; k++) {
    const b64 = await page.evaluate(async ({ files, tilt }) => {
      const c = document.createElement('canvas'); c.width = 1200; c.height = 1600; const ctx = c.getContext('2d');
      ctx.fillStyle = '#6b5440'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.translate(600, 800); ctx.rotate(tilt); ctx.translate(-600, -800);
      const x0 = 180, y0 = 200, W = 840, H = W / 0.72; ctx.fillStyle = '#18191f'; ctx.fillRect(x0, y0, W, H);
      for (const [i, f] of files.entries()) { if (!f) continue; const im = await createImageBitmap(await (await fetch(`../lorcana-card-images/images/${f}.jpg`)).blob());
        const cw = W / 3, ch = H / 3; ctx.drawImage(im, x0 + (i % 3) * cw + cw * 0.04, y0 + Math.floor(i / 3) * ch + ch * 0.03, cw * 0.92, ch * 0.94); }
      return c.toDataURL('image/jpeg', 0.88).split(',')[1];
    }, { files: PAGE, tilt: k ? 0.03 : 0 });
    const file = `${d.replace(/\W+/g, '-')}-${k + 1}.jpg`; fs.writeFileSync(path.join(out, file), Buffer.from(b64, 'base64')); photos.push({ file, device: d, tilt: k ? 0.03 : 0 });
  }
  // 2. the annotation tool, served from the repository as the protocol says
  await page.route('http://a3.test/**', (r) => { const p = path.join(REPO, decodeURIComponent(new URL(r.request().url()).pathname));
    return fs.existsSync(p) ? r.fulfill({ body: fs.readFileSync(p), contentType: p.endsWith('.html') ? 'text/html' : p.endsWith('.json') ? 'application/json' : 'application/octet-stream' }) : r.fulfill({ status: 404, body: '' }); });
  await page.goto('http://a3.test/tools/pagescan-annotate.html');
  await expect(page.locator('#status')).toContainText('cartas no catálogo');
  await page.locator('#pick').setInputFiles(photos.map((p) => path.join(out, p.file)));
  const cv = page.locator('#cv');
  const order = [...photos].sort((a, b) => a.file.localeCompare(b.file));   // the tool lists the photos by file name
  const typed = {};
  for (const [k, p] of order.entries()) {
    await expect(page.locator(`#files li[data-k="${k}"]`)).toHaveText(p.file);
    const [d, where, s] = DEVICES.find((x) => x[0] === p.device);
    await page.locator('#device').fill(d); await page.locator('#where').selectOption(where); typed[p.file] = Math.round((s + k * 0.1) * 10) / 10; await page.locator('#devs').fill(String(typed[p.file]));
    if (k % 2) await page.locator('#tilt').check();
    if (k === 0) await page.locator('#foil').check();
    // the 4 corners of the pocket area, clicked on the picture (image pixels → screen)
    const corners = [[180, 200], [1020, 200], [1020, 200 + 840 / 0.72], [180, 200 + 840 / 0.72]].map(([x, y]) => { const a = p.tilt, cx = 600, cy = 800, dx = x - cx, dy = y - cy; return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]; });
    for (const [x, y] of corners) {   // the photo is taller than the window: scroll to the corner, as a person does
      const W = await cv.evaluate((c) => c.width);
      await page.locator('#left').evaluate((el, yy) => { el.scrollTop = Math.max(0, yy - el.clientHeight / 2); }, y * (await cv.boundingBox()).width / W);
      const b = await cv.boundingBox(), H = await cv.evaluate((c) => c.height);
      await page.mouse.click(b.x + x * b.width / W, b.y + y * b.height / H); }
    expect(await page.evaluate(() => state.pages[state.i].corners.length)).toBe(4);
    for (let i = 0; i < 9; i++) { const inp = page.locator(`#pockets input[data-k="${i}"]`); await inp.fill(ID(PAGE[i]) || 'vazia'); await inp.dispatchEvent('change'); }
    await expect(page.locator(`#files li[data-k="${k}"]`)).toHaveClass(/done/);
    if (k < order.length - 1) await page.locator('#next').click();
  }
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
  const truth = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  // 3. what the annotation exports is what the bench reads
  expect(truth.pages).toHaveLength(6);
  for (const [k, p] of truth.pages.entries()) {
    expect(p.cards).toEqual(PAGE.map(ID));
    expect(p.user).toHaveLength(4); expect(p.device).toBeTruthy(); expect(typeof p.device_s).toBe('number'); expect(p.where).toMatch(/app-|navegador/);
    expect(photos.map((x) => x.file)).toContain(p.file);
    expect(p.device_s).toBe(typed[p.file]);                                       // the time typed for that photo
    expect(p.device).toBe(photos.find((x) => x.file === p.file).device);
  }
  expect(truth.real).toBe(true);           // the tool says "real": generated photos are marked here, by the test
  truth.real = false;
  fs.writeFileSync(path.join(out, 'truth.json'), JSON.stringify(truth, null, 1));
  // 4. the scanner on each photo with the annotated corners (what tools/pagescan-bench.spec.mjs does), then the report
  await page.goto(SITE); await page.waitForFunction(() => typeof window.__inkwellScanPage === 'function');
  await page.route('**/__a3/**', (r) => r.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(path.join(out, decodeURIComponent(r.request().url().split('/__a3/')[1]))) }));
  const rows = [];
  for (const p of truth.pages) {
    const r = await page.evaluate(async ({ file, quad }) => { const img = await createImageBitmap(await (await fetch('/__a3/' + encodeURIComponent(file))).blob());
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
      return window.__inkwellScanPage(ctx.getImageData(0, 0, c.width, c.height), quad); }, { file: p.file, quad: p.user });
    r.pockets.forEach((k, i) => rows.push({ file: p.file, cond: p.cond, device: p.device, where: p.where, i, truth: p.cards[i], ...k, desktop_ms: r.ms.total, device_s: p.device_s }));
  }
  const rep = makeReport(truth, rows);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rep, null, 1)); fs.writeFileSync(path.join(out, 'report.md'), markdown(rep) + '\n');
  console.log(markdown(rep));
  // the report: every card accounted for once, per device, with the phone time; incomplete set → no target judged
  const cardsN = rows.filter((x) => x.truth).length;
  expect(rep.all.cards).toBe(cardsN); expect(rep.all.empty_pockets).toBe(6);
  const parts = ['auto-right', 'first-right', 'alt-right', 'not-offered', 'card-as-empty', 'false-positive'].map((v) => rows.filter((x) => x.truth && x.v === v).length);
  expect(parts.reduce((a, b) => a + b, 0)).toBe(cardsN);
  expect(Object.keys(rep.by_device).sort()).toEqual(DEVICES.map((d) => d[0]).sort());
  const bTimes = truth.pages.filter((p) => p.device === 'Android B (antigo)').map((p) => p.device_s);
  expect(rep.by_device['Android B (antigo)'].device_s_max).toBe(Math.max(...bTimes));
  expect(rep.coverage.complete).toBe(false);
  expect(rep.coverage.missing.join(' | ')).toMatch(/sintéticas.*6 de 30 páginas/);
  expect(Object.values(rep.targets).every((v) => v === 'não avaliável')).toBe(true);
  expect(markdown(rep)).toMatch(/Conjunto:\*\* incompleto/);
});
