// Trocas (/trades/) Mural against a fake Supabase: "Troco" posts from Coleção's trade binder.
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/trades.spec.mjs
import { test, expect } from '@playwright/test';

const BASE = new URL('trades/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';
const ANA = '22222222-2222-4222-8222-222222222222';

test('the board shows "tem para troca" posts; a friend can propose a trade with the card already in "I get"', async ({ page }) => {
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles') return json([{ profile: 'luiscredie', updated_at: '2026-10-20T10:00:00Z', collection: { 'LOR13-27': { n: 2, f: 0 } }, wishlist: {} }]);
    if (path === 'friendships') return json([{ requester: ME, addressee: ANA, status: 'accepted' }]);
    if (path === 'listings') return json([{ id: 'l1', user_id: ANA, kind: 'trade', card_id: 'LOR10-10', qty: 2, foil: false, price_brl: null, note: 'Troco por set 14', created_at: '2026-10-28T12:00:00Z' }]);
    if (path === 'profiles') return json([{ user_id: ANA, display_name: 'Ana Souza' }]);
    if (path === 'rpc/my_settings') return json({ user_id: ME, auto_collection: false });
    if (path === 'rpc/my_duels_sync') return json(null);
    return json([]);
  });
  await page.goto(BASE + '?tab=board');
  const row = page.locator('[data-listing="l1"]');
  await expect(row).toContainText('Ana Souza tem para troca · 2×');
  await expect(row).toContainText('Troco por set 14');
  await page.locator('[data-bkind="offer"]').click();
  await expect(row).toBeVisible();
  await page.locator('[data-bkind="want"]').click();
  await expect(row).toHaveCount(0);
  await page.locator('[data-bkind="all"]').click();
  await row.getByRole('button', { name: 'Propor troca' }).click();
  await expect(page.locator('#tradeForm')).toBeVisible();
  await expect(page.locator('#tradeForm [data-items="gt"]')).toContainText('Gurgi');
});
