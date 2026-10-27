// Coleção (/colecao/) against a fake Supabase: the binder check mode.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/colecao.spec.mjs
import { test, expect } from '@playwright/test';

const BASE = new URL('colecao/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';

async function setup(page, { collection = { 'LOR10-10': { n: 2, f: 0 } }, added = [], home = [], failHome = false, fresh = false } = {}) {
  let created = false;
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
    if (path === 'inkwell_profiles' && req.method() === 'POST') { created = true; return route.fulfill({ status: 201, body: '' }); }
    if (path === 'inkwell_profiles') return json(fresh && !created ? [] : [{ profile: fresh ? 'principal' : 'luiscredie', updated_at: '2026-10-20T10:00:00Z', collection: fresh ? {} : collection }]);
    if (path === 'collection_added') return json(added);
    if (path === 'collection_home') return home === null ? route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }) : json(home);
    if (path === 'rpc/collection_change') return failHome ? route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"x"}' }) : route.fulfill({ status: 204, body: '' });
    if (path === 'rpc/apply_collection_delta') return route.fulfill({ status: 204, body: '' });
    if (path === 'rpc/my_duels_sync') return json(null);
    return json([]);
  });
  return calls;
}

test('binder check mode follows the binder order and saves changes', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Conferir estoque' }).click();
  await expect(page).toHaveURL(/conferir=1/);
  await expect(page.locator('[data-testid="binder-page"]')).toHaveText(/^Amber · custo \d$/);
  const names = await page.locator('.binder-row .t > span:first-child').allInnerTexts();
  expect(names.length).toBeGreaterThan(1);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  expect(names.map((n) => n.split('\n')[0])).toEqual(sorted.map((n) => n.split('\n')[0]));

  const first = page.locator('.binder-row').first();
  const id = await first.getAttribute('data-bcard');
  await first.locator(`[data-bq="${id}:n:1"]`).click();
  await expect(first.locator('output').first()).toHaveText('1');
  await expect.poll(() => calls.filter((c) => c.path === 'rpc/apply_collection_delta').length).toBe(1);
  expect(calls.find((c) => c.path === 'rpc/apply_collection_delta').body.p_delta).toEqual([{ card_id: id, qty: 1, foil: false }]);

  const progress = await page.locator('[data-testid="binder-progress"]').innerText();
  await page.locator('#bCheck').click();
  await expect(page.locator('#bCheck')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('[data-testid="binder-progress"]').innerText()).not.toBe(progress);

  const before = await page.locator('[data-testid="binder-page"]').innerText();
  await page.getByRole('button', { name: 'Próxima página' }).click();
  await expect(page.locator('[data-testid="binder-page"]')).not.toHaveText(before);

  await page.locator('[data-bsec="inf"]').click();
  await expect(page.locator('[data-bsec="inf"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="binder-page"]')).toHaveText(/^Amber · custo/);

  await page.locator('#bOwned').check();
  await page.locator('[data-bsec="core"]').click();
  await page.locator('[data-bink="Amber"]').click();
  await page.locator('[data-bcost="2"]').click();
  await expect(page.locator('.binder-row')).toHaveCount(1);   // only Gurgi (LOR10-10, Amber cost 2) is owned there
  await expect(page.locator('.binder-row')).toContainText('Gurgi');

  await page.locator('#backColl').click();
  await expect(page).not.toHaveURL(/conferir/);
  await expect(page.getByRole('button', { name: 'Conferir estoque' })).toBeVisible();
});

