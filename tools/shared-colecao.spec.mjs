// Coleção shared between people (supabase/collection_shares.sql), more than one collection, a friend's collection.
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/shared-colecao.spec.mjs
import { test, expect } from '@playwright/test';

const BASE = new URL('colecao/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '22222222-2222-4222-8222-222222222222';
const LUIS = '11111111-1111-4111-8111-111111111111';

async function setup(page, { own = [{ profile: 'principal', collection: {} }], sharedWithMe = [], given = [], privacy = { view: false, lend: false }, signedIn = true, friend = null, invite = null } = {}) {
  const calls = [];
  await page.addInitScript(([me, signed]) => {
    localStorage.setItem('inkwell-lang', 'pt');
    if (!signed) return;
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 't@example.com' } }));
  }, [ME, signedIn]);
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ path, body });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles') return json(own.map((x) => ({ updated_at: '2026-10-20T10:00:00Z', ...x })));
    if (path === 'rpc/shared_collections') return json(sharedWithMe);
    if (path === 'rpc/my_collection_shares') return json({ given, received: [] });
    if (path === 'rpc/my_collection_privacy') return json(privacy);
    if (path === 'rpc/share_invite_info') return json(invite);
    if (path === 'rpc/accept_share_invite') { sharedWithMe = [{ owner: LUIS, owner_name: 'Luís Credie', profile: 'principal', can_edit: true, collection: { 'LOR10-10': { n: 3, f: 0 } }, home: [] }]; return json({ owner: LUIS, profile: 'principal', can_edit: true }); }
    if (path === 'rpc/create_share_invite') return json('abc123');
    if (path === 'rpc/friend_collection') return json(friend);
    if (path === 'rpc/create_collection') { own = [...own, { profile: body.p_name, collection: {} }]; return route.fulfill({ status: 204, body: '' }); }
    if (/^rpc\//.test(path) && path !== 'rpc/my_duels_sync') return route.fulfill({ status: 204, body: '' });
    return json([]);
  });
  return calls;
}
const luisShare = (canEdit) => [{ owner: LUIS, owner_name: 'Luís Credie', profile: 'principal', can_edit: canEdit, collection: { 'LOR10-10': { n: 2, f: 0 } }, home: [] }];

test('my own collection is empty and Luís shares his: it opens his, and changes go to his', async ({ page }) => {
  const calls = await setup(page, { sharedWithMe: luisShare(true) });
  await page.goto(BASE);
  await expect(page.locator('#title')).toHaveText('Coleção de Luís');
  await expect(page.locator('[data-testid="src-mode"]')).toHaveText(/pode alterar/);
  await page.locator('[data-card="LOR10-10"]').click();
  await page.locator('#cardSheet [data-d="n:1:binder"]').click();
  await expect.poll(() => calls.filter((c) => c.path === 'rpc/shared_collection_change').length).toBe(1);
  const b = calls.find((c) => c.path === 'rpc/shared_collection_change').body;
  expect(b).toEqual({ p_owner: LUIS, p_profile: 'principal', p_delta: [{ card_id: 'LOR10-10', qty: 1, foil: false }], p_home: [] });
  expect(calls.some((c) => c.path === 'rpc/apply_collection_delta')).toBe(false);
  // the switcher goes back to my own
  await page.locator('[data-testid="coll-source"]').selectOption('principal');
  await expect(page.locator('#title')).toHaveText('Minha coleção');
});

test('view only: no + / −, no import or scan', async ({ page }) => {
  await setup(page, { sharedWithMe: luisShare(false) });
  await page.goto(BASE);
  await expect(page.locator('[data-testid="src-mode"]')).toHaveText(/só ver/);
  await expect(page.locator('[data-testid="import"]')).toHaveCount(0);
  await page.locator('[data-card="LOR10-10"]').click();
  await expect(page.locator('#cardSheet [data-d="n:1:binder"]')).toBeHidden();
});

