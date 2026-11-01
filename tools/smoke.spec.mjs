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
