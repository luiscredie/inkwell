// Every page, signed out and signed in, on a narrow phone: no script error and nothing wider than the screen.
// The Supabase answers are empty (a new account): the pages must still draw.
//   (cd site && python3 -m http.server 8080) &   npx playwright test tools/sweep.spec.mjs
import { test, expect } from '@playwright/test';
import { originOf, record, describe } from './http-origin.mjs';

const ROOT = new URL('./', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const PAGES = ['', 'colecao/', 'decks/', 'trades/', 'amigos/', 'feed/', 'perfil/', 'precos/', 'comunidades/', 'eventos/', 'coach/', 'counter/', 'comecar/', 'entrar/', 'privacidade/', 'dlc-londres/'];
// push/ is not a page: it is the scope of the push service worker (push/sw.js, registered by shell.js), with no
// index.html by design. Locally the test server lists the folder; on the site GitHub answers with its own 404 page.
// It is checked apart below (the worker is served), not swept as a product page.
const ME = '11111111-1111-4111-8111-111111111111';

async function prepare(page, signedIn) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|favicon|ERR_NAME_NOT_RESOLVED|Content Security Policy/i.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.addInitScript(([me, on]) => {
    localStorage.setItem('inkwell-lang', 'pt');
    if (!on) return;
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, [ME, signedIn]);
  await page.route('**/rest/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles') return json([{ profile: 'luiscredie', updated_at: '2026-11-15T10:00:00Z', collection: { 'LOR7-137': { n: 2, f: 1, l: { it: { n: 1 } } } }, decks: [], wishlist: {} }]);
    if (path.startsWith('rpc/')) return json(null);
    return json([]);
  });
  await page.route('**/functions/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  return errors;
}

for (const signedIn of [false, true]) for (const w of [320, 390]) for (const p of PAGES) {
  test(`${signedIn ? 'signed in' : 'signed out'} ${w}px /${p}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 760 });
    const errors = await prepare(page, signedIn);
    const res = await page.goto(ROOT + p);
    const o = originOf(res); record(ROOT + p, o);
    expect(o.status, `/${p} is a page of the site: ${describe(o)}`).toBe(200);   // a 404/503 page is not swept as a product page
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => {
      const W = document.documentElement.clientWidth, out = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (!r.width || cs.visibility === 'hidden' || el.closest('dialog:not([open]), [hidden], .sr-only, [aria-hidden="true"]')) continue;
        if (r.right > W + 1 && !el.closest('[style*="overflow"], .scroll-x, .hscroll, .chips, .seg, .tabs, .rail, .carousel')) {
          out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} → ${Math.round(r.right)}px`);
        }
      }
      return { scroll: document.documentElement.scrollWidth - W, out: [...new Set(out)].slice(0, 6) };
    });
    expect(errors, 'script errors').toEqual([]);
    expect(over.scroll, `page scrolls sideways: ${over.out.join(' | ')}`).toBeLessThanOrEqual(1);
  });
}

test('push/: the push service worker is served (the folder is its scope, not a page)', async ({ request }) => {
  const r = await request.get(ROOT + 'push/sw.js');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type'] || '').toMatch(/javascript/);
  expect(await r.text()).toMatch(/addEventListener\(\s*["']push["']/);
});
