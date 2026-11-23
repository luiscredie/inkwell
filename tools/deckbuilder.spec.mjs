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

// ---------- Todas / Tintáveis / Não tintáveis (Conselho 23/11, ROADMAP #311 P2) ----------
// Only what the list shows: no card leaves the deck, nothing is saved, and every number stays the whole deck's.
test('deck list: Todas / Tintáveis / Não tintáveis filters the rows only — counts, stats and the deck stay whole', async ({ page }) => {
  // Timon - Snowball Swiper (uninkable) in two printings: LOR11-16 and a promo
  const deck = { ...AMBER, cards: { ...AMBER.cards, 'LOR11-16': 2, 'DLPC1-32-P3': 1 } };
  const { calls } = await setup(page, { deck });
  await page.goto(BASE + '?deck=deck-a');
  const seg = page.getByTestId('inkw');
  await expect(seg.locator('[data-inkw=""]')).toHaveAttribute('aria-pressed', 'true');
  await expect(seg).toContainText('Todas 59');
  await expect(seg).toContainText('Tintáveis 48');
  await expect(seg).toContainText('Não tintáveis 11');
  const rows = page.locator('[data-testid="dl"] .dl-row');
  const all = await rows.count();
  await seg.locator('[data-inkw="no"]').click();
  await expect(page.getByTestId('inkw-shown')).toHaveText(/Mostrando 11 de 59 cartas \(não tintáveis\)\./);
  // every row shown is uninkable (no "ink" mark on its cost), both Timon printings included
  expect(await page.$$eval('[data-testid="dl"] .dl-row .cost', (els) => els.every((e) => !e.classList.contains('ink')))).toBe(true);
  await expect(page.locator('[data-testid="dl"] .dl-row', { hasText: 'Timon' })).toHaveCount(2);
  expect(await rows.count()).toBeLessThan(all);
  // the deck itself is untouched: its count and overview are the whole deck's, and nothing was saved
  await expect(page.locator('[data-testid="deck-stats"]')).toContainText('59/60');
  await expect(page.getByTestId('deck-overview')).toContainText('59');
  expect(saves(calls)).toHaveLength(0);
  // Tintáveis, then back to Todas from the line under the buttons
  await seg.locator('[data-inkw="yes"]').click();
  expect(await page.$$eval('[data-testid="dl"] .dl-row .cost', (els) => els.every((e) => e.classList.contains('ink')))).toBe(true);
  await page.getByTestId('inkw-shown').getByRole('button', { name: 'Mostrar todas' }).click();
  await expect(rows).toHaveCount(all);
  await expect(page.getByTestId('inkw-shown')).toHaveCount(0);
  // Análise counts the whole deck whatever the list shows
  await seg.locator('[data-inkw="no"]').click();
  await page.getByRole('tab', { name: 'Análise' }).click();
  await expect(page.locator('main')).toContainText('48 de 59 inkáveis');
  expect(saves(calls)).toHaveLength(0);
});