test('share sheet: invite link (can change), friends switches, new collection', async ({ page }) => {
  const calls = await setup(page, { own: [{ profile: 'principal', collection: { 'LOR10-10': { n: 1, f: 0 } } }], given: [{ profile: 'principal', member: LUIS, name: 'Luís Credie', can_edit: false }] });
  await page.goto(BASE);
  await page.locator('[data-testid="share"]').click();
  await expect(page.locator('[data-member]')).toContainText('Luís Credie');
  await page.locator(`[data-edit="${LUIS}"]`).check();
  await expect.poll(() => calls.find((c) => c.path === 'rpc/set_collection_share')?.body).toEqual({ p_owner: ME, p_profile: 'principal', p_member: LUIS, p_can_edit: true });
  await page.locator('#invEdit').check();
  await page.locator('[data-testid="make-invite"]').click();
  await expect(page.locator('#linkTxt')).toHaveValue(/colecao\/\?compartilhar=abc123$/);
  expect(calls.find((c) => c.path === 'rpc/create_share_invite').body).toEqual({ p_profile: 'principal', p_can_edit: true });
  await page.locator('#pvLend').check();
  await expect.poll(() => calls.find((c) => c.path === 'rpc/set_collection_privacy')?.body).toEqual({ p_profile: 'principal', p_view: false, p_lend: true });
  await page.locator('#newColl').click();
  await page.locator('#newName').fill('Só minha');
  await page.locator('#newOk').click();
  await expect(page.locator('#title')).toHaveText('Só minha');
  await expect(page.locator('[data-own="Só minha"]')).toContainText('aberta');
});

test('an invite link: shows whose, accepts, opens the shared collection', async ({ page }) => {
  const calls = await setup(page, { invite: { name: 'Luís', can_edit: true, valid: true, mine: false } });
  await page.goto(BASE + '?compartilhar=abc123');
  await expect(page.locator('[data-testid="invite-text"]')).toContainText('Luís quer dividir a coleção com você');
  await page.locator('[data-testid="accept-invite"]').click();
  await expect(page.locator('#title')).toHaveText('Coleção de Luís');
  expect(calls.find((c) => c.path === 'rpc/accept_share_invite').body).toEqual({ p_code: 'abc123' });
  await expect(page).not.toHaveURL(/compartilhar/);
});

test('signed out with an invite: explains and keeps the code for after signing in', async ({ page }) => {
  await setup(page, { signedIn: false, invite: { name: 'Luís', can_edit: false, valid: true, mine: null } });
  await page.goto(BASE + '?compartilhar=abc123');
  await expect(page.locator('[data-testid="invite-text"]')).toContainText('você vê tudo (sem alterar)');
  await expect(page.locator('[data-testid="accept-invite"]')).toHaveText('Entrar');
  expect(await page.evaluate(() => localStorage.getItem('inkwell-share-invite'))).toBe('abc123');
});

test("a friend's collection, read only", async ({ page }) => {
  await setup(page, { friend: { view: true, name: 'Ana Souza', lend: true, cards: 1, collection: { 'LOR10-10': { n: 4, f: 0 } }, lent: {} } });
  await page.goto(BASE + '?amigo=ana');
  await expect(page.locator('#title')).toHaveText('Coleção de Ana');
  await expect(page.locator('[data-card="LOR10-10"]')).toBeVisible();
  await expect(page.locator('[data-testid="back-mine"]')).toBeVisible();
  await page.locator('[data-card="LOR10-10"]').click();
  await expect(page.locator('#cardSheet [data-d="n:1:binder"]')).toBeHidden();
});

test("a friend's collection that isn't open", async ({ page }) => {
  await setup(page, { friend: { view: false } });
  await page.goto(BASE + '?amigo=ana');
  await expect(page.locator('#app')).toContainText('não está aberta para você');
});

test('a visitor sees what Coleção does, with a fictional example, and can create theirs or try a deck', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto(BASE);
  const d = page.locator('[data-testid="coll-demo"]');
  await expect(d).toContainText('dados fictícios');
  await expect(d.locator('.ccard')).toHaveCount(6);
  await expect(d).toContainText('Escaneie com a câmera');
  await expect(d).toContainText('Fichário, Casa e Trocas');
  await expect(page.locator('[data-testid="create-collection"]')).toHaveText('Criar minha coleção');
  await expect(d.getByRole('link', { name: 'Testar um deck sem cadastro' })).toHaveAttribute('href', '../decks/');
});
