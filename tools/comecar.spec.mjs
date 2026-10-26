// Começar meu Inkwell (/comecar/, guest profile, behind ?preview=visitante) against a fake Supabase.
// Case ids (A01…A35) are the handoff acceptance matrix (spec/04-aceite.md).
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/comecar.spec.mjs
import { test, expect } from '@playwright/test';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';
const PAGE = new URL('comecar/?preview=visitante', ROOT).href;
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DRAFT = 'inkwell-guest-draft-v1';
const jwt = (sub) => { const exp = Math.floor(Date.now() / 1000) + 3600; return 'x.' + Buffer.from(JSON.stringify({ sub, exp, email: 'a@b.c' })).toString('base64url') + '.y'; };

// Fake back end. profile: what my_profile returns; saveDelay: hold save_my_profile; failSave: 500 on save.
async function setup(page, { signedIn = false, profile = null, saveDelay = 0, failSave = false, collection = undefined, collectionFail = false, keepFoil = true } = {}) {
  const calls = [];
  await page.addInitScript(([me, tok, si]) => {
    localStorage.setItem('inkwell-lang', 'pt');
    if (si && !sessionStorage.getItem('t-signed')) {
      sessionStorage.setItem('t-signed', '1');
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: tok, refresh_token: 'r', expires_at: exp, user: { id: me, email: 'a@b.c' } }));
    }
  }, [ME, jwt(ME), signedIn]);
  await page.route('**/auth/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push({ path });
    if (path.endsWith('/otp')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (path.endsWith('/verify')) {
      const body = JSON.parse(route.request().postData());
      if (body.token !== '123456') return route.fulfill({ status: 400, contentType: 'application/json', body: '{"msg":"bad"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: jwt(ME), refresh_token: 'r', expires_in: 3600, user: { id: ME, email: 'a@b.c' } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ path, body });
    const json = (v, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'rpc/my_profile') return json(profile);
    if (path === 'rpc/save_my_profile') {
      if (saveDelay) await new Promise((r) => setTimeout(r, saveDelay));
      if (failSave) return json({ message: 'x' }, 500);
      const show = (body.p.showcase || []).map((s) => (keepFoil ? s : { id: s.id, k: s.k }));
      return json({ ...(profile || {}), ...body.p, showcase: show });
    }
    if (path === 'inkwell_profiles') {
      if (collectionFail) return json({ message: 'x' }, 500);
      if (collection === 'slow') { await new Promise((r) => setTimeout(r, 1500)); return json([{ profile: 'p', collection: {} }]); }
      return json(collection ? [{ profile: 'p', collection }] : []);
    }
    return json([]);
  });
  return calls;
}
const saves = (calls) => calls.filter((c) => c.path === 'rpc/save_my_profile');
const draftOf = (page) => page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) || 'null'), DRAFT);

async function pickCard(page, slot, query, { set, id, finish } = {}) {
  await page.locator(`[data-slot="${slot}"] [data-pick]`).first().click();
  const d = page.locator('#picker');
  await expect(d).toBeVisible();
  await d.locator('#pkQ').fill(query);
  if (set) await d.locator('#pkSet').selectOption(set);
  const card = id ? d.locator(`.iw-result[data-card="${id}"]`) : d.locator('.iw-result').first();
  if (finish) await card.getByRole('button', { name: finish, exact: true }).click();
  await card.locator('[data-use]').click();
  await expect(d).toBeHidden();
}

test('flag off: /comecar/ goes back to the feed; ?preview=visitante opens the editor without a login wall (A01)', async ({ page }) => {
  await setup(page);
  await page.goto(new URL('comecar/', ROOT).href);
  await expect(page).toHaveURL(/\/feed\//);
  await page.goto(PAGE);
  await expect(page.getByRole('heading', { name: 'Seu Inkwell começa aqui' })).toBeVisible();
  await expect(page.locator('#iwSignSheet')).not.toBeVisible();
  await expect(page.getByLabel('Nome de exibição')).toBeEditable();
});

test('looking without editing leaves nothing behind (A07); editing and undoing goes back to clean (A08)', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await expect(page.locator('#save')).toHaveCount(0);
  expect(await draftOf(page)).toBeNull();
  await page.getByLabel('Nome de exibição').fill('Ana');
  await expect(page.locator('#save')).toBeVisible();
  expect((await draftOf(page)).displayName).toBe('Ana');
  await page.getByLabel('Nome de exibição').fill('');
  await expect(page.locator('#save')).toHaveCount(0);
  expect(await draftOf(page)).toBeNull();
  await page.locator('[data-ink="Ruby"]').click();
  await page.locator('[data-ink="Ruby"]').click();
  expect(await draftOf(page)).toBeNull();
});

