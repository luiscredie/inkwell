// Coleção (/colecao/) against a fake Supabase: the binder check mode.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/colecao.spec.mjs
import { test, expect } from '@playwright/test';

const BASE = new URL('colecao/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';

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
    if (path === 'rpc/apply_collection_delta') return route.fulfill({ status: 204, body: '' });
    if (path === 'rpc/my_duels_sync') return json(null);
    return json([]);
  });
  return calls;
}

test('binder check mode follows the binder order and saves changes', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Conferir fichário' }).click();
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
  await expect(page.getByRole('button', { name: 'Conferir fichário' })).toBeVisible();
});

// ---------- Escanear (card scanner) with a fake camera that shows one card image in the frame ----------
const IMG = (f) => `../lorcana-card-images/images/${f}`;
async function fakeCamera(page, { file, ocr = null, deny = false }) {
  await page.addInitScript(([src, ocrText, denied]) => {
    if (ocrText !== null) window.INKWELL_SCAN_OCR = async () => ocrText;
    navigator.mediaDevices.getUserMedia = async () => {
      if (denied) throw new DOMException('denied', 'NotAllowedError');
      const c = document.createElement('canvas'); c.width = 720; c.height = 1280;
      const ctx = c.getContext('2d'), img = new Image(); img.src = src;
      setInterval(() => {
        ctx.fillStyle = '#4a3426'; ctx.fillRect(0, 0, c.width, c.height);
        const g = window.__inkwellScanGuide?.();
        if (g && img.complete && img.naturalWidth) {   // the card a little off-centre and a little bigger than the frame, as a hand would hold it
          const w = g.w * 1.03, h = g.h * 1.03;
          ctx.drawImage(img, g.x + g.w * 0.02 - (w - g.w) / 2, g.y - g.h * 0.015 - (h - g.h) / 2, w, h);
        }
      }, 60);
      return c.captureStream(15);
    };
  }, [file ? IMG(file) : '', ocr, deny]);
}
const deltas = (calls) => calls.filter((c) => c.path === 'rpc/apply_collection_delta').flatMap((c) => c.body.p_delta);

test('scanner adds a card it recognises; +1, foil and undo', async ({ page }) => {
  const calls = await setup(page);
  await fakeCamera(page, { file: 'Rapunzel_-_Tower_Defender__LOR13-80.jpg' });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await expect(page.locator('[data-testid="scan-last"]')).toContainText('Rapunzel', { timeout: 15000 });
  await expect(page.locator('[data-testid="scan-count"]')).toHaveText('1 adicionada');
  await page.getByRole('button', { name: '+1 desta' }).click();
  await expect(page.locator('[data-testid="scan-count"]')).toHaveText('2 adicionadas');
  await page.locator('#scanUndo').click();
  await expect(page.locator('[data-testid="scan-count"]')).toHaveText('1 adicionada');
  await page.locator('#scan [data-foil="1"]').click();
  await page.getByRole('button', { name: '+1 desta' }).click();
  await page.getByRole('button', { name: 'Concluir' }).click();
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
  await page.getByRole('button', { name: 'Concluir' }).click();
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
  await page.getByRole('button', { name: 'Concluir' }).click();
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
  await page.locator('[data-bopen="LOR7-41"]').click();
  await expect(page.locator('#cardSheet .thumb.big')).toBeVisible();
  await expect(page.locator('[data-testid="card-format"]')).toHaveText('Só no Infinito: não tem reimpressão em set do Core.');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="binder-page"]')).toBeVisible();
});
