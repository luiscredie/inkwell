// Início on a phone: the "Continuar" block (the side columns are hidden up to 760px), the first steps of an empty
// account, and the notice with "Tentar de novo" when the home data doesn't load. Fake Supabase, real pages.
//   (cd site && python3 -m http.server 8080) &   npx playwright test tools/home.spec.mjs
// HOME_EVIDENCE=1 saves PNG files to docs/evidencias/home-continuar/.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const ROOT = new URL('./', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';
const EVID = new URL('../docs/evidencias/home-continuar/', import.meta.url);
const DECK_A = { id: 'deck-a', name: 'Âmbar Aço', format: 'core', cards: { 'LOR10-1': 4, 'LOR10-10': 4 } };
const DECK_B = { id: 'deck-b', name: 'Rubi Safira', format: 'core', cards: { 'LOR10-11': 4, 'LOR10-12': 4, 'LOR10-13': 2 } };
const HOME = { profile: { handle: 'luis', is_public: true }, friend_requests: [], recados_waiting: 0, communities: [], community_posts: [], recados_new: [] };
const soon = () => new Date(Date.now() + 3 * 86400e3).toISOString();

async function open(page, { width = 390, collection = {}, decks = [], marks = [], home = HOME, homeFails = () => false, colsFail = () => false, lastDeck = null } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width, height: width < 700 ? 760 : 900 });
  await page.addInitScript(([me, last]) => {
    localStorage.setItem('inkwell-lang', 'pt');
    if (last) localStorage.setItem(`inkwell-last-deck:${me}`, last);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, [ME, lastDeck]);
  await page.route('**/rest/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles' && colsFail()) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' });
    if (path === 'inkwell_profiles') return json([{ profile: 'principal', updated_at: '2026-11-15T10:00:00Z', collection, decks, wishlist: {} }]);
    if (path === 'rpc/my_home') return homeFails() ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' }) : json(home);
    if (path === 'rpc/my_event_marks') return json(marks);
    if (path === 'rpc/my_profile') return json({ handle: 'luis', is_public: true, display_name: 'Luís' });
    if (path.startsWith('rpc/')) return json(null);
    return json([]);
  });
  await page.route('**/functions/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(ROOT + 'feed/');
  await page.waitForLoadState('networkidle').catch(() => {});
  return errors;
}
const shot = async (page, name) => { if (!process.env.HOME_EVIDENCE) return; mkdirSync(EVID, { recursive: true }); await page.screenshot({ path: new URL(name + '.png', EVID).pathname }); };
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('phone, account with decks and cards: Continuar shows the last deck opened, the collection and the next saved event', async ({ page }) => {
  const errors = await open(page, { collection: { 'LOR10-1': { n: 2, f: 1 }, 'LOR10-10': { n: 4, f: 0 } }, decks: [DECK_A, DECK_B], lastDeck: 'deck-a',
    marks: [{ rph_id: 9, status: 'going', registered: false, paid: false, snap: { name: 'Liga de Sábado', start: soon(), store: 'Loja Exemplo' } }] });
  const keep = page.getByTestId('home-continue');
  await expect(keep.getByRole('heading', { name: 'Continuar' })).toBeVisible();
  const deck = keep.getByTestId('keep-deck');
  await expect(deck).toContainText('Âmbar Aço');
  await expect(deck).toContainText('8 cartas · ver o que falta');
  await expect(deck).toHaveAttribute('href', '../decks/?deck=deck-a&tab=missing');
  await expect(keep.getByTestId('keep-collection')).toContainText('7 cartas · escanear mais');
  await expect(keep.getByTestId('keep-event')).toContainText('Liga de Sábado');
  await expect(keep.getByTestId('keep-event')).toContainText('Loja Exemplo');
  await expect(keep.getByTestId('first-collection')).toHaveCount(0);
  // seen without scrolling, comfortable to tap, nothing wider than the screen
  for (const id of ['keep-deck', 'keep-collection', 'keep-event']) {
    const b = await keep.getByTestId(id).boundingBox();
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.y + b.height).toBeLessThanOrEqual(760 - 56);   // above the bottom bar
  }
  expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
  await shot(page, '390-conta-com-deck');
});

