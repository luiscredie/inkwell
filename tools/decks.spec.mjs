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
  // buying is always offered, after friends and the board: Liga Lorcana (Brazil) and TCGplayer, in a new tab
  const buy = miss.getByTestId('buy-links');
  await expect(buy).toContainText('Comprar');
  await expect(buy.getByTestId('buy-liga')).toHaveAttribute('href', /^https:\/\/www\.ligalorcana\.com\.br\/\?view=cards%2Fcard&card=Baloo/);
  await expect(buy.getByTestId('buy-tcg')).toHaveAttribute('href', /^https:\/\/www\.tcgplayer\.com\/search\/lorcana\/product\?.*q=Baloo/);
  await expect(buy.getByTestId('buy-liga')).toHaveAttribute('target', '_blank');
  await expect(buy.getByTestId('buy-liga')).toHaveAttribute('rel', /noopener/);
  expect(await page.locator('[data-testid="buy-links"]').count()).toBe(await page.locator('[data-miss]').count());   // one per missing card

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
  await expect(page.locator('[data-deck="deck-a"] [data-testid="meta-tag"]')).toHaveCSS('background-color', 'rgb(40, 84, 106)');   // #28546A
  await expect(page.locator('[data-deck="deck-13"] [data-testid="meta-tag"]')).toHaveCSS('color', 'rgb(28, 20, 4)');   // light green: dark text
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
async function publicSetup(page, prices, br) {
  const calls = await setup(page, { signedIn: false });
  if (prices) await page.route('**/data/prices.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prices) }));
  if (br) await page.addInitScript(() => { window.INKWELL_PRICES_BR = true; });   // MYP Cards is off by default (cloud.js)
  if (prices || br) await page.route('**/data/prices-br.json', (r) => (br ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(br) }) : r.fulfill({ status: 404, body: '' })));
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
  // "Criar conta e salvar" was pressed before: the save opens by itself, and still waits for the person
  await expect(page.locator('#iSave')).toBeVisible();
  expect(saves(calls)).toHaveLength(0);
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

test('a collection shared with me counts, and a friend who lends from their collection can be asked', async ({ page }) => {
  await setup(page);
  const posts = [];
  await page.route('**/rest/v1/rpc/shared_collections', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ owner: SELLER, owner_name: 'Bruno', profile: 'principal', can_edit: true, collection: { 'LOR10-1': { n: 1, f: 0 } }, home: [] }]) }));
  await page.route('**/rest/v1/rpc/friends_lending', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ user: FRIEND, name: 'Ana Souza', handle: 'ana', card_id: 'LOR10-1', free: 3 }]) }));
  await page.route('**/rest/v1/user_loans', (r) => { posts.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 201, body: '' }); });
  await page.goto(BASE + '?deck=deck-a&tab=missing');
  await expect(page.locator('[data-testid="missing-summary"]')).toContainText('1 carta faltando');   // 2 mine + 1 shared of 4
  await expect(page.locator('[data-testid="friend-has"]')).toContainText('Ana Souza tem');
  await page.locator('[data-borrow]').click();
  await expect(page.locator('[data-testid="friend-has"]')).toContainText('Pedido enviado');
  expect(posts[0]).toEqual({ lender: FRIEND, borrower: ME, created_by: ME, items: [{ card_id: 'LOR10-1', qty: 1, foil: false }], note: 'Para o deck Amber Test' });
});

test('a friend whose collection is only visible (no lending) shows up and can be asked — they decide', async ({ page }) => {
  await setup(page);
  const posts = [];
  await page.route('**/rest/v1/rpc/friends_lending', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ user: FRIEND, name: 'Ana Souza', handle: 'ana', card_id: 'LOR10-1', free: 2, lend: false }]) }));
  await page.route('**/rest/v1/user_loans', (r) => { posts.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 201, body: '' }); });
  await page.goto(BASE + '?deck=deck-a&tab=missing');
  const row = page.locator('[data-testid="friend-has"]');
  await expect(row).toContainText('Ana Souza tem');
  await expect(row).toContainText('2 na coleção · a pessoa decide se empresta');
  await expect(page.locator('[data-testid="missing-summary"]')).toContainText('1 pode vir de amigos');   // only the board offer counts; Ana wasn't promised
  await page.locator('[data-borrow]').click();
  await expect(row).toContainText('Pedido enviado');
  expect(posts[0]).toMatchObject({ lender: FRIEND, borrower: ME, items: [{ card_id: 'LOR10-1', qty: 2, foil: false }] });
});

