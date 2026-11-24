// Scanner 2.0 — Coleção › Escanear › "Página 3×3", against a fake Supabase and a fake camera that films a binder page
// (8 real card images in a 3×3 page, the last pocket empty). Checks the whole flow and that nothing is saved before
// the final confirmation. Chromium, and WebKit (iPhone) with PW_WEBKIT=1.
import { test, expect } from '@playwright/test';

const BASE = new URL('colecao/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';
const PAGE = ['Rapunzel_-_Tower_Defender__LOR13-80', '4_Town_-_Hottest_Band_of_the_Year__LOR13-17', 'Owl_-_Hunny_Ranger__LOR13-185', 'Piglet_-_Hunny_Mage_Apprentice__LOR13-154',
  'Rabbit_-_Hunny_Paladin__LOR13-5', 'Roo_-_Hunny_Rogue__LOR13-83', 'Tigger_-_Hunny_Barbarian__LOR13-126', 'Winnie_the_Pooh_-_Hunny_Archmage__LOR13-40', null];
const ID = (f) => f.split('__')[1];

async function setup(page) {
  const calls = [];
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, '');
    calls.push({ path, body: req.postData() ? JSON.parse(req.postData()) : null });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles') return json([{ profile: 'luiscredie', updated_at: '2026-10-20T10:00:00Z', collection: { 'LOR10-10': { n: 2, f: 0 } } }]);
    if (path.startsWith('rpc/')) return route.fulfill({ status: 204, body: '' });
    return json([]);
  });
  // the camera films a binder page lined up with the on-screen frame (slightly bigger, as a hand would hold it)
  await page.addInitScript((files) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
      const ctx = c.getContext('2d'), imgs = files.map((f) => { if (!f) return null; const i = new Image(); i.src = `../lorcana-card-images/images/${f}.jpg`; return i; });
      setInterval(() => {
        ctx.fillStyle = '#5c4634'; ctx.fillRect(0, 0, c.width, c.height);
        const g = window.__inkwellScanGuide?.(); if (!g) return;
        const k = 1.02, W = g.w * k, H = g.h * k, x0 = g.x - (W - g.w) / 2 + g.w * 0.01, y0 = g.y - (H - g.h) / 2;
        ctx.fillStyle = '#1c1d24'; ctx.fillRect(x0, y0, W, H);   // the binder page
        imgs.forEach((im, i) => { if (!im || !im.complete || !im.naturalWidth) return; const cw = W / 3, ch = H / 3, x = x0 + (i % 3) * cw, y = y0 + Math.floor(i / 3) * ch;
          ctx.drawImage(im, x + cw * 0.04, y + ch * 0.03, cw * 0.92, ch * 0.94); });
      }, 80);
      return c.captureStream(12);
    };
  }, PAGE);
  return calls;
}
const deltas = (calls) => calls.filter((c) => c.path === 'rpc/apply_collection_delta').flatMap((c) => c.body.p_delta);
// Chromium films the page with the fake camera and taps "Fotografar página". WebKit under Playwright gives no frames
// from a canvas stream, so there the same page is drawn on a still and handed to the scanner (the gallery path).
const STILL = (page) => test.info().project.name === 'iphone';
async function stillPage(page) {
  await page.evaluate(async (files) => {
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1440; const ctx = c.getContext('2d');
    ctx.fillStyle = '#5c4634'; ctx.fillRect(0, 0, c.width, c.height);
    const x0 = 140, y0 = 150, W = 800, H = W / 0.72; ctx.fillStyle = '#1c1d24'; ctx.fillRect(x0, y0, W, H);
    await Promise.all(files.map(async (f, i) => { if (!f) return; const im = new Image(); im.src = `../lorcana-card-images/images/${f}.jpg`; await im.decode();
      const cw = W / 3, ch = H / 3; ctx.drawImage(im, x0 + (i % 3) * cw + cw * 0.04, y0 + Math.floor(i / 3) * ch + ch * 0.03, cw * 0.92, ch * 0.94); }));
    const q = [[x0 + 8, y0 - 6], [x0 + W - 4, y0 + 5], [x0 + W + 6, y0 + H - 3], [x0 - 5, y0 + H + 4]];   // lined up by hand, a little off
    window.__inkwellScanPageFrom(c, q);
  }, PAGE);
}
async function pagePhoto(page) {
  if (STILL(page)) await stillPage(page); else await page.getByTestId('page-shoot').click();
  const rev = page.getByTestId('page-review');
  await expect(rev).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__inkwellScanPageState()?.busy), { timeout: 60000 }).toBe(false);
  return rev;
}

