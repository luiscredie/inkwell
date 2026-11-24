// Inkwell Mobile B2: the screens the first app version must cover — start, sign-in, Coleção, Decks — on a phone,
// signed out and signed in (fake Supabase). Checks: the page loads without errors, fits the screen, the bottom
// tab bar is there and can be used. Screenshots in SHOT_DIR.
import { test, expect } from '@playwright/test';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/';
const ME = '11111111-1111-4111-8111-111111111111';
async function signedIn(page) {
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'teste@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles') return json([{ profile: 'teste', updated_at: '2026-11-20T10:00:00Z', collection: { 'LOR13-80': { n: 2, f: 0 }, 'LOR10-10': { n: 1, f: 1 } } }]);
    if (path.startsWith('rpc/')) return json(null);
    return json([]);
  });
}
const shot = (page, name) => process.env.SHOT_DIR ? page.screenshot({ path: `${process.env.SHOT_DIR}/${test.info().project.name}-${name}.png` }) : null;
async function fits(page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
  expect(r.sw).toBeLessThanOrEqual(r.vw + 1);
}

const SCREENS = [
  ['inicio', 'feed/', false], ['entrar', 'entrar/', false], ['colecao', 'colecao/', true], ['decks', 'decks/', true],
];
for (const [name, path, auth] of SCREENS) {
  test(`${name}: loads, fits the phone, tab bar in reach`, async ({ page }) => {
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    if (auth) await signedIn(page); else await page.addInitScript(() => localStorage.setItem('inkwell-lang', 'pt'));
    await page.goto(new URL(path, ROOT).href);
    await page.waitForLoadState('networkidle').catch(() => {});
    await fits(page);
    const vp = page.viewportSize();
    const nav = page.locator('nav').filter({ has: page.locator('a[href*="colecao"]') }).last();
    if (name !== 'entrar') {
      await expect(nav).toBeVisible();
      const b = await nav.boundingBox();
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1);   // the bar sits inside the screen
    }
    await shot(page, name);
    expect(errors).toEqual([]);
  });
}

test('navigation between Coleção and Decks by the tab bar (signed in)', async ({ page }) => {
  await signedIn(page);
  await page.goto(new URL('colecao/', ROOT).href);
  const nav = page.locator('nav').filter({ has: page.locator('a[href*="decks"]') }).last();
  await nav.locator('a[href*="decks"]').first().click();
  await expect(page).toHaveURL(/\/decks\//);
  await fits(page);
});