test('a deck can be shown on the public profile', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(BASE);
  await page.locator('#new').click();
  await page.locator('#fName').fill('Vitrine');
  await expect(page.locator('#fPub')).not.toBeChecked();
  await page.locator('#fPub').check();
  await page.locator('#fSave').click();
  await expect.poll(() => saves(calls).length).toBe(1);
  expect(saves(calls)[0].body.p_deck).toMatchObject({ name: 'Vitrine', public: true });
  await page.locator('#back').click();
  await expect(page.locator('.deck-row', { hasText: 'Vitrine' }).getByTestId('deck-public')).toHaveText('público');
  await expect(page.locator('[data-testid="deck-public"]')).toHaveCount(1);   // the others never had it
  for (const c of saves(calls)) if (c.body.p_deck.name !== 'Vitrine') expect(c.body.p_deck).not.toHaveProperty('public');
});

test('signed out: the total is an estimate in reais — MYP Cards when listed there, TCGplayer otherwise', async ({ page }) => {
  await publicSetup(page, { generated_at: '2026-10-25T00:00:00Z', currency: 'BRL', usd_brl: 5.4, prices: { 'LOR9-3': { n: 3, nl: 3 }, 'LOR9-53': { n: 10, nl: 10 } } },
    { retrieved_at: '2026-10-21T17:28:47Z', product_url: 'https://mypcards.com/lorcana/produto/{path}', cards: { 'LOR9-53': [2, 'x/elsa'] } });
  await page.goto(BASE);
  await page.getByTestId('public-text').fill('4 Stitch - Rock Star\n4 Elsa - Snow Queen (9-53)');
  await expect(page.getByTestId('public-total')).toHaveText('R$ 20,00');   // 4 × 3 (TCGplayer) + 4 × 2 (MYP)
  const row = page.getByTestId('public-list').locator('.pd-row').first();
  await expect(row.getByTestId('unit')).toHaveText(/R\$\s\d/);            // the price of one card stands out
  await expect(row.getByTestId('subtotal')).toContainText('4× = R$');      // the copies' subtotal under it
  await expect(page.getByTestId('public-summary')).toContainText('estimativa');
  await expect(page.getByTestId('public-prices')).toContainText('Estimativa em reais: menor anúncio na MYP Cards');
});

test('signed out: one tap fills an example deck — 60 cards, legal in Core, marked as an example', async ({ page }) => {
  await publicSetup(page);
  await page.goto(BASE);
  await page.getByTestId('public-sample').click();
  await expect(page.getByTestId('public-summary')).toContainText('60/60');
  await expect(page.getByTestId('public-legal')).toContainText('legal');
  await expect(page.getByTestId('public-legal')).not.toContainText('ainda');
  await expect(page.getByTestId('public-fixes')).toHaveCount(0);
  await expect(page.getByTestId('public-sample-note')).toContainText('não é lista competitiva');
  await expect(page.getByTestId('public-sample')).toHaveCount(0);
});

