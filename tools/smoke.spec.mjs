// Browser smoke for the site root: the old app is retired, so the root and
// /sim/ only send people to the new pages, and the old files are gone.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/smoke.spec.mjs
import { test, expect } from '@playwright/test';

const ROOT = new URL('./', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;

test.beforeEach(async ({ page }) => {
  // no network to Supabase in a smoke run
  await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
});

test('the root opens Início (feed) without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(ROOT);
  await expect(page).toHaveURL(/\/feed\/$/);
  await expect(page.locator('body')).toContainText('Inkwell');
  expect(errors).toEqual([]);
});

for (const [hash, page_] of [['#collection', 'colecao'], ['#prices', 'precos'], ['#decks', 'decks'], ['#learn', 'comecar'], ['#matches', 'eventos'], ['#qualquer', 'feed']]) {
  test(`an old address ${hash} goes to /${page_}/`, async ({ page }) => {
    await page.goto(ROOT + 'index.html' + hash);
    await expect(page).toHaveURL(new RegExp(`/${page_}/$`));
  });
}

test('the simulator address goes to Início', async ({ page }) => {
  await page.goto(ROOT + 'sim/');
  await expect(page).toHaveURL(/\/feed\/$/);
});

test('the old app files are not published any more', async ({ request }) => {
  for (const f of ['support.js', 'match-center-engine.js', 'manifest.webmanifest', 'users/luis.json', 'sim/game.js']) {
    expect((await request.get(ROOT + f)).status(), f).toBe(404);
  }
  const sw = await (await request.get(ROOT + 'sw.js')).text();
  expect(sw).toContain('unregister');
  expect(sw).not.toContain('addEventListener(\'fetch\'');
});

test('every page links the Instagram profile (a plain link, nothing from Meta loads)', async ({ page }) => {
  const meta = [];
  page.on('request', (r) => { if (/instagram|facebook|fbcdn|cdninstagram/.test(r.url())) meta.push(r.url()); });
  for (const p of ['feed/', 'colecao/', 'decks/', 'eventos/', 'privacidade/']) {
    await page.goto(ROOT + p);
    const a = page.locator('[data-testid="instagram"]');
    await expect(a).toHaveAttribute('href', 'https://www.instagram.com/inkwell.brasil/');
    await expect(a).toHaveAttribute('target', '_blank');
    await expect(a).toHaveAttribute('rel', /noopener/);
  }
  await page.goto(ROOT + 'feed/');
  await expect(page.locator('[data-testid="hero-instagram"]')).toContainText('Novidades e eventos no Instagram');
  await page.goto(ROOT + 'privacidade/');
  await expect(page.locator('main')).toContainText('nada da Meta é carregado');
  expect(meta).toEqual([]);
});

test('a new visitor: the main button tries a deck with no sign-up; profile second; community smaller', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('inkwell-lang', 'pt'));
  await page.goto(ROOT + 'feed/');
  const main = page.getByTestId('try-deck');
  await expect(main).toHaveText('Testar um deck sem cadastro');
  await expect(main).toHaveClass(/iw-button-primary/);
  await expect(page.getByTestId('start')).toHaveText('Criar meu perfil');
  await expect(page.getByTestId('try-deck-what')).toHaveText('Cole sua lista ou experimente um exemplo. Veja as cartas, a legalidade e a estimativa de custo.');
  await expect(page.getByTestId('hero-community')).toHaveAttribute('href', '../comunidades/');
  await main.click();
  await expect(page).toHaveURL(/\/decks\/$/);
  await expect(page.getByTestId('public-sample')).toBeVisible();
});

test('account menu (light theme): the picked language is readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ME = '11111111-1111-4111-8111-111111111111';
  await page.addInitScript((me) => { localStorage.setItem('inkwell-lang', 'pt'); localStorage.setItem('inkwell-theme', 'dia'); const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'a@b.c' } })); }, ME);
  await page.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(new URL('decks/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href);
  await page.locator('#iwAcct').click();
  const pt = page.locator('.menu [data-lang-pick="pt"]');
  await expect(pt).toBeVisible();
  const [fg, bg] = await pt.evaluate((b) => [getComputedStyle(b).color, getComputedStyle(b).backgroundColor]);
  const lum = (c) => { const [r, g, b2] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b2; };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  expect((a + 0.05) / (b + 0.05)).toBeGreaterThan(4.5);
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/menu-lang.png' });
});

test('language flag in the top bar: US flag switches to English, Brazilian flag back; fits a 360px phone signed in', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const ME = '11111111-1111-4111-8111-111111111111';
  await page.addInitScript((me) => { if (!localStorage.getItem('inkwell-lang')) localStorage.setItem('inkwell-lang', 'pt'); const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'a@b.c' } })); }, ME);
  await page.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(new URL('decks/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href);
  const flag = page.getByTestId('lang-flag');
  await expect(flag).toHaveAttribute('aria-label', 'Switch to English');
  const bar = await page.locator('.appbar-in').evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(bar[0]).toBeLessThanOrEqual(bar[1] + 1);                 // the top bar still fits
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/flag-pt.png', clip: { x: 0, y: 0, width: 360, height: 70 } });
  await flag.click();
  await expect(page.getByTestId('lang-flag')).toHaveAttribute('aria-label', 'Mudar para português');
  await expect(page.locator('html')).toHaveAttribute('lang', /en/);
  await page.getByTestId('lang-flag').click();
  await expect(page.getByTestId('lang-flag')).toHaveAttribute('aria-label', 'Switch to English');
});
