// Sign-in sheet (shell.js) against a fake Supabase Auth: the code from the e-mail is taken whole, whatever its length
// (Supabase sends 6 to 10 digits), never cut, and only sent when the person presses "Entrar".
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/login.spec.mjs
import { test, expect } from '@playwright/test';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';
const FEED = new URL('feed/', ROOT).href;
const ME = '11111111-1111-4111-8111-111111111111';
const jwt = (sub) => { const exp = Math.floor(Date.now() / 1000) + 3600; return 'x.' + Buffer.from(JSON.stringify({ sub, exp, email: 'a@b.c' })).toString('base64url') + '.y'; };

async function setup(page, { code = '12345678', otpStatus = () => 200, passkeyAsked = true } = {}) {
  const calls = { otp: 0, verify: [] };
  await page.addInitScript((asked) => { localStorage.setItem('inkwell-lang', 'pt'); if (asked) localStorage.setItem('inkwell-passkey-offer', 'no'); }, passkeyAsked);
  await page.route('**/auth/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/otp')) { calls.otp += 1; return route.fulfill({ status: otpStatus(calls.otp), contentType: 'application/json', body: '{}' }); }
    if (path.endsWith('/verify')) {
      const body = JSON.parse(route.request().postData());
      calls.verify.push(body.token);
      if (body.token !== code) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error_code":"otp_expired"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: jwt(ME), refresh_token: 'r', expires_in: 3600, user: { id: ME, email: 'a@b.c' } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  return calls;
}
async function toCode(page) {
  await page.goto(FEED);
  await page.evaluate(() => window.INKWELL_SIGNIN());
  const sheet = page.locator('#iwSignSheet');
  await sheet.locator('#iwSiEmail').fill('ana@example.com');
  await sheet.getByRole('button', { name: 'Enviar código' }).click();
  await expect(sheet.getByLabel('Código do e-mail')).toBeFocused();
  return sheet;
}

test('an 8-digit code arriving whole (iPhone suggestion or paste) is kept whole and signs in by itself', async ({ page }) => {
  const calls = await setup(page);
  const sheet = await toCode(page);
  const box = sheet.getByLabel('Código do e-mail');
  await expect(box).toHaveAttribute('autocomplete', 'one-time-code');
  await box.fill('1234 5678');            // e-mails sometimes space the digits
  await expect.poll(() => calls.verify).toEqual(['12345678']);
  await expect(page.locator('#iwSignSheet')).toBeHidden();   // reloaded, signed in
});

test('a 6-digit code works too', async ({ page }) => {
  const calls = await setup(page, { code: '654321' });
  const sheet = await toCode(page);
  await sheet.getByLabel('Código do e-mail').pressSequentially('654321');
  await expect(sheet.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  expect(calls.verify).toHaveLength(0);
  await sheet.getByRole('button', { name: 'Entrar' }).click();
  await expect.poll(() => calls.verify).toEqual(['654321']);
});

test('more than 10 digits: nothing is cut or sent, the person is told to check', async ({ page }) => {
  const calls = await setup(page);
  const sheet = await toCode(page);
  await sheet.getByLabel('Código do e-mail').fill('123456789012');
  await expect(sheet.getByRole('button', { name: 'Entrar' })).toBeDisabled();
  await expect(sheet.locator('#iwSiMsg')).toContainText('no máximo 10 dígitos');
  await expect(sheet.getByLabel('Código do e-mail')).toHaveValue('123456789012');
  expect(calls.verify).toHaveLength(0);
});

test('a refused code: clear message, the code stays to be checked, ask for another after the wait', async ({ page }) => {
  await page.clock.install();
  const calls = await setup(page);
  const sheet = await toCode(page);
  await sheet.getByLabel('Código do e-mail').fill('11111111');   // whole at once: tried by itself
  await expect(sheet.locator('#iwSiMsg')).toContainText('Esse código não vale');
  expect(calls.verify).toHaveLength(1);
  await expect(sheet.getByLabel('Código do e-mail')).toHaveValue('11111111');
  const again = sheet.locator('#iwSiAgain');
  await expect(again).toBeDisabled();
  await expect(again).toContainText('Mandar outro código em');
  await page.clock.fastForward(61000);
  await expect(again).toBeEnabled();
  await again.click();
  await expect.poll(() => calls.otp).toBe(2);
  await expect(sheet.locator('#iwSiMsg')).toContainText('Mandamos um código novo');
  await expect(sheet.getByLabel('Código do e-mail')).toHaveValue('');
});

test('resend refused by the rate limit says to wait', async ({ page }) => {
  await page.clock.install();
  await setup(page, { otpStatus: (n) => (n > 1 ? 429 : 200) });
  const sheet = await toCode(page);
  await page.clock.fastForward(61000);
  await sheet.locator('#iwSiAgain').click();
  await expect(sheet.locator('#iwSiMsg')).toContainText('Espere um pouco');
});

test('an e-mail link that was already used: the sign-in sheet explains and asks for a new code', async ({ page }) => {
  await setup(page);
  await page.goto(`${FEED}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid`);
  const sheet = page.locator('#iwSignSheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('#iwSiMsg')).toContainText('O link do e-mail não vale mais');
  expect(page.url()).not.toContain('error');
});

test('/entrar/: nothing is used until the button; then signs in and goes back where the code was asked', async ({ page }) => {
  const used = [];
  await page.addInitScript(() => {
    localStorage.setItem('inkwell-lang', 'pt');
    if (!sessionStorage.getItem('t')) { sessionStorage.setItem('t', '1'); localStorage.setItem('inkwell-return', JSON.stringify({ path: '/colecao/', at: Date.now() })); }
  });
  await page.route('**/auth/v1/verify', async (route) => {
    used.push(JSON.parse(route.request().postData()));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: jwt(ME), refresh_token: 'r', expires_in: 3600, user: { id: ME } }) });
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(new URL('entrar/?h=abc123', ROOT).href);
  await expect(page.getByRole('button', { name: 'Entrar no Inkwell' })).toBeVisible();
  expect(page.url()).not.toContain('abc123');   // the hash leaves the address bar
  await page.waitForTimeout(500);
  expect(used).toHaveLength(0);                 // a scanner that only opens the page uses nothing
  await page.getByRole('button', { name: 'Entrar no Inkwell' }).click();
  await expect(page).toHaveURL(/\/colecao\//);
  expect(used).toEqual([{ type: 'email', token_hash: 'abc123' }]);
});

test('/entrar/ with a used link: says so and offers a new code', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('inkwell-lang', 'pt'));
  await page.route('**/auth/v1/verify', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: '{}' }));
  await page.goto(new URL('entrar/?h=abc123', ROOT).href);
  await page.getByRole('button', { name: 'Entrar no Inkwell' }).click();
  await expect(page.getByRole('heading', { name: 'Este link não vale mais' })).toBeVisible();
  await page.getByRole('button', { name: 'Pedir código novo' }).click();
  await expect(page.locator('#iwSignSheet')).toBeVisible();
});

