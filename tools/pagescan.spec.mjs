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
        window.__fakeCamFull = imgs.every((im) => !im || (im.complete && im.naturalWidth));   // every card drawn in this frame
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
    await Promise.all(files.map(async (f, i) => { if (!f) return; const im = await createImageBitmap(await (await fetch(`../lorcana-card-images/images/${f}.jpg`)).blob());   /* #333: decode()+drawImage drew nothing at times in WebKit under load */
      const cw = W / 3, ch = H / 3; ctx.drawImage(im, x0 + (i % 3) * cw + cw * 0.04, y0 + Math.floor(i / 3) * ch + ch * 0.03, cw * 0.92, ch * 0.94); }));
    for (let i = 0; i < 9; i++) { if (!files[i]) continue; const cw = W / 3, ch = H / 3, d = ctx.getImageData(Math.round(x0 + (i % 3) * cw + cw * 0.2), Math.round(y0 + Math.floor(i / 3) * ch + ch * 0.2), Math.round(cw * 0.6), Math.round(ch * 0.6)).data;
      let lo = 255, hi = 0; for (let k = 0; k < d.length; k += 16) { const l = d[k]; if (l < lo) lo = l; if (l > hi) hi = l; } if (hi - lo < 20) throw new Error(`test photo: card ${i + 1} not drawn`); }
    const q = [[x0 + 8, y0 - 6], [x0 + W - 4, y0 + 5], [x0 + W + 6, y0 + H - 3], [x0 - 5, y0 + H + 4]];   // lined up by hand, a little off
    window.__inkwellScanPageFrom(c, q);
  }, PAGE);
}
async function pagePhoto(page) {
  if (STILL(page)) await stillPage(page);
  else {   // under load the fake camera may still be loading a card picture: shoot once every card is on screen
    await page.waitForFunction(() => window.__fakeCamFull === true, null, { timeout: 30000 });
    await page.waitForTimeout(250);
    await page.getByTestId('page-shoot').click();
  }
  const rev = page.getByTestId('page-review');
  await expect(rev).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__inkwellScanPageState()?.busy), { timeout: 60000 }).toBe(false);
  return rev;
}

