// Lore counter (/counter/) against a fake Supabase: decks from Inkwell, the opponent found by name.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/counter.spec.mjs
import { test, expect } from '@playwright/test';

const BASE = new URL('counter/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';
const RODRIGO = '22222222-2222-4222-8222-222222222222';

async function setup(page, { tour = false, findFails = false } = {}) {
  const calls = [];
  await page.addInitScript(([me, tour]) => {
    if (sessionStorage.getItem('t')) return; sessionStorage.setItem('t', '1');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me } }));
    localStorage.setItem('inkwell-lorecounter-v3', JSON.stringify({ lang: 'pt', players: 2, decks: true, tour, bestOf: 3 }));
  }, [ME, tour]);
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ path, body });
    const json = (v, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles') return json([{ profile: 'p', decks: [{ id: 'd1', name: 'Circle of Life', colors: ['Amber', 'Emerald'], cards: { 'LOR9-26': 4 } }] }]);
    if (path === 'rpc/friend_decks') return json([]);
    if (path === 'rpc/find_player_decks') {
      if (findFails) return json({ message: 'x' }, 404);
      return json(String(body.p_q).toLowerCase().includes('rod')
        ? [{ player: RODRIGO, name: 'Rodrigo', handle: 'veterano', avatar: null, friend: true, deck_id: 'r1', deck_name: 'Safira Aço', colors: ['Sapphire', 'Steel'] },
           { player: RODRIGO, name: 'Rodrigo', handle: 'veterano', avatar: null, friend: true, deck_id: 'r2', deck_name: 'Rubi Âmbar', colors: ['Ruby', 'Amber'] }]
        : []);
    }
    return json([]);
  });
  return calls;
}
async function newMatch(page) {
  await page.goto(BASE);
  await page.click('#menuBtn');
  await page.getByRole('button', { name: 'Nova partida' }).click();
  await page.getByRole('button', { name: 'Sim' }).click();
}

test('casual match: my Inkwell deck, then the opponent found by name, right away', async ({ page }) => {
  const calls = await setup(page);
  await newMatch(page);
  await page.getByRole('button', { name: 'Circle of Life' }).click();
  await expect(page.getByRole('heading', { name: 'O oponente usa o Inkwell?' })).toBeVisible();
  await page.getByRole('button', { name: 'Sim' }).click();
  await page.getByPlaceholder('Nome ou @usuário').fill('r');
  await expect(page.locator('#fpList')).toContainText('Digite pelo menos 2 letras');
  await page.getByPlaceholder('Nome ou @usuário').fill('rodr');
  await expect(page.locator('#fpList')).toContainText('Rodrigo · @veterano · amigo');
  await page.getByRole('button', { name: 'Safira Aço' }).click();
  await expect(page.locator('#sheet')).toBeHidden();
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('inkwell-lorecounter-v3')));
  expect(st.match.opp).toEqual({ inks: ['Sapphire', 'Steel'], name: 'Safira Aço', friend: { id: RODRIGO, name: 'Rodrigo' } });
  expect(st.color.p2).toEqual(['Sapphire', 'Steel']);
  expect(calls.filter((c) => c.path === 'rpc/find_player_decks').at(-1).body).toEqual({ p_q: 'rodr' });
});

test('opponent not on Inkwell: just the inks', async ({ page }) => {
  await setup(page);
  await newMatch(page);
  await page.getByRole('button', { name: 'Circle of Life' }).click();
  await page.getByRole('button', { name: 'Não' }).click();
  await expect(page.getByRole('heading', { name: 'Deck do oponente' })).toBeVisible();
  await page.locator('#dk [data-ink="Ruby"]').click();
  await page.getByRole('button', { name: 'Salvar' }).click();
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('inkwell-lorecounter-v3')));
  expect(st.match.opp.inks).toEqual(['Ruby']);
});

test('search unavailable: says so and the inks still work', async ({ page }) => {
  await setup(page, { findFails: true });
  await newMatch(page);
  await page.getByRole('button', { name: 'Circle of Life' }).click();
  await page.getByRole('button', { name: 'Sim' }).click();
  await page.getByPlaceholder('Nome ou @usuário').fill('rodr');
  await expect(page.locator('#fpList')).toContainText('A busca não está disponível agora');
  await page.getByRole('button', { name: 'Escolher as tintas' }).click();
  await expect(page.getByRole('heading', { name: 'Deck do oponente' })).toBeVisible();
});

test('tournament mode: no opponent question at the start', async ({ page }) => {
  await setup(page, { tour: true });
  await newMatch(page);
  await page.getByRole('button', { name: 'Circle of Life' }).click();
  await expect(page.locator('#sheet')).toBeHidden();
});

test('meta deck library: filtered by the inks chosen, picks name and inks', async ({ page }) => {
  await setup(page);
  await newMatch(page);
  await page.getByRole('button', { name: 'Circle of Life' }).click();
  await page.getByRole('button', { name: 'Não' }).click();
  await expect(page.locator('#metaGrp')).toContainText('Decks do meta');
  await page.locator('#dk [data-ink="Steel"]').click();
  await expect(page.locator('#metaGrp')).toContainText('Steelsong');
  await expect(page.locator('#metaGrp')).not.toContainText('Circle');
  await page.locator('#metaGrp').getByRole('button', { name: 'Steelsong' }).click();
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('inkwell-lorecounter-v3')));
  expect(st.match.opp).toEqual({ inks: ['Amber', 'Steel'], name: 'Steelsong' });
});

async function winGame(page) {
  const bx = await page.locator('#h1').boundingBox();
  for (let i = 0; i < 20; i++) await page.mouse.click(bx.x + bx.width * 0.85, bx.y + bx.height / 2);
}
test('opponent deck skipped: asked again at the end, and can still be set from the result', async ({ page }) => {
  await setup(page);
  await newMatch(page);
  await page.getByRole('button', { name: 'Circle of Life' }).click();
  await page.getByRole('button', { name: 'Pular' }).click();                 // "O oponente usa o Inkwell?" → skip
  await winGame(page);
  await page.getByRole('button', { name: 'Pular' }).click();                 // who went first → skip
  await page.getByRole('button', { name: 'Pular' }).click();                 // still unknown: asked again → skip
  await page.locator('#sheet').waitFor({ state: 'hidden' });
  { const bx = await page.locator('#h1').boundingBox(); await page.mouse.click(bx.x + bx.width * 0.85, bx.y + bx.height / 2); }   // a tap starts the next game
  await winGame(page);
  await expect(page.getByRole('heading', { name: 'O oponente usa o Inkwell?' })).toBeVisible();   // end of match, still unknown
  await page.getByRole('button', { name: 'Pular' }).click();
  await page.getByRole('button', { name: 'Escolher deck do oponente' }).click();
  await page.getByRole('button', { name: 'Não' }).click();
  await page.locator('#dk [data-ink="Ruby"]').click();
  await page.getByRole('button', { name: 'Salvar' }).click();
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('inkwell-lorecounter-v3')));
  expect(st.history[0].opp.inks).toEqual(['Ruby']);
  expect(st.history[0].exported).toBe(false);
});