test('the same filter in the builder: one control, kept from the list, works with cost and type; the deck pane says what it hides', async ({ page }) => {
  const { calls } = await setup(page);
  await page.goto(BASE + '?deck=deck-a');
  await page.getByTestId('inkw').locator('[data-inkw="yes"]').click();
  await page.getByRole('button', { name: 'Editar lista' }).click();
  const b = page.getByTestId('builder');
  await expect(b.getByTestId('inkw')).toHaveCount(1);   // in the main filters, not under "Mais filtros"
  await expect(b.getByTestId('inkw').locator('[data-inkw="yes"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-bcost="2"]').click();
  await page.locator('[data-btype="char"]').click();
  await expect(page.getByTestId('bt').first()).toBeVisible();
  expect(await page.$$eval('[data-testid="bt"] .bt-info .cost', (els) => els.length > 0 && els.every((e) => e.classList.contains('ink') && e.textContent === '2'))).toBe(true);
  const tabs = page.locator('[data-bpane="deck"]');
  if (await tabs.isVisible()) await tabs.click();   // phone: the deck pane; desktop: always beside the grid
  await expect(page.getByTestId('bld-deck').getByTestId('inkw-shown')).toHaveText(/Mostrando 48 de 56 cartas \(tintáveis\)\./);
  await expect(page.locator('[data-bpane="deck"]')).toContainText('56/60');   // the count is the whole deck's
  if (await page.locator('[data-bpane="cards"]').isVisible()) await page.locator('[data-bpane="cards"]').click();
  await b.getByTestId('inkw').locator('[data-inkw="no"]').click();
  expect(await page.$$eval('[data-testid="bt"] .bt-info .cost', (els) => els.every((e) => !e.classList.contains('ink')))).toBe(true);
  // "Limpar filtros" clears it too; still nothing saved
  await page.locator('[data-bclear]').click();
  await expect(b.getByTestId('inkw').locator('[data-inkw=""]')).toHaveAttribute('aria-pressed', 'true');
  expect(saves(calls)).toHaveLength(0);
});

for (const w of [320, 430]) {
  test(`phone ${w}px: the three buttons fit, are easy to tap and say which is on`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await setup(page);
    await page.goto(BASE + '?deck=deck-a');
    const seg = page.getByTestId('inkw');
    for (const k of ['', 'yes', 'no']) {
      const bb = await seg.locator(`[data-inkw="${k}"]`).boundingBox();
      expect(bb.height).toBeGreaterThanOrEqual(40);
      expect(bb.x + bb.width).toBeLessThanOrEqual(w);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await seg.locator('[data-inkw="no"]').click();
    await expect(seg.locator('[data-inkw="no"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(seg).toHaveAttribute('aria-label', 'Tintável ou não');
  });
}

// ---------- Fase 2: the deck while it is built (spec "Deck builder · Fase 2", Conselho 23/11) ----------
// Fixture prices: only LOR10-1 (R$ 10,50) and the promo Timon DLPC1-32-P3 (R$ 7,00), so every value is checkable.
const P2_PRICES = { schema_version: 2, generated_at: new Date().toISOString(), prices: { 'LOR10-1': { n: 10.5, nl: 10.5, nh: 10.5 }, 'DLPC1-32-P3': { n: 7, nl: 7, nh: 7 } } };
const pricesRoute = (page, body = P2_PRICES) => page.route('**/data/prices.json', (r) => (body ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) : r.fulfill({ status: 404, body: '' })));
// LOR10-1: 4 in the deck, none owned (R$ 10,50 each) · LOR10-10 (Gurgi, cost 2): 4 in the deck, 2 owned, no price
const P2_COLL = Object.fromEntries(IDS.map((id) => [id, { n: id === 'LOR10-1' ? 0 : id === 'LOR10-10' ? 2 : 4, f: 0 }]));
const curveOf = async (page) => (await page.getByTestId('bp-curve').getAttribute('aria-label'));

test('panel: count, inkable, curve, missing and value — and they follow every + and −', async ({ page }) => {
  await pricesRoute(page);
  const { calls } = await setup(page, { coll: P2_COLL });
  await openBuilder(page);
  const panel = page.getByTestId('bld-panel');
  if (!(await panel.isVisible())) await page.locator('[data-bpane="deck"]').click();
  await expect(page.getByTestId('bp-count')).toHaveText('56/60');
  await expect(page.getByTestId('bp-miss')).toHaveText('6');
  await expect(page.getByTestId('bp-val')).toHaveText(/R\$\s42,00 \+ 2 sem preço/);   // 4 × 10,50; Gurgi has no price
  await expect(page.getByTestId('bp-note')).toContainText('Estimativa parcial: 2 sem preço ficam fora.');
  // the curve's columns add up to the deck
  const before = await curveOf(page);
  const sum = (lbl) => [...lbl.matchAll(/(≤1|\d\+?): (\d+)/g)].reduce((a, m) => a + +m[2], 0);
  expect(sum(before)).toBe(56);
  const gurgiCol = (lbl) => +lbl.match(/(?:^|, )2: (\d+)/)[1];
  // − on Gurgi (cost 2): 55 cards, one fewer missing and without price, one fewer in column 2
  if (await page.locator('[data-bpane="cards"]').isVisible()) await page.locator('[data-bpane="cards"]').click();
  await page.locator('#addQ').fill('gurgi apple');
  await tile(page, 'Gurgi').getByRole('button', { name: 'Tirar uma · Gurgi' }).click();
  if (!(await panel.isVisible())) await page.locator('[data-bpane="deck"]').click();
  await expect(page.getByTestId('bp-count')).toHaveText('55/60');
  await expect(page.getByTestId('bp-miss')).toHaveText('5');
  await expect(page.getByTestId('bp-val')).toHaveText(/R\$\s42,00 \+ 1 sem preço/);
  expect(gurgiCol(await curveOf(page))).toBe(gurgiCol(before) - 1);
  await expect(page.locator('[data-bsay]')).toHaveText(/55 de 60 cartas, \d+ tintáveis, faltam 5, R\$\s42,00 \+ 1 sem preço, estimativa parcial/);
  // the Missing tab says the same total for the same cards
  await expect.poll(() => saves(calls).length).toBe(1);
});

test('panel: another printing you own counts; a printing with no price uses its cheapest reprint', async ({ page }) => {
  await pricesRoute(page);
  // Timon - Snowball Swiper: the deck has LOR11-16 (no price); you own one promo DLPC1-32-P3 (R$ 7)
  const deck = { ...AMBER, cards: { ...AMBER.cards, 'LOR11-16': 2 } };
  await setup(page, { deck, coll: { ...Object.fromEntries(IDS.map((id) => [id, { n: 4, f: 0 }])), 'DLPC1-32-P3': { n: 1, f: 0 } } });
  await openBuilder(page);
  if (!(await page.getByTestId('bld-panel').isVisible())) await page.locator('[data-bpane="deck"]').click();
  await expect(page.getByTestId('bp-miss')).toHaveText('1');
  await expect(page.getByTestId('bp-val')).toHaveText(/^R\$\s7,00$/);
  await expect(page.getByTestId('bp-note')).not.toContainText('Estimativa parcial');
});

test('panel: prices that did not load say so; a complete deck says "Você tem todas"', async ({ page }) => {
  await pricesRoute(page, null);
  await setup(page, { coll: P2_COLL });
  await openBuilder(page);
  if (!(await page.getByTestId('bld-panel').isVisible())) await page.locator('[data-bpane="deck"]').click();
  await expect(page.getByTestId('bp-val')).toHaveText('preço indisponível');
  await expect(page.getByTestId('bp-count')).toHaveText('56/60');   // the rest works
  const p2 = await page.context().newPage();
  await pricesRoute(p2);
  await setup(p2, { coll: Object.fromEntries(IDS.map((id) => [id, { n: 4, f: 0 }])) });
  await openBuilder(p2);
  if (!(await p2.getByTestId('bld-panel').isVisible())) await p2.locator('[data-bpane="deck"]').click();
  await expect(p2.getByTestId('bld-panel')).toContainText('Você tem todas');
  await expect(p2.getByTestId('bp-val')).toHaveCount(0);
});

test('panel: no request beyond the deck saves while building (prices and collection are the ones loaded)', async ({ page }) => {
  await pricesRoute(page);
  await setup(page, { coll: P2_COLL });
  await openBuilder(page);
  await page.locator('#addQ').fill('gurgi apple');   // (the search's own ability index loads here, Fase 1 — before we count)
  await expect(tile(page, 'Gurgi')).toHaveCount(1);
  await page.waitForTimeout(500);
  const seen = [];
  page.on('request', (r) => { const u = r.url(); if (/\/rest\/v1\/|\/data\/.*\.json|\/functions\//.test(u)) seen.push(u.replace(/^.*?(\/rest\/v1\/|\/data\/|\/functions\/)/, '$1')); });
  const g = tile(page, 'Gurgi');
  for (let i = 0; i < 5; i++) { await g.locator('[data-bq$=":-1"]').click(); await g.locator('[data-bq$=":1"]').click(); }
  await page.waitForTimeout(1200);
  expect(seen.filter((u) => u !== '/rest/v1/rpc/save_deck')).toEqual([]);
});

for (const w of [320, 360, 390, 430]) {
  test(`phone ${w}px: one 28 px line under the tabs, readable, nothing cut; the grid keeps two columns`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await pricesRoute(page);
    await setup(page, { coll: P2_COLL });
    await openBuilder(page);
    const line = page.getByTestId('bld-sum');
    await expect(line).toBeVisible();
    const box = await line.boundingBox();
    expect(Math.round(box.height)).toBeLessThanOrEqual(28);
    const cut = await page.$$eval('[data-testid="bld-sum"] button', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth).map((e) => e.textContent));
    expect(cut).toEqual([]);
    expect(await page.$$eval('[data-testid="bld-sum"] button', (els) => Math.min(...els.map((e) => parseFloat(getComputedStyle(e).fontSize))))).toBeGreaterThanOrEqual(12);
    await expect(page.getByTestId('bs-val')).toContainText(/R\$\s42,00 \+2/);   // cents below R$ 100
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const xs = await page.$$eval('[data-testid="bt"]', (els) => [...new Set(els.slice(0, 6).map((e) => Math.round(e.getBoundingClientRect().left)))]);
    expect(xs.length).toBe(2);
    // the + and − still work right under it
    await page.locator('#addQ').fill('gurgi apple');
    await tile(page, 'Gurgi').locator('[data-bq$=":-1"]').click();
    await expect(page.locator('[data-bpane="deck"]')).toContainText('55/60');
    await expect(page.getByTestId('bs-open')).toContainText('55/60');
  });
}

test('phone: tapping the value opens Faltando; the rest of the line opens the summary sheet, which closes back to the line', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pricesRoute(page);
  await setup(page, { coll: P2_COLL });
  await openBuilder(page);
  const open = page.getByTestId('bs-open');
  await expect(open).toHaveAttribute('aria-label', /^Resumo do deck: 56 de 60 cartas, \d+ tintáveis, faltam 6, R\$\s42,00 \+ 2 sem preço, estimativa parcial$/);
  await open.click();
  const sheet = page.locator('#sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Resumo do deck' })).toBeVisible();
  await expect(sheet.getByTestId('bp-count')).toHaveText('56/60');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await sheet.getByTestId('sheet-miss').click();
  await expect(page).toHaveURL(/tab=missing/);
  await expect(page.getByRole('tab', { name: /Faltando/ })).toHaveAttribute('aria-selected', 'true');
  // and from the line's value directly
  await page.getByRole('button', { name: 'Editar lista' }).click();
  await page.getByTestId('bs-val').click();
  await expect(page).toHaveURL(/tab=missing/);
});