// Passkeys (Supabase Auth, experimental): a virtual authenticator stands in for Face ID / fingerprint.
async function virtualAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
}
const b64 = (s) => Buffer.from(s).toString('base64url');
async function passkeyServer(page) {
  const got = [];
  await page.route('**/auth/v1/passkeys/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/.*\/auth\/v1\//, ''), body = route.request().postData() ? JSON.parse(route.request().postData()) : null;
    got.push({ path, body, auth: route.request().headers().authorization || '' });
    const j = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'passkeys/registration/options') return j({ challenge_id: 'reg1', options: { challenge: b64('challenge-registration-0001'), rp: { id: 'localhost', name: 'Inkwell' }, user: { id: b64(ME), name: 'a@b.c', displayName: 'a@b.c' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }, timeout: 60000 } });
    if (path === 'passkeys/registration/verify') return j({ id: 'pk1', friendly_name: 'iPhone' });
    if (path === 'passkeys/authentication/options') return j({ challenge_id: 'auth1', options: { challenge: b64('challenge-authentication-01'), rpId: 'localhost', userVerification: 'preferred', timeout: 60000 } });
    if (path === 'passkeys/authentication/verify') return j({ access_token: jwt(ME), refresh_token: 'r2', expires_in: 3600, user: { id: ME, email: 'a@b.c' } });
    return j([]);
  });
  return got;
}

test('after the code, a passkey can be created; next time "Entrar com passkey" signs in without the e-mail', async ({ page }) => {
  await virtualAuthenticator(page);
  const calls = await setup(page, { passkeyAsked: false });
  const got = await passkeyServer(page);
  const sheet = await toCode(page);
  await sheet.getByLabel('Código do e-mail').fill('12345678');
  await expect(sheet.locator('#iwSiT')).toHaveText('Entrar mais rápido da próxima vez?');
  await sheet.getByTestId('passkey-create').click();
  await expect.poll(() => got.map((g) => g.path)).toEqual(['passkeys/registration/options', 'passkeys/registration/verify']);
  expect(got[0].auth).toMatch(/^Bearer /);                                     // only signed in
  expect(got[1].body.challenge_id).toBe('reg1');
  expect(got[1].body.credential.response.attestationObject).toBeTruthy();
  await expect(page.locator('#iwSignSheet')).toBeHidden();                       // reloaded, signed in
  // sign out, then back in with the passkey
  await page.waitForLoadState('load');
  await page.evaluate(() => localStorage.removeItem('inkwell-counter-auth'));   // signed out
  await page.reload();
  await page.evaluate(() => window.INKWELL_SIGNIN());
  await page.getByTestId('signin-passkey').click();
  await expect.poll(() => got.map((g) => g.path).slice(2)).toEqual(['passkeys/authentication/options', 'passkeys/authentication/verify']);
  expect(got[3].body.challenge_id).toBe('auth1');
  expect(got[3].body.credential.response.signature).toBeTruthy();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('inkwell-counter-auth') || 'null')?.refresh_token)).toBe('r2');
  expect(calls.otp).toBe(1);                                                    // no second e-mail
});

test('"Agora não" after the code: signed in, and the offer does not come back on this device', async ({ page }) => {
  await setup(page, { passkeyAsked: false });
  const sheet = await toCode(page);
  await sheet.getByLabel('Código do e-mail').fill('12345678');
  await sheet.getByRole('button', { name: 'Agora não' }).click();
  await expect(page.locator('#iwSignSheet')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('inkwell-passkey-offer'))).toBe('no');
});
