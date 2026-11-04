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

// Pacote 1, item 3. Chrome's preload scanner read `<img src="${...}">` inside the big inline scripts as tags and asked
// for /perfil/${imgUrl(c)} and the like (404 on about half the loads); the build now writes `<img` in scripts.
for (const p of ['feed', 'decks', 'perfil', 'comunidades', 'precos', 'comecar']) {
  test(`${p}: no 404 while the page opens (3 loads, signed in and out)`, async ({ browser }) => {
    const ME = '11111111-1111-4111-8111-111111111111', missing = [];
    for (const signed of [false, true, false]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      if (signed) await page.addInitScript((me) => { const exp = Math.floor(Date.now() / 1000) + 3600;
        localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'a@b.c' } })); }, ME);
      await page.route(/\/rest\/v1\/|\/auth\/v1\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
      page.on('response', (r) => { if (r.status() === 404) missing.push(decodeURIComponent(new URL(r.url()).pathname)); });
      await page.goto(new URL(p + '/', ROOT).href, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      await ctx.close();
    }
    expect(missing).toEqual([]);
  });
}

// Pacote 1, item 3. Opening Início signed in: my collection and decks, my_profile and my_home are each asked once
// (they were asked twice: the card on the left and the post composer; the top bar and the page).
test('feed signed in: decks, my_profile and my_home are each requested once, and both places still get them', async ({ page }) => {
  const ME = '11111111-1111-4111-8111-111111111111', calls = [];
  await page.addInitScript((me) => { const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'a@b.c' } })); }, ME);
  await page.route(/\/rest\/v1\/|\/auth\/v1\//, (r) => {
    const u = new URL(r.request().url()), path = u.pathname.replace(/.*\/(rest|auth)\/v1\//, '');
    calls.push(path + decodeURIComponent(u.search));
    const json = (v) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles' && u.search.includes('decks')) return json([{ profile: 'principal', collection: { 'LOR1-1': { n: 2, f: 1 } }, decks: [{ id: 'd1', name: 'Âmbar Aço', cards: { 'LOR1-1': 4 } }, { id: 'd2', name: 'Rubi Safira', cards: { 'LOR1-2': 4 } }] }]);
    if (path === 'rpc/my_profile') return json({ user_id: ME, display_name: 'Teste', handle: 'teste' });
    if (path === 'rpc/my_home') return json({});
    if (path === 'profiles') return json([{ user_id: ME, display_name: 'Teste' }]);   // the composer needs my profile
    if (path === 'user') return json({ id: ME, email: 'a@b.c' });
    return json([]);
  });
  await page.goto(new URL('feed/', ROOT).href);
  await expect(page.getByTestId('me-decks')).toHaveText('2');                 // the card on the left
  await expect(page.getByTestId('me-cards')).toHaveText('3');
  await expect(page.locator('#cmpDeck option')).toHaveCount(3);               // the composer: "Deck…" + the 2 decks
  await page.waitForTimeout(1000);                                            // nothing else arrives late
  const n = (re) => calls.filter((c) => re.test(c)).length;
  expect(n(/^inkwell_profiles\?select=.*decks/), calls.join('\n')).toBe(1);
  expect(n(/^rpc\/my_profile/), calls.join('\n')).toBe(1);
  expect(n(/^rpc\/my_home/), calls.join('\n')).toBe(1);
});