test('physical or virtual: virtual moves nothing; physical sets the cards aside (binder first, then home) and can be taken apart', async ({ page }) => {
  const calls = await setup(page);
  // fixtures: LOR10-1 2 owned (deck wants 4), the rest 4 each; one LOR10-10 copy is at home
  await page.route('**/rest/v1/collection_home**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ profile: 'luiscredie', card_id: 'LOR10-10', n: 1, f: 0 }]) }));
  await page.route('**/rest/v1/collection_decked**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  const builds = [];
  await page.route('**/rest/v1/rpc/build_deck', (r) => { builds.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 204, body: '' }); });
  await page.goto(BASE + '?deck=deck-a');
  const box = page.locator('[data-testid="deck-build"]');
  await expect(box.locator('[data-kind="virtual"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(box.locator('[data-testid="build-state"]')).toContainText('Virtual: as cartas ficam onde estão');
  await box.locator('[data-kind="physical"]').click();
  await expect(box.locator('[data-testid="build-plan"]')).toContainText('58 cartas vão ficar separadas para este deck na minha coleção: 57 do fichário, 1 de casa.');
  await expect(box.locator('[data-testid="build-plan"]')).toContainText('2 que você não tem livres');
  expect(builds).toEqual([]);   // nothing until confirmed
  await box.locator('[data-testid="build-go"]').click();
  await expect(box.locator('[data-testid="build-state"]')).toContainText('58 cartas separadas');
  expect(builds[0]).toMatchObject({ p_owner: null, p_profile: 'luiscredie', p_deck: 'deck-a', p_name: 'Amber Test', p_from_home: [{ card_id: 'LOR10-10', qty: 1, foil: false }] });
  expect(builds[0].p_items.find((x) => x.card_id === 'LOR10-1')).toEqual({ card_id: 'LOR10-1', n: 2, f: 0 });
  expect(builds[0].p_items.reduce((t, x) => t + x.n + x.f, 0)).toBe(58);
  // back to virtual: asks, then takes it apart
  await box.locator('[data-kind="virtual"]').click();
  await expect(box).toContainText('As 58 cartas voltam para o fichário');
  await box.locator('[data-testid="unbuild-go"]').click();
  await expect(box.locator('[data-kind="virtual"]')).toHaveAttribute('aria-pressed', 'true');
  expect(builds[1]).toMatchObject({ p_deck: 'deck-a', p_items: [], p_from_home: [] });
  expect(calls.length).toBeGreaterThan(0);
});

test('deleting a physical deck puts its cards back in the binder first', async ({ page }) => {
  const calls = await setup(page);
  await page.route('**/rest/v1/collection_decked**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { profile: 'luiscredie', deck_id: 'deck-a', deck_name: 'Amber Test', card_id: 'LOR10-10', n: 4, f: 0 }, { profile: 'luiscredie', deck_id: 'deck-a', deck_name: 'Amber Test', card_id: 'LOR10-11', n: 3, f: 1 }]) }));
  const order = [];
  await page.route('**/rest/v1/rpc/build_deck', (r) => { order.push(['build', JSON.parse(r.request().postData())]); return r.fulfill({ status: 204, body: '' }); });
  await page.route('**/rest/v1/rpc/delete_deck', (r) => { order.push(['delete']); return r.fulfill({ status: 204, body: '' }); });
  await page.goto(BASE + '?deck=deck-a');
  await expect(page.locator('[data-testid="build-state"]')).toContainText('8 cartas separadas');
  await page.locator('#more').click();
  await page.locator('#mDelete').click();
  await expect(page.locator('#mDelete')).toContainText('devolver as 8 cartas ao fichário');
  await page.locator('#mDelete').click();
  await expect(page.locator('#toast')).toContainText('As 8 cartas voltaram para o fichário');
  expect(order.map((x) => x[0])).toEqual(['build', 'delete']);   // taken apart before deleting
  expect(order[0][1]).toMatchObject({ p_owner: null, p_profile: 'luiscredie', p_deck: 'deck-a', p_items: [], p_from_home: [] });
  expect(calls.length).toBeGreaterThan(0);
});

test('a list kept without pressing "save" is offered after sign-in, but nothing opens by itself', async ({ page }) => {
  await publicSetup(page);
  await page.goto(BASE);
  await page.getByTestId('public-text').fill('4 Stitch - Rock Star');
  const calls = await setup(page);
  await page.addInitScript((me) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me } }));
  }, ME);
  await page.goto(BASE);
  await expect(page.getByTestId('pending-deck')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('#iSave')).toHaveCount(0);
  expect(saves(calls)).toHaveLength(0);
});