// ---------- Escanear (card scanner) with a fake camera that shows one card image in the frame ----------
const IMG = (f) => `../lorcana-card-images/images/${f}`;
async function fakeCamera(page, { file, ocr = null, deny = false, scale = 1.03, wobble = 0 }) {
  await page.addInitScript(([src, ocrText, denied, k, wob]) => {
    if (ocrText !== null) window.INKWELL_SCAN_OCR = async () => ocrText;
    navigator.mediaDevices.getUserMedia = async () => {
      if (denied) throw new DOMException('denied', 'NotAllowedError');
      const c = document.createElement('canvas'); c.width = 720; c.height = 1280;
      const ctx = c.getContext('2d'), img = new Image(); img.src = src;
      let t = 0;
      setInterval(() => {
        t++; const jx = wob ? Math.sin(t * 1.7) * wob : 0, jy = wob ? Math.cos(t * 1.3) * wob : 0;   // a phone being moved around
        ctx.fillStyle = '#4a3426'; ctx.fillRect(0, 0, c.width, c.height);
        const g = window.__inkwellScanGuide?.();
        if (g && img.complete && img.naturalWidth) {   // the card a little off-centre and a little bigger than the frame, as a hand would hold it
          const w = g.w * k, h = g.h * k;
          ctx.drawImage(img, g.x + g.w * (0.02 + jx) - (w - g.w) / 2, g.y + g.h * (jy - 0.015) - (h - g.h) / 2, w, h);
        }
      }, 60);
      return c.captureStream(15);
    };
  }, [file ? IMG(file) : '', ocr, deny, scale, wobble]);
}
async function confirmList(page, n) {   // Concluir -> review -> add
  await page.getByRole('button', { name: 'Concluir' }).click();
  const review = page.locator('[data-testid="scan-review"]');
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: n === 1 ? 'Adicionar 1 carta à coleção' : `Adicionar ${n} cartas à coleção` }).click();
}
const deltas = (calls) => calls.filter((c) => c.path === 'rpc/apply_collection_delta').flatMap((c) => c.body.p_delta);

test('scanner lists the cards it recognises and adds them only after review; +1, foil and undo', async ({ page }) => {
  const calls = await setup(page);
  await fakeCamera(page, { file: 'Rapunzel_-_Tower_Defender__LOR13-80.jpg' });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await expect(page.locator('[data-testid="scan-last"]')).toContainText('Rapunzel', { timeout: 15000 });
  await expect(page.locator('[data-testid="scan-count"]')).toHaveText('1 na lista');
  await page.getByRole('button', { name: '+1 desta' }).click();
  await expect(page.locator('[data-testid="scan-count"]')).toHaveText('2 na lista');
  await page.locator('#scanUndo').click();
  await expect(page.locator('[data-testid="scan-count"]')).toHaveText('1 na lista');
  await page.locator('#scan [data-foil="1"]').click();
  await page.getByRole('button', { name: '+1 desta' }).click();
  await page.getByRole('button', { name: 'Concluir' }).click();
  const review = page.locator('[data-testid="scan-review"]');
  await expect(review.locator('[data-rev]')).toHaveCount(2);   // normal and foil
  await page.waitForTimeout(900);
  expect(deltas(calls)).toEqual([]);   // nothing saved before confirming
  await review.locator('[data-rev="LOR13-80:1"] [data-rq="1"]').click();   // 2 foil
  await review.locator('[data-rev="LOR13-80:1"] [data-rq="-1"]').click();  // back to 1
  await review.getByRole('button', { name: 'Adicionar 2 cartas à coleção' }).click();
  await expect.poll(() => deltas(calls).length).toBeGreaterThan(0);
  const net = {}; for (const d of deltas(calls)) { const k = `${d.card_id}:${d.foil}`; net[k] = (net[k] || 0) + d.qty; }
  expect(net).toEqual({ 'LOR13-80:false': 1, 'LOR13-80:true': 1 });
});

test('scanner reads the collector line when two printings share the art', async ({ page }) => {
  const calls = await setup(page);
  await fakeCamera(page, { file: 'The_Queen_-_Regal_Monarch__LOR9-7.jpg', ocr: '7/204 · EN · 9' });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await expect(page.locator('[data-testid="scan-last"]')).toContainText('nº 7', { timeout: 15000 });
  await confirmList(page, 1);
  await expect.poll(() => deltas(calls).map((d) => d.card_id)).toEqual(['LOR9-7']);
});

