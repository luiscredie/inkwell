// Decks page (/decks/) against a fake Supabase.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/decks.spec.mjs
import { test, expect } from '@playwright/test';

const BASE = new URL('decks/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';
const FRIEND = '22222222-2222-4222-8222-222222222222';
const SELLER = '33333333-3333-4333-8333-333333333333';
const IDS = ['LOR10-1', 'LOR10-10', 'LOR10-11', 'LOR10-12', 'LOR10-13', 'LOR10-14', 'LOR10-15', 'LOR10-16',
  'LOR10-17', 'LOR10-18', 'LOR10-2', 'LOR10-21', 'LOR10-22', 'LOR10-23', 'LOR10-26'];

function fixtures() {
  const cards = Object.fromEntries(IDS.map((id) => [id, 4]));
  const collection = Object.fromEntries(IDS.map((id) => [id, { n: id === 'LOR10-1' ? 2 : 4, f: 0 }]));
  return {
    profiles: [{ profile: 'luiscredie', updated_at: '2026-10-20T10:00:00Z', collection,
      decks: [{ id: 'deck-a', name: 'Amber Test', format: 'core', colors: ['Amber'], cards, created_at: '2026-10-01', targetCopies: 1 }] }],
    listings: [
      { id: 'l1', user_id: FRIEND, kind: 'lend', card_id: 'LOR10-1', qty: 1, foil: false, price_brl: null },
      { id: 'l2', user_id: SELLER, kind: 'sell', card_id: 'LOR10-1', qty: 2, foil: false, price_brl: 12.5 },
    ],
    friendships: [{ requester: ME, addressee: FRIEND, status: 'accepted' }],
    names: [{ user_id: FRIEND, display_name: 'Ana Souza' }, { user_id: SELLER, display_name: 'Bruno Lima' }],
    games: [{ game_id: 'duels-1', played_at: '2026-10-19T20:00:00Z',
      summary: { result: 'win', my_lore: 20, opp_lore: 14, opp_inks: 'Ruby/Sapphire', went_first: true },
      players: [{ is_me: true, deck: { list: IDS.map((card_id) => ({ card_id, qty: 4 })) } }, { is_me: false }] }],
  };
}

async function setup(page, { signedIn = true, extraDecks = [] } = {}) {
  const db = fixtures();
  db.profiles[0].decks.push(...extraDecks);
  const calls = [];
  await page.addInitScript(([signed, me]) => {
    localStorage.setItem('inkwell-lang', 'pt');
    if (signed) {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
    } else localStorage.removeItem('inkwell-counter-auth');
  }, [signedIn, ME]);
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace(/.*\/rest\/v1\//, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path, body });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles') return json(db.profiles);
    if (path === 'listings' && req.method() === 'POST') return json(body.map((r, i) => ({ id: 'new' + i, ...r })));
    if (path === 'listings') return json(db.listings);
    if (path === 'friendships') return json(db.friendships);
    if (path === 'profiles') return json(url.search.includes(ME) ? [{ user_id: ME, display_name: 'Luis' }] : db.names);
    if (path === 'game_logs') return json(db.games);
    if (path === 'rpc/save_deck') return json({ ...body.p_deck, updated_at: '2026-10-21T10:00:00Z' });
    if (path === 'rpc/delete_deck') return route.fulfill({ status: 204, body: '' });
    if (path === 'rpc/my_duels_sync') return json(null);
    return json([]);
  });
  return calls;
}
const saves = (calls) => calls.filter((c) => c.path === 'rpc/save_deck');

test('signed out: the page offers the one sign-in', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto(BASE);
  await expect(page.getByRole('button', { name: 'Entrar' }).last()).toBeVisible();
  await expect(page.locator('.appbar a[data-iw="decks"]')).toHaveAttribute('aria-current', 'page');
});