test('MYP Cards is off by default: TCGplayer only, prices-br.json is not even asked for', async ({ page }) => {
  const asked = [];
  page.on('request', (r) => { if (r.url().includes('prices-br.json')) asked.push(r.url()); });
  await publicSetup(page);
  await page.goto(BASE);
  await page.getByTestId('public-sample').click();
  await expect(page.getByTestId('public-prices')).not.toContainText('MYP');
  expect(asked).toEqual([]);
});

test('tap a card in a deck: it opens large, with your copies of that printing; add one and save to the collection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await setup(page);
  await page.route('**/rest/v1/rpc/apply_collection_delta', (r) => { calls.push({ path: 'rpc/apply_collection_delta', body: JSON.parse(r.request().postData()) }); return r.fulfill({ status: 204, body: '' }); });
  await page.goto(BASE + '?deck=deck-a&tab=missing');
  await expect(page.locator('[data-testid="missing-summary"]')).toContainText('2 cartas faltando');
  await page.locator('[data-miss="LOR10-1"] .thumb').click();
  const z = page.locator('#iwZoom');
  await expect(z).toBeVisible();
  const box = z.getByTestId('zoom-collection');
  await expect(box).toContainText('Na sua coleção “luiscredie” · esta arte');
  await expect(box.getByTestId('zx-n')).toHaveText('2');
  await expect(box.getByTestId('zx-f')).toHaveText('0');
  await expect(box).toContainText('No deck: 4');
  await expect(box.locator('[data-zx-save]')).toBeDisabled();
  await box.locator('[data-zx="n:1"]').click();                 // taps inside don't close the card
  await box.locator('[data-zx="f:1"]').click();
  await expect(z).toBeVisible();
  await expect(box.getByTestId('zx-n')).toHaveText('3');
  await box.locator('[data-zx-save]').click();
  await expect(z).toBeHidden();
  expect(calls.filter((c) => c.path === 'rpc/apply_collection_delta').map((c) => c.body)).toEqual([{ p_profile: 'luiscredie', p_delta: [{ card_id: 'LOR10-1', qty: 1, foil: false }, { card_id: 'LOR10-1', qty: 1, foil: true }] }]);
  await expect(page.locator('[data-miss="LOR10-1"]')).toHaveCount(0);   // 3 normal + 1 foil = the 4 the deck needs
  // the picture has its size before it loads (it used to open small on iPhone)
  await page.goto(BASE + '?deck=deck-a');
  await page.locator('#tabBody .thumb').first().click();
  await expect(z).toBeVisible();
  const w = await z.locator('img').evaluate((i) => i.getBoundingClientRect().width);
  expect(w).toBeGreaterThan(250);
});

test('foil with no price of its own: "estimado com base no preço normal" in Fada Madrinha and the large card; no price: out of the totals and said', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // DLPC1-43-P3 (Ariel promo): only a normal price (R$ 380); LOR14-20 (Russell): no price at all
  await setup(page, { extraDecks: [{ id: 'deck-e', name: 'Estimado', format: 'core', colors: ['Amber'], cards: { 'DLPC1-43-P3': 2, 'LOR14-20': 1, 'LOR10-1': 4 }, created_at: '2026-10-01' }] });
  await page.goto(BASE + '?deck=deck-e&tab=gala');
  const grid = page.getByTestId('gala-grid');
  await expect(grid.locator('[data-gala="DLPC1-43-P3"]')).toContainText('R$ 380,00 cada estimado com base no preço normal');
  await expect(grid.locator('[data-gala="LOR14-20"]')).toContainText('sem preço');
  await expect(grid.locator('[data-testid="gala-est"]')).toHaveCount(1);                 // only the card at the normal price
  await expect(page.getByTestId('gala-price-notes')).toHaveText('2 cópias foil com preço estimado (com base no preço normal) · 1 cópia sem preço, fora dos totais');
  // the large card: the foil line says it is the normal price
  await page.goto(BASE + '?deck=deck-e');
  await page.locator('#tabBody .thumb[data-card="DLPC1-43-P3"]').first().click();
  const box = page.locator('#iwZoom').getByTestId('zoom-collection');
  await expect(box.getByTestId('zx-price')).toContainText('R$ 380,00 normal · R$ 380,00 foil estimado com base no preço normal');
  await page.keyboard.press('Escape');
  await page.locator('#tabBody .thumb[data-card="LOR10-1"]').first().click();          // a card with its own foil price: no mark
  await expect(page.locator('#iwZoom').getByTestId('zx-foil-est')).toHaveCount(0);
});