test('scanner asks only when it cannot tell the printings apart', async ({ page }) => {
  const calls = await setup(page);
  await fakeCamera(page, { file: 'Under_the_Sea__LOR4-95.jpg', ocr: '' });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  const pick = page.locator('[data-testid="scan-pick"]');
  await expect(pick).toBeVisible({ timeout: 15000 });
  await expect(pick.locator('[data-pick]')).toHaveCount(3);   // two printings + "Nenhuma destas"
  await pick.locator('[data-pick="LOR9-97"]').click();
  await expect(page.locator('[data-testid="scan-last"]')).toContainText('nº 97');
  await confirmList(page, 1);
  await expect.poll(() => deltas(calls).map((d) => d.card_id)).toEqual(['LOR9-97']);
});

test('scanner explains a blocked camera', async ({ page }) => {
  await setup(page);
  await fakeCamera(page, { deny: true });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await expect(page.locator('#scanSay')).toContainText('A câmera não abriu');
});

test('binder: rotated cards only in Infinity, reprints marked, tap shows the card big', async ({ page }) => {
  await setup(page);
  await page.goto(BASE + '?conferir=1');
  // Amber Coil (set 7, no reprint) is Infinity only
  await page.locator('[data-bsec="core"]').click();
  await page.locator('[data-bink="Amber"]').click();
  await page.locator('[data-bcost="1"]').click();
  await expect(page.locator('[data-bcard="LOR7-41"]')).toHaveCount(0);
  await page.locator('[data-bsec="inf"]').click();
  await page.locator('[data-bink="Amber"]').click();
  await page.locator('[data-bcost="1"]').click();
  await expect(page.locator('[data-bcard="LOR7-41"]')).toHaveCount(1);
  const w = await page.locator('[data-bcard="LOR7-41"] .thumb').evaluate((e) => e.getBoundingClientRect().width);
  expect(w).toBeLessThan(60);   // small image in the row, at desktop size too
  await page.locator('[data-bopen="LOR7-41"]').click();
  await expect(page.locator('#cardSheet .thumb.big')).toBeVisible();
  await expect(page.locator('[data-testid="card-format"]')).toHaveText('Só no Infinito: não tem reimpressão em set do Core.');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="binder-page"]')).toBeVisible();
});

test('scanner recognises a set 14 card held smaller than the frame (a picture on a screen)', async ({ page }) => {
  const calls = await setup(page);
  await fakeCamera(page, { file: 'Fru_Fru_-_VIP_Guest__LOR14-1.jpg', scale: 0.68 });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await expect(page.locator('[data-testid="scan-last"]')).toContainText('Fru Fru', { timeout: 15000 });
  await confirmList(page, 1);
  await expect.poll(() => deltas(calls).map((d) => d.card_id)).toEqual(['LOR14-1']);
});

test('closing the scanner with cards in the list asks first; discarding saves nothing', async ({ page }) => {
  const calls = await setup(page);
  await fakeCamera(page, { file: 'Rapunzel_-_Tower_Defender__LOR13-80.jpg' });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await expect(page.locator('[data-testid="scan-count"]')).toHaveText('1 na lista', { timeout: 15000 });
  await page.keyboard.press('Escape');
  const review = page.locator('[data-testid="scan-review"]');
  await expect(review).toBeVisible();
  await expect(review).toContainText('Rapunzel');
  await review.getByRole('button', { name: 'Descartar a lista' }).click();
  await review.getByRole('button', { name: 'Toque de novo para descartar' }).click();
  await expect(page.locator('#scan')).not.toBeVisible();
  await page.waitForTimeout(900);
  expect(deltas(calls)).toEqual([]);
});

