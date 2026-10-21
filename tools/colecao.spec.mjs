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