// the pocket editor sits over the page; to tap another pocket, back to the photo first
async function openPk(rev, i) {
  const ed = rev.getByTestId('pocket-edit');
  if (await ed.count() && (await ed.getAttribute('data-edit-pocket')) === String(i)) return ed;
  if (await ed.count()) { await rev.locator('#pgsClose').click(); await expect(ed).toHaveCount(0); }
  await rev.locator(`#pgPhoto [data-pk="${i}"]`).click();                      // tapping the card on the photo opens it
  await expect(ed).toHaveAttribute('data-edit-pocket', String(i));
  return ed;
}
const closeSheet = async (rev) => { if (await rev.getByTestId('pocket-edit').count()) { await rev.locator('#pgsClose').click(); await expect(rev.getByTestId('pocket-edit')).toHaveCount(0); } };
// settle one pocket to the right card: confirm the suggestion, pick an alternative, or search by name
async function settleTo(rev, ed, id, words) {
  const best = await ed.getByTestId('pocket-best').count() ? (await ed.getAttribute('data-edit-pocket')) : null;
  const st = await rev.page().evaluate((i) => window.__inkwellScanPageState().pockets[i], +(await ed.getAttribute('data-edit-pocket')));
  if (best != null && st.id === id) return ed.getByTestId('pocket-confirm').click();
  const alt = ed.locator(`.pgs-alts [data-use="${id}"]`);
  if (await alt.count()) return alt.first().click();
  await ed.getByTestId('pocket-find').click();
  await ed.getByTestId('pocket-search').fill(words);
  await ed.locator(`#pgFound [data-use="${id}"]`).click();
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
  expect(await page.evaluate(() => window.__inkwellScanWorker())).toBe('worker');   // recognised off the main thread
  expect(st.pockets[8].status).toBe('empty');                                     // the empty pocket
  expect(st.pockets.slice(0, 8).map((p, i) => p.id === ID(PAGE[i]))).toEqual(Array(8).fill(true));
  expect(st.pockets.slice(0, 8).filter((p) => p.status === 'ok').length).toBeGreaterThanOrEqual(6);
  expect(st.pockets.slice(0, 8).filter((p, i) => p.status === 'ok' && p.id !== ID(PAGE[i]))).toEqual([]);   // never confident and wrong
  await expect(rev.locator('#pgPhoto [data-pk]')).toHaveCount(9);                 // the nine pockets on the photo, each tappable
  await expect(rev.locator('[data-pocket="8"] img.shot')).toHaveCount(1);
  await expect(rev.getByTestId('page-out')).toHaveText('Ficam de fora: 1 posição vazia (9). Se houver carta em alguma, toque nela para buscar.');
  await expect(rev.locator('[data-pocket]')).toHaveCount(9);
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/page-review.png` : test.info().outputPath('page-review.png') });

  // "Resolver N posições" opens the first pending pocket; each decision moves on to the next one
  const pend = st.pockets.map((p, i) => (['check', 'choose', 'unknown'].includes(p.status) ? i : -1)).filter((i) => i >= 0);
  if (pend.length) {
    await expect(rev.getByTestId('page-add')).toHaveText(`Resolver ${pend.length === 1 ? '1 posição' : pend.length + ' posições'}`);
    await rev.getByTestId('page-add').click();
    for (const i of pend) { const ed = rev.getByTestId('pocket-edit'); await expect(ed).toHaveAttribute('data-edit-pocket', String(i)); await settleTo(rev, ed, ID(PAGE[i]), ''); }
    await expect(rev.getByTestId('pocket-edit')).toHaveCount(0);
  }
  // corrections: pocket 1 is changed to another card, pocket 2 gets 2 copies, pocket 3 is foil, pocket 4 left out
  let ed = await openPk(rev, 0);
  await expect(ed.locator('h3')).toHaveText('Posição 1 de 9');
  await ed.getByTestId('pocket-find').click();
  await ed.getByTestId('pocket-search').fill('fru fru');
  await ed.locator('#pgFound [data-use="LOR14-1"]').click();
  ed = await openPk(rev, 1);
  await ed.getByRole('button', { name: 'Mais uma' }).click();
  await expect(ed.getByTestId('pocket-qty')).toHaveText('2');
  ed = await openPk(rev, 2);
  await ed.locator('#pgFoil').check();
  ed = await openPk(rev, 3);
  await ed.getByTestId('pocket-skip').click();
  await closeSheet(rev);
  await expect(rev.locator('[data-pocket="3"]')).toHaveClass(/skip/);
  await expect(rev.getByTestId('page-out')).toContainText('1 posição vazia (9) · 1 deixada de fora (4)');

  const add = rev.getByTestId('page-add');
  await expect(add).toHaveText('Continuar para revisão (8 cartas)');    // 7 cards + 1 extra copy; pocket 4 out, pocket 9 empty
  await page.waitForTimeout(900);
  expect(deltas(calls)).toEqual([]);                                     // nothing saved yet
  await add.click();
  await expect(rev).toBeHidden();
  const review = page.getByTestId('scan-review');                        // straight to the usual review
  await expect(review).toBeVisible();
  await page.waitForTimeout(500);
  expect(deltas(calls)).toEqual([]);
  await review.getByRole('button', { name: 'Adicionar 8 cartas à coleção' }).click();
  await expect.poll(() => deltas(calls).length).toBeGreaterThan(0);
  const net = {}; for (const d of deltas(calls)) { const k = `${d.card_id}${d.foil ? '*' : ''}`; net[k] = (net[k] || 0) + d.qty; }
  expect(net).toEqual({ 'LOR14-1': 1, 'LOR13-17': 2, 'LOR13-185*': 1, 'LOR13-5': 1, 'LOR13-83': 1, 'LOR13-126': 1, 'LOR13-40': 1 });
});

// The block seen on a real Android (24/11): a page with 4 pockets to settle. The person taps the cards on the photo,
// walks the pending ones (suggestion, alternatives or search), and reaches the final review; nothing saved before.
const HARD = ['Rapunzel_-_Tower_Defender__LOR13-80', '4_Town_-_Hottest_Band_of_the_Year__LOR13-17', 'Owl_-_Hunny_Ranger__LOR13-185', 'Piglet_-_Hunny_Mage_Apprentice__LOR13-154',
  'Rabbit_-_Hunny_Paladin__LOR13-5', 'Elsa_-_Concerned_Sister__LOR11-125', 'Junior_Woodchuck_Guidebook__LOR10-66|flip', 'Winnie_the_Pooh_-_Hunny_Archmage__LOR13-40', 'Winnie_the_Pooh_&_Piglet_-_Hunny_Mages__LOR13-62|flip'];
const WORDS = { 'LOR10-66': 'woodchuck guidebook', 'LOR13-62': 'hunny mages', 'LOR11-125': 'elsa concerned', 'LOR13-40': 'hunny archmage' };
async function hardPage(page) {   // two cards upside down in their pockets, as happens in a binder
  await page.evaluate(async (files) => {
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1440; const ctx = c.getContext('2d');
    ctx.fillStyle = '#5c4634'; ctx.fillRect(0, 0, c.width, c.height);
    const x0 = 140, y0 = 150, W = 800, H = W / 0.72; ctx.fillStyle = '#1c1d24'; ctx.fillRect(x0, y0, W, H);
    await Promise.all(files.map(async (f, i) => { const [n, fx] = f.split('|'); const im = await createImageBitmap(await (await fetch(`../lorcana-card-images/images/${n}.jpg`)).blob());   /* #333: decode()+drawImage drew nothing at times in WebKit under load */
      const cw = W / 3, ch = H / 3, x = x0 + (i % 3) * cw + cw * 0.04, y = y0 + Math.floor(i / 3) * ch + ch * 0.03;
      if (fx === 'flip') { ctx.save(); ctx.translate(x + cw * 0.46, y + ch * 0.47); ctx.rotate(Math.PI); ctx.drawImage(im, -cw * 0.46, -ch * 0.47, cw * 0.92, ch * 0.94); ctx.restore(); }
      else ctx.drawImage(im, x, y, cw * 0.92, ch * 0.94); }));
    for (let i = 0; i < 9; i++) { if (!files[i]) continue; const cw = W / 3, ch = H / 3, d = ctx.getImageData(Math.round(x0 + (i % 3) * cw + cw * 0.2), Math.round(y0 + Math.floor(i / 3) * ch + ch * 0.2), Math.round(cw * 0.6), Math.round(ch * 0.6)).data;
      let lo = 255, hi = 0; for (let k = 0; k < d.length; k += 16) { const l = d[k]; if (l < lo) lo = l; if (l > hi) hi = l; } if (hi - lo < 20) throw new Error(`test photo: card ${i + 1} not drawn`); }
    window.__inkwellScanPageFrom(c, [[x0 + 8, y0 - 6], [x0 + W - 4, y0 + 5], [x0 + W + 6, y0 + H - 3], [x0 - 5, y0 + H + 4]]);
  }, HARD);
  const rev = page.getByTestId('page-review');
  await expect(rev).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__inkwellScanPageState()?.busy), { timeout: 60000 }).toBe(false);
  return rev;
}
async function openPageMode(page) {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await page.getByTestId('scan-mode').getByRole('button', { name: 'Página 3×3' }).click();
}

test('Escanear página: 4 pockets to settle, tapped on the photo, through to the final review', async ({ page }) => {
  test.setTimeout(150000);
  const calls = await setup(page);
  await openPageMode(page);
  const rev = await hardPage(page);
  const st = await page.evaluate(() => window.__inkwellScanPageState());
  const truth = HARD.map((f) => ID(f.split('|')[0]));
  const pend = st.pockets.map((p, i) => (['check', 'choose', 'unknown'].includes(p.status) ? i : -1)).filter((i) => i >= 0);
  console.log('HARD', JSON.stringify(st.pockets.map((p) => [p.status, p.id])));
  expect(pend).toEqual([5, 6, 7, 8]);                                               // 4 to settle, as on the phone
  expect(st.pockets.filter((p, i) => p.status === 'ok' && p.id !== truth[i])).toEqual([]);   // never confident and wrong
  const add = rev.getByTestId('page-add');
  await expect(add).toHaveText('Resolver 4 posições');
  await expect(add).toBeEnabled();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/page-4pend.png` });

  // the person taps the 3rd pending card straight on the photo
  await rev.locator('#pgPhoto [data-pk="7"] polygon').scrollIntoViewIfNeeded();   // the bottom row may sit under the footer until scrolled
  const box = await rev.locator('#pgPhoto [data-pk="7"] polygon').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  let ed = rev.getByTestId('pocket-edit');
  await expect(ed).toHaveAttribute('data-edit-pocket', '7');
  await expect(ed.locator('h3')).toHaveText('Posição 8 de 9');
  await expect(ed.getByTestId('pocket-progress')).toHaveText('Pendência 3 de 4');
  await expect(ed.locator('img.crop')).toHaveCount(1);                            // the pocket from the photo, beside the suggestion
  await expect(ed.getByTestId('pocket-find')).toHaveText('Buscar outra carta');
  // "same art" lists only printings of this art; look-alikes are listed apart
  const st7 = await page.evaluate(() => window.__inkwellScanPageState().pockets[7]);
  const same = await ed.getByTestId('pocket-same').locator('[data-use]').evaluateAll((b) => b.map((x) => x.dataset.use)).catch(() => []);
  expect(same.every((id) => st7.group.includes(id))).toBe(true);
  // a pocket not recognised has no "same art" list: its group is only the engine's rejected guess
  await ed.getByTestId('pocket-next').click();
  await expect(ed).toHaveAttribute('data-edit-pocket', '8');
  await expect(ed.getByTestId('pocket-same')).toHaveCount(0);
  await ed.getByTestId('pocket-prev').click();
  await expect(ed).toHaveAttribute('data-edit-pocket', '7');
  // anterior / próxima pendência
  await ed.getByTestId('pocket-prev').click();
  await expect(ed).toHaveAttribute('data-edit-pocket', '6');
  await ed.getByTestId('pocket-next').click(); await ed.getByTestId('pocket-next').click();
  await expect(ed).toHaveAttribute('data-edit-pocket', '8');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/pocket-edit.png` });
  await settleTo(rev, ed, truth[8], WORDS[truth[8]]);                             // settled -> moves on by itself (wraps to the first pending)
  for (const i of [5, 6, 7]) {
    await expect(ed).toHaveAttribute('data-edit-pocket', String(i));
    await expect(ed.getByTestId('pocket-find')).toBeVisible();
    expect(deltas(calls)).toEqual([]);
    await settleTo(rev, ed, truth[i], WORDS[truth[i]]);
  }
  await expect(ed).toHaveCount(0);                                                 // all settled: back to the page
  await expect(rev.getByTestId('page-note')).toContainText('Tudo resolvido');
  await expect(add).toHaveText('Continuar para revisão (9 cartas)');
  await expect(add).toBeFocused();
  await page.waitForTimeout(600);
  expect(deltas(calls)).toEqual([]);
  await add.click();
  const review = page.getByTestId('scan-review');
  await expect(review).toBeVisible();
  expect(deltas(calls)).toEqual([]);
  await review.getByRole('button', { name: 'Adicionar 9 cartas à coleção' }).click();
  await expect.poll(() => deltas(calls).length).toBeGreaterThan(0);
  const net = {}; for (const d of deltas(calls)) net[d.card_id] = (net[d.card_id] || 0) + d.qty;
  expect(net).toEqual(Object.fromEntries(truth.map((t) => [t, 1])));
});

// 26/11 — a pocket's search stopped at 12 cards: "Minnie Mouse" has more than 30 and the Enchanted never showed.
test('Escanear página: pocket search lists every match, art suggestions first, rarity words and numbers', async ({ page }) => {
  await setup(page);
  await page.goto(BASE);
  await page.waitForFunction(() => typeof window.__inkwellFindCards === 'function');
  const r = await page.evaluate(() => ({
    minnie: window.__inkwellFindCards('minnie mouse'), ench: window.__inkwellFindCards('minnie encantada'),
    num: window.__inkwellFindCards('minnie 4/206'), hk: window.__inkwellFindCards('horned king'), none: window.__inkwellFindCards('zzzz'),
  }));
  expect(r.minnie.length).toBeGreaterThan(30);
  expect(r.minnie).toContain('LOR4-206');                                       // Musketeer Champion (Enchanted)
  expect(r.ench).toEqual(expect.arrayContaining(['LOR4-206', 'LOR13-238']));
  expect(r.ench.every((id) => ['LOR4-206', 'LOR13-238'].includes(id))).toBe(true);
  expect(r.num).toEqual(['LOR4-206']);
  expect(r.hk[0]).toMatch(/^LOR13-/);                                           // newest set first
  expect(r.none).toEqual([]);
});

test('Escanear página: the pocket editor shows the count and "Mostrar mais"', async ({ page }) => {
  test.setTimeout(120000);
  await setup(page);
  await openPageMode(page);
  const rev = await hardPage(page);
  const ed = await openPk(rev, 8);
  await ed.getByTestId('pocket-find').click();
  await ed.getByTestId('pocket-search').fill('minnie mouse');
  const count = await ed.getByTestId('pocket-search-count').textContent();
  expect(+count.match(/\d+/)[0]).toBeGreaterThan(30);
  await expect(ed.locator('#pgFound [data-use]')).toHaveCount(24);
  await ed.getByTestId('pocket-search-more').click();
  await expect(ed.locator('#pgFound [data-use]')).toHaveCount(Math.min(48, +count.match(/\d+/)[0]));
  await expect(ed.getByTestId('pocket-search')).toHaveValue('minnie mouse');
});

test('Escanear página: the same page twice asks before adding it again; Esc steps back', async ({ page }) => {
  test.setTimeout(120000);
  const calls = await setup(page);
  await openPageMode(page);
  if (!STILL(page)) { await page.waitForFunction(() => document.getElementById('scanVideo')?.videoWidth > 0); await page.waitForTimeout(400); }
  const settle = async (rev) => {
    // the collector numbers are read in the background (real OCR on CI): wait for it, so no redraw lands on a tap
    await expect(rev.getByTestId('page-reading')).toHaveCount(0, { timeout: 60000 });
    const s = await page.evaluate(() => window.__inkwellScanPageState());
    for (let i = 0; i < 9; i++) if (['check', 'choose', 'unknown'].includes(s.pockets[i].status)) { const ed = await openPk(rev, i); await ed.getByTestId('pocket-skip').click(); }
    await closeSheet(rev);
    console.log('DUPSTATE', JSON.stringify((await page.evaluate(() => window.__inkwellScanPageState())).pockets.map((p) => [p.status, p.id, p.skip ? 1 : 0, (p.group || []).length]))); };
  let rev = await pagePhoto(page); await settle(rev);
  await rev.getByTestId('page-add-more').click();
  await expect(rev).toBeHidden();
  const n1 = await page.evaluate(() => document.querySelector('[data-testid="scan-count"]').textContent);
  rev = await pagePhoto(page); await settle(rev);
  // Esc closes the pocket editor first, then the corner mode, then the page
  await openPk(rev, 0); await page.keyboard.press('Escape');
  await expect(rev.getByTestId('pocket-edit')).toHaveCount(0); await expect(rev).toBeVisible();
  await rev.getByTestId('page-adjust').click(); await expect(rev.locator('circle.corner')).toHaveCount(4);
  await page.keyboard.press('Escape'); await expect(rev.locator('circle.corner')).toHaveCount(0); await expect(rev).toBeVisible();
  await rev.getByTestId('page-add-more').click();
  await expect(rev.getByTestId('page-dup')).toBeVisible();                        // asked first
  await expect(page.getByTestId('scan-count')).toHaveText(n1);                    // nothing added yet
  await rev.getByTestId('page-add-more').click();                                 // the person insists: a second copy of each
  await expect(rev).toBeHidden();
  await expect(page.getByTestId('scan-count')).not.toHaveText(n1);
  expect(deltas(calls)).toEqual([]);
});

for (const [w, h] of [[320, 568], [360, 640], [390, 844], [430, 932]]) {
  test(`Escanear página fits a ${w}px phone`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: w, height: h });
    await setup(page);
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Escanear' }).click();
    await page.getByTestId('scan-mode').getByRole('button', { name: 'Página 3×3' }).click();
    if (!STILL(page)) { await page.waitForFunction(() => document.getElementById('scanVideo')?.videoWidth > 0); await page.waitForTimeout(400); }
    const g = await page.locator('#scanGuide').boundingBox();
    expect(g.x).toBeGreaterThanOrEqual(0); expect(g.x + g.width).toBeLessThanOrEqual(w + 0.5);
    const rev = await pagePhoto(page);
    const add = await rev.getByTestId('page-add').boundingBox();
    expect(add.y + add.height).toBeLessThanOrEqual(h + 0.5);                     // the footer action is on screen, not below the fold
    await rev.locator('#pgPhoto [data-pk="0"]').click();
    const ed = rev.getByTestId('pocket-edit'); await expect(ed).toBeVisible();
    for (const t of ['pocket-confirm', 'pocket-find']) { const b = ed.getByTestId(t); if (await b.count()) { await b.scrollIntoViewIfNeeded(); const r = await b.boundingBox(); expect(r.height).toBeGreaterThanOrEqual(44); } }
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/page-${w}.png` });
    const over = await page.evaluate((vw) => [...document.querySelectorAll('#pageReview *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > vw + 0.5 || r.left < -0.5); }).map((e) => e.tagName + '.' + e.className).slice(0, 5), w);
    expect(over).toEqual([]);
  });
}