test('Fada Madrinha: each card in its rarest printing, in foil, with the cost, what you have and where to buy (partner first)', async ({ page }) => {
  await page.addInitScript(() => { window.INKWELL_PARTNER_STORE = { name: 'Loja Parceira', search: 'https://loja.example/busca?q={q}' }; });
  await setup(page, { extraDecks: [{ id: 'deck-g', name: 'Gala', format: 'core', colors: ['Amber'], cards: { 'LOR9-188': 2, 'LOR11-89': 4 }, created_at: '2026-10-01' }] });
  await page.goto(BASE + '?deck=deck-g&tab=gala');
  const grid = page.getByTestId('gala-grid');
  await expect(grid.locator('[data-gala]')).toHaveCount(2);
  await expect(grid.locator('[data-gala]').first()).toHaveAttribute('data-gala', 'LOR1-216');   // Tinker Bell: the Enchanted one
  await expect(grid.locator('[data-gala="LOR1-216"]')).toContainText('Encantada');
  await expect(grid.locator('[data-gala="LOR1-216"]')).toContainText('Você tem 0 de 2');
  await expect(grid.locator('[data-gala="DLPC1-29-P3"]')).toContainText('Promo');            // White Rabbit: the promo
  await expect(page.getByTestId('gala-summary')).toContainText('Fada Madrinha');
  const partner = grid.locator('[data-gala="LOR1-216"] [data-testid="buy-partner"]');
  await expect(partner).toHaveText(/Loja Parceira/);
  await expect(partner).toHaveAttribute('href', /^https:\/\/loja\.example\/busca\?q=Tinker%20Bell/);
  await expect(partner).toHaveAttribute('rel', /sponsored/);
  // Liga Lorcana opens that very printing (edition and number), not the plain card
  await expect(grid.locator('[data-gala="LOR1-216"] [data-testid="buy-liga"]')).toHaveAttribute('href', 'https://www.ligalorcana.com.br/?card=Tinker+Bell+-+Giant+Fairy+%28Alternate+Art%29%28216%29&ed=LOR1&num=216&view=cards%2Fcard');
  await expect(page.locator('[data-tab="gala"]')).toHaveText('✨ Fada Madrinha');
});

test('without a partner store the buy row has only Liga Lorcana and TCGplayer', async ({ page }) => {
  await setup(page);
  await page.goto(BASE + '?deck=deck-a&tab=missing');
  await expect(page.locator('[data-testid="buy-links"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="buy-partner"]')).toHaveCount(0);
});