test('sort by recently added, and the MYP Cards price in the card sheet', async ({ page }) => {
  await setup(page, {
    collection: { 'LOR10-10': { n: 2, f: 0 }, 'LOR13-80': { n: 1, f: 0 }, 'LOR9-7': { n: 1, f: 0 } },
    added: [{ profile: 'luiscredie', card_id: 'LOR13-80', added_at: '2026-10-21T12:00:00Z' }, { profile: 'luiscredie', card_id: 'LOR9-7', added_at: '2026-10-20T12:00:00Z' }],
  });
  await page.addInitScript(() => localStorage.setItem('inkwell-coll-view-v2', JSON.stringify({ view: 'list', sort: 'recent' })));
  await page.goto(BASE);
  const ids = await page.locator('.list-row[data-card]').evaluateAll((els) => els.map((e) => e.dataset.card));
  expect(ids).toEqual(['LOR13-80', 'LOR9-7', 'LOR10-10']);   // newest first, undated last
  await expect(page.locator('.list-row[data-card="LOR13-80"]')).toContainText('adicionada em');
  await page.locator('.list-row[data-card="LOR13-80"]').click();
  const br = page.locator('[data-testid="card-br"]');
  await expect(br).toContainText('No Brasil a partir de');
  await expect(br).toHaveAttribute('href', 'https://mypcards.com/lorcana/produto/363191/rapunzel-tower-defender');
});

test('scanner adds nothing while the phone is moving', async ({ page }) => {
  await setup(page);
  await fakeCamera(page, { file: 'Rapunzel_-_Tower_Defender__LOR13-80.jpg', wobble: 0.12 });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await page.waitForTimeout(5000);
  await expect(page.locator('[data-testid="scan-count"]')).toHaveText('');
});

test('a hand that shakes a little still gets the card', async ({ page }) => {
  await setup(page);
  await fakeCamera(page, { file: 'Judy_Hopps_-_Helpful_Officer__LOR14-9.jpg', wobble: 0.018, scale: 1.05 });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await expect(page.locator('[data-testid="scan-last"]')).toContainText('Judy Hopps', { timeout: 15000 });
});

test('binder: a dual-ink card sits on its first ink pages, where the set numbers it', async ({ page }) => {
  await setup(page);
  await page.goto(BASE + '?conferir=1');
  await page.locator('[data-bsec="core"]').click();
  await expect(page.locator('[data-bink="Dual"]')).toHaveCount(0);
  await page.locator('[data-bink="Amber"]').click();
  await page.locator('[data-bcost="4"]').click();
  const card = page.locator('[data-bcard="LOR13-27"]');   // Pocahontas & Meeko, Amber/Amethyst
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-testid="dual"]')).toHaveText('Amber / Amethyst');
});