// Conselho 26/11 — the collector number on the whole page: a clear number naming another card is only a suggestion (the
// person confirms), never an automatic answer; a reprint is not settled by a number that names a card outside its printings.
test('Escanear página: a number naming another card only suggests it; reprints are not settled by it', async ({ page }) => {
  test.setTimeout(120000);
  await setup(page);
  await page.addInitScript(() => { window.INKWELL_SCAN_OCR = async () => '100/204 · EN · 7'; });   // LOR7-100, not on this page
  await openPageMode(page);
  await hardPage(page);
  await expect.poll(() => page.evaluate(() => { const s = window.__inkwellScanPageState(); return s && !s.busy && !document.querySelector('[data-testid=page-reading]'); }), { timeout: 60000 }).toBe(true);
  const st = await page.evaluate(() => window.__inkwellScanPageState());
  expect(st.pockets.filter((p) => p && p.status === 'ok' && p.id === 'LOR7-100')).toEqual([]);          // never settled by the number alone
  expect(st.pockets.some((p) => p && p.status === 'check' && p.id === 'LOR7-100')).toBe(true);            // offered first, for the person
  expect(st.pockets.filter((p) => p && p.status === 'choose' && p.id === 'LOR7-100')).toEqual([]);        // a reprint keeps its printings
});