test('list shows readiness, games and what is missing', async ({ page }) => {
  await setup(page);
  await page.goto(BASE);
  const row = page.locator('[data-deck="deck-a"]');
  await expect(row).toContainText('Amber Test');
  await expect(row).toContainText('60/60 cartas');
  await expect(row).toContainText('97% na coleção');
  await expect(row).toContainText('1 jogo');
  await expect(row).toContainText('100%');
  await expect(row).toContainText('faltam');
  await expect(row.locator('.trail .tag')).toContainText(/^faltam 2 cartas · R\$/);
  await expect(page.locator('#sub')).toContainText('1 deck');
});

test('deck detail: list, analysis, missing with friends and board, games', async ({ page }) => {
  await setup(page);
  await page.goto(BASE + '?deck=deck-a');
  await expect(page.locator('h1')).toHaveText('Amber Test');
  await expect(page.locator('[data-testid="deck-stats"]')).toContainText('60/60');
  await expect(page.locator('.dl-row').first()).toBeVisible();
  await expect(page.locator('.dl-row', { hasText: 'Baloo' })).toContainText('falta 2');
  const img = page.locator('.dl-row', { hasText: 'Baloo' }).locator('.thumb img');   // each card in the list shows its picture
  await expect(img).toHaveAttribute('src', /lorcana-card-images\//);
  expect(await page.locator('.dl-row .thumb').first().evaluate((e) => e.getBoundingClientRect().width)).toBeLessThan(40);

  await page.getByRole('tab', { name: 'Análise' }).click();
  await expect(page).toHaveURL(/tab=analysis/);
  await expect(page.locator('[data-testid="curve"] .bars > div')).toHaveCount(8);
  await expect(page.locator('[data-testid="inkable"]')).toContainText('de 60');
  await expect(page.locator('[data-testid="health"]')).toContainText('Todas as cartas valem no formato Core.');

  await page.getByRole('tab', { name: /Faltando/ }).click();
  await expect(page.locator('[data-testid="missing-summary"]')).toContainText('2 cartas faltando');
  await expect(page.locator('[data-testid="missing-summary"]')).toContainText('1 pode vir de amigos');
  const miss = page.locator('[data-miss="LOR10-1"]');
  await expect(miss).toContainText('Ana Souza empresta');
  await expect(miss).toContainText('Bruno Lima vende no Mural');
  await expect(miss.getByRole('link', { name: 'Pedir emprestado' })).toHaveAttribute('href', /trades\/\?tab=board&q=Baloo/);

  await page.getByRole('tab', { name: 'Jogos' }).click();
  await expect(page.locator('[data-testid="games-stats"]')).toContainText('100%');
  const g = page.locator('.game-row').first();
  await expect(g).toContainText('vs Ruby/Sapphire');
  await expect(g).toContainText('20–14');
  await expect(g).toHaveAttribute('href', /coach\/\?player=.*&game=duels-1/);

  await page.locator('#back').click();
  await expect(page.locator('[data-deck="deck-a"]')).toBeVisible();
});

test('edit list: change a quantity, block an illegal add, undo', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(BASE + '?deck=deck-a');
  await page.getByRole('button', { name: 'Editar lista' }).click();
  await page.getByRole('button', { name: 'Tirar uma · Gurgi' }).click();
  await expect.poll(() => saves(calls).length).toBe(1);
  expect(saves(calls)[0].body.p_deck.cards['LOR10-10']).toBe(3);
  await expect(page.locator('[data-testid="deck-stats"]')).toContainText('59/60');
  await page.locator('#addQ').fill('ariel on human');
  await expect(page.locator('#addRes')).toContainText(/Fora do Core|Limite de cópias|Outra tinta/);
  await page.locator('#addQ').fill('gurgi');
  await page.locator('#addRes [data-add]').first().click();
  await expect.poll(() => saves(calls).length).toBe(2);
  expect(saves(calls)[1].body.p_deck.cards['LOR10-10']).toBe(4);
  await page.locator('#undo').click();
  await expect.poll(() => saves(calls).length).toBe(3);
  expect(saves(calls)[2].body.p_deck.cards['LOR10-10']).toBe(3);
});