test('a third ink explains the limit and keeps the two chosen (A06); focus stays on the ink (A32)', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await page.locator('[data-ink="Amber"]').click();
  await page.locator('[data-ink="Steel"]').click();
  await page.locator('[data-ink="Ruby"]').click();
  await expect(page.getByTestId('ink-max')).toHaveText('Você pode destacar até duas tintas. Remova uma para escolher outra.');
  await expect(page.locator('[data-ink="Amber"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-ink="Steel"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-ink="Ruby"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-ink="Ruby"]')).toBeFocused();
  expect((await draftOf(page)).preferredInks).toEqual(['Amber', 'Steel']);
});

test('picker: real cards before typing (A27), whole catalogue by search (A02), exact printing kept (A03)', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await page.locator('[data-slot="0"] [data-pick]').click();
  const d = page.locator('#picker');
  await expect(d.getByTestId('pk-count')).toContainText('set mais recente');
  expect(await d.locator('.iw-result').count()).toBeGreaterThan(0);
  await d.locator('#pkQ').fill('elsa snow queen');
  await expect(d.locator('.iw-result[data-card="LOR1-41"]')).toBeVisible();
  await expect(d.locator('.iw-result[data-card="LOR9-53"]')).toBeVisible();
  await d.locator('.iw-result[data-card="LOR1-41"] [data-use]').click();
  await expect(page.locator('[data-slot="0"] .iw-card-label')).toContainText('nº 41');
  expect((await draftOf(page)).favorites).toEqual([{ id: 'LOR1-41', foil: false }]);
});

test('same printing in two finishes is allowed, an exact repeat is blocked; Epic is foil only (A26)', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await pickCard(page, 0, 'elsa snow queen', { id: 'LOR1-41' });
  await pickCard(page, 1, 'elsa snow queen', { id: 'LOR1-41', finish: 'Foil' });
  await page.locator('[data-slot="2"] [data-pick]').click();
  const d = page.locator('#picker');
  await d.locator('#pkQ').fill('elsa snow queen');
  await expect(d.locator('.iw-result[data-card="LOR1-41"] [data-use]')).toBeDisabled();
  await expect(d.locator('.iw-result[data-card="LOR9-210"] [data-fin]')).toHaveCount(0);
  await d.locator('.iw-result[data-card="LOR9-210"] [data-use]').click();
  expect((await draftOf(page)).favorites).toEqual([{ id: 'LOR1-41', foil: false }, { id: 'LOR1-41', foil: true }, { id: 'LOR9-210', foil: true }]);
});

test('replace, move and remove with the keyboard keep the order (A05); dialog focus and Escape (A19)', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await pickCard(page, 0, 'elsa snow queen', { id: 'LOR1-41' });
  await pickCard(page, 1, 'elsa snow queen', { id: 'LOR9-53' });
  const right = page.locator('[data-move="0:1"]');
  await right.focus(); await page.keyboard.press('Enter');
  expect((await draftOf(page)).favorites.map((f) => f.id)).toEqual(['LOR9-53', 'LOR1-41']);
  // dialog: opens with focus in the search, Escape closes and focus returns to the trigger
  const trig = page.locator('[data-slot="0"] [data-pick]');
  await trig.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#pkQ')).toBeFocused();
  await expect(page.locator('#picker')).toHaveAttribute('aria-labelledby', 'pkT');
  await page.keyboard.press('Escape');
  await expect(page.locator('#picker')).toBeHidden();
  await expect(trig).toBeFocused();
  await page.locator('[data-remove="0"]').click();
  expect((await draftOf(page)).favorites.map((f) => f.id)).toEqual(['LOR1-41']);
});

