// A shared deck: /perfil/?u=<handle>#deck-<id> (the QR code of a deck image) shows only that deck — never the
// profile, not even for a moment — against a fake Supabase and the real catalog and card images.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/sharedeck.spec.mjs
// Screenshots go to docs/evidencias/deck-compartilhado/ (SD_EVIDENCE=1).
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';
const url = (p) => new URL(p, ROOT).href;
const ME = '11111111-1111-4111-8111-111111111111';
const EVID = new URL('../docs/evidencias/deck-compartilhado/', import.meta.url);
const shot = async (page, name, opts = {}) => { if (!process.env.SD_EVIDENCE) return; mkdirSync(EVID, { recursive: true }); await page.screenshot({ path: new URL(name, EVID).pathname, ...opts }); };

// the same 60-card deck as tools/overview.spec.mjs
const CARDS = { 'LOR10-1': 3, 'LOR10-10': 4, 'LOR10-11': 4, 'LOR10-12': 4, 'LOR10-13': 4, 'LOR10-14': 4, 'LOR10-15': 4, 'LOR10-16': 4, 'LOR10-17': 4, 'LOR10-18': 2,
  'LOR10-223': 1, 'LOR11-94': 4, 'LOR13-101': 2, 'LOR13-103': 2, 'LOR10-207': 2, 'LOR10-231': 2, 'LOR10-100': 2, 'LOR10-101': 2, 'LOR10-102': 3, 'LOR10-34': 3 };
// everything else on the profile carries a marker, so the tests can tell it never reached the page
const SECRET = ['BIO-MARCADOR', 'LEMA-MARCADOR', 'CIDADE-MARCADOR', 'RECADO-MARCADOR', 'AMIGO-MARCADOR', 'DESTAQUE-MARCADOR', 'OUTRO-DECK-MARCADOR'];
const profile = (over = {}) => ({
  handle: 'luis', name: 'Luís', bio: 'BIO-MARCADOR', motto: 'LEMA-MARCADOR', avatar: 'LOR10-17', inks: ['Amber'], city: 'CIDADE-MARCADOR', mock: false,
  showcase: [{ id: 'LOR14-1', own: true }], record: { w: 8, l: 4 }, trade: { want: ['LOR14-3'], have: ['LOR14-2'] },
  friends: [{ name: 'AMIGO-MARCADOR', handle: 'amigo', avatar: null }], friends_n: 1,
  recados: [{ id: 'r1', body: 'RECADO-MARCADOR', at: '2026-11-01T10:00:00Z', name: 'Ana', handle: null, avatar: null }],
  deck: { name: 'DESTAQUE-MARCADOR', format: 'core', colors: ['Ruby'], cards: { 'LOR14-1': 4 } },
  public_decks: [
    { id: 'd-outro', name: 'OUTRO-DECK-MARCADOR', format: 'core', colors: ['Ruby'], cards: { 'LOR14-2': 4 } },
    { id: 'deck-ov', name: 'Âmbar Esmeralda', format: 'core', colors: ['Amber', 'Emerald'], cards: CARDS },
  ],
  relation: null, can_recado: false, ...over });

async function setup(page, { pp = profile(), signedIn = false, mine = null, delay = 0 } = {}) {
  const st = { pp, calls: [] };
  await page.addInitScript(([signed, me]) => {
    localStorage.setItem('inkwell-lang', 'pt');
    if (signed) {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
    }
    // anything of the profile appearing at any moment while the page loads
    window.__seen = [];
    new MutationObserver(() => {
      const t = document.body?.innerText || '';
      for (const m of ['BIO-MARCADOR', 'LEMA-MARCADOR', 'CIDADE-MARCADOR', 'RECADO-MARCADOR', 'AMIGO-MARCADOR', 'DESTAQUE-MARCADOR', 'OUTRO-DECK-MARCADOR']) if (t.includes(m) && !window.__seen.includes(m)) window.__seen.push(m);
      if (document.querySelector('[data-testid="profile"], [data-testid="showcase"], [data-testid="record"], [data-testid="trade"], [data-testid="friends"], [data-testid="recados"]') && !window.__seen.includes('profile-section')) window.__seen.push('profile-section');
    }).observe(document, { childList: true, subtree: true, characterData: true });
  }, [signedIn, ME]);
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    st.calls.push(path);
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'rpc/public_profile') {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (st.pp === 'offline') return route.fulfill({ status: 503, body: '' });
      return json(body.p_handle === 'luis' ? (typeof st.pp === 'function' ? st.pp() : st.pp) : null);
    }
    if (path === 'rpc/my_profile') return json(mine);
    if (path.startsWith('inkwell_profiles')) return json([]);
    if (path === 'rpc/track') return route.fulfill({ status: 204, body: '' });
    return json([]);
  });
  return st;
}
const deckUrl = (id = 'deck-ov', h = 'luis') => url(`perfil/?u=${h}#deck-${id}`);
const sd = (page) => page.getByTestId('shared-deck');