test('Escanear página: nine pockets, corrections, nothing saved before confirming', async ({ page }) => {
  test.setTimeout(120000);
  const calls = await setup(page);
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await page.getByTestId('scan-mode').getByRole('button', { name: 'Página 3×3' }).click();
  await expect(page.locator('#scanGuide')).toHaveClass(/page/);
  if (!STILL(page)) await expect(page.locator('#scanSay')).toContainText('Enquadre a página inteira');
  if (!STILL(page)) { await page.waitForFunction(() => document.getElementById('scanVideo')?.videoWidth > 0); await page.waitForTimeout(400); }
  const rev = await pagePhoto(page);

  const st = await page.evaluate(() => window.__inkwellScanPageState());
  expect(st.pockets).toHaveLength(9);
  expect(st.pockets[8].status).toBe('empty');                                     // the empty pocket
  // every card identified (alone, or as the first suggestion, or among the printings to pick); most need nothing
  expect(st.pockets.slice(0, 8).map((p, i) => p.id === ID(PAGE[i]))).toEqual(Array(8).fill(true));
  expect(st.pockets.slice(0, 8).filter((p) => p.status === 'ok').length).toBeGreaterThanOrEqual(6);
  expect(st.pockets.slice(0, 8).filter((p, i) => p.status === 'ok' && p.id !== ID(PAGE[i]))).toEqual([]);   // never confident and wrong
  await expect(rev.locator('polygon')).toHaveCount(9);                             // the outlines over the photo
  await expect(rev.locator('[data-pocket]')).toHaveCount(9);
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/page-review.png` : test.info().outputPath('page-review.png') });

  // settle anything the scanner wasn't sure about (search by the right name)
  for (let i = 0; i < 8; i++) {
    const p = (await page.evaluate(() => window.__inkwellScanPageState())).pockets[i];
    if (p.status === 'ok') continue;
    await rev.locator(`[data-pocket="${i}"]`).click();
    await rev.getByTestId('pocket-edit').locator(`.cands [data-use="${ID(PAGE[i])}"]`).first().click();   // the right card is among the suggestions
  }
  // corrections: pocket 1 is changed to another card, pocket 2 gets 2 copies, pocket 3 is foil, pocket 4 left out
  await rev.locator('[data-pocket="0"]').click();
  await expect(rev.getByTestId('pocket-edit')).toBeVisible();
  await rev.getByTestId('pocket-search').fill('fru fru');
  await rev.locator('#pgFound [data-use="LOR14-1"]').click();
  await rev.locator('[data-pocket="1"]').click();
  await rev.getByRole('button', { name: 'Mais uma' }).click();
  await expect(rev.getByTestId('pocket-qty')).toHaveText('2');
  await rev.locator('[data-pocket="2"]').click();
  await rev.locator('#pgFoil').check();
  await rev.locator('[data-pocket="3"]').click();
  await rev.getByTestId('pocket-skip').click();
  await expect(rev.locator('[data-pocket="3"]')).toHaveClass(/skip/);

  const add = rev.getByTestId('page-add');
  await expect(add).toHaveText('Pôr 8 cartas na lista');    // 7 cards + 1 extra copy; pocket 4 out, pocket 9 empty
  await page.waitForTimeout(900);
  expect(deltas(calls)).toEqual([]);                          // nothing saved yet
  await add.click();
  await expect(rev).toBeHidden();
  await expect(page.locator('#scanSay')).toContainText('8 cartas foram para a lista');
  await expect(page.getByTestId('scan-count')).toHaveText('8 na lista');

  // the same page again: asked once more before adding it twice; here the person retakes instead
  const rev2 = await pagePhoto(page);
  for (let i = 0; i < 8; i++) {
    const p = (await page.evaluate(() => window.__inkwellScanPageState())).pockets[i];
    if (p.status === 'ok') continue;
    await rev2.locator(`[data-pocket="${i}"]`).click(); await rev2.getByTestId('pocket-skip').click();
  }
  const st2 = await page.evaluate(() => window.__inkwellScanPageState());
  if (st2.pockets.every((p, i) => p.status === 'empty' || p.id === ID(PAGE[i]))) {   // same ids as a plain page: different from the corrected one, no warning
    await expect(rev2.getByTestId('page-dup')).toHaveCount(0);
  }
  await page.keyboard.press('Escape');                                             // Esc leaves the page check, adds nothing
  await expect(rev2).toBeHidden();
  await expect(page.getByTestId('scan-count')).toHaveText('8 na lista');
  await page.waitForTimeout(700);
  expect(deltas(calls)).toEqual([]);

  // Concluir -> the usual review -> confirm: one save with exactly the corrected page
  await page.getByRole('button', { name: 'Concluir' }).click();
  const review = page.getByTestId('scan-review');
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Adicionar 8 cartas à coleção' }).click();
  await expect.poll(() => deltas(calls).length).toBeGreaterThan(0);
  const net = {}; for (const d of deltas(calls)) { const k = `${d.card_id}${d.foil ? '*' : ''}`; net[k] = (net[k] || 0) + d.qty; }
  expect(net).toEqual({ 'LOR14-1': 1, 'LOR13-17': 2, 'LOR13-185*': 1, 'LOR13-5': 1, 'LOR13-83': 1, 'LOR13-126': 1, 'LOR13-40': 1 });
});

test('Escanear página: the same page twice asks before adding it again', async ({ page }) => {
  test.setTimeout(120000);
  const calls = await setup(page);
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await page.getByTestId('scan-mode').getByRole('button', { name: 'Página 3×3' }).click();
  if (!STILL(page)) { await page.waitForFunction(() => document.getElementById('scanVideo')?.videoWidth > 0); await page.waitForTimeout(400); }
  const settle = async (rev) => { const s = await page.evaluate(() => window.__inkwellScanPageState());
    for (let i = 0; i < 9; i++) if (['check', 'choose', 'unknown'].includes(s.pockets[i].status)) { await rev.locator(`[data-pocket="${i}"]`).click(); await rev.getByTestId('pocket-skip').click(); } };
  let rev = await pagePhoto(page); await settle(rev);
  await rev.getByTestId('page-add').click();
  await expect(rev).toBeHidden();
  const n1 = await page.evaluate(() => document.querySelector('[data-testid="scan-count"]').textContent);
  rev = await pagePhoto(page); await settle(rev);
  await rev.getByTestId('page-add').click();
  await expect(rev.getByTestId('page-dup')).toBeVisible();                        // asked first
  await expect(page.getByTestId('scan-count')).toHaveText(n1);                    // nothing added yet
  await rev.getByTestId('page-add').click();                                      // the person insists: a second copy of each
  await expect(rev).toBeHidden();
  await expect(page.getByTestId('scan-count')).not.toHaveText(n1);
  expect(deltas(calls)).toEqual([]);
});

for (const w of [320, 390, 430]) {
  test(`Escanear página fits a ${w}px phone`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: w, height: 844 });
    await setup(page);
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Escanear' }).click();
    await page.getByTestId('scan-mode').getByRole('button', { name: 'Página 3×3' }).click();
    if (!STILL(page)) { await page.waitForFunction(() => document.getElementById('scanVideo')?.videoWidth > 0); await page.waitForTimeout(400); }
    const g = await page.locator('#scanGuide').boundingBox();
    expect(g.x).toBeGreaterThanOrEqual(0); expect(g.x + g.width).toBeLessThanOrEqual(w + 0.5);
    const rev = await pagePhoto(page);
    await rev.locator('[data-pocket="0"]').click();
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/page-${w}.png` });
    const over = await page.evaluate((vw) => [...document.querySelectorAll('#pageReview *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > vw + 0.5 || r.left < -0.5); }).map((e) => e.tagName + '.' + e.className).slice(0, 5), w);
    expect(over).toEqual([]);
  });
}
