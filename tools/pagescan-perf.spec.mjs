// Scanner 2.0 timings, stage by stage, on a slowed-down CPU (Chrome DevTools throttling, as a modest phone).
// Not in CI's smoke list; run by hand:  PERF_RATES=1,4,6 npx playwright test --project=chromium tools/pagescan-perf.spec.mjs
// The OCR (Tesseract from a CDN) is not reachable here: its time is reported by the app on a real device / emulator
// (console "[inkwell] escanear página {...}").
import { test, expect } from '@playwright/test';
const BASE = new URL('colecao/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';
const HARD = ['Rapunzel_-_Tower_Defender__LOR13-80', '4_Town_-_Hottest_Band_of_the_Year__LOR13-17', 'Owl_-_Hunny_Ranger__LOR13-185', 'Piglet_-_Hunny_Mage_Apprentice__LOR13-154',
  'Rabbit_-_Hunny_Paladin__LOR13-5', 'Elsa_-_Concerned_Sister__LOR11-125', 'Junior_Woodchuck_Guidebook__LOR10-66|flip', 'Winnie_the_Pooh_-_Hunny_Archmage__LOR13-40', 'Winnie_the_Pooh_&_Piglet_-_Hunny_Mages__LOR13-62|flip'];
const RATES = (process.env.PERF_RATES || '1,4,6').split(',').map(Number);
for (const rate of RATES) test(`Escanear página timings, CPU ÷${rate}`, async ({ page }) => {
  test.setTimeout(300000);
  await page.addInitScript((me) => { localStorage.setItem('inkwell-lang', 'pt'); const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'a@b.c' } }));
    window.INKWELL_SCAN_OCR = async () => '';   // no network OCR here
    navigator.mediaDevices.getUserMedia = async () => { const c = document.createElement('canvas'); c.width = 320; c.height = 480; setInterval(() => c.getContext('2d').fillRect(0, 0, 9, 9), 100); return c.captureStream(5); }; }, ME);
  await page.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(BASE);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await page.getByRole('button', { name: 'Escanear' }).first().click();
  await page.getByTestId('scan-mode').getByRole('button', { name: 'Página 3×3' }).click();
  await page.waitForTimeout(1500 * rate);   // the person frames the page: the Worker warms up meanwhile
  const out = [];
  for (let run = 0; run < 3; run++) {
    // a 2400 x 1800 still, as the app takes from the camera
    await page.evaluate(async (files) => {
      const c = document.createElement('canvas'); c.width = 2400; c.height = 1800; const ctx = c.getContext('2d');
      ctx.fillStyle = '#5c4634'; ctx.fillRect(0, 0, c.width, c.height);
      const x0 = 620, y0 = 150, W = 1150, H = W / 0.72; ctx.fillStyle = '#1c1d24'; ctx.fillRect(x0, y0, W, H);
      await Promise.all(files.map(async (f, i) => { const [n, fx] = f.split('|'); const im = new Image(); im.src = `../lorcana-card-images/images/${n}.jpg`; await im.decode();
        const cw = W / 3, ch = H / 3, x = x0 + (i % 3) * cw + cw * 0.04, y = y0 + Math.floor(i / 3) * ch + ch * 0.03;
        if (fx === 'flip') { ctx.save(); ctx.translate(x + cw * 0.46, y + ch * 0.47); ctx.rotate(Math.PI); ctx.drawImage(im, -cw * 0.46, -ch * 0.47, cw * 0.92, ch * 0.94); ctx.restore(); }
        else ctx.drawImage(im, x, y, cw * 0.92, ch * 0.94); }));
      window.__inkwellScanPageFrom(c, [[x0 + 8, y0 - 6], [x0 + W - 4, y0 + 5], [x0 + W + 6, y0 + H - 3], [x0 - 5, y0 + H + 4]]);
    }, HARD);
    await expect.poll(() => page.evaluate(() => window.__inkwellScanPageTiming()?.ocr != null && !window.__inkwellScanPageState()?.busy), { timeout: 240000 }).toBe(true);
    const t = await page.evaluate(() => window.__inkwellScanPageTiming());
    out.push(t);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__inkwellScanPageTiming = window.__inkwellScanPageTiming; });
  }
  console.log(`PERF ÷${rate}`, JSON.stringify(out));
});