test('the QR code address shows only that deck: its numbers, art, list and who shared it', async ({ page }) => {
  await setup(page);
  await page.goto(deckUrl());
  await expect(sd(page)).toBeVisible();
  await expect(page.getByTestId('sd-name')).toHaveText('Âmbar Esmeralda');
  await expect(page).toHaveTitle('Âmbar Esmeralda · Inkwell');
  await expect(page.getByTestId('ov-total')).toContainText('60');
  await expect(page.getByTestId('ov-char')).toContainText('38');
  await expect(page.getByTestId('ov-action')).toContainText('Ações (10 músicas)');
  await expect(page.getByTestId('ov-noink')).toContainText('8');
  await expect(page.getByTestId('ov-item')).toContainText('4');
  await expect(page.getByTestId('ov-location')).toContainText('6');
  await expect(page.getByTestId('ov-distinct')).toContainText('20');
  const bars = (await page.locator('[data-testid="ov-curve"] .bars b').allTextContents()).map(Number);
  expect(bars).toEqual([0, 22, 16, 12, 4, 5, 1]);
  await expect(page.locator('.ov-card')).toHaveCount(20);
  await expect(page.getByTestId('sd-list').locator('li')).toHaveCount(20);
  await expect(page.locator('.ov-card:has(.ov-foil)')).toHaveCount(3);
  await expect(page.getByTestId('ov-foil-note')).toBeVisible();
  await expect(page.getByTestId('sd-by')).toHaveText('Deck compartilhado por Luís (@luis) · Ver perfil');
  await expect(page.getByTestId('sd-by').getByRole('link', { name: 'Ver perfil' })).toHaveAttribute('href', '?u=luis');
  await expect(page.getByTestId('sd-cta').getByRole('link')).toHaveAttribute('href', '../decks/');
  // nothing else of the profile, in the page or at any moment while it loaded
  const html = await page.content();
  for (const m of SECRET) expect(html).not.toContain(m);
  expect(await page.evaluate(() => window.__seen)).toEqual([]);
  await expect(page.locator('[data-testid="profile"], [data-testid="showcase"], [data-testid="record"], [data-testid="trade"], [data-testid="friends"], [data-testid="recados"], [data-testid="featured-deck"], [data-testid="public-deck"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('vitórias');
});

test('no moment of the profile: while the profile is being read only a placeholder shows', async ({ page }) => {
  await setup(page, { delay: 1200 });
  await page.goto(deckUrl());
  await expect(page.locator('#app .skel')).toBeVisible();
  await expect(page.locator('#title')).toHaveText('Deck compartilhado');
  await expect(sd(page)).toBeVisible({ timeout: 5000 });
  expect(await page.evaluate(() => window.__seen)).toEqual([]);
});

test('without a deck in the address, the profile is the full profile as before', async ({ page }) => {
  await setup(page);
  await page.goto(url('perfil/?u=luis'));
  await expect(page.getByTestId('profile')).toBeVisible();
  await expect(page.getByTestId('record')).toBeVisible();
  await expect(page.getByTestId('public-deck')).toHaveCount(2);
  await expect(sd(page)).toHaveCount(0);
  // the watcher used by the other tests does see a profile when there is one
  expect(await page.evaluate(() => window.__seen)).toEqual(expect.arrayContaining(['profile-section', 'BIO-MARCADOR', 'RECADO-MARCADOR']));
});

for (const [label, opts, id, profileLink] of [
  ['a private or deleted deck', {}, 'nao-existe', true],
  ['the featured deck (no id on the profile)', {}, 'featured', true],
  ['a private profile', { pp: null }, 'deck-ov', false],
  ['a deck id that is not valid', {}, '!!', true],
  ['an empty deck id', {}, '', true],
]) {
  test(`${label}: a message, no cards, no other deck`, async ({ page }) => {
    await setup(page, opts);
    await page.goto(deckUrl(id));
    const box = page.getByTestId('shared-deck-missing');
    await expect(box).toContainText('Deck indisponível');
    await expect(box).toContainText('Este deck não está mais público, ou este link não é válido.');
    await expect(page.locator('.ov-card, [data-testid="sd-list"]')).toHaveCount(0);
    await expect(page.getByTestId('sd-profile')).toHaveCount(profileLink ? 1 : 0);
    const html = await page.content();
    for (const m of SECRET) expect(html).not.toContain(m);
    expect(await page.evaluate(() => window.__seen)).toEqual([]);
  });
}

test('the profile cannot be read: says so, no cards', async ({ page }) => {
  await setup(page, { pp: 'offline' });
  await page.goto(deckUrl());
  await expect(page.getByTestId('shared-deck-missing')).toContainText('Não deu para abrir o deck agora. Tente de novo.');
  await expect(page.locator('.ov-card')).toHaveCount(0);
});

test('a visitor and a signed-in member see exactly the same deck; the owner also gets "Editar meu deck"', async ({ browser }) => {
  const text = async (opts) => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await setup(page, opts); await page.goto(deckUrl()); await expect(sd(page)).toBeVisible();
    const t = await sd(page).innerText(); const edit = await page.getByTestId('sd-edit').count(); const cta = await page.getByTestId('sd-cta').count(); await ctx.close(); return { t, edit, cta }; };
  const visitor = await text({});
  const member = await text({ signedIn: true, mine: { handle: 'bia', is_public: true } });
  const owner = await text({ signedIn: true, mine: { handle: 'luis', is_public: true } });
  expect(member.t).toBe(visitor.t);
  expect([visitor.edit, member.edit, owner.edit]).toEqual([0, 0, 1]);
  expect([visitor.cta, member.cta, owner.cta]).toEqual([1, 1, 0]);
  expect(owner.t).not.toMatch(/possui|coleção/i);   // the owner's collection never shows here
});

test('the owner\'s "Editar meu deck" opens that deck in Decks', async ({ page }) => {
  await setup(page, { signedIn: true, mine: { handle: 'luis', is_public: true } });
  await page.goto(deckUrl());
  await expect(page.getByTestId('sd-edit')).toHaveAttribute('href', '../decks/?deck=deck-ov');
});

test('Copiar lista, then Importar in Decks gives back the same 20 printings', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit gives tests no clipboard permission');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(ROOT).origin });
  await setup(page);
  await page.goto(deckUrl());
  await page.getByTestId('sd-copy').click();
  await expect(page.locator('#toast')).toContainText('Lista copiada');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.split('\n')).toHaveLength(20);
  expect(text).toContain('1 Goofy - Galumphing Gumshoe (Enchanted) (LOR10-223)');
  // in Decks, signed out (the public "try a deck" box reads the same lines)
  await page.goto(url('decks/'));
  await page.locator('#pText').fill(text);
  await expect(page.getByTestId('public-summary')).toContainText('60');
});

