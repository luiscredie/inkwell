// Security tags on every page: the Content-Security-Policy lets the pages do everything they do (no violation),
// and a page framed by another site hides itself.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/security.spec.mjs
import { test, expect } from '@playwright/test';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';
const url = (p) => new URL(p, ROOT).href;
const ME = '11111111-1111-4111-8111-111111111111';
const PAGES = ['feed/', 'colecao/', 'decks/', 'comunidades/', 'coach/', 'eventos/', 'trades/', 'precos/', 'perfil/', 'comecar/', 'privacidade/', 'entrar/', 'counter/', 'admin/'];

async function setup(page, signedIn) {
  await page.addInitScript(([me, signed]) => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    localStorage.setItem('inkwell-lang', 'pt');
    if (!signed) return;
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, [ME, signedIn]);
  await page.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/functions/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"events":[]}' }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
}

for (const signedIn of [false, true]) {
  test(`every page: the security tags are there and nothing is blocked (${signedIn ? 'signed in' : 'visitor'})`, async ({ page }) => {
    test.setTimeout(120000);   // 14 pages, each until the network is quiet
    await setup(page, signedIn);
    for (const p of PAGES) {
      await page.goto(url(p));
      await page.waitForLoadState('networkidle').catch(() => {});
      expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').count(), p).toBe(1);
      expect(await page.evaluate(() => window.__csp), p).toEqual([]);
    }
  });
}

test('a policy violation would be caught (the check works)', async ({ page }) => {
  await setup(page, false);
  await page.goto(url('feed/'));
  await page.evaluate(() => { const s = document.createElement('script'); s.src = 'https://evil.example.com/x.js'; document.head.append(s); });
  await expect.poll(() => page.evaluate(() => window.__csp.length)).toBeGreaterThan(0);
});

test('framed by another site, the page hides itself', async ({ page }) => {
  await page.setContent(`<iframe id="f" src="${url('privacidade/')}" style="width:600px;height:400px"></iframe>`);
  const frame = page.frameLocator('#f');
  await expect.poll(async () => (await page.frames()).find((f) => f.url().includes('privacidade'))?.evaluate(() => getComputedStyle(document.documentElement).display).catch(() => 'gone')).toMatch(/none|gone/);
});