test('new deck and import', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(BASE);
  await page.locator('#new').click();
  await page.locator('#fName').fill('Meu deck novo');
  await page.locator('[data-ink-pick="Ruby"]').click();
  await page.locator('#fSave').click();
  await expect.poll(() => saves(calls).length).toBe(1);
  expect(saves(calls)[0].body.p_deck).toMatchObject({ name: 'Meu deck novo', format: 'core', colors: ['Ruby'] });
  await expect(page).toHaveURL(/deck=deck-/);
  await expect(page.locator('#addQ')).toBeVisible();

  await page.locator('#back').click();
  await page.locator('#import').click();
  await page.locator('#iName').fill('Colado');
  await page.locator('#iText').fill('4 Gurgi - Apple Lover\n2x Baloo - Friend and Guardian\n3 Not A Real Card');
  await expect(page.locator('#iInfo')).toContainText('6 cartas reconhecidas');
  await expect(page.locator('#iInfo')).toContainText('Not A Real Card');
  await page.locator('#iSave').click();
  await expect.poll(() => saves(calls).length).toBe(2);
  expect(saves(calls)[1].body.p_deck).toMatchObject({ name: 'Colado', cards: { 'LOR10-10': 4, 'LOR10-1': 2 }, colors: ['Amber'] });
  await expect(page.locator('h1')).toHaveText('Colado');
});

test('delete asks for a second tap', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(BASE + '?deck=deck-a');
  await page.locator('#more').click();
  await page.locator('#mDelete').click();
  await expect(page.locator('#mDelete')).toContainText('Toque de novo');
  expect(calls.some((c) => c.path === 'rpc/delete_deck')).toBe(false);
  await page.locator('#mDelete').click();
  await expect.poll(() => calls.filter((c) => c.path === 'rpc/delete_deck').length).toBe(1);
  await expect(page.locator('.empty')).toContainText('Nenhum deck ainda');
});