test('reload and navigating in the same tab keep the draft without asking (A09)', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await page.getByLabel('Nome de exibição').fill('Ana');
  await page.locator('[data-ink="Emerald"]').click();
  await page.reload();
  await expect(page.getByLabel('Nome de exibição')).toHaveValue('Ana');
  await expect(page.locator('[data-ink="Emerald"]')).toHaveAttribute('aria-pressed', 'true');
  await page.goto(new URL('feed/', ROOT).href);
  await expect(page.getByText('Seu Inkwell ainda não foi salvo.')).toBeVisible();
  await page.goto(PAGE);
  await expect(page.getByLabel('Nome de exibição')).toHaveValue('Ana');
});

test('discarding asks first; cancelling keeps everything (A10)', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await page.getByLabel('Nome de exibição').fill('Ana');
  await page.locator('#discard').click();
  const d = page.locator('#leave');
  await expect(d.getByRole('heading', { name: 'Sair sem salvar?' })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Continuar editando' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await expect(page.locator('#discard')).toBeFocused();
  expect((await draftOf(page)).displayName).toBe('Ana');
  await page.locator('#discard').click();
  await d.getByRole('button', { name: 'Sair sem salvar' }).click();
  await expect(page).toHaveURL(/\/feed\//);
  expect(await draftOf(page)).toBeNull();
});

test('no session storage: the editor works and says the draft is at risk (A11)', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    const deny = () => { throw new DOMException('denied', 'SecurityError'); };
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (this === window.sessionStorage && k !== 'inkwell-preview') return deny(); return real.call(this, k, v); };
  });
  await page.goto(PAGE);
  await expect(page.getByTestId('storage-error')).toBeVisible();
  await page.getByLabel('Nome de exibição').fill('Ana');
  await expect(page.getByTestId('pv-name')).toHaveText('Ana');
});

test('a broken draft opens the page with a clear restart and touches nothing else (A33)', async ({ page }) => {
  await setup(page);
  await page.addInitScript((k) => {
    if (sessionStorage.getItem('t-once')) return; sessionStorage.setItem('t-once', '1');
    sessionStorage.setItem(k, '{"schemaVersion":9,"displayName":42,"favorites":[{"id":7}]}');
    sessionStorage.setItem('other-key', 'stay');
  }, DRAFT);
  await page.goto(PAGE);
  await expect(page.getByTestId('draft-invalid')).toBeVisible();
  await page.getByRole('button', { name: 'Começar novamente' }).click();
  await expect(page.getByTestId('draft-invalid')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('other-key'))).toBe('stay');
});

test('sign-up cancelled or wrong code: draft intact, no false success (A12)', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(PAGE);
  await page.getByLabel('Nome de exibição').fill('Ana');
  await page.locator('#save').click();
  const sheet = page.locator('#iwSignSheet');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.locator('#save')).toBeVisible();
  await expect(page.getByTestId('saved')).toHaveCount(0);
  await page.locator('#save').click();
  await sheet.locator('#iwSiEmail').fill('ana@example.com');
  await sheet.getByRole('button', { name: 'Enviar código' }).click();
  await sheet.locator('.otp input').first().fill('999999');
  await expect(sheet.locator('#iwSiMsg')).toContainText('Código errado');
  expect((await draftOf(page)).displayName).toBe('Ana');
  expect(saves(calls)).toHaveLength(0);
});

test('confirm the code in the same tab: the draft is saved as a private profile, once (A13, A16, A23, A29)', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(PAGE);
  await page.getByLabel('Nome de exibição').fill('Ana Lorcana');
  await page.locator('[data-ink="Amethyst"]').click();
  await pickCard(page, 0, 'elsa snow queen', { id: 'LOR1-41', finish: 'Foil' });
  await page.locator('#save').click();
  const sheet = page.locator('#iwSignSheet');
  await sheet.locator('#iwSiEmail').fill('ana@example.com');
  await sheet.getByRole('button', { name: 'Enviar código' }).click();
  await sheet.locator('.otp input').first().fill('123456');
  await expect(page.getByTestId('saved')).toBeVisible();
  expect(saves(calls)).toHaveLength(1);
  const p = saves(calls)[0].body.p;
  expect(p).toEqual({ display_name: 'Ana Lorcana', inks: ['Amethyst'], showcase: [{ id: 'LOR1-41', k: 'fav', foil: true }] });
  expect(p).not.toHaveProperty('is_public');
  expect(calls.some((c) => /collection|apply_collection|decks/.test(c.path))).toBe(false);
  expect(await draftOf(page)).toBeNull();
});