test('Escanear página: the glare filter is off unless asked for (?reflexo=1)', async ({ page }) => {
  await setup(page);
  await page.goto(BASE);
  expect(await page.evaluate(() => window.__inkwellScanExp())).toEqual({ detrend: true, glare: false });
  await page.goto(BASE + '?reflexo=1');
  expect(await page.evaluate(() => window.__inkwellScanExp().glare)).toBe(true);
});

test('Escanear página: recognising a page does not block the screen (Web Worker)', async ({ page }) => {
  test.skip(STILL(page), 'long-task timing is measured in Chromium (WebKit has no Long Tasks API)');
  test.setTimeout(120000);
  await setup(page);
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await page.getByTestId('scan-mode').getByRole('button', { name: 'Página 3×3' }).click();
  await page.waitForFunction(() => document.getElementById('scanVideo')?.videoWidth > 0);
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__long = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ type: 'longtask' }); });
  await pagePhoto(page);
  const r = await page.evaluate(() => ({ engine: window.__inkwellScanWorker(), longest: Math.round(Math.max(0, ...window.__long)), total: Math.round(window.__long.reduce((a, b) => a + b, 0)) }));
  console.log('LONGTASKS', JSON.stringify(r));
  expect(r.engine).toBe('worker');
  // the photo is copied to the Worker and the result drawn back: short tasks only (no pocket is recognised here)
  expect(r.longest).toBeLessThan(250);
  expect(r.total).toBeLessThan(600);   // on the main thread the nine pockets alone block > 1 s (measured 24/11)
});

