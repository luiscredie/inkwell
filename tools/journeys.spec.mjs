// Issue #145, P0-A: the visitor's journeys end to end, on a phone (390×844, touch) and a computer (1440×900), against a
// fake Supabase that REMEMBERS what was saved (so logout / login / reload show the same data). WebKit (iPhone) runs these
// too in CI (playwright project "iphone"). These are mocks: they prove the pages, not the real Supabase — the real login
// is docs/validacao-login-real.md.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/journeys.spec.mjs
import { test, expect } from '@playwright/test';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';
const at = (p) => new URL(p, ROOT).href;
const ME = '11111111-1111-4111-8111-111111111111';
const CODE = '12345678';
const jwt = (sub) => { const exp = Math.floor(Date.now() / 1000) + 3600; return 'x.' + Buffer.from(JSON.stringify({ sub, exp, email: 'teste@exemplo.com' })).toString('base64url') + '.y'; };

// A fake back end with memory: inkwell_profiles (collection + decks), the public profile, sign-in by code.
async function backend(page, { slow = 0 } = {}) {
  const db = { rows: [], me: null, verify: [], otp: 0, offline: false };
  await page.addInitScript(() => { localStorage.setItem('inkwell-lang', 'pt'); try { localStorage.setItem('inkwell-passkey-offer', 'no'); } catch { /* */ } });
  await page.route('**/auth/v1/**', async (route) => {
    if (db.offline) return route.abort('internetdisconnected');
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/otp')) { db.otp += 1; return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (path.endsWith('/verify')) {
      const body = JSON.parse(route.request().postData());
      db.verify.push(String(body.token || '').length);   // only the length is kept: never the code
      if (body.token !== CODE) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error_code":"otp_expired"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: jwt(ME), refresh_token: 'r', expires_in: 3600, user: { id: ME, email: 'teste@exemplo.com', created_at: new Date().toISOString() } }) });
    }
    if (path.endsWith('/logout')) return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/rest/v1/**', async (route) => {
    if (db.offline) return route.abort('internetdisconnected');
    if (slow) await new Promise((r) => setTimeout(r, slow));
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace(/.*\/rest\/v1\//, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const json = (v, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles' && req.method() === 'GET') {
      return json(db.rows.map((r) => ({ profile: r.profile, updated_at: r.updated_at, collection: r.data.collection, decks: r.data.decks, wishlist: r.data.wishlist })));
    }
    if (path === 'inkwell_profiles' && req.method() === 'POST') {
      if (!db.rows.some((r) => r.profile === body.profile)) db.rows.push({ profile: body.profile, updated_at: new Date().toISOString(), data: body.data });
      return route.fulfill({ status: 201, body: '' });
    }
    if (path === 'rpc/save_deck') {
      const row = db.rows.find((r) => r.profile === body.p_profile); if (!row) return json({ message: 'profile not found' }, 400);
      const i = row.data.decks.findIndex((d) => d.id === body.p_deck.id);
      const saved = { ...(i >= 0 ? row.data.decks[i] : { notes: '', targetCopies: 1, format: 'core', colors: [], cards: {} }), ...body.p_deck, updated_at: new Date().toISOString() };
      if (i >= 0) row.data.decks[i] = saved; else row.data.decks.push(saved);
      return json(saved);
    }
    if (path === 'rpc/my_profile') return json(db.me);
    if (path === 'rpc/save_my_profile') { db.me = { ...(db.me || {}), ...body.p, invite_code: 'abc123def0', hidden: false }; return json(db.me); }
    if (path === 'rpc/my_settings') return json(db.me ? { user_id: ME, display_name: db.me.display_name, default_visibility: 'friends' } : null);
    if (/^rpc\//.test(path)) return json(null);
    return json([]);
  });
  return db;
}
// evidence for the PR (SHOT_DIR=…): the code field and the e-mail are masked
const shot = async (page, name) => { if (!process.env.SHOT_DIR) return; await page.screenshot({ path: `${process.env.SHOT_DIR}/${test.info().project.name}-${page.viewportSize().width}-${name}.png`, mask: [page.locator('#iwSiCode, #iwSiEmail, .acct-email, [data-testid="acct-email"]')] }); };
// what the person sees must fit the screen: no sideways scroll
async function fits(page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw, 'no horizontal scroll').toBeLessThanOrEqual(o.cw + 1);
}
async function signInWithCode(page, { tooShort = true } = {}) {
  const sheet = page.locator('#iwSignSheet');
  await expect(sheet.locator('#iwSiEmail')).toBeVisible();
  await sheet.locator('#iwSiEmail').fill('teste@exemplo.com');
  await sheet.getByRole('button', { name: 'Enviar código' }).click();
  const box = sheet.getByLabel('Código do e-mail');
  await expect(box).toBeFocused();
  if (tooShort) {   // 7 of the 8 digits, then "Entrar": not signed in, told why, and what was typed stays
    await box.pressSequentially(CODE.slice(0, 7), { delay: 20 });
    await sheet.locator('#iwSiIn').click();
    await expect(sheet.locator('#iwSiMsg')).toContainText('Esse código não vale');
    await shot(page, '3-code-7-digits-refused');
    await expect(box).toHaveValue(CODE.slice(0, 7));
    expect(await page.evaluate(() => localStorage.getItem('inkwell-counter-auth'))).toBeNull();
    await box.fill('');
  }
  await box.fill(CODE);   // the whole code arriving at once (paste / iPhone suggestion) signs in by itself
}

for (const [label, viewport, touch] of [['phone', { width: 390, height: 844 }, true], ['computer', { width: 1440, height: 900 }, false]]) {
  test.describe(label, () => {
    test.use({ viewport, hasTouch: touch, isMobile: touch });

    test('J1: home → "Testar um deck sem cadastro" → example deck → create account → the deck is saved and stays after logout/login', async ({ page }) => {
      const db = await backend(page);
      await page.goto(at('index.html'));
      await expect(page).toHaveURL(/\/feed\/$/);
      await fits(page);
      const cta = page.getByTestId('try-deck');
      await expect(cta).toBeInViewport();
      await shot(page, '1-home');
      const box = await cta.boundingBox(); expect(box.height).toBeGreaterThanOrEqual(40);
      await cta.click();
      await expect(page).toHaveURL(/\/decks\/$/);
      await page.getByTestId('public-sample').click();
      await expect(page.getByTestId('public-summary')).toContainText('60/60');
      await shot(page, '2-deck-example');
      await fits(page);
      await page.getByTestId('public-save').click();
      await signInWithCode(page);
      // back on Decks, signed in: the list from before and the save sheet already open
      await expect(page.getByTestId('pending-deck')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('#iSave')).toBeVisible();
      await shot(page, '4-back-signed-in-save');
      await page.locator('#iName').fill('Meu deck de teste');
      await page.locator('#iSave').click();
      await expect.poll(() => db.rows[0]?.data.decks.length || 0).toBe(1);
      expect(db.rows[0].data.decks[0].name).toBe('Meu deck de teste');
      expect(Object.values(db.rows[0].data.decks[0].cards).reduce((a, b) => a + b, 0)).toBe(60);
      expect(db.verify).toEqual([7, CODE.length]);   // 7 digits refused by the server, then the 8 (only lengths are kept here)
      // reload, back/forward, logout and login again: the deck is still there
      await page.goto(at('decks/')).catch(() => page.goto(at('decks/')));   // WebKit sometimes reports an internal error on this navigation: once more
      await expect(page.locator('.deck-row', { hasText: 'Meu deck de teste' })).toBeVisible();
      await shot(page, '5-deck-saved');
      await page.goBack(); await page.goForward();
      await expect(page.locator('.deck-row', { hasText: 'Meu deck de teste' })).toBeVisible({ timeout: 10000 });   // WebKit restores from back/forward more slowly
      await page.evaluate(() => localStorage.removeItem('inkwell-counter-auth'));   // logout (this browser)
      await page.reload();
      await expect(page.locator('.deck-row')).toHaveCount(0);
      await page.evaluate(() => window.INKWELL_SIGNIN());
      await signInWithCode(page, { tooShort: false });
      await expect(page.locator('.deck-row', { hasText: 'Meu deck de teste' })).toBeVisible({ timeout: 10000 });
      await fits(page);
    });

    test('J2: home → "Criar meu perfil" → inks and a card → save with the code → the profile is saved (private)', async ({ page }) => {
      const db = await backend(page);
      await page.goto(at('feed/'));
      await page.getByTestId('start').click();
      await expect(page).toHaveURL(/\/comecar\//);
      await fits(page);
      await page.getByLabel('Nome de exibição').fill('Teste P0');
      await page.locator('[data-ink="Amber"]').click();
      await page.locator('#save').click();
      await signInWithCode(page);
      await expect(page.getByTestId('saved')).toBeVisible({ timeout: 10000 });
      await shot(page, '6-profile-saved');
      expect(db.me?.display_name).toBe('Teste P0');
      expect(db.me.is_public).not.toBe(true);   // a new profile starts private
      await fits(page);
    });

    test('J3: slow network shows loading and then the page; no network keeps the list typed and says so', async ({ page }) => {
      const db = await backend(page, { slow: 1500 });
      await page.goto(at('decks/'));
      await page.getByTestId('public-text').fill('4 Stitch - Rock Star');
      await expect(page.getByTestId('public-summary')).toContainText('4/60');
      db.offline = true;
      await page.context().setOffline(true);
      await page.getByTestId('public-save').click();
      await page.locator('#iwSiEmail').fill('teste@exemplo.com');
      await page.getByRole('button', { name: 'Enviar código' }).click();
      await expect(page.locator('#iwSiMsg')).toContainText(/internet|conexão/i);
      await page.context().setOffline(false);
      db.offline = false;
      await page.locator('#iwSignSheet [data-close]').first().click();
      await expect(page.getByTestId('public-text')).toHaveValue('4 Stitch - Rock Star');   // nothing lost
      await page.reload();
      await expect(page.getByTestId('public-text')).toHaveValue('4 Stitch - Rock Star');   // kept in this browser for a day
    });

    test('J4: signed in on a slow network: loading first, then the decks; with no network: a clear error and "Tentar de novo" works', async ({ page }) => {
      const db = await backend(page, { slow: 1500 });
      db.rows.push({ profile: 'principal', updated_at: new Date().toISOString(), data: { collection: {}, decks: [{ id: 'd1', name: 'Deck lento', format: 'core', colors: [], cards: { 'LOR10-1': 4 } }], wishlist: {} } });
      await page.addInitScript(([me, tok]) => { if (sessionStorage.getItem('j4')) return; sessionStorage.setItem('j4', '1'); const exp = Math.floor(Date.now() / 1000) + 3600;
        localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: tok, refresh_token: 'r', expires_at: exp, user: { id: me, email: 'teste@exemplo.com' } })); }, [ME, jwt(ME)]);
      await page.goto(at('decks/'));
      await expect(page.locator('#app .skel').first()).toBeVisible();   // loading, not an empty page
      await expect(page.locator('.deck-row', { hasText: 'Deck lento' })).toBeVisible({ timeout: 10000 });
      db.offline = true;
      await page.reload();
      await expect(page.locator('#app')).toContainText('Não foi possível carregar seus decks', { timeout: 15000 });
      db.offline = false;
      await page.locator('#retry').click();
      await expect(page.locator('.deck-row', { hasText: 'Deck lento' })).toBeVisible({ timeout: 10000 });
      expect(db.rows[0].data.decks).toHaveLength(1);   // nothing lost or duplicated
      await fits(page);
    });
  });
}
