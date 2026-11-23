// Decks › "Editar lista": the builder grid (Fase 1 of the deck builder, ROADMAP "Decks · Montar").
// Runs in Chromium and, with PW_WEBKIT=1, in WebKit on an iPhone profile.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/deckbuilder.spec.mjs
import { test, expect } from '@playwright/test';

const BASE = new URL('decks/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';
const IDS = ['LOR10-1', 'LOR10-10', 'LOR10-11', 'LOR10-12', 'LOR10-13', 'LOR10-14', 'LOR10-15', 'LOR10-16',
  'LOR10-17', 'LOR10-18', 'LOR10-2', 'LOR10-21', 'LOR10-22', 'LOR10-23'];   // Amber, 14 × 4 = 56 cards
const AMBER = { id: 'deck-a', name: 'Amber Test', format: 'core', colors: ['Amber'], cards: Object.fromEntries(IDS.map((id) => [id, 4])), created_at: '2026-10-01' };

async function setup(page, { deck = AMBER, coll } = {}) {
  const collection = coll || Object.fromEntries(IDS.map((id) => [id, { n: id === 'LOR10-1' ? 2 : 4, f: 0 }]));
  const db = { profiles: [{ profile: 'luiscredie', updated_at: '2026-10-20T10:00:00Z', collection, decks: [JSON.parse(JSON.stringify(deck))] }] };
  const calls = [], texts = [];
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  page.on('request', (r) => { if (r.url().includes('card-text.json')) texts.push(r.url()); });
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ path, body });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles') return json(db.profiles);
    if (path === 'profiles') return json([{ user_id: ME, display_name: 'Luis' }]);
    if (path === 'rpc/save_deck') {   // kept, so a reload reads back what was saved
      const saved = { ...body.p_deck, updated_at: '2026-10-21T10:00:00Z' }, ds = db.profiles[0].decks;
      ds.splice(Math.max(0, ds.findIndex((x) => x.id === saved.id)), 1, JSON.parse(JSON.stringify(saved)));
      return json(saved);
    }
    if (path === 'rpc/my_duels_sync') return json(null);
    return json([]);
  });
  return { calls, texts };
}
const saves = (calls) => calls.filter((c) => c.path === 'rpc/save_deck');
const lastDeck = (calls) => saves(calls).at(-1)?.body.p_deck;

async function openBuilder(page, deck = 'deck-a') {
  await page.goto(BASE + '?deck=' + deck);
  await page.getByRole('button', { name: 'Editar lista' }).click();
  await expect(page.getByTestId('builder')).toBeVisible();
  await expect(page.getByTestId('bt').first()).toBeVisible();
}
const tile = (page, name) => page.getByTestId('bt').filter({ hasText: name });

test('no inks yet: six to choose, then the second, then only cards of both — nothing else changes', async ({ page }) => {
  const { calls } = await setup(page, { deck: { id: 'deck-n', name: 'Novo', format: 'core', colors: [], cards: {}, created_at: '2026-10-01' } });
  await openBuilder(page, 'deck-n');
  await expect(page.getByTestId('ink-ask')).toHaveText('Escolha até 2 tintas');
  await expect(page.getByTestId('ink-pick').locator('[data-bink]')).toHaveCount(6);
  // no "Outra tinta" anywhere: nothing is blocked before an ink is chosen
  await expect(page.getByTestId('bgrid')).not.toContainText('Outra tinta');

  await page.locator('[data-bink="Ruby"]').click();
  await expect(page.getByTestId('ink-ask')).toHaveText('Escolha a segunda tinta');
  await expect.poll(() => lastDeck(calls)?.colors).toEqual(['Ruby']);
  expect(lastDeck(calls).cards).toEqual({});
  await expect(page.getByTestId('bgrid')).not.toContainText('Outra tinta');
  const inks = () => page.$$eval('[data-testid="bt"] [data-card]', (els) => [...new Set(els.map((e) => e.dataset.ink))].sort().join());
  await expect.poll(inks).toBe('ruby');

  await page.locator('[data-bink="Sapphire"]').click();
  await expect.poll(() => lastDeck(calls)?.colors).toEqual(['Ruby', 'Sapphire']);
  await expect(page.getByTestId('ink-filter')).toBeVisible();
  await expect(page.getByTestId('ink-pick')).toHaveCount(0);
  await expect.poll(inks).toBe('ruby,sapphire');
});