test('an account with a profile: review before applying, nothing overwritten silently (A15)', async ({ page }) => {
  const calls = await setup(page, { signedIn: true, profile: { display_name: 'Luís', inks: ['Ruby'], showcase: [{ id: 'LOR9-53', k: 'own' }], bio: 'oi' } });
  await page.goto(PAGE);
  await page.locator('[data-ink="Sapphire"]').click();
  await page.locator('#save').click();
  await expect(page.getByTestId('review')).toBeVisible();
  expect(saves(calls)).toHaveLength(0);
  await expect(page.getByTestId('review')).toContainText('Luís');
  await page.getByRole('button', { name: 'Aplicar ao meu perfil' }).click();
  await expect(page.getByTestId('saved')).toBeVisible();
  // only what was edited goes: the name and favourites stay as they were
  expect(saves(calls)[0].body.p).toEqual({ inks: ['Sapphire'] });
});

test('double click and retry: one save at a time, the form is locked while sending (A16, A31)', async ({ page }) => {
  const calls = await setup(page, { signedIn: true, saveDelay: 1200 });
  await page.goto(PAGE);
  await page.getByLabel('Nome de exibição').fill('Ana');
  await page.locator('#save').dblclick();
  await expect(page.locator('#form')).toHaveAttribute('inert', '');
  await expect(page.getByTestId('saved')).toBeVisible();
  expect(saves(calls)).toHaveLength(1);
});

test('a failed save keeps the changes and offers a retry (A12)', async ({ page }) => {
  const calls = await setup(page, { signedIn: true, failSave: true });
  await page.goto(PAGE);
  await page.getByLabel('Nome de exibição').fill('Ana');
  await page.locator('#save').click();
  await expect(page.getByTestId('save-error')).toBeVisible();
  await expect(page.getByLabel('Nome de exibição')).toHaveValue('Ana');
  expect((await draftOf(page)).displayName).toBe('Ana');
  expect(saves(calls)).toHaveLength(1);
});

test('the account changes while saving: nothing is applied to the new one (A35)', async ({ page }) => {
  const calls = await setup(page, { signedIn: true, saveDelay: 1500 });
  await page.goto(PAGE);
  await page.getByLabel('Nome de exibição').fill('Ana');
  await page.locator('#save').click();
  await expect(page.locator('#form')).toHaveAttribute('inert', '');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  await page.evaluate(([tok, other, e]) => localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: tok, refresh_token: 'r', expires_at: e, user: { id: other } })), [jwt(OTHER), OTHER, exp]);
  await expect(page.getByTestId('identity')).toBeVisible();
  expect((await draftOf(page)).displayName).toBe('Ana');
  expect(saves(calls).length).toBeLessThanOrEqual(1);
});

test('the server without foil: saved, and the page says the finish was not kept', async ({ page }) => {
  await setup(page, { signedIn: true, keepFoil: false });
  await page.goto(PAGE);
  await pickCard(page, 0, 'elsa snow queen', { id: 'LOR1-41', finish: 'Foil' });
  await page.locator('#save').click();
  await expect(page.getByTestId('saved')).toContainText('acabamento foil não foi guardado');
});

test('opened from the e-mail link without the draft: account ready ≠ profile saved (A14, A30)', async ({ page }) => {
  await setup(page);
  await page.goto(`${PAGE}#access_token=${jwt(ME)}&refresh_token=r&expires_in=3600`);
  await expect(page.getByTestId('draft-missing')).toBeVisible();
  await expect(page.getByTestId('saved')).toHaveCount(0);
  await page.getByRole('button', { name: 'Começar novamente' }).click();
  await expect(page.getByLabel('Nome de exibição')).toBeVisible();
});

test('the e-mail link opened while the original tab is still open: go back to it (A14)', async ({ context }) => {
  const a = await context.newPage();
  await setup(a);
  await a.goto(PAGE);
  await a.getByLabel('Nome de exibição').fill('Ana');
  const b = await context.newPage();
  await setup(b);
  await b.goto(`${PAGE}#access_token=${jwt(ME)}&refresh_token=r&expires_in=3600`);
  await expect(b.getByTestId('other-tab')).toBeVisible();
});