test('phone: with no deck opened before, Continuar offers the newest deck; a past saved event is not shown', async ({ page }) => {
  await open(page, { collection: { 'LOR10-1': { n: 1 } }, decks: [DECK_A, DECK_B],
    marks: [{ rph_id: 3, status: 'going', snap: { name: 'Evento antigo', start: '2026-01-10T15:00:00Z' } }] });
  const keep = page.getByTestId('home-continue');
  await expect(keep.getByTestId('keep-deck')).toContainText('Rubi Safira');
  await expect(keep.getByTestId('keep-collection')).toContainText('1 carta · escanear mais');
  await expect(keep.getByTestId('keep-event')).toHaveCount(0);
});

test('phone, the deck tile opens that deck on Faltando', async ({ page }) => {
  await open(page, { collection: { 'LOR10-1': { n: 1 } }, decks: [DECK_A], lastDeck: 'deck-a' });
  await page.getByTestId('keep-deck').click();
  await expect(page).toHaveURL(/\/decks\/\?deck=deck-a&tab=missing$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Âmbar Aço');
});

test('phone, empty account: three first steps and no blank page', async ({ page }) => {
  const errors = await open(page, { width: 320 });
  const keep = page.getByTestId('home-continue');
  await expect(keep.getByRole('heading', { name: 'Comece por aqui' })).toBeVisible();
  await expect(keep.getByTestId('first-collection')).toHaveAttribute('href', '../colecao/');
  await expect(keep.getByTestId('first-deck')).toHaveAttribute('href', '../decks/?importar=1');
  await expect(keep.getByTestId('first-event')).toHaveAttribute('href', '../eventos/');
  await expect(keep.getByTestId('keep-deck')).toHaveCount(0);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
  await shot(page, '320-conta-vazia');
});

test('phone: when the home data fails there is a notice and Tentar de novo loads it', async ({ page }) => {
  let down = true;
  await open(page, { collection: { 'LOR10-1': { n: 1 } }, decks: [DECK_A], homeFails: () => down });
  const err = page.getByTestId('home-error');
  await expect(err).toContainText('Não deu para carregar esta parte do seu Início.');
  await shot(page, '390-falha');
  down = false;
  await page.waitForTimeout(5200);   // a failed shared read is asked again; a recent good one is reused for 5 s
  await err.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(page.getByTestId('home-error')).toHaveCount(0);
  await expect(page.getByTestId('for-you')).toContainText('Para você');
  await expect(page.getByTestId('keep-deck')).toBeVisible();
});

// Missão 2027, etapa 1: the missing half of a partial account, and only next steps on the desktop
const W = [320, 360, 390, 430, 1280];
test('deck and no cards: "Cadastrar minhas cartas", on phones and on the desktop', async ({ page }) => {
  for (const width of W) {
    const errors = await open(page, { width, decks: [DECK_A] });
    const keep = page.getByTestId('home-continue');
    const add = keep.getByTestId('keep-add-collection');
    await expect(add).toBeVisible();
    await expect(add).toHaveAttribute('href', '../colecao/');
    await expect(add).toContainText('Cadastrar minhas cartas');
    await expect(add).toContainText('Assim Âmbar Aço mostra só o que falta de verdade.');
    await expect(keep.getByTestId('keep-add-deck')).toHaveCount(0);
    await expect(keep.getByTestId('keep-collection')).toHaveCount(0);                       // no "0 cartas" tile
    if (width < 761) await expect(keep.getByTestId('keep-deck')).toBeVisible();
    else { await expect(keep.getByTestId('keep-deck')).toBeHidden(); await expect(page.getByTestId('me-card')).toBeVisible(); }   // the left column has it
    expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
    await shot(page, `${width}-deck-sem-colecao`);
  }
});

test('cards and no deck: "Importar ou montar um deck" opens the import sheet in Decks', async ({ page }) => {
  for (const width of W) {
    await open(page, { width, collection: { 'LOR10-1': { n: 2 } } });
    const add = page.getByTestId('keep-add-deck');
    await expect(add).toBeVisible();
    await expect(add).toContainText('Importar ou montar um deck');
    await expect(page.getByTestId('keep-add-collection')).toHaveCount(0);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
    await shot(page, `${width}-colecao-sem-deck`);
  }
  await page.getByTestId('keep-add-deck').click();
  await expect(page).toHaveURL(/\/decks\/$/);                  // the flag is dropped: Back or reload don't reopen it
  await expect(page.locator('#iName')).toBeVisible();          // the paste sheet is open
});

test('empty account on the desktop: the first steps show too', async ({ page }) => {
  await open(page, { width: 1280 });
  const keep = page.getByTestId('home-continue');
  await expect(keep.getByRole('heading', { name: 'Comece por aqui' })).toBeVisible();
  for (const id of ['first-collection', 'first-deck', 'first-event']) await expect(keep.getByTestId(id)).toBeVisible();
  expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
  await shot(page, '1280-conta-vazia');
});

test('desktop keeps today\'s home: a complete account sees no block from 761px up', async ({ page }) => {
  for (const width of [768, 860, 1280]) {
    await open(page, { width, collection: { 'LOR10-1': { n: 2 } }, decks: [DECK_A] });
    await expect(page.getByTestId('home-continue')).toBeHidden();
    await expect(page.getByTestId('keep-add-collection')).toHaveCount(0);
    await expect(page.getByTestId('me-card')).toBeVisible();
    expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
    await shot(page, `${width}-desktop`);
  }
});

test('phone: tapping a Continuar tile sends one event with no deck name or number in it', async ({ page }) => {
  const sent = [];
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });   // metrics are off for automated browsers
  page.on('request', (r) => { if (r.url().includes('/rest/v1/rpc/track')) sent.push(r.postDataJSON()); });
  await open(page, { collection: { 'LOR10-1': { n: 1 } }, decks: [DECK_A], lastDeck: 'deck-a' });
  await page.getByTestId('keep-deck').click();
  await expect(page).toHaveURL(/tab=missing$/);
  const ev = sent.filter((b) => b.p_kind === 'action' && b.p_page === 'feed');
  expect(ev.map((b) => b.p_name)).toEqual(['home_keep_deck']);
  expect(Object.keys(ev[0]).sort()).toEqual(['p_dev', 'p_kind', 'p_name', 'p_page', 'p_ref', 'p_sid']);
  expect(JSON.stringify(ev[0])).not.toContain('deck-a');
});