// Android: a finger that lands on the photo must still scroll the check screen (the photo fills most of a small phone).
// Real touch events through CDP (Chromium); corners only move in "Ajustar cantos", where the photo stops scrolling.
test('Escanear página: a swipe that starts on the photo scrolls; a tap opens the card; corners only in adjust mode', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch input via CDP');
  test.setTimeout(120000);
  await page.setViewportSize({ width: 360, height: 640 });
  await setup(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await openPageMode(page);
  const rev = await hardPage(page);
  const scrolled = () => page.evaluate(() => Math.max(window.scrollY, ...[...document.querySelectorAll('#pageReview, #pageReview *')].map((e) => e.scrollTop)));
  const swipe = async (x, y0, y1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * k / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
  };
  const ph = await rev.locator('#pgPhoto').boundingBox();
  const cx = ph.x + ph.width / 2, cy = Math.min(ph.y + ph.height * 0.6, 600);
  expect(await scrolled()).toBe(0);
  await swipe(cx, cy, cy - 250);                                                  // the gesture starts on a card of the photo
  const s1 = await scrolled();
  console.log('SCROLL after swipe on photo', s1);
  expect(s1).toBeGreaterThan(80);
  await expect(rev.getByTestId('pocket-edit')).toHaveCount(0);                    // a swipe is not a tap
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.__inkwellScanPageState().quad))).toBeTruthy();
  const q0 = await page.evaluate(() => JSON.stringify(window.__inkwellScanPageState().quad));
  // a tap on a card opens its editor
  await rev.locator('#pgPhoto [data-pk="4"] polygon').scrollIntoViewIfNeeded();
  const pk = await rev.locator('#pgPhoto [data-pk="4"] polygon').boundingBox();
  const tp = [{ x: pk.x + pk.width / 2, y: pk.y + pk.height / 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(rev.getByTestId('pocket-edit')).toHaveAttribute('data-edit-pocket', '4');
  await rev.locator('#pgsClose').click();
  expect(await page.evaluate(() => JSON.stringify(window.__inkwellScanPageState().quad))).toBe(q0);   // the corners never moved
  // adjust mode: dragging a corner moves it, the screen stays put
  await rev.getByTestId('page-adjust').click();
  const c = rev.locator('circle.corner[data-corner="0"]'); await c.scrollIntoViewIfNeeded();
  const cb = await c.boundingBox(), before = await scrolled();
  await swipe(cb.x + cb.width / 2, cb.y + cb.height / 2, cb.y + cb.height / 2 + 30);
  expect(await page.evaluate(() => JSON.stringify(window.__inkwellScanPageState().quad))).not.toBe(q0);
  expect(Math.abs((await scrolled()) - before)).toBeLessThan(5);
  await rev.getByTestId('page-adjust').click();
  await expect(rev.getByTestId('page-rerun')).toBeVisible();                     // moved corners: offer to recognise again
});