test('Fada Madrinha: the most expensive art first; the arrows (or a swipe) show the other arts and the totals follow', async ({ page }) => {
  await setup(page, { extraDecks: [{ id: 'deck-p', name: 'Pegasus', format: 'core', colors: ['Amber'], cards: { 'LOR4-84': 4 }, created_at: '2026-10-01' }] });
  await page.goto(BASE + '?deck=deck-p&tab=gala');
  const card = page.locator('[data-gkey]').first();
  await expect(card).toHaveAttribute('data-gala', 'DLPC1-1-C2');            // the promo, R$ 405 in foil — dearer than the Epic
  await expect(card.getByTestId('gala-pos')).toHaveText(/^1\/\d+$/);
  const total1 = await page.getByTestId('gala-stats').locator('.stat').first().innerText();
  await card.locator('[data-gnav$=":1"]').click();
  await expect(page.locator('[data-gkey]').first()).not.toHaveAttribute('data-gala', 'DLPC1-1-C2');
  await expect(page.locator('[data-gkey]').first().getByTestId('gala-pos')).toHaveText(/^2\//);
  expect(await page.getByTestId('gala-stats').locator('.stat').first().innerText()).not.toBe(total1);
  await page.locator('[data-gkey]').first().locator('[data-gnav$=":-1"]').click();
  await expect(page.locator('[data-gkey]').first()).toHaveAttribute('data-gala', 'DLPC1-1-C2');
  await expect(page.locator('#iwZoom')).toBeHidden();                         // the arrows don't open the card
});

test.describe('phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('Fada Madrinha: swiping the art left shows the next one', async ({ page }) => {
    await setup(page, { extraDecks: [{ id: 'deck-p', name: 'Pegasus', format: 'core', colors: ['Amber'], cards: { 'LOR4-84': 4 }, created_at: '2026-10-01' }] });
    await page.goto(BASE + '?deck=deck-p&tab=gala');
    await expect(page.locator('[data-gkey]').first()).toHaveAttribute('data-gala', 'DLPC1-1-C2');
    await page.locator('[data-gkey] .gala-art').first().evaluate((el) => {
      const r = el.getBoundingClientRect(), y = r.top + r.height / 2;
      const t = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(r.right - 20)], changedTouches: [t(r.right - 20)], bubbles: true }));
      el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(r.left + 20)], bubbles: true, cancelable: true }));
    });
    await expect(page.locator('[data-gkey]').first().getByTestId('gala-pos')).toHaveText(/^2\//);
  });
});

// ---------- #145 P0-C: price transparency ----------
const pricesAt = (iso) => ({ generated_at: iso, usd_brl: 5.4, prices: { 'LOR10-1': { n: 2, nl: 2, f: 6, fl: 6 }, 'LOR10-10': { n: 1, nl: 1 } } });
test('prices: the deck says source, currency, date and that values are indicative', async ({ page }) => {
  await setup(page);
  await page.route('**/data/prices.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pricesAt(new Date().toISOString())) }));
  await page.goto(BASE + '?deck=deck-a');
  const note = page.getByTestId('price-note').first();
  await expect(note).toHaveAttribute('data-state', 'ok');
  await expect(note).toContainText('Valores indicativos em reais');
  await expect(note).toContainText('TCGplayer');
  await expect(note).toContainText('R$ 5,4');
  await expect(note).toContainText('atualizado em');
  await page.goto(BASE + '?deck=deck-a&tab=missing');
  await expect(page.getByTestId('price-note').first()).toHaveAttribute('data-state', 'ok');
});
test('prices: older than 3 days are flagged as out of date, the deck still works', async ({ page }) => {
  await setup(page);
  await page.route('**/data/prices.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pricesAt(new Date(Date.now() - 5 * 864e5).toISOString())) }));
  await page.goto(BASE + '?deck=deck-a');
  await expect(page.getByTestId('price-note').first()).toHaveAttribute('data-state', 'stale');
  await expect(page.getByTestId('price-note').first()).toContainText('Preços desatualizados');
  await expect(page.locator('[data-testid="deck-stats"]')).toContainText('R$');
});
test('prices: when the price file does not load, values show — (never R$ 0) and the deck, list and missing cards work', async ({ page }) => {
  await setup(page);
  await page.route('**/data/prices.json', (r) => r.fulfill({ status: 503, body: '' }));
  await page.goto(BASE + '?deck=deck-a');
  await expect(page.getByTestId('price-note').first()).toHaveAttribute('data-state', 'unavailable');
  await expect(page.getByTestId('price-note').first()).toContainText('Preços indisponíveis');
  await expect(page.locator('[data-testid="deck-stats"] .stat').nth(2)).toContainText('—');
  await expect(page.locator('[data-testid="deck-stats"]')).not.toContainText('R$ 0');
  await page.goto(BASE + '?deck=deck-a&tab=missing');
  await expect(page.locator('[data-testid="missing-summary"]')).toContainText('faltando');
  await expect(page.locator('[data-testid="missing-summary"]')).not.toContainText('R$');
});