test('tap a card: it shows large', async ({ page }) => {
  await setup(page);
  await page.goto(deckUrl());
  await page.locator('.ov-card[data-card="LOR10-17"]').click();
  await expect(page.locator('#iwZoom')).toBeVisible();
});

test('a card whose art does not load still shows its name', async ({ page }) => {
  await setup(page);
  await page.route('**/lorcana-card-images/**LOR10-17*', (r) => r.abort());
  await page.goto(deckUrl());
  const t = page.locator('.ov-card[data-card="LOR10-17"]');
  await expect(t.locator('img')).toHaveCount(0);
  await expect(t.locator('.ov-noart')).toBeVisible();
  await expect(t.locator('.ov-noart')).toContainText('Ariel');
});

test('found by id: renamed and reordered decks still open the right one; edited cards show; removed shows the message', async ({ page }) => {
  const st = await setup(page);
  const base = profile();
  st.pp = { ...base, public_decks: [{ ...base.public_decks[1], name: 'Novo nome' }, { ...base.public_decks[0] }, { id: 'deck-ov2', name: 'Âmbar Esmeralda', format: 'core', colors: ['Amber'], cards: { 'LOR14-2': 4 } }] };
  await page.goto(deckUrl());
  await expect(page.getByTestId('sd-name')).toHaveText('Novo nome');
  await expect(page.locator('.ov-card')).toHaveCount(20);
  st.pp = { ...base, public_decks: [{ ...base.public_decks[1], cards: { 'LOR10-17': 4, 'LOR10-10': 2 } }] };
  await page.reload();
  await expect(page.locator('.ov-card')).toHaveCount(2);
  await expect(page.getByTestId('ov-total')).toContainText('6');
  st.pp = { ...base, public_decks: [base.public_decks[0]] };
  await page.reload();
  await expect(page.getByTestId('shared-deck-missing')).toBeVisible();
  await expect(page.locator('.ov-card')).toHaveCount(0);
});