// ---------- three stocks: Fichário, Casa, Emprestadas ----------
const rpc = (calls, name) => calls.filter((c) => c.path === `rpc/${name}`).map((c) => c.body);
test('stocks: binder and home counts, move a card home, binder check counts only the binder', async ({ page }) => {
  const calls = await setup(page, { collection: { 'LOR10-10': { n: 3, f: 1 }, 'LOR13-27': { n: 1, f: 0 } }, home: [{ profile: 'luiscredie', card_id: 'LOR10-10', n: 1, f: 0 }] });
  await page.goto(BASE);
  const places = page.locator('[data-testid="places"]');
  await expect(places.locator('[data-place="all"]')).toContainText('5');
  await expect(places.locator('[data-place="binder"]')).toContainText('4');
  await expect(places.locator('[data-place="home"]')).toContainText('1');
  await places.locator('[data-place="home"]').click();
  await expect(page.locator('#count')).toHaveText('1 cartas');
  await expect(page.locator('[data-card="LOR10-10"] .pill')).toHaveText('×1');
  await places.locator('[data-place="binder"]').click();
  await expect(page.locator('#count')).toHaveText('2 cartas');
  // the card sheet: 2 normal + 1 foil in the binder, 1 normal at home; move one normal home
  await page.locator('[data-card="LOR10-10"]').click();
  const st = page.locator('[data-testid="stocks"]');
  await expect(st.locator('[data-n="binder-n"]')).toHaveText('2');
  await expect(st.locator('[data-n="home-n"]')).toHaveText('1');
  await st.locator('[data-mv="n:home"]').click();
  // asks how many first; nothing moves until confirmed
  const box = page.locator('[data-testid="move-confirm"]');
  await expect(box).toContainText('Mover cartas normais para Casa');
  await expect(box).toContainText('2 no fichário');
  await box.locator('[data-mq="all"]').click();
  await expect(box.locator('#mvQ')).toHaveText('2');
  await box.locator('[data-mq="-1"]').click();
  await page.locator('#mvCancel').click();
  await expect(box).toHaveCount(0);
  expect(rpc(calls, 'collection_change')).toEqual([]);
  await st.locator('[data-mv="n:home"]').click();
  await expect(page.locator('#mvOk')).toHaveText('Mover 1 para Casa');
  await page.locator('#mvOk').click();
  await expect(st.locator('[data-n="binder-n"]')).toHaveText('1');
  await expect(st.locator('[data-n="home-n"]')).toHaveText('2');
  await expect.poll(() => rpc(calls, 'collection_change')).toEqual([{ p_profile: 'luiscredie', p_delta: [], p_home: [{ card_id: 'LOR10-10', qty: 1, foil: false }] }]);
  // adding one at home: owned +1 and home +1 in one call
  await st.locator('[data-d="f:1:home"]').click();
  await expect.poll(() => rpc(calls, 'collection_change').at(-1)).toEqual({ p_profile: 'luiscredie', p_delta: [{ card_id: 'LOR10-10', qty: 1, foil: true }], p_home: [{ card_id: 'LOR10-10', qty: 1, foil: true }] });
  await page.keyboard.press('Escape');
  // Conferir fichário shows what is in the binder (3 normal − 2 at home = 1) and how many are at home
  await page.getByRole('button', { name: 'Conferir estoque' }).click();
  await page.locator('[data-bsec="core"]').click();
  await page.locator('[data-bink="Amber"]').click();
  await page.locator('[data-bcost="2"]').click();   // Gurgi, LOR10-10
  const row = page.locator('[data-bcard="LOR10-10"]');
  await expect(row.locator('[data-bn="binder-n"]')).toHaveText('1');
  await expect(row.locator('[data-bn="home-n"]')).toHaveText('2');
  await expect(row.locator('[data-bn="home-f"]')).toHaveText('1');
  // + in the Casa column adds a card at home
  await row.locator('[data-bq="LOR10-10:n:1:home"]').click();
  await expect(row.locator('[data-bn="home-n"]')).toHaveText('3');
  await expect.poll(() => rpc(calls, 'collection_change').at(-1)).toEqual({ p_profile: 'luiscredie', p_delta: [{ card_id: 'LOR10-10', qty: 1, foil: false }], p_home: [{ card_id: 'LOR10-10', qty: 1, foil: false }] });
  // two separate marks per page; the binder mark keeps its old storage
  await page.locator('#hCheck').click();
  await expect(page.locator('#hCheck')).toHaveText('Casa conferida');
  await expect(page.locator('#bCheck')).toHaveText('Fichário: marcar conferido');
  await expect(page.locator('[data-bcost="2"]')).toHaveText('2⌂');
  await page.locator('#bCheck').click();
  await expect(page.locator('[data-bcost="2"]')).toHaveText('2✓⌂');
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /checked/.test(k)).sort())).toEqual(['inkwell-binder-checked-v1-11111111-1111-4111-8111-111111111111', 'inkwell-home-checked-v1-11111111-1111-4111-8111-111111111111']);
});

test('stocks: the scanner adds to the chosen stock; without the table nothing changes', async ({ page }) => {
  const calls = await setup(page);
  await fakeCamera(page, { file: 'Fru_Fru_-_VIP_Guest__LOR14-1.jpg', scale: 0.68 });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await expect(page.locator('[data-testid="scan-last"]')).toContainText('Fru Fru', { timeout: 15000 });
  await page.getByRole('button', { name: 'Concluir' }).click();
  await page.locator('[data-testid="scan-place"] [data-splace="home"]').click();
  await page.locator('[data-testid="scan-review"]').getByRole('button', { name: 'Adicionar 1 carta à coleção' }).click();
  await expect.poll(() => rpc(calls, 'collection_change')).toEqual([{ p_profile: 'luiscredie', p_delta: [{ card_id: 'LOR14-1', qty: 1, foil: false }], p_home: [{ card_id: 'LOR14-1', qty: 1, foil: false }] }]);
});