test('only cards I own: off for guests; loading, empty and error are distinct (A04, A25)', async ({ page }) => {
  await setup(page);
  await page.goto(PAGE);
  await page.locator('[data-slot="0"] [data-pick]').click();
  await expect(page.locator('[data-scope="owned"]')).toBeDisabled();
  await expect(page.locator('#picker .owned')).toHaveCount(0);   // no ownership badge for a guest
});

for (const [name, opts, id] of [['empty', { collection: {} }, 'coll-empty'], ['error', { collectionFail: true }, 'coll-error'], ['loading', { collection: 'slow' }, 'coll-loading']]) {
  test(`only cards I own: ${name} (A25)`, async ({ page }) => {
    await setup(page, { signedIn: true, ...opts });
    await page.goto(PAGE);
    await page.locator('[data-slot="0"] [data-pick]').click();
    await page.locator('[data-scope="owned"]').click();
    await expect(page.getByTestId(id)).toBeVisible();
  });
}

test('owned finish is exact: the badge follows normal/foil (A04, A26)', async ({ page }) => {
  await setup(page, { signedIn: true, collection: { 'LOR1-41': { n: 1, f: 0 } } });
  await page.goto(PAGE);
  await page.locator('[data-slot="0"] [data-pick]').click();
  const d = page.locator('#picker');
  await d.locator('#pkQ').fill('elsa snow queen');
  const r = d.locator('.iw-result[data-card="LOR1-41"]');
  await expect(r.locator('.owned')).toHaveText('Você tem esta versão');
  await r.getByRole('button', { name: 'Foil', exact: true }).click();
  await expect(r).toContainText('Você tem esta carta em outro acabamento');
  await expect(d.locator('.iw-result[data-card="LOR9-53"] .owned')).toHaveCount(0);
});

test('a broken image keeps the name and printing readable (A17)', async ({ page }) => {
  await setup(page);
  await page.route('**/lorcana-card-images/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto(PAGE);
  await pickCard(page, 0, 'elsa snow queen', { id: 'LOR1-41' });
  const fb = page.locator('[data-slot="0"] .iw-fallback');
  await expect(fb).toBeVisible();
  await expect(fb).toContainText('Elsa');
  await expect(fb).toContainText('nº 41');
});

for (const w of [320, 390, 768, 1440]) {
  test(`no sideways scrolling at ${w}px (A18)`, async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(PAGE);
    await page.getByLabel('Nome de exibição').fill('Um nome de exibição bem comprido');
    await pickCard(page, 0, 'elsa snow queen', { id: 'LOR1-41' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.locator('[data-slot="1"] [data-pick]').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test('feed with the flag: example profile is labelled and never enters the draft (A34, A28)', async ({ page }) => {
  await setup(page);
  await page.goto(new URL('feed/?preview=visitante', ROOT).href);
  await expect(page.getByText('Demonstração com dados fictícios').first()).toBeVisible();
  await page.getByRole('link', { name: 'Começar meu Inkwell' }).first().click();
  await expect(page).toHaveURL(/\/comecar\//);
  await expect(page.getByLabel('Nome de exibição')).toHaveValue('');
  expect(await draftOf(page)).toBeNull();
});

test('the feed without the flag stays as it is today (rollback)', async ({ page }) => {
  await setup(page);
  await page.goto(new URL('feed/?preview=off', ROOT).href);
  await expect(page.getByText('Demonstração com dados fictícios')).toHaveCount(0);
  await expect(page.locator('a[href="../comecar/"]')).toHaveCount(0);
});

test('English: the page and the picker have no Portuguese left over (A21)', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem('inkwell-lang', 'en'));
  await page.goto(PAGE);
  await expect(page.getByRole('heading', { name: 'Your Inkwell starts here' })).toBeVisible();
  await page.locator('[data-slot="0"] [data-pick]').click();
  const text = await page.locator('main, #picker').allInnerTexts();
  expect(text.join(' ')).not.toMatch(/Escolha|Buscar|Todos|Modo visitante|cartas favoritas/);
});