test('dual-ink cards: only when both inks are the deck\'s', async ({ page }) => {
  const { calls } = await setup(page);
  await openBuilder(page);
  // one ink (Amber): a dual Amber card needs a second ink the deck has not chosen
  await page.locator('#addQ').fill('lilo stitch fun loving');
  await expect(page.getByTestId('bgrid-empty')).toBeVisible();
  await page.locator('[data-bink="Steel"]').click();
  await expect.poll(() => lastDeck(calls)?.colors).toEqual(['Amber', 'Steel']);
  await expect(tile(page, 'Lilo & Stitch')).toHaveCount(1);
  // Amber + Steel: an Amber/Amethyst card stays out
  await page.locator('#addQ').fill('pocahontas meeko adventurous');
  await expect(page.getByTestId('bgrid-empty')).toBeVisible();
  // "Mostrar todas as tintas" shows it, without a + and with the reason
  await page.locator('[data-ball]').click();
  await expect(tile(page, 'Pocahontas & Meeko')).toContainText('Outra tinta');
  await expect(tile(page, 'Pocahontas & Meeko').locator('[data-bq]')).toHaveCount(0);
  // the deck's inks and cards were never changed by looking
  expect(lastDeck(calls).colors).toEqual(['Amber', 'Steel']);
  expect(Object.keys(lastDeck(calls).cards).length).toBe(IDS.length);
});

test('a tile: − n/4 +, the copy limit, what you have and what is missing; owning none never blocks', async ({ page }) => {
  const { calls } = await setup(page);
  await openBuilder(page);
  await page.locator('#addQ').fill('gurgi apple');
  const g = tile(page, 'Gurgi');
  await expect(g.locator('output')).toHaveText('4/4');
  await expect(g.getByRole('button', { name: 'Pôr uma · Gurgi' })).toBeDisabled();   // copy limit
  await g.getByRole('button', { name: 'Tirar uma · Gurgi' }).click();
  await expect(g.locator('output')).toHaveText('3/4');
  await expect.poll(() => lastDeck(calls)?.cards['LOR10-10']).toBe(3);
  await expect(page.locator('[data-bpane="deck"]')).toContainText('55/60');

  // LOR10-1: 4 in the deck, 2 owned → "falta 2"
  await page.locator('#addQ').fill('');
  await page.locator('[data-bowned]').click();   // "Só as que tenho": only the 14 owned
  await expect(page.locator('[data-bres]')).toHaveText(`${IDS.length} cartas`);
  await expect(page.locator('[data-testid="bt"]:has([data-card="LOR10-1"])')).toContainText(/você tem 2.*falta 2/);
  await page.locator('[data-bowned]').click();

  // a card not in the collection can still be added
  await page.locator('#addQ').fill('mickey mouse');
  const add = page.getByTestId('bt').filter({ hasText: 'não está na sua coleção' }).first().locator('[data-bq$=":1"]');
  const before = saves(calls).length;
  await add.click();
  await expect.poll(() => saves(calls).length).toBe(before + 1);
});

test('the search, filters and scroll stay through + and −, and come back after a reload', async ({ page }) => {
  const { calls } = await setup(page);
  await openBuilder(page);
  await page.locator('[data-bcost="2"]').click();
  await page.locator('[data-btype="char"]').click();
  await expect(page.locator('[data-bcost="2"]')).toHaveAttribute('aria-pressed', 'true');
  const n = await page.getByTestId('bt').count();
  expect(n).toBeGreaterThan(3);
  const third = page.getByTestId('bt').nth(3);
  await third.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => scrollY);
  await third.locator('[data-bq$=":1"]').click();
  await expect.poll(() => saves(calls).length).toBe(1);   // the save renders the page again…
  await page.waitForTimeout(300);
  expect(Math.abs(await page.evaluate(() => scrollY) - y)).toBeLessThan(40);   // …and nothing jumps
  await expect(page.locator('[data-bcost="2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-btype="char"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('bt')).toHaveCount(n);

  await page.locator('#addQ').fill('gaston');
  await page.reload();
  await page.getByRole('button', { name: 'Editar lista' }).click();
  await expect(page.locator('#addQ')).toHaveValue('gaston');
  await expect(page.locator('[data-bcost="2"]')).toHaveAttribute('aria-pressed', 'true');
});

test('abilities: the text file is fetched only when needed; ability search and a mechanic filter', async ({ page }) => {
  const { texts } = await setup(page);
  await openBuilder(page);
  await page.locator('#addQ').fill('ga');
  await page.waitForTimeout(400);
  expect(texts.length).toBe(0);   // not at page open, not for a short name search
  await page.locator('#addQ').fill('remove up to');
  await expect.poll(() => texts.length).toBe(1);
  await expect(page.locator('[data-bres]')).toHaveText(/^\d+ cartas$/);   // found by the ability's words, not by a name
  expect(parseInt(await page.locator('[data-bres]').textContent())).toBeGreaterThan(5);
  await page.locator('#addQ').fill('');
  await page.locator('[data-bmore]').click();
  await expect(page.getByTestId('more-filters')).toBeVisible();
  await page.locator('[data-bmech="Bodyguard"]').click();
  await expect(page.getByTestId('bt').first()).toBeVisible();
  await expect(page.locator('[data-bres]')).toHaveText(/^\d+ cartas$/);
  const guarded = await page.locator('[data-bres]').textContent();
  await page.locator('[data-bmech="Bodyguard"]').click();
  const all = await page.locator('[data-bres]').textContent();
  expect(parseInt(guarded)).toBeLessThan(parseInt(all));
  expect(texts.length).toBe(1);
});

test('zoom from the eye button opens the card; + and − never open it', async ({ page }) => {
  await setup(page);
  await openBuilder(page);
  const t = page.getByTestId('bt').first();
  await t.locator('[data-bq$=":1"]').click();
  await expect(page.locator('#iwZoom')).not.toBeVisible();
  await t.locator('[data-bzoom]').click();
  await expect(page.locator('#iwZoom')).toBeVisible();
});

for (const w of [320, 360, 390, 430]) {
  test(`phone ${w}px: two columns, no sideways scroll, Cartas / Meu deck with the count`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await setup(page);
    await openBuilder(page);
    const xs = await page.$$eval('[data-testid="bt"]', (els) => [...new Set(els.slice(0, 6).map((e) => Math.round(e.getBoundingClientRect().left)))]);
    expect(xs.length).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await page.getByTestId('bt').first().locator('[data-bq$=":1"]').boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(40);   // a thumb, not a pointer
    await expect(page.locator('[data-bpane="deck"]')).toContainText('56/60');
    await expect(page.getByTestId('bld-deck')).toBeHidden();
    await page.locator('[data-bpane="deck"]').click();
    await expect(page.getByTestId('bld-deck')).toBeVisible();
    await expect(page.getByTestId('bgrid')).toBeHidden();
    await page.locator('[data-bpane="cards"]').click();
    await expect(page.getByTestId('bgrid')).toBeVisible();
  });
}