test('stocks: before supabase/collection_home.sql runs, the page works as before', async ({ page }) => {
  const calls = await setup(page, { home: null });
  await page.goto(BASE);
  await expect(page.locator('#count')).toHaveText('1 cartas');
  await expect(page.locator('[data-testid="places"]')).toHaveCount(0);
  await page.locator('[data-card="LOR10-10"]').click();
  await expect(page.locator('[data-testid="stocks"]')).toHaveCount(0);
  await page.locator('#cardSheet [data-d="n:1"]').click();
  await expect.poll(() => rpc(calls, 'apply_collection_delta')).toEqual([{ p_profile: 'luiscredie', p_delta: [{ card_id: 'LOR10-10', qty: 1, foil: false }] }]);
});

test('scanner recognises the Tinker Bell Challenge promo (DLPC1-18-C2)', async ({ page }) => {
  const calls = await setup(page);
  await fakeCamera(page, { file: 'Tinker_Bell_-_Insistent_Fairy_(Disney_Lorcana_Challenge)__DLPC1-18-C2.jpg' });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await expect(page.locator('[data-testid="scan-last"]')).toContainText('Tinker Bell', { timeout: 15000 });
  await confirmList(page, 1);
  await expect.poll(() => deltas(calls).map((d) => d.card_id)).toEqual(['DLPC1-18-C2']);
});

test('stocks: when a save fails, the card sheet goes back to the saved counts', async ({ page }) => {
  await setup(page, { collection: { 'LOR8-136': { n: 0, f: 1 } }, home: [{ profile: 'luiscredie', card_id: 'LOR8-136', n: 0, f: 1 }], failHome: true });
  await page.goto(BASE);
  await page.locator('[data-card="LOR8-136"]').click();
  const st = page.locator('[data-testid="stocks"]');
  await expect(st.locator('[data-n="home-f"]')).toHaveText('1');
  await st.locator('[data-d="f:-1:home"]').click();
  await expect(st.locator('[data-n="home-f"]')).toHaveText('0');
  await expect(page.locator('#toast')).toContainText('Não foi possível salvar');
  await expect(st.locator('[data-n="home-f"]')).toHaveText('1');
});

// ---------- Emprestar / Vender / Venda combo ----------
const posts = (calls, path) => calls.filter((c) => c.path === path && c.body).map((c) => c.body);
const ymd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
test('lend from the card sheet: a loan in Trocas, the copy shows as lent', async ({ page }) => {
  const calls = await setup(page, { collection: { 'LOR10-10': { n: 2, f: 0 } } });
  await page.goto(BASE);
  await page.locator('[data-card="LOR10-10"]').click();
  await page.locator('#aLoan').click();
  await page.locator('#aOk').click();
  await expect(page.locator('#aMsg')).toHaveText('Escreva para quem é o empréstimo.');
  await page.locator('#aPerson').fill('Rafa');
  await page.locator('#aDue').fill('2026-11-30');
  await page.locator('#aOk').click();
  await expect.poll(() => posts(calls, 'loans')).toEqual([{ direction: 'lent', person: 'Rafa', items: [{ card_id: 'LOR10-10', qty: 1, foil: false }], due_on: '2026-11-30', note: '' }]);
  await expect(page.locator('[data-testid="stocks"]')).toContainText('1 emprestada');
});