test('phone: when decks and collection fail to load, Continuar says so and Tentar de novo brings the tiles back', async ({ page }) => {
  let down = true;
  const errors = await open(page, { collection: { 'LOR10-1': { n: 1 } }, decks: [DECK_A], lastDeck: 'deck-a', colsFail: () => down });
  const keep = page.getByTestId('home-continue');
  await expect(keep.getByRole('heading', { name: 'Continuar' })).toBeVisible();
  const err = keep.getByTestId('keep-error');
  await expect(err).toContainText('Não deu para carregar seus decks e sua coleção.');
  const b = await err.getByRole('button', { name: 'Tentar de novo' }).boundingBox();
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
  await shot(page, '390-falha-colecao');
  down = false;
  await err.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(keep.getByTestId('keep-error')).toHaveCount(0);
  await expect(keep.getByTestId('keep-deck')).toContainText('Âmbar Aço');
  expect(errors).toEqual([]);
});

test('phone, two accounts on one device: the last deck of another account (or the old shared key) is never used', async ({ page }) => {
  const OTHER = '99999999-9999-4999-8999-999999999999';
  await page.addInitScript((other) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');   // only before the first page
    localStorage.setItem(`inkwell-last-deck:${other}`, 'deck-a');   // the other account opened Âmbar Aço
    localStorage.setItem('inkwell-last-deck', 'deck-a');             // and the key before this fix, shared by everyone
  }, OTHER);
  await open(page, { collection: { 'LOR10-1': { n: 1 } }, decks: [DECK_A, DECK_B] });
  await expect(page.getByTestId('keep-deck')).toContainText('Rubi Safira');   // this account's newest, not the other's choice
  await page.getByTestId('keep-deck').click();                               // opening a deck stores it for this account only
  await expect(page).toHaveURL(/deck=deck-b/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Rubi Safira');
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('inkwell-last-deck')).sort());
  expect(keys).toEqual(['inkwell-last-deck:11111111-1111-4111-8111-111111111111', 'inkwell-last-deck:99999999-9999-4999-8999-999999999999']);
  expect(await page.evaluate(() => localStorage.getItem('inkwell-last-deck:11111111-1111-4111-8111-111111111111'))).toBe('deck-b');
});