test('taking out the last ink: it stays out (also after a reload) and the cards stay in the deck', async ({ page }) => {
  const { calls } = await setup(page);
  await openBuilder(page);
  await expect(page.locator('[data-bink="Amber"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-bink="Amber"]').click();
  await expect(page.getByTestId('ink-ask')).toHaveText('Escolha até 2 tintas');
  await expect(page.locator('[data-bink="Amber"]')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => lastDeck(calls)?.colors).toEqual([]);
  expect(Object.values(lastDeck(calls).cards).reduce((a, b) => a + b, 0)).toBe(56);   // no card removed
  await page.waitForTimeout(900);   // past the save debounce: Amber doesn't come back by itself
  await expect(page.locator('[data-bink="Amber"]')).toHaveAttribute('aria-pressed', 'false');

  // choosing another ink: its cards can be added; the Amber ones stay and are pointed out
  await page.locator('[data-bink="Ruby"]').click();
  await expect.poll(() => lastDeck(calls)?.colors).toEqual(['Ruby']);
  await expect(page.getByTestId('ink-off')).toHaveText('56 cartas de outras tintas continuam no deck.');
  await expect(page.getByTestId('bt').first().locator('[data-bq$=":1"]')).toBeEnabled();
  await page.locator('[data-bink="Ruby"]').click();
  await expect.poll(() => lastDeck(calls)?.colors).toEqual([]);

  await page.reload();
  await page.getByRole('button', { name: 'Editar lista' }).click();
  await expect(page.getByTestId('ink-ask')).toHaveText('Escolha até 2 tintas');
  await expect(page.locator('[data-bink="Amber"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-bpane="deck"]')).toContainText('56/60');
});

test('set filter: the tile shows that set\'s printing; + keeps the printing already in the deck', async ({ page }) => {
  const coll = { ...Object.fromEntries(IDS.map((id) => [id, { n: 4, f: 0 }])), 'LOR1-12': { n: 3, f: 0 }, 'LOR1-14': { n: 1, f: 0 } };
  const { calls } = await setup(page, { deck: { ...AMBER, cards: { ...AMBER.cards, 'LOR1-12': 2 } }, coll });
  await openBuilder(page);
  const art = (name) => tile(page, name).locator('[data-card]');
  await page.locator('#addQ').fill('true friend');
  await expect(art('Mickey Mouse')).toHaveAttribute('data-card', 'LOR1-12');   // the deck's printing
  await page.locator('[data-bmore]').click();
  await page.locator('[data-bset]').selectOption('LOR9');
  await expect(art('Mickey Mouse')).toHaveAttribute('data-card', 'LOR9-13');
  await tile(page, 'Mickey Mouse').locator('[data-bq$=":1"]').click();
  await expect.poll(() => lastDeck(calls)?.cards['LOR1-12']).toBe(3);   // the saved printing, not switched
  expect(lastDeck(calls).cards['LOR9-13']).toBeUndefined();
  await expect(art('Mickey Mouse')).toHaveAttribute('data-card', 'LOR9-13');

  // a card not in the deck: the set's printing, even owning another one; + adds the printing shown
  await page.locator('#addQ').fill('moana of motunui');
  await expect(art('Moana')).toHaveAttribute('data-card', 'LOR9-20');
  await tile(page, 'Moana').locator('[data-bq$=":1"]').click();
  await expect.poll(() => lastDeck(calls)?.cards['LOR9-20']).toBe(1);
  await page.locator('[data-bset]').selectOption('');
  await expect(art('Moana')).toHaveAttribute('data-card', 'LOR9-20');   // now in the deck: the deck's printing
});