test('advisor: shared cards, buying plan, priority and copies', async ({ page }) => {
  const twin = { id: 'deck-b', name: 'Twin', format: 'core', colors: ['Amber'], cards: Object.fromEntries(IDS.slice(1).map((id) => [id, 4])), created_at: '2026-10-02' };
  const calls = await setup(page, { extraDecks: [twin] });
  await page.goto(BASE);
  await expect(page.locator('[data-testid="plan-notice"]')).toContainText('1 das 2');
  await page.locator('#planNotice').click();
  await expect(page).toHaveURL(/view=plan/);
  await expect(page.locator('[data-testid="plan-stats"]')).toContainText('1/2');
  await expect(page.locator('[data-testid="buy-list"]')).toContainText('Gurgi');
  await expect(page.locator('[data-testid="conflicts"]')).toContainText('você tem 4 · os decks pedem 8');
  await page.locator('[data-prio="deck-a"]').click();
  await expect(page.locator('[data-prio="deck-a"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => saves(calls).length).toBe(1);
  expect(saves(calls)[0].body.p_deck).toEqual({ id: 'deck-a', name: 'Amber Test', targetCopies: 1, portfolioPriority: 1 });

  await page.goto(BASE + '?deck=deck-b&tab=plan');
  await expect(page.locator('[data-testid="plan-status"]')).toContainText('Montável junto com os outros');
  await expect(page.locator('[data-testid="plan-shared"]')).toContainText('Amber Test');
  await page.getByRole('button', { name: 'Pôr uma cópia' }).click();
  await expect(page.locator('[data-testid="target"]')).toHaveText('2');
  await expect.poll(() => saves(calls).length).toBe(2);
  expect(saves(calls)[1].body.p_deck).toMatchObject({ id: 'deck-b', targetCopies: 2 });
});

test('a list under 60 says how many cards it is short, not that cards are missing', async ({ page }) => {
  const cards = Object.fromEntries(IDS.map((id) => [id, 4])); cards['LOR10-26'] = 3;   // 59 cards
  await setup(page, { extraDecks: [{ id: 'deck-59', name: 'Short List', format: 'core', colors: ['Amber'], cards, created_at: '2026-10-02' }] });
  await page.goto(BASE);
  const row = page.locator('[data-deck="deck-59"]');
  await expect(row).toContainText('59/60');
  await expect(row.locator('.tag.warn')).toHaveText('lista: falta 1 carta');
  await expect(row).toContainText('faltam 2 na coleção');   // LOR10-1: 4 in the list, 2 in the collection
});

test('meta: automatic from the newest set, chosen on the deck page, filter on the list', async ({ page }) => {
  const s13 = { 'LOR13-12': 4, 'LOR13-8': 4, 'LOR10-1': 4 };   // newest set: 13
  const calls = await setup(page, { extraDecks: [{ id: 'deck-13', name: 'Set 13 Deck', format: 'core', colors: ['Amber'], cards: s13, created_at: '2026-10-03' }] });
  await page.goto(BASE);
  await expect(page.locator('[data-deck="deck-a"]')).toContainText('Set 10');
  await expect(page.locator('[data-deck="deck-a"] [data-testid="meta-tag"]')).toHaveText('(Set 10)');
  await expect(page.locator('[data-deck="deck-13"]')).toContainText('Set 13');
  await page.locator('#metaF').selectOption('LOR13');
  await expect(page.locator('[data-deck]')).toHaveCount(1);
  await expect(page.locator('[data-deck="deck-13"]')).toBeVisible();
  await page.locator('#metaF').selectOption('all');
  // choose Set 14 for the Amber deck on its page
  await page.locator('[data-deck="deck-a"]').click();
  await expect(page.locator('#metaSel')).toHaveValue('');
  await expect(page.locator('#metaSel option').first()).toHaveText('Automático (Set 10)');
  await page.locator('#metaSel').selectOption('LOR14');
  await expect.poll(() => saves(calls).map((c) => c.body.p_deck)).toContainEqual({ id: 'deck-a', name: 'Amber Test', meta: 'LOR14' });
  await page.goto(BASE);
  await expect(page.locator('[data-deck="deck-a"]')).toContainText('Set 14');   // kept on this device too
});

test('import a list into an existing deck: replaces the cards, Desfazer brings them back', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(BASE + '?deck=deck-a');
  await page.locator('#more').click();
  await page.locator('#mImport').click();
  await expect(page.locator('[data-testid="import-replaces"]')).toContainText('Amber Test');
  await page.locator('#iText').fill('4 Gurgi - Apple Lover\n4 Pocahontas - Guiding the Tribe');
  await page.locator('#iSave').click();
  await expect.poll(() => saves(calls).at(-1)?.body.p_deck.cards).toEqual({ 'LOR10-10': 4, 'LOR13-12': 4 });
  await expect(page.locator('[data-testid="deck-stats"]')).toContainText('8');
  await page.locator('#toast #undo').click();
  await expect.poll(() => Object.keys(saves(calls).at(-1)?.body.p_deck.cards || {}).length).toBe(15);
});

test('import recognises names with special dashes and apostrophes in the catalog', async ({ page }) => {
  await setup(page);
  await page.goto(BASE);
  await page.locator('#import').click();
  await page.locator('#iText').fill(["4 Mrs. Incredible - Super Stretchy", "2 Jack-Jack Parr - Incredible Potential", "1 Ariel's Grotto - A Secret Place",
    "1 I Find 'Em, I Flatten 'Em", "2 Daisy Duck - Trendy Traveler", "1 Wind-Up Frog - Sid's Toy"].join("\n"));
  await expect(page.locator('#iInfo')).toHaveText('11 cartas reconhecidas');
});

// ---------- trying a list without an account ----------
const LIST = '4 Elsa - Snow Queen\n4 Stitch - Rock Star\n2 Elza Snow Quen';
async function publicSetup(page, prices) {
  const calls = await setup(page, { signedIn: false });
  if (prices) await page.route('**/data/prices.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prices) }));
  return calls;
}

test('signed out: paste a list and see the cards, the rules used and the price', async ({ page }) => {
  const calls = await publicSetup(page);
  await page.goto(BASE);
  await page.getByTestId('public-text').fill(LIST);
  await expect(page.getByTestId('public-summary')).toContainText('8/60');
  await expect(page.getByTestId('public-legal')).toContainText('ainda não é legal');
  await expect(page.getByTestId('public-rules')).toContainText('Validado no formato Core: sets 9, 10, 11, 12, 13, 14');
  await expect(page.getByTestId('public-issues')).toContainText('faltam 52 cartas');
  await expect(page.getByTestId('public-list').locator('.pd-row')).toHaveCount(2);
  await expect(page.getByTestId('public-prices')).toContainText('TCGplayer');
  await page.getByRole('button', { name: 'Infinito' }).click();
  await expect(page.getByTestId('public-rules')).toContainText('Infinity: todos os sets');
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);   // nothing is saved without an account
});

test('signed out: a line not recognised can be fixed by picking the card', async ({ page }) => {
  await publicSetup(page);
  await page.goto(BASE);
  await page.getByTestId('public-text').fill(LIST);
  const fix = page.getByTestId('public-fixes');
  await expect(fix).toContainText('2 Elza Snow Quen');
  await fix.getByRole('button', { name: 'Elsa - Snow Queen' }).click();
  await expect(page.getByTestId('public-fixes')).toHaveCount(0);
  await expect(page.getByTestId('public-text')).toHaveValue(/2 Elsa - Snow Queen/);
  await expect(page.getByTestId('public-summary')).toContainText('10/60');
});

test('signed out: a card with no price is "sem preço", left out of the total, never R$ 0', async ({ page }) => {
  await publicSetup(page, { generated_at: '2026-10-25T00:00:00Z', currency: 'BRL', prices: { 'LOR9-3': { n: 3, nl: 3 } } });
  await page.goto(BASE);
  await page.getByTestId('public-text').fill('4 Stitch - Rock Star\n4 Elsa - Snow Queen');
  await expect(page.getByTestId('public-total')).toHaveText('R$ 12,00');
  await expect(page.getByTestId('public-summary')).toContainText('4 de 8 cartas com preço');
  await expect(page.getByTestId('no-price')).toHaveCount(1);
});

test('the list stays through a reload and sign-up, then becomes a deck only when asked', async ({ page }) => {
  await publicSetup(page);
  await page.goto(BASE);
  await page.getByTestId('public-text').fill('4 Stitch - Rock Star');
  await page.reload();
  await expect(page.getByTestId('public-text')).toHaveValue('4 Stitch - Rock Star');
  await page.getByTestId('public-save').click();
  await expect(page.locator('#iwSignSheet')).toBeVisible();
  // signed in now (same browser): the list is offered, not saved by itself
  const calls = await setup(page);
  await page.addInitScript((me) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me } }));
  }, ME);
  await page.goto(BASE);
  await expect(page.getByTestId('pending-deck')).toContainText('4 cartas');
  expect(saves(calls)).toHaveLength(0);
  await page.getByRole('button', { name: 'Salvar como deck' }).click();
  await page.locator('#iSave').click();
  await expect.poll(() => saves(calls).length).toBe(1);
  expect(Object.values(saves(calls)[0].body.p_deck.cards)).toEqual([4]);
  await expect(page.getByTestId('pending-deck')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('inkwell-public-deck-v1'))).toBeNull();
});

test('a list older than a day is gone', async ({ page }) => {
  await publicSetup(page);
  await page.addInitScript(() => localStorage.setItem('inkwell-public-deck-v1', JSON.stringify({ v: 1, text: '4 Stitch - Rock Star', format: 'core', at: Date.now() - 2 * 864e5 })));
  await page.goto(BASE);
  await expect(page.getByTestId('public-text')).toHaveValue('');
});