// Shared between 1, 2 or 3 Workers, the nine pockets come out exactly the same (statuses, cards, scores, suggestions).
test('Escanear página: the same answers with 1 Worker or 3 in parallel', async ({ browser }) => {
  test.setTimeout(120000);
  const run = async (k) => {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.addInitScript((n) => { window.INKWELL_SCAN_WORKERS = n; }, k);
    await page.goto(BASE); await page.waitForFunction(() => typeof window.__inkwellScanPage === 'function');
    const r = await page.evaluate(async (files) => {
      const c = document.createElement('canvas'); c.width = 1080; c.height = 1440; const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#5c4634'; ctx.fillRect(0, 0, c.width, c.height);
      const x0 = 140, y0 = 150, W = 800, H = W / 0.72; ctx.fillStyle = '#1c1d24'; ctx.fillRect(x0, y0, W, H);
      await Promise.all(files.map(async (f, i) => { const [n, fx] = f.split('|'); const im = await createImageBitmap(await (await fetch(`../lorcana-card-images/images/${n}.jpg`)).blob());   /* #333: decode()+drawImage drew nothing at times in WebKit under load */
        const cw = W / 3, ch = H / 3, x = x0 + (i % 3) * cw + cw * 0.04, y = y0 + Math.floor(i / 3) * ch + ch * 0.03;
        if (fx === 'flip') { ctx.save(); ctx.translate(x + cw * 0.46, y + ch * 0.47); ctx.rotate(Math.PI); ctx.drawImage(im, -cw * 0.46, -ch * 0.47, cw * 0.92, ch * 0.94); ctx.restore(); } else ctx.drawImage(im, x, y, cw * 0.92, ch * 0.94); }));
      const a = await window.__inkwellScanPage(ctx.getImageData(0, 0, c.width, c.height), [[x0 + 8, y0 - 6], [x0 + W - 4, y0 + 5], [x0 + W + 6, y0 + H - 3], [x0 - 5, y0 + H + 4]]);
      return { workers: window.__inkwellScanWorkers(), pockets: a.pockets.map((p) => [p.i, p.status, p.id, p.score, p.gap, p.group, p.top]) };
    }, HARD);
    await ctx.close(); return r;
  };
  const one = await run(1), three = await run(3);
  expect(one.workers).toBe(1); expect(three.workers).toBe(3);
  expect(three.pockets).toEqual(one.pockets);
});

