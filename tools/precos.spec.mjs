// Preços (/precos/) against a fake Supabase, with the real prices and price history files.
import { test, expect } from '@playwright/test';

const BASE = new URL('precos/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';

async function setup(page) {
  const calls = [];
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    localStorage.removeItem('inkwell-prices-view-v1');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, '');
    calls.push({ path, body: req.postData() ? JSON.parse(req.postData()) : null });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles') return json([{ profile: 'luiscredie', collection: { 'LOR10-10': { n: 4, f: 0 }, 'LOR13-31': { n: 1, f: 1 } }, wishlist: { 'LOR13-31': { t: 999 }, 'LOR10-1': 1 } }]);
    if (path === 'rpc/set_wishlist') return route.fulfill({ status: 204, body: '' });
    if (path === 'rpc/my_duels_sync') return json(null);
    return json([]);
  });
  return calls;
}
const wl = (calls) => calls.filter((c) => c.path === 'rpc/set_wishlist').map((c) => c.body);

test('movers, wishlist and collection value', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(BASE);
  await expect(page.locator('h1')).toHaveText('Preços');
  await expect(page.locator('#sub')).not.toBeEmpty();
  // Movers: the 'Última' period always compares the last two snapshots
  await page.locator('[data-period="latest"]').click();
  await expect(page.locator('[data-testid="gainers"] .list-row, [data-testid="losers"] .list-row').first()).toBeVisible({ timeout: 15000 });
  const first = page.locator('[data-mover]').first(), id = await first.getAttribute('data-mover');
  await first.locator('[data-star]').click();
  await expect.poll(() => wl(calls).length).toBe(1);
  expect(wl(calls)[0]).toMatchObject({ p_profile: 'luiscredie', p_card_id: id });

  await page.getByRole('tab', { name: /Lista de desejos/ }).click();
  await expect(page.locator('[data-wish="LOR13-31"]')).toContainText('comprar agora');
  const t = page.locator('[data-target="LOR10-1"]');
  await t.fill('12,50'); await t.press('Tab');
  await expect.poll(() => wl(calls).length).toBe(2);
  expect(wl(calls)[1]).toMatchObject({ p_card_id: 'LOR10-1', p_target: 12.5 });
  await page.locator('#addQ').fill('gurgi apple');
  await page.locator('#addRes [data-star]').first().click();
  await expect.poll(() => wl(calls).length).toBe(3);

  await page.getByRole('tab', { name: 'Valor da coleção' }).click();
  await expect(page.locator('[data-testid="value-stats"]')).toContainText('6');
  await expect(page.locator('svg.vchart')).toBeVisible();
  await expect(page.locator('[data-testid="top-cards"] .list-row')).toHaveCount(2);
});

test('Coleção links its value to Preços', async ({ page }) => {
  await setup(page);
  await page.goto(new URL('../colecao/', BASE).href);
  await page.locator('[data-testid="to-prices"]').click();
  await expect(page).toHaveURL(/precos\/\?tab=value/);
  await expect(page.getByRole('tab', { name: 'Valor da coleção' })).toHaveAttribute('aria-selected', 'true');
});