test('desktop: the panel sits atop the deck column; its value opens Faltando', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await pricesRoute(page);
  await setup(page, { coll: P2_COLL });
  await openBuilder(page);
  await expect(page.getByTestId('bld-sum')).toBeHidden();
  await expect(page.getByTestId('bld-panel')).toBeVisible();
  await page.getByTestId('bp-val').click();
  await expect(page).toHaveURL(/tab=missing/);
});

test('phone with the keyboard open: the search stays in view and uncovered; the fixed bar stays small', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 400 });   // about what is left above an on-screen keyboard
  await pricesRoute(page);
  await setup(page, { coll: P2_COLL });
  await openBuilder(page);
  await page.locator('#addQ').focus();
  await page.locator('#addQ').scrollIntoViewIfNeeded();
  const bar = await page.locator('.bld-bar').boundingBox(), q = await page.locator('#addQ').boundingBox();
  expect(bar.height).toBeLessThanOrEqual(96);
  expect(q.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);   // not under the sticky bar
  expect(q.y + q.height).toBeLessThanOrEqual(400);
  await page.locator('#addQ').fill('gurgi');
  await expect(page.getByTestId('bs-open')).toBeVisible();
});

test('contrast of the compact line: at least 4.5:1 in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pricesRoute(page);
  await setup(page, { coll: P2_COLL });
  for (const theme of ['dia', 'noite']) {
    await page.addInitScript((t) => { try { localStorage.setItem('inkwell-theme', t); } catch {} document.documentElement.dataset.theme = t; }, theme);
    await openBuilder(page);
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    const ratios = await page.$$eval('[data-testid="bld-sum"] b, [data-testid="bld-sum"] span, [data-testid="bs-val"]', (els) => {
      const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number), lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return rgb(c); } return [255, 255, 255]; };
      return els.filter((e) => e.textContent.trim()).map((e) => { const a = lum(rgb(getComputedStyle(e).color)), b = lum(bgOf(e)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); });
    });
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  }
});