// The collector numbers are read after the check screen is usable. While that happens the person scrolls and types:
// the background updates must not move the screen, close the editor or steal the search box.
test('Escanear página: the screen is usable while the numbers are read in the background', async ({ page }) => {
  test.setTimeout(120000);
  const calls = await setup(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.addInitScript(() => { window.__ocrN = 0; window.INKWELL_SCAN_OCR = () => new Promise((ok) => setTimeout(() => { window.__ocrN++; ok(''); }, 700)); });
  await openPageMode(page);
  const rev = await hardPage(page);
  await expect(rev.getByTestId('page-reading')).toBeVisible();                     // reading, and already usable
  await expect(rev.getByTestId('page-add')).toBeEnabled();
  await rev.locator('.items').evaluate((e) => { e.scrollTop = 300; });
  const ed = await openPk(rev, 8);
  await ed.getByTestId('pocket-find').click();
  await ed.getByTestId('pocket-search').pressSequentially('hunny', { delay: 120 });
  await expect(rev.getByTestId('page-reading')).toHaveCount(0, { timeout: 30000 }); // the reading finished meanwhile
  expect(await page.evaluate(() => window.__ocrN)).toBeGreaterThan(0);
  await expect(ed).toHaveAttribute('data-edit-pocket', '8');
  await expect(ed.getByTestId('pocket-search')).toBeFocused();
  await expect(ed.getByTestId('pocket-search')).toHaveValue('hunny');
  await page.keyboard.type(' mages');
  await expect(ed.getByTestId('pocket-search')).toHaveValue('hunny mages');
  await rev.locator('#pgsClose').click();
  expect(await rev.locator('.items').evaluate((e) => e.scrollTop)).toBeGreaterThan(250);
  const t = await page.evaluate(() => window.__inkwellScanPageTiming());
  expect(t.ready).toBeLessThan(t.ready + t.ocr);                                    // ready came before the numbers were read
  expect(t.ocrN).toBe(4);                                                          // the 2 reprints and the 2 pockets the art didn't settle
  expect(deltas(calls)).toEqual([]);
});

// #334 — a tap must not be lost when the background reading of collector numbers settles a pocket. The reading is held
// behind a gate: the finger goes down, the reading settles pocket 6 (Elsa, a reprint), then the finger comes up.
async function gatedReading(page) {
  await page.addInitScript(() => {
    window.__ocrGate = new Promise((ok) => { window.__ocrOpen = ok; });
    window.INKWELL_SCAN_OCR = async () => { await window.__ocrGate; return '125/204 EN 11'; };   // Elsa, Concerned Sister: LOR11-125
  });
}
const settledByReading = (page) => expect.poll(() => page.evaluate(() => window.__inkwellScanPageState().pockets[5].status), { timeout: 20000 }).toBe('ok');
for (const target of ['photo', 'grid', 'footer']) {
  test(`#334: a ${target} tap made while the reading settles a pocket is not lost (mouse)`, async ({ page }) => {
    test.setTimeout(120000);
    await setup(page); await gatedReading(page);
    await openPageMode(page);
    const rev = await hardPage(page);
    await expect(rev.getByTestId('page-reading')).toBeVisible();
    expect((await page.evaluate(() => window.__inkwellScanPageState())).pockets[5].status).toBe('choose');
    const el = target === 'photo' ? rev.locator('#pgPhoto [data-pk="0"] polygon') : target === 'grid' ? rev.locator('[data-pocket="1"]') : rev.getByTestId('page-add');
    await el.scrollIntoViewIfNeeded();
    const b = await el.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.evaluate(() => window.__ocrOpen());                                  // the reading lands while the finger is down
    await settledByReading(page);
    await page.waitForTimeout(150);
    await page.mouse.up();
    const ed = rev.getByTestId('pocket-edit');
    await expect(ed).toBeVisible({ timeout: 3000 });
    await expect(ed).toHaveAttribute('data-edit-pocket', target === 'photo' ? '0' : target === 'grid' ? '1' : '6');   // footer: first pending after pocket 6 settled
    await expect(rev.getByTestId('page-add')).toHaveText('Resolver 3 posições');
  });
}

test('#334: a real touch on the photo while the reading settles a pocket opens it (CDP touch)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch input via CDP');
  test.setTimeout(120000);
  await page.setViewportSize({ width: 360, height: 640 });
  await setup(page); await gatedReading(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await openPageMode(page);
  const rev = await hardPage(page);
  const pk = rev.locator('#pgPhoto [data-pk="4"] polygon'); await pk.scrollIntoViewIfNeeded();
  const b = await pk.boundingBox(), tp = [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp });
  await page.evaluate(() => window.__ocrOpen());
  await settledByReading(page);
  await page.waitForTimeout(150);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(rev.getByTestId('pocket-edit')).toHaveAttribute('data-edit-pocket', '4', { timeout: 3000 });
});