test('sell one card: date is today, the price comes filled, the card leaves the collection', async ({ page }) => {
  const calls = await setup(page, { collection: { 'LOR10-10': { n: 2, f: 0 } } });
  await page.goto(BASE);
  await page.locator('[data-card="LOR10-10"]').click();
  await page.locator('#aSale').click();
  await expect(page.locator('#aDate')).toHaveValue(ymd());
  await page.locator('[data-price="0"]').fill('5');
  await expect(page.locator('#aTotal')).toHaveValue('5.00');
  await page.locator('#aOk').click();
  await expect.poll(() => posts(calls, 'trades')).toEqual([{ person: 'Venda', traded_on: ymd(), gave: [{ card_id: 'LOR10-10', qty: 1, foil: false, price: 5 }], got: [], cash_brl: -5, note: 'Venda', collection: 'applied' }]);
  expect(rpc(calls, 'collection_change').concat(rpc(calls, 'apply_collection_delta')).map((b) => b.p_delta)).toEqual([[{ card_id: 'LOR10-10', qty: -1, foil: false }]]);
});

test('combo sale: add cards, keep each price, a lower total becomes the discount', async ({ page }) => {
  const calls = await setup(page, { collection: { 'LOR10-10': { n: 2, f: 0 }, 'LOR13-12': { n: 3, f: 0 } } });
  await page.goto(BASE);
  await page.locator('[data-card="LOR10-10"]').click();
  await page.locator('#aSale').click();
  await page.locator('[data-price="0"]').fill('10');
  await page.locator('#aCombo').click();
  await page.locator('#aQ').fill('pocahontas guiding');
  await page.locator('[data-add="LOR13-12"]').click();
  await page.locator('[data-price="1"]').fill('20');
  await page.locator('[data-q="1:1"]').click();   // 2 Pocahontas
  await expect(page.locator('#aSum')).toContainText('50,00');
  await page.locator('#aTotal').fill('40');
  await expect(page.locator('[data-testid="discount"]')).toContainText('10,00 · 20%');
  await page.locator('#aOk').click();
  await expect.poll(() => posts(calls, 'trades')).toEqual([{ person: 'Venda', traded_on: ymd(), cash_brl: -40, collection: 'applied', got: [],
    gave: [{ card_id: 'LOR10-10', qty: 1, foil: false, price: 10 }, { card_id: 'LOR13-12', qty: 2, foil: false, price: 20 }], note: 'Venda combo · desconto R$\u00a010,00' }]);
});

test('conferir estoque: pick a set; only its cards and pages; checked marks kept per set', async ({ page }) => {
  await setup(page, { collection: { 'LOR10-10': { n: 2, f: 0 }, 'LOR13-12': { n: 3, f: 0 } } });
  await page.goto(BASE);
  await expect(page.locator('#openBinder')).toHaveText('Conferir estoque');
  await page.locator('#openBinder').click();
  await expect(page.locator('#title')).toHaveText('Conferir estoque');
  await page.locator('[data-bsec="core"]').click();
  await page.locator('[data-bink="Amber"]').click();
  await page.locator('[data-bcost="2"]').click();
  await expect(page.locator('[data-bcard="LOR10-10"]')).toHaveCount(1);   // Gurgi (set 10) and Pocahontas (set 13) share Amber · 2
  await page.locator('#bSet').selectOption('LOR13');
  await expect(page.locator('[data-bcard="LOR10-10"]')).toHaveCount(0);
  await expect(page.locator('[data-bcard="LOR13-12"]')).toHaveCount(1);
  expect(await page.locator('.binder-row').evaluateAll((r) => r.every((x) => x.dataset.bcard.startsWith('LOR13-')))).toBe(true);
  await page.locator('#bCheck').click();   // checked for set 13 only
  await expect(page.locator('[data-bcost="2"]')).toContainText('✓');
  await page.locator('#bSet').selectOption('all');
  await expect(page.locator('[data-bcost="2"]')).not.toContainText('✓');
});

test('sets are listed by set number', async ({ page }) => {
  await setup(page);
  await page.goto(BASE + '?conferir=1');
  const codes = await page.locator('#bSet option').evaluateAll((o) => o.map((x) => x.value).filter((v) => v !== 'all'));
  const main = codes.filter((c) => /^LOR\d+$/.test(c)).map((c) => +c.slice(3));
  expect(main).toEqual([...main].sort((a, b) => a - b));
  expect(codes.slice(0, 3)).toEqual(['LOR1', 'LOR2', 'LOR3']);
  expect(codes.indexOf('LOR14')).toBeLessThan(codes.indexOf('Q1'));
});