test('links and history: another deck in the address, no deck, back, reload', async ({ page }) => {
  await setup(page);
  await page.goto(deckUrl());
  await expect(page.getByTestId('sd-name')).toHaveText('Âmbar Esmeralda');
  await page.evaluate(() => { location.hash = '#deck-d-outro'; });
  await expect(page.getByTestId('sd-name')).toHaveText('OUTRO-DECK-MARCADOR');
  await page.getByTestId('sd-by').getByRole('link', { name: 'Ver perfil' }).click();
  await expect(page.getByTestId('profile')).toBeVisible();
  await expect(sd(page)).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTestId('sd-name')).toHaveText('OUTRO-DECK-MARCADOR');
  await page.goBack();
  await expect(page.getByTestId('sd-name')).toHaveText('Âmbar Esmeralda');
  await page.reload();
  await expect(page.getByTestId('sd-name')).toHaveText('Âmbar Esmeralda');
  await expect(page.getByTestId('profile')).toHaveCount(0);
  await page.evaluate(() => { history.pushState(null, '', location.pathname + location.search); dispatchEvent(new HashChangeEvent('hashchange')); });
  await expect(page.getByTestId('profile')).toBeVisible();
});

for (const width of [320, 360, 390, 430]) {
  test(`phone ${width}px: the deck fits the screen, the end sits above the tab bar`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await setup(page);
    await page.goto(deckUrl());
    await expect(sd(page)).toBeVisible();
    const over = await page.evaluate(() => { const vw = document.documentElement.clientWidth, out = [];
      for (const el of document.querySelectorAll('[data-testid="shared-deck"], [data-testid="shared-deck"] *')) { const r = el.getBoundingClientRect(); if (r.width && (r.right > vw + 0.5 || r.left < -0.5)) out.push(el.className || el.tagName); }
      return out; });
    expect(over).toEqual([]);
    await page.evaluate(() => Promise.all([...document.querySelectorAll('.ov-card img')].map((i) => { i.loading = 'eager'; return i.decode().catch(() => null); })));
    await shot(page, `celular-${width}-inicio.png`);
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    const cta = await page.getByTestId('sd-cta').boundingBox(), tab = await page.locator('.tabbar').boundingBox();
    if (tab) expect(cta.y + cta.height).toBeLessThanOrEqual(tab.y);
    await shot(page, `celular-${width}-fim.png`);
  });
}

test('computer: the deck page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page);
  await page.goto(deckUrl());
  await expect(sd(page)).toBeVisible();
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.ov-card img')].map((i) => { i.loading = 'eager'; return i.decode().catch(() => null); })));
  await shot(page, 'computador-1280.png', { fullPage: true });
});