test('#334: the reading never changes the pocket the person has open; it waits for the editor to close', async ({ page }) => {
  test.setTimeout(120000);
  await setup(page); await gatedReading(page);
  await openPageMode(page);
  const rev = await hardPage(page);
  const ed = await openPk(rev, 5);
  await ed.getByTestId('pocket-find').click();
  await ed.getByTestId('pocket-search').fill('elsa');
  await page.evaluate(() => window.__ocrOpen());
  await expect(rev.getByTestId('page-reading')).toHaveCount(0, { timeout: 20000 });
  await expect(ed).toHaveAttribute('data-edit-pocket', '5');                        // still the person's
  await expect(ed.getByTestId('pocket-search')).toHaveValue('elsa');
  await expect(ed.getByTestId('pocket-search')).toBeFocused();
  expect((await page.evaluate(() => window.__inkwellScanPageState())).pockets[5].status).toBe('choose');
  await rev.locator('#pgsClose').click();                                          // closed: the reading applies now
  await settledByReading(page);
  await expect(rev.locator('#pgPhoto [data-pk="5"]')).toHaveAttribute('data-st', 'ok');
});

test('#334: when the reading settles the last pending pocket, the screen updates in place and both footer actions work', async ({ page }) => {
  test.setTimeout(120000);
  const calls = await setup(page); await gatedReading(page);
  await openPageMode(page);
  const rev = await hardPage(page);
  for (const i of [6, 7, 8]) { const ed = await openPk(rev, i); await ed.getByTestId('pocket-skip').click(); }
  await closeSheet(rev);
  await expect(rev.getByTestId('page-add')).toHaveText('Resolver 1 posição');
  await page.evaluate(() => { for (const e of document.querySelectorAll('#pageReview [data-pocket], #pageReview [data-pk], #pgAdd')) e.__same = true; });
  await page.evaluate(() => window.__ocrOpen());
  await settledByReading(page);
  await expect(rev.getByTestId('page-add')).toHaveText('Continuar para revisão (6 cartas)');
  await expect(rev.locator('#pgPhoto [data-pk="5"] text')).toHaveText('✓');
  await expect(rev.locator('[data-pocket="5"] .chip')).toHaveText(/Reconhecida|Confirmada|Certa/);
  await expect(rev.getByTestId('page-progress')).toHaveText('Tudo resolvido');
  expect(await page.evaluate(() => [...document.querySelectorAll('#pageReview [data-pocket], #pageReview [data-pk], #pgAdd')].every((e) => e.__same))).toBe(true);   // nothing replaced
  await rev.getByTestId('page-add-more').click();                                  // inserted in place, and it works
  await expect(rev).toBeHidden();
  expect(deltas(calls)).toEqual([]);
});