test('a new account gets an empty collection, so its first card saves', async ({ page }) => {
  const calls = await setup(page, { fresh: true });
  await page.goto(BASE);
  await expect.poll(() => calls.filter((c) => c.path === 'inkwell_profiles' && c.body).length).toBe(1);
  const made = calls.find((c) => c.path === 'inkwell_profiles' && c.body).body;
  expect(made).toMatchObject({ user_id: ME, profile: 'principal', data: { collection: {} } });
});

test('import: a Dreamborn file is recognised on its own; review, then "keep the larger number" adds only what is missing', async ({ page }) => {
  const calls = await setup(page, { collection: { 'LOR10-10': { n: 2, f: 0 }, 'LOR1-41': { n: 3, f: 0 } } });
  await page.goto(BASE);
  await page.locator('[data-testid="import"]').click();
  const csv = 'Set Number,Card Number,Variant,Count,Name\n1,41,Normal,3,Elsa - Snow Queen\n1,41,Foil,1,Elsa - Snow Queen\n10,10,Normal,4,Gurgi - Apple Lover\n99,1,Normal,1,Nobody\n';
  await page.locator('#impFile').setInputFiles({ name: 'dreamborn.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const sum = page.locator('[data-testid="imp-summary"]');
  await expect(sum).toContainText('Reconhecido: Dreamborn');
  await expect(sum).toContainText('2 cartas diferentes · 7 normais · 1 foil');
  await expect(page.locator('[data-testid="imp-rejects"]')).toContainText('1 linha não foi reconhecida');
  await page.locator('[data-testid="imp-rejects"] summary').click();
  await expect(page.locator('[data-testid="imp-rejects"]')).toContainText('linha 5: 99 · 1 · Nobody');
  // max: Elsa 3 already (0 more) + 1 foil; Gurgi 2 -> 4 (2 more) = 3
  await expect(page.locator('#impGo')).toHaveText('Adicionar 3 cartas à coleção');
  if (process.env.SHOT) { await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600); await page.screenshot({ path: process.env.SHOT }); await page.setViewportSize({ width: 1280, height: 720 }); }
  await page.locator('[name=impMode][value=sum]').check();
  await expect(page.locator('#impGo')).toHaveText('Adicionar 8 cartas à coleção');
  await page.locator('[name=impMode][value=max]').check();
  await page.locator('#impGo').click();
  await expect.poll(() => calls.filter((c) => c.path === 'rpc/apply_collection_delta').length).toBe(1);
  const d = calls.find((c) => c.path === 'rpc/apply_collection_delta').body;
  expect(d.p_profile).toBe('luiscredie');
  expect(d.p_delta).toEqual(expect.arrayContaining([{ card_id: 'LOR1-41', qty: 1, foil: true }, { card_id: 'LOR10-10', qty: 2, foil: false }]));
  expect(d.p_delta).toHaveLength(2);
  await expect(page.locator('#toast')).toContainText('3 cartas adicionadas');
});

test('import: a pasted list; nothing matched says so', async ({ page }) => {
  const calls = await setup(page, { collection: {} });
  await page.goto(BASE);
  await page.locator('[data-testid="import"]').click();
  await page.locator('#impText').fill('carta que não existe\noutra');
  await page.locator('#impRead').click();
  await expect(page.locator('#impMsg')).toContainText('Nenhuma linha bateu');
  await page.locator('#impText').fill('4 Gurgi - Apple Lover\n1 Elsa - Snow Queen (foil)');
  await page.locator('#impRead').click();
  await expect(page.locator('[data-testid="imp-summary"]')).toContainText('Reconhecido: Lista');
  await page.locator('#impGo').click();
  await expect.poll(() => calls.filter((c) => c.path === 'rpc/apply_collection_delta').length).toBe(1);
  expect(calls.find((c) => c.path === 'rpc/apply_collection_delta').body.p_delta).toHaveLength(2);
});
