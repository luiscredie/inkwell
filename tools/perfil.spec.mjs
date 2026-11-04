// My Inkwell (/perfil/), the public home (/feed/ signed out) and the admin panel (/admin/) against a fake Supabase.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/perfil.spec.mjs
import { test, expect } from '@playwright/test';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';
const url = (p) => new URL(p, ROOT).href;
const ME = '11111111-1111-4111-8111-111111111111';

const USER1 = {
  handle: 'rafa_exemplo', name: 'Rafa (exemplo)', bio: 'Jogo Âmbar/Aço competitivo.', motto: 'Quinta é dia de liga.', avatar: 'LOR14-2', inks: ['Amber', 'Steel'], city: 'São Paulo', mock: true,
  showcase: [{ id: 'LOR13-80', own: true }, { id: 'LOR14-1', own: true }, { id: 'LOR10-10', own: false }],
  deck: { name: 'Âmbar/Aço da liga', format: 'core', colors: ['Amber', 'Steel'], cards: { 'LOR14-1': 4, 'LOR14-10': 4, 'LOR14-11': 4 } },
  public_decks: [{ id: 'd9', name: 'Rubi de sexta', format: 'core', colors: ['Ruby'], cards: { 'LOR14-1': 2 } }],
  record: { w: 8, l: 4 }, trade: { want: ['LOR14-3'], have: [] },
  friends: [{ name: 'Marina (exemplo)', handle: 'marina_exemplo', avatar: 'LOR13-80' }, { name: 'Bia (exemplo)', handle: 'bia_exemplo', avatar: 'LOR14-1' }], friends_n: 3,
  recados: [{ id: 'x1', body: 'Valeu pela troca da Mulan! Quinta tem revanche.', at: '2026-10-20T10:00:00Z', name: 'Marina (exemplo)', handle: 'marina_exemplo', avatar: 'LOR13-80' }],
  relation: null, can_recado: null,
};
const ANA = (relation) => ({ ...USER1, handle: 'ana', name: 'Ana', mock: false, relation, can_recado: relation === 'friend', recados: [] });

async function setup(page, { signedIn = true, mine = null, admin = false, relation = 'none', invite = { ok: true, name: 'Luís', requester: '22222222-2222-4222-8222-222222222222', status: 'pending' } } = {}) {
  const calls = [];
  await page.addInitScript(([me, signed]) => {
    localStorage.setItem('inkwell-lang', 'pt');
    if (!signed) return;
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, [ME, signedIn]);
  let myRow = mine;
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ path, full: path + decodeURIComponent(new URL(req.url()).search), body });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'rpc/public_profile') return json(body.p_handle === 'rafa_exemplo' ? USER1 : body.p_handle === 'ana' ? ANA(relation) : null);
    if (path === 'rpc/example_profiles') return json([USER1, { ...USER1, handle: 'marina_exemplo', name: 'Marina (exemplo)', motto: 'Uma Encantada de cada vez.', deck: null }]);
    if (path === 'rpc/request_friend' || path === 'rpc/post_recado') return json({ ok: true });
    if (path === 'rpc/friend_collection') return json({ view: true, lend: false, cards: 12, collection: null, lent: null });
    if (path === 'rpc/my_data_export') return json({ account: { email: 'luis@example.com' }, games: [] });
    if (path === 'rpc/delete_my_account') return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    if (path === 'rpc/my_home') return json({ profile: { handle: null, is_public: false, adult: true }, friend_requests: [{ name: 'Ana', handle: 'ana', avatar: 'LOR14-1' }], recados_waiting: 2,
      recados_new: [], communities: [{ slug: 'liga-campinas', name: 'Liga Campinas' }],
      community_posts: [{ name: 'Bia', handle: null, avatar: null, body: 'Sexta tem torneio!', at: '2026-10-21T10:00:00Z', community: 'Liga Campinas', slug: 'liga-campinas', mine: false }] });
    if (path === 'rpc/my_recados') return json([{ id: 'r9', body: 'Bora jogar sexta?', status: 'pending', created_at: '2026-10-21T10:00:00Z', author_name: 'Ana', author_handle: 'ana', author_avatar: 'LOR14-1' }]);
    if (path.startsWith('recados') || path.startsWith('friendships')) return route.fulfill({ status: 204, body: '' });
    if (path === 'rpc/my_profile') return json(myRow ? { ...myRow, is_admin: admin } : null);
    if (path === 'rpc/save_my_profile') { myRow = { ...(myRow || {}), ...body.p, invite_code: 'abc123def0', hidden: false }; return json(myRow); }
    if (path === 'rpc/invite_info') return json(body.p_code === 'abc123def0' ? { name: 'Luís', handle: null } : null);
    if (path === 'rpc/accept_invite') return json(invite);
    if (path === 'rpc/report_profile') return route.fulfill({ status: 204, body: '' });
    if (path.startsWith('inkwell_profiles')) return json([{ profile: 'luiscredie', updated_at: '2026-10-21T10:00:00Z', decks: [{ id: 'd1', name: 'Steelsong', format: 'core', colors: ['Amber', 'Steel'], cards: { 'LOR14-1': 4 } }], collection: { 'LOR13-80': { n: 1, f: 0 } } }]);
    if (path === 'rpc/admin_users') return admin ? json([
      { id: ME, email: 'luis@example.com', display_name: 'Luís', handle: null, is_public: false, is_mock: false, hidden: false, adult: true, is_admin: true, games: 554, open_reports: 0, created_at: '2026-08-01T00:00:00Z' },
      { id: '00000000-0000-4000-a000-000000000001', email: 'user1@exemplo.invalid', display_name: 'user1 (exemplo)', handle: 'user1', is_public: true, is_mock: true, hidden: false, adult: true, is_admin: false, games: 12, open_reports: 1, created_at: '2026-10-21T00:00:00Z' },
    ]) : route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'not allowed' }) });
    if (path === 'rpc/admin_reports') return admin ? json([{ id: 'r1', reason: 'Spam', status: 'open', created_at: '2026-10-21T00:00:00Z', target: '00000000-0000-4000-a000-000000000001', target_name: 'user1 (exemplo)', target_handle: 'user1', reporter_name: 'Luís' }]) : route.fulfill({ status: 403, body: '{"message":"not allowed"}' });
    if (path === 'rpc/admin_action' || path === 'rpc/admin_resolve_report') return route.fulfill({ status: 204, body: '' });
    if (path === 'rpc/admin_feedback') return admin ? json([
      { id: 'f1', at: '2026-10-30T10:00:00Z', kind: 'bug', body: 'O scanner <b>não</b> abre', page: 'cards', path: '/inkwell/colecao/', device: 'iPhone · 390x844', status: 'open', email: 'eu@exemplo.com', name: null, handle: null, member: false },
      { id: 'f2', at: '2026-10-29T10:00:00Z', kind: 'idea', body: 'Modo torneio', page: 'decks', status: 'done', email: 'bia@x.com', name: 'Bia', handle: 'bia', member: true }]) : route.fulfill({ status: 403, body: '{"message":"not allowed"}' });
    if (path === 'rpc/admin_feedback_done' || path === 'rpc/send_feedback') return route.fulfill({ status: 204, body: '' });
    if (path === 'rpc/admin_stats') return admin ? json(STATS(body.p_days)) : route.fulfill({ status: 403, body: '{"message":"not allowed"}' });
    if (path === 'rpc/admin_metrics') return admin ? json(METRICS) : route.fulfill({ status: 403, body: '{"message":"not allowed"}' });
    if (path === 'rpc/my_duels_sync') return json(null);
    return json([]);
  });
  return calls;
}
const rpcCalls = (calls, name) => calls.filter((c) => c.path === `rpc/${name}`).map((c) => c.body);

test('previous public home (?preview=off) explains Inkwell and shows example profiles marked as fictional', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto(url('feed/?preview=off'));
  const home = page.locator('[data-testid="public-home"]');
  await expect(home.locator('h1')).toHaveText('Seu canto na comunidade de Lorcana');
  await expect(page.locator('[data-testid="example-profile"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="example-profile"]').first()).toContainText('Exemplo · perfil fictício');
  await expect(page.locator('[data-testid="example-profile"]').first()).toContainText('“Quinta é dia de liga.”');
  await expect(page.locator('[data-testid="example-profile"]').first()).toContainText('3 amigos');
  const order = await home.locator(':scope > section').evaluateAll((els) => els.map((e) => e.id || e.className));
  expect(order.slice(0, 2)).toEqual(['landHero', 'landEvents']);   // where to play right below the hero, then the examples
  await expect(home.locator('.land-feat')).toHaveCount(6);
  await page.locator('[data-testid="example-profile"]').first().click();
  await expect(page).toHaveURL(/perfil\/\?u=rafa_exemplo/);
  await expect(page.locator('[data-testid="mock-banner"]')).toContainText('perfil fictício');
});

test('a public profile shows only what its owner picked; signed out there is no report button', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto(url('perfil/?u=rafa_exemplo'));
  const p = page.locator('[data-testid="profile"]');
  await expect(p.locator('.mi-name')).toHaveText('Rafa (exemplo)');
  await expect(p).toContainText('@rafa_exemplo');
  await expect(page.locator('[data-testid="motto"]')).toHaveText('“Quinta é dia de liga.”');
  await expect(page.locator('[data-testid="friends"] .mi-fgrid a')).toHaveCount(2);
  await expect(page.locator('[data-testid="friends"]')).toContainText('+1 com perfil privado');
  await expect(page.locator('[data-testid="recados"]')).toContainText('Valeu pela troca da Mulan!');
  await expect(page.locator('#recForm')).toHaveCount(0);   // signed out: no form
  await expect(page.locator('[data-testid="featured-deck"] .mi-key figure')).toHaveCount(3);
  await page.locator('[data-testid="featured-deck"] summary').click();
  await expect(page.locator('[data-testid="featured-deck"] .mi-list li')).toHaveCount(3);
  await expect(p).toContainText('Âmbar');
  await expect(page.locator('[data-testid="showcase"] figure')).toHaveCount(3);
  await expect(page.locator('[data-testid="showcase"] .tag.match')).toHaveCount(2);   // "tem"
  await expect(page.locator('[data-testid="featured-deck"]')).toContainText('12 cartas');
  await expect(page.locator('[data-testid="public-deck"]')).toHaveCount(1);   // + the decks marked public
  await expect(page.locator('[data-testid="public-deck"]')).toContainText('Deck público');
  await expect(page.locator('[data-testid="public-deck"]')).toContainText('Rubi de sexta');
  await expect(page.locator('[data-testid="record"]')).toContainText('8');
  await expect(page.locator('#report')).toHaveCount(0);
  await page.goto(url('perfil/?u=ninguem'));
  await expect(page.locator('.empty')).toContainText('Perfil não encontrado');
});

test('signed in, a profile can be reported', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís', handle: null, invite_code: 'abc123def0' } });
  await page.goto(url('perfil/?u=ana'));
  await page.locator('#report').click();
  await page.locator('#rpWhy').fill('Conteúdo ofensivo');
  await page.locator('#rpSend').click();
  await expect(page.locator('#toast')).toContainText('Denúncia enviada');
  expect(rpcCalls(calls, 'report_profile')).toEqual([{ p_handle: 'ana', p_reason: 'Conteúdo ofensivo' }]);
});

test('friends: ask from a profile; a friend can leave a recado that waits for approval', async ({ page }) => {
  let calls = await setup(page, { mine: { display_name: 'Luís', handle: 'luis', adult: true, invite_code: 'abc123def0' }, relation: 'none' });
  await page.goto(url('perfil/?u=ana'));
  await page.locator('#addFriend').click();
  await expect(page.locator('[data-testid="relation"]')).toHaveText('Pedido enviado');
  expect(rpcCalls(calls, 'request_friend')).toEqual([{ p_handle: 'ana' }]);

  const page2 = await page.context().newPage();
  calls = await setup(page2, { mine: { display_name: 'Luís', handle: 'luis', adult: true, invite_code: 'abc123def0' }, relation: 'friend' });
  await page2.goto(url('perfil/?u=ana'));
  await expect(page2.locator('[data-testid="relation"]')).toHaveText('Amigos');
  await expect(page2.locator('[data-testid="friend-collection"]')).toHaveAttribute('href', '../colecao/?amigo=ana');   // she opened her collection to friends
  await page2.locator('#recBody').fill('Bora jogar sexta?');
  await page2.locator('#recForm button[type=submit]').click();
  await expect(page2.locator('#toast')).toContainText('Aparece quando Ana aprovar');
  expect(rpcCalls(calls, 'post_recado')).toEqual([{ p_handle: 'ana', p_body: 'Bora jogar sexta?' }]);
});

test('my profile: passkeys listed, deleted with a second tap', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís', handle: null, is_public: false, adult: true } });
  const dels = [];
  await page.route('**/auth/v1/passkeys**', (r) => {
    if (r.request().method() === 'DELETE') { dels.push(new URL(r.request().url()).pathname.split('/').pop()); return r.fulfill({ status: 204, body: '' }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dels.length ? [] : [{ id: 'pk1', friendly_name: 'iPhone', created_at: '2026-11-03T10:00:00Z', last_used_at: '2026-11-03T12:00:00Z' }]) });
  });
  await page.goto(url('perfil/'));
  const box = page.getByTestId('my-passkeys');
  await expect(box).toContainText('Entrar sem código');
  await expect(box).toContainText('iPhone');
  await expect(box).toContainText('criada em');
  await box.locator('[data-pkdel="pk1"]').click();
  await expect(box.locator('[data-pkdel="pk1"]')).toHaveText('Toque de novo para apagar');
  expect(dels).toEqual([]);
  await box.locator('[data-pkdel="pk1"]').click();
  await expect(box).toContainText('Passkey apagada');
  expect(dels).toEqual(['pk1']);
  await expect(box.getByTestId('passkey-add')).toHaveText(/Criar passkey/);
});

test('my profile: recados wait for my approval', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís', handle: 'luis', bio: '', motto: '', inks: [], city: '', showcase: [], is_public: false, adult: true, invite_code: 'abc123def0' } });
  await page.goto(url('perfil/?editar=1'));
  const box = page.locator('[data-testid="my-recados"]');
  await expect(box).toContainText('Recados esperando você');
  await box.locator('[data-rec="r9"] [data-ra="shown"]').click();
  await expect(box).toContainText('No seu perfil');
  expect(calls.find((c) => c.full.startsWith('recados?id=eq.r9')).body).toMatchObject({ status: 'shown' });
});

test('my profile: private by default; public needs an address and 18+; card and invite', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís', handle: null, bio: '', inks: [], city: '', showcase: [], is_public: false, adult: false, show_record: true, show_trade: false, invite_code: 'abc123def0' } });
  await page.goto(url('perfil/?editar=1'));
  await expect(page.locator('[data-testid="status"]')).toHaveText('Privado');
  await expect(page.locator('#fPublic')).toBeDisabled();
  await expect(page.locator('#fCity')).toBeDisabled();
  await page.locator('#fHandle').fill('Luis Credie!');
  await expect(page.locator('#fHandle')).toHaveValue('luiscredie');
  await page.locator('#fBio').fill('Jogo Amber/Steel.');
  await page.locator('#fMotto').fill('Topo um BO3 sempre.');
  await page.locator('.ed-inks [data-ink="Amber"]').click();
  await page.locator('.ed-inks [data-ink="Steel"]').click();
  await page.locator('.ed-inks [data-ink="Ruby"]').click();   // a third ink replaces the oldest
  await page.locator('#qAv').fill('abuelita');
  await page.locator('#avRes [data-pick]').first().click();
  await page.locator('[data-spick="0"]').click();
  await page.locator('#pkQ').fill('rapunzel tower');
  await page.locator('#cardPicker [data-card="LOR13-80"] [data-use]').click();
  await expect(page.locator('#cardPicker')).not.toBeVisible();
  await page.locator('[data-spick="1"]').first().click();
  await page.locator('#pkQ').fill('fru fru');
  await page.locator('#cardPicker [data-card="LOR14-1"] [data-use]').click();
  await expect(page.locator('[data-sk="0:own"]')).toHaveAttribute('aria-pressed', 'true');   // owned: Rapunzel
  await expect(page.locator('[data-sk="1:own"]')).toBeDisabled();                             // not owned: Fru Fru
  await page.locator('#fDeck').selectOption('d1');
  await page.locator('#fAdult').check();
  await page.locator('#fCity').fill('São Paulo');
  await page.locator('#fPublic').check();
  await page.locator('#edSave').click();
  await expect(page.locator('#toast')).toContainText('Salvo');
  const saved = rpcCalls(calls, 'save_my_profile')[0].p;
  expect(saved).toMatchObject({ handle: 'luiscredie', bio: 'Jogo Amber/Steel.', motto: 'Topo um BO3 sempre.', inks: ['Steel', 'Ruby'], adult: true, is_public: true, city: 'São Paulo', featured_deck: 'd1',
    showcase: [{ id: 'LOR13-80', k: 'own' }, { id: 'LOR14-1', k: 'fav' }] });
  expect(saved.avatar_card).toBeTruthy();
  await expect(page.locator('[data-testid="status"]')).toHaveText('Público');
  await expect(page.locator('#invLink')).toHaveValue(/perfil\/\?convite=abc123def0&u=luiscredie$/);
  await page.locator('#pcMake').click();
  await expect(page.locator('[data-testid="player-card"]')).toBeVisible();
  const size = await page.locator('[data-testid="player-card"]').evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  expect(size).toEqual([1080, 1350]);
});

test('showcase editor: real cards, only-mine filter, foil kept, replace, move and remove', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís', handle: 'luis', adult: true, is_public: false, invite_code: 'abc123def0',
    showcase: [{ id: 'LOR10-10', k: 'fav', foil: true }, { id: 'LOR14-1', k: 'fav' }] } });
  await page.goto(url('perfil/?editar=1'));
  const slots = page.locator('[data-testid="ed-showcase"] .iw-slot');
  await expect(slots).toHaveCount(3);
  await expect(slots.nth(0).locator('img')).toHaveCount(1);
  await expect(slots.nth(0)).toContainText('foil');
  await expect(slots.nth(2).locator('button.iw-card.empty')).toBeEnabled();
  // pick from my collection only
  await slots.nth(2).locator('[data-spick]').click();
  await page.locator('#cardPicker [data-scope="owned"]').click();
  await expect(page.locator('#cardPicker [data-card]')).toHaveCount(1);
  await expect(page.locator('#cardPicker [data-card="LOR13-80"]')).toContainText('Você tem esta versão');
  await page.locator('#cardPicker [data-card="LOR13-80"] [data-use]').click();
  await expect(page.locator('[data-sk="2:own"]')).toHaveAttribute('aria-pressed', 'true');
  // move the new card to the front, remove the second, replace keeps the slot
  await page.locator('[data-smove="2:-1"]').click();
  await page.locator('[data-smove="1:-1"]').click();
  await page.locator('[data-sdel="2"]').click();
  await page.locator('#edSave').click();
  await expect(page.locator('#toast')).toContainText('Salvo');
  const saved = rpcCalls(calls, 'save_my_profile').at(-1).p;
  expect(saved.showcase).toEqual([{ id: 'LOR13-80', k: 'own' }, { id: 'LOR10-10', k: 'fav', foil: true }]);
});

test('an invite link: shown signed out; after signing in the person decides', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto(url('perfil/?convite=abc123def0'));
  await expect(page.locator('[data-testid="invite"]')).toContainText('Luís convidou você para o Inkwell');
  expect(await page.evaluate(() => localStorage.getItem('inkwell-invite'))).toBe('abc123def0');

  const page2 = await page.context().newPage();
  const calls = await setup(page2, { mine: { display_name: 'Ana', handle: null, invite_code: 'zzz' } });
  await page2.goto(url('perfil/?editar=1'));
  const ask = page2.locator('[data-testid="invite-ask"]');
  await expect(page2.locator('#sheet')).toContainText('Luís quer ser seu amigo');
  expect(calls.filter((c) => c.path.startsWith('friendships'))).toEqual([]);   // nothing until the person decides
  await ask.getByRole('button', { name: 'Aceitar' }).click();
  await expect(page2.locator('#toast')).toContainText('Agora você e Luís são amigos');
  expect(rpcCalls(calls, 'accept_invite')).toEqual([{ p_code: 'abc123def0' }]);
  const f = calls.find((c) => c.path.startsWith('friendships'));
  expect(f.full).toContain('requester=eq.22222222-2222-4222-8222-222222222222');
  expect(f.body).toMatchObject({ status: 'accepted' });
});

test('admin: members, reports, two taps to delete', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís' }, admin: true });
  await page.goto(url('admin/'));
  await page.locator('[data-tab="users"]').click();   // the Painel opens first
  const rows = page.locator('[data-testid="users"] .adm-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('exemplo');
  await expect(rows.nth(0).locator('[data-act="delete"]')).toBeDisabled();   // the admin can't delete itself
  const del = rows.nth(1).locator('[data-act="delete"]');
  await del.click();
  await expect(rows.nth(1).locator('[data-act="delete"]')).toHaveText('Toque de novo para confirmar');
  expect(rpcCalls(calls, 'admin_action')).toEqual([]);
  await rows.nth(1).locator('[data-act="delete"]').click();
  await expect.poll(() => rpcCalls(calls, 'admin_action')).toEqual([{ p_user: '00000000-0000-4000-a000-000000000001', p_action: 'delete' }]);
  await page.locator('[data-tab="reports"]').click();
  await expect(page.locator('[data-testid="reports"]')).toContainText('Spam');
  await page.locator('[data-resolve="r1"]').click();
  await expect.poll(() => rpcCalls(calls, 'admin_resolve_report')).toEqual([{ p_id: 'r1' }]);
});

const STATS = (days) => ({ days, totals: { visits_anon: 40, visits_signed: 12, views: 130, bounced: 22, two_plus: 15, tried: 9, opened_signin: 6, got_code: 4, signed_in: 3, avg_views: 2.4,
  signups: 5, signups_confirmed: 4, profiles_public: 1, profiles_private: 3, members: 31, active_7d: 9 },
  series: [{ day: '2026-10-28', visits_anon: 10, visits_signed: 4, signups: 1, profiles: 1 }, { day: '2026-10-29', visits_anon: 30, visits_signed: 8, signups: 4, profiles: 3 }],
  pages: [{ page: 'feed', views_anon: 50, views_signed: 20, landed: 30, left: 18 }, { page: 'decks', views_anon: 20, views_signed: 5, landed: 6, left: 9 }],
  actions: [{ name: 'deck_sample', anon: 5, signed: 0 }, { name: 'signin_open', anon: 6, signed: 0 }], refs: [{ ref: 'instagram.com', visits: 12 }, { ref: '', visits: 20 }], devices: { mobile: 33, desktop: 7 } });

test('admin Painel: visits, sign-ups, profiles, the way to an account, pages, actions; period', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís' }, admin: true });
  await page.goto(url('admin/'));
  await expect(page.locator('[data-testid="kpi-visits"]')).toContainText('40');
  await expect(page.locator('[data-testid="kpi-visits"]')).toContainText('55% saíram na primeira página');
  await expect(page.locator('[data-testid="kpi-signups"]')).toContainText('4 confirmaram o e-mail');
  await expect(page.locator('[data-testid="kpi-profiles"]')).toContainText('1 públicos · 3 privados');
  await expect(page.locator('[data-testid="stats-funnel"]')).toContainText('Experimentaram algo');
  await expect(page.locator('[data-testid="stats-funnel"] .fr').nth(2)).toContainText('23%');
  await expect(page.locator('[data-testid="stats-pages"]')).toContainText('Início');
  await expect(page.locator('[data-testid="stats-actions"]')).toContainText('Deck de exemplo');
  await expect(page.locator('[data-testid="stats-refs"]')).toContainText('Direto ou app');
  await expect(page.locator('[data-testid="stats-devices"]')).toHaveText('Celular 33 · Computador 7');
  expect(rpcCalls(calls, 'admin_stats')).toEqual([{ p_days: 14 }]);   // opened once: one query (it used to fire ~1000)
  await page.locator('[data-days="30"]').click();
  await expect.poll(() => rpcCalls(calls, 'admin_stats').at(-1)).toEqual({ p_days: 30 });
  await page.waitForTimeout(300);
  expect(rpcCalls(calls, 'admin_stats').length).toBe(2);
});

const EV = ['page_view', 'try_deck_started', 'deck_sample_loaded', 'signup_started', 'signup_completed', 'deck_saved', 'profile_started', 'profile_saved', 'collection_started'];
const METRICS = { generated_at: '2026-11-03T23:00:00Z', since: '2026-10-21T03:00:00Z', days: 14, retention_days: 90, first_event_at: '2026-10-29T12:00:00Z', visits: 12, visits_anon: 9,
  events: EV.map((name, i) => ({ name, count: i === 0 ? 40 : i === 2 ? 3 : 0, visits: i === 0 ? 12 : i === 2 ? 3 : 0, anon: i === 0 ? 30 : i === 2 ? 3 : 0, signed: i === 0 ? 10 : 0 })),
  members: 6, accounts_created: 2, new_with_profile: 1, new_with_deck: 0, active_7d: 0, active_30d: 1, active_since: '2026-11-03' };
test('#145 P0-B admin metrics: the 9 events by name, real zeros, active 7d/30d, update time and how we count', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís' }, admin: true });
  await page.goto(url('admin/'));
  const m = page.getByTestId('metrics');
  await expect(m).toBeVisible();
  await expect(m.getByTestId('metrics-updated')).toContainText('Atualizado em');
  await expect(m.locator('[data-ev]')).toHaveCount(9);
  await expect(m.locator('[data-ev="deck_sample_loaded"] td').nth(1)).toHaveText('3');
  await expect(m.locator('[data-ev="signup_completed"] td').nth(1)).toHaveText('0');   // zero is zero
  await expect(m.getByTestId('m-active7')).toContainText('0');
  await expect(m.getByTestId('m-active30')).toContainText('1');
  await expect(m.getByTestId('m-visits')).toContainText('12');
  await expect(m.getByTestId('m-visits')).toContainText('abas do navegador');
  await expect(m.getByTestId('m-visits')).toContainText('não são pessoas');
  await expect(m).not.toContainText('únic');                                      // never "visitantes únicos"
  await expect(m.getByTestId('m-accounts')).toContainText('1 com perfil · 0 com deck');   // from the database
  await expect(m).toContainText('Como contamos');
  expect(rpcCalls(calls, 'admin_metrics')).toEqual([{ p_days: 14 }]);
});
test('admin funnel: try a deck → sign-up → deck saved, in tabs; rates only when valid; database numbers apart', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís' }, admin: true });
  const at = (name, visits, count) => ({ name, count, visits, anon: 0, signed: 0 });
  await page.route('**/rest/v1/rpc/admin_metrics', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...METRICS, accounts_created: 3, new_with_deck: 1, active_7d: 2, active_30d: 5,
    events: [at('page_view', 50, 90), at('try_deck_started', 10, 14), at('signup_started', 4, 5), at('signup_completed', 0, 0), at('deck_saved', 2, 2)] }) }));
  await page.goto(url('admin/'));
  const f = page.getByTestId('funnel');
  const row = (k) => f.locator(`[data-fn="${k}"] td`);
  await expect(row('try_deck_started')).toHaveText(['Deck experimentado', '10', '14', '—']);
  await expect(row('signup_started')).toHaveText(['Cadastro iniciado', '4', '5', '40%']);
  await expect(row('signup_completed')).toHaveText(['Cadastro concluído', '0', '0', '0%']);
  await expect(row('deck_saved')).toHaveText(['Deck salvo', '2', '2', '—']);   // the step before is zero: no rate
  await expect(f).toContainText('eventos do navegador');
  await expect(f).toContainText('Visitas são abas, não pessoas');
  await expect(f.locator('thead')).toContainText('Taxa aproximada');
  await expect(f).toContainText('Ninguém é acompanhado de uma etapa para a outra');
  await expect(f.getByTestId('funnel-db')).toHaveText('No banco (dados reais): 3 contas criadas, 1 delas com deck salvo · membros ativos (por conta): 2 em 7 dias, 5 em 30 dias.');
});

test('#145 P0-B admin metrics: before the SQL runs, a clear message (the rest of the Painel still works)', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís' }, admin: true });
  await page.route('**/rest/v1/rpc/admin_metrics', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"PGRST202","message":"Could not find the function public.admin_metrics"}' }));
  await page.goto(url('admin/'));
  await expect(page.getByTestId('metrics-error')).toContainText('metrics_p0.sql');
  await expect(page.locator('[data-testid="kpi-visits"]')).toContainText('40');
});

test('admin Painel: an empty answer shows a message instead of loading forever', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís' }, admin: true });
  await page.route('**/rest/v1/rpc/admin_stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url('admin/'));
  await expect(page.locator('[data-testid="stats-error"]')).toHaveText('Não foi possível carregar.');
  expect(errs).toEqual([]);
});

test('a visit is counted: one page view, and an action once; nothing from "do not track"', async ({ page }) => {
  const calls = await setup(page, { signedIn: false });
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  await page.goto(url('decks/'));
  await expect.poll(() => rpcCalls(calls, 'track').length).toBe(1);
  const v = rpcCalls(calls, 'track')[0];
  expect(v).toMatchObject({ p_page: 'decks', p_kind: 'view', p_name: null });
  expect(v.p_sid).toMatch(/^[a-f0-9]{24}$/);
  await page.getByTestId('public-sample').click();
  await page.getByTestId('public-text').fill('4 Stitch - Rock Star');
  await page.getByTestId('public-text').fill('4 Stitch - Rock Star\n4 Elsa - Snow Queen');
  await expect.poll(() => rpcCalls(calls, 'track').map((x) => x.p_name)).toEqual([null, 'try_deck_started', 'deck_sample_loaded', 'deck_result', 'deck_paste']);   // #145 names; the result is counted once, when it first shows
  expect(new Set(rpcCalls(calls, 'track').map((x) => x.p_sid)).size).toBe(1);   // the same visit
  // a browser with Global Privacy Control sends nothing
  const page2 = await page.context().newPage();
  const calls2 = await setup(page2, { signedIn: false });
  await page2.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }); });
  await page2.goto(url('decks/'));
  await page2.waitForTimeout(800);
  expect(rpcCalls(calls2, 'track')).toEqual([]);
});

test('admin page refuses members who are not admins', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Ana' }, admin: false });
  await page.goto(url('admin/'));
  await expect(page.locator('.empty')).toContainText('Sem permissão');
});

test('your data: download everything; deleting needs the word typed', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís', handle: 'luis', adult: true, invite_code: 'abc123def0' } });
  await page.goto(url('perfil/?editar=1'));
  const dl = page.waitForEvent('download');
  await page.locator('#dataDl').click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^inkwell-meus-dados-\d{4}-\d{2}-\d{2}\.json$/);
  await page.locator('#dataDel').click();
  await expect(page.locator('#delGo')).toBeDisabled();
  await page.locator('#delWord').fill('excluir');
  await expect(page.locator('#delGo')).toBeEnabled();
  await page.locator('#delGo').click();
  await expect(page).toHaveURL(/feed\/\?conta=excluida/);
  expect(rpcCalls(calls, 'delete_my_account')).toEqual([{ p_confirm: 'EXCLUIR' }]);
  const out = await page.context().browser().newPage();   // the fake session above signs in again on every load
  await setup(out, { signedIn: false });
  await out.goto(url('feed/?conta=excluida'));
  await expect(out.locator('[data-testid="deleted"]')).toContainText('foram excluídos');
});

test('signed-in home: "Para você" shows what is waiting and the communities', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís' } });
  await page.goto(url('feed/'));
  const fy = page.locator('[data-testid="for-you"]');
  await expect(fy.locator('[data-testid="fy-requests"]')).toContainText('Ana quer ser seu amigo');
  await expect(fy.locator('[data-testid="fy-recados"]')).toContainText('2 recados esperando você');
  await expect(fy.locator('[data-testid="fy-profile"]')).toBeVisible();
  await expect(fy.locator('[data-testid="fy-posts"]')).toContainText('Sexta tem torneio!');
  await expect(fy.locator('[data-testid="fy-posts"] a').first()).toHaveAttribute('href', '../comunidades/?c=liga-campinas');
});

test('signed-in home on a computer: me, shortcuts, communities in three columns', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, { mine: { display_name: 'Luís', handle: 'luis', is_public: true, inks: ['Amber', 'Steel'] } });
  await page.goto(url('feed/'));
  const me = page.locator('[data-testid="me-card"]');
  await expect(me).toContainText('Luís');
  await expect(me).toContainText('@luis');
  await expect(me).toContainText('Âmbar');
  await expect(me.locator('img[src="../ink/steel.svg"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="me-cards"]')).toHaveText('1');
  await expect(page.locator('[data-testid="me-decks"]')).toHaveText('1');
  await expect(page.locator('.home-tools a[href="../counter/"]')).toContainText('Contador de lore');
  await expect(page.locator('[data-testid="home-comms"] a[href="../comunidades/?c=liga-campinas"]')).toContainText('Liga Campinas');
  const [l, m, r] = await Promise.all(['#left', '.home-main', '#aside'].map((s) => page.locator(s).boundingBox()));
  expect(l.x + l.width).toBeLessThanOrEqual(m.x);
  expect(m.x + m.width).toBeLessThanOrEqual(r.x);
});

test('phone: Amigos e privacidade opened before the data arrives shows "loading", never "Escolha seu nome"', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { mine: { display_name: 'Luís' } });
  let release; const gate = new Promise((r) => { release = r; });
  await page.route('**/rest/v1/rpc/my_settings', async (r) => { await gate; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user_id: ME, display_name: 'Luís', default_visibility: 'friends', default_group_id: null }) }); });
  await page.goto(url('feed/#amigos'));   // the account menu's "Amigos e privacidade" opens the sheet right away
  await expect(page.locator('#friendsSheet [data-testid="side-loading"]')).toBeVisible();
  await expect(page.locator('#friendsSheet')).not.toContainText('Escolha seu nome');
  release();
  await expect(page.locator('#friendsSheet [data-testid="side-loading"]')).toHaveCount(0);
  await expect(page.locator('#friendsSheet')).not.toContainText('Escolha seu nome');
  await expect(page.locator('#myName')).toHaveCount(0);
});

test('an expired session refreshes once, even with the many calls a page makes at once', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís' } });
  await page.addInitScript((me) => {   // the token expired an hour ago (a phone waking up)
    const exp = Math.floor(Date.now() / 1000) - 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'old', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  const used = [];
  await page.route('**/auth/v1/token*', async (r) => {
    used.push(JSON.parse(r.request().postData()).refresh_token);
    await new Promise((ok) => setTimeout(ok, 300));
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: ME, exp })) + '.z', refresh_token: 'new', expires_in: 3600, user: { id: ME, email: 'luis@example.com' } }) });
  });
  await page.goto(url('feed/'));
  await expect(page.locator('[data-testid="for-you"]')).toBeVisible();
  await page.waitForTimeout(800);
  expect(used).toEqual(['old']);   // one refresh, not one per call
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('inkwell-counter-auth'))).refresh_token).toBe('new');
});

test('phone: searching friends keeps the same field (the keyboard stays open) and shows the results under it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { mine: { display_name: 'Luís' } });
  await page.route('**/rest/v1/rpc/my_settings', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user_id: ME, display_name: 'Luís', default_visibility: 'friends' }) }));
  await page.route(/\/rest\/v1\/profiles\?display_name=ilike/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ user_id: '99999999-9999-4999-8999-999999999999', display_name: 'Caique Barral' }]) }));
  await page.goto(url('feed/#amigos'));
  const box = page.locator('#friendsSheet #findPeople');
  await expect(box).toBeVisible();
  await box.evaluate((el) => { el.dataset.same = '1'; });
  await box.focus();
  await page.keyboard.type('Cai', { delay: 120 });
  await expect(page.locator('#friendsSheet #found')).toContainText('Caique Barral');
  await expect(page.locator('#friendsSheet #findPeople')).toHaveAttribute('data-same', '1');   // not redrawn
  await expect(page.locator('#friendsSheet #findPeople')).toBeFocused();
  await expect(page.locator('#friendsSheet #findPeople')).toHaveValue('Cai');
});

test('signed-in home on a phone: one column, no side columns', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { mine: { display_name: 'Luís' } });
  await page.goto(url('feed/'));
  await expect(page.locator('[data-testid="for-you"]')).toBeVisible();
  await expect(page.locator('#left')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Início: a friend with a public profile opens it; a private one shows as private', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, { mine: { display_name: 'Luís' } });
  const R = '22222222-2222-4222-8222-222222222222', P = '33333333-3333-4333-8333-333333333333';
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/rest/v1/friendships**', (route) => json(route, [{ requester: ME, addressee: R, status: 'accepted' }, { requester: P, addressee: ME, status: 'accepted' }]));
  await page.route('**/rest/v1/profiles?**', (route) => json(route, route.request().url().includes(ME) && !route.request().url().includes('in.') ? [{ user_id: ME, display_name: 'Luís', default_visibility: 'friends' }]
    : [{ user_id: R, display_name: 'Rodrigo' }, { user_id: P, display_name: 'Paula' }]));
  await page.route('**/rest/v1/rpc/my_friends', (route) => json(route, [{ id: R, name: 'Rodrigo', handle: 'rodrigo', avatar: null }, { id: P, name: 'Paula', handle: null, avatar: null }]));
  await page.goto(url('feed/'));
  const list = page.locator('[data-testid="friend-list"]');
  await expect(list.locator('a.friend-link')).toHaveCount(1);
  await expect(list.locator('a.friend-link')).toHaveAttribute('href', '../perfil/?u=rodrigo');
  await expect(list).toContainText('Paula');
  await expect(list).toContainText('Perfil privado');
});

test('tapping a card thumbnail shows the card large', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto(url('perfil/?u=rafa_exemplo'));
  await page.locator('[data-testid="showcase"] .thumb').first().click();
  await expect(page.locator('#iwZoom')).toBeVisible();
  await expect(page.locator('#iwZoom img')).toHaveAttribute('src', /lorcana-card-images/);
  await page.locator('#iwZoom').click();
  await expect(page.locator('#iwZoom')).toBeHidden();
});

test('profile background: pick a Location, it shows turned sideways; saved apart', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís', handle: 'luis', adult: true, is_public: false, invite_code: 'abc123def0', showcase: [] } });
  const covers = [];
  await page.route('**/rest/v1/rpc/set_my_cover', (route) => { covers.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 204, body: '' }); });
  await page.goto(url('perfil/?editar=1'));
  await page.locator('#coverPick').click();
  await page.locator('#pkQ').fill('white agony plains');
  await page.locator('#cardPicker [data-card="LOR10-102"] [data-use]').click();
  await expect(page.locator('[data-testid="ed-cover"]')).toContainText('Local');
  const cover = page.locator('#prev [data-testid="cover"]');
  await expect(cover).toHaveClass(/loc/);
  expect(await cover.locator('img.mi-loc').evaluate((i) => getComputedStyle(i).transform)).toMatch(/^matrix\([-0-9.e]+, 1(\.\d+)?, -1(\.\d+)?, /);
  await page.locator('#edSave').click();
  await expect(page.locator('#toast')).toContainText('Salvo');
  expect(rpcCalls(calls, 'save_my_profile').at(-1).p).not.toHaveProperty('cover_card');
  await expect.poll(() => covers).toEqual([{ p_card: 'LOR10-102' }]);
});

test('public profile shows its background card', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.route('**/rest/v1/rpc/profile_cover', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify('LOR12-195') }));
  await page.goto(url('perfil/?u=rafa_exemplo'));
  await expect(page.locator('[data-testid="cover"]')).toHaveAttribute('data-card', 'LOR12-195');
});

test('Início: write a post with a card, like and comment; tables & leagues with Vou', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, { mine: { display_name: 'Luís', adult: true } });
  const sent = [];
  let posts = [{ id: 'p1', author: 'u2', name: 'Rodrigo', handle: 'rodrigo', avatar: null, body: 'Olha meu deck <b>novo</b>', card: null, deck: { name: 'Steelsong', colors: ['Amber', 'Steel'], cards: { 'LOR14-1': 4, 'LOR10-10': 2 } },
    visibility: 'friends', at: new Date().toISOString(), mine: false, likes: 1, liked: false, comments_n: 0, comments: [] }];
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/rest/v1/profiles?**', (r) => json(r, [{ user_id: ME, display_name: 'Luís', default_visibility: 'friends' }]));
  await page.route('**/rest/v1/rpc/feed_posts', (r) => json(r, posts));
  await page.route('**/rest/v1/rpc/create_post', (r) => { const b = JSON.parse(r.request().postData()); sent.push(['create', b]); return json(r, { id: 'p2', author: 'me', name: 'Luís', body: b.p_body, card: b.p_card, foil: b.p_foil, deck: b.p_deck, visibility: b.p_visibility, at: new Date().toISOString(), mine: true, likes: 0, liked: false, comments_n: 0, comments: [] }); });
  await page.route('**/rest/v1/rpc/like_post', (r) => { sent.push(['like', JSON.parse(r.request().postData())]); return r.fulfill({ status: 204, body: '' }); });
  await page.route('**/rest/v1/rpc/comment_post', (r) => { const b = JSON.parse(r.request().postData()); sent.push(['comment', b]); return json(r, { ...posts[0], comments_n: 1, comments: [{ id: 'c1', name: 'Luís', body: b.p_body, at: new Date().toISOString(), mine: true }] }); });
  let ev = { id: 'e1', title: 'Liga de quinta', starts_at: '2030-01-03T22:00:00Z', place: 'Loja do Zé', community: 'Liga Campinas', slug: 'liga-campinas', going: 3, maybe: 0, me: null, capacity: 16 };
  await page.route('**/rest/v1/rpc/my_events', (r) => json(r, [ev]));
  await page.route('**/rest/v1/rpc/rsvp_event', (r) => { const b = JSON.parse(r.request().postData()); sent.push(['rsvp', b]); ev = { ...ev, me: b.p_status, going: 4 }; return json(r, ev); });
  await page.goto(url('feed/'));
  const post = page.locator('[data-spost="p1"]');
  await expect(post).toContainText('Olha meu deck <b>novo</b>');   // text, never HTML
  await expect(post.locator('[data-testid="post-deck"]')).toContainText('Steelsong');
  await post.locator('[data-like]').click();
  await expect(post.locator('[data-like]')).toHaveAttribute('aria-pressed', 'true');
  await post.locator('[data-pcmt]').click();
  await post.locator('[data-pform] input').fill('Boa!');
  await post.locator('[data-psend]').click();
  await expect(page.locator('[data-spost="p1"] .cmt')).toContainText('Boa!');
  await page.locator('#cmpText').fill('Puxei hoje!');
  await page.locator('#cmpCard').click();
  await page.locator('#pkQ').fill('rapunzel tower');
  await page.locator('#cardPicker [data-card="LOR13-80"] [data-use]').click();
  await expect(page.locator('[data-testid="att-card"]')).toBeVisible();
  await page.locator('#cmpGo').click();
  await expect(page.locator('[data-spost="p2"]')).toContainText('Puxei hoje!');
  expect(sent.find((x) => x[0] === 'create')[1]).toMatchObject({ p_body: 'Puxei hoje!', p_card: 'LOR13-80', p_visibility: 'friends' });
  expect(sent.find((x) => x[0] === 'like')[1]).toEqual({ p_post: 'p1', p_on: true });
  const evs = page.locator('[data-testid="home-events"]');
  await expect(evs).toContainText('Liga de quinta');
  await evs.locator('[data-rsvp="e1:going"]').click();
  await expect(evs.locator('[data-rsvp="e1:going"]')).toHaveAttribute('aria-pressed', 'true');
  expect(sent.find((x) => x[0] === 'rsvp')[1]).toEqual({ p_event: 'e1', p_status: 'going' });
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
});

test('Início: a post with several cards asks if it is a combo (up to 5)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, { mine: { display_name: 'Luís', adult: true } });
  const sent = [];
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/rest/v1/profiles?**', (r) => json(r, [{ user_id: ME, display_name: 'Luís', default_visibility: 'friends' }]));
  await page.route('**/rest/v1/rpc/feed_posts', (r) => json(r, [{ id: 'old', author: 'u2', name: 'Rodrigo', body: 'velho', card: 'LOR14-1', foil: false, visibility: 'friends', at: '2026-10-01T10:00:00Z', mine: false, likes: 0, comments_n: 0, comments: [] }]));
  await page.route('**/rest/v1/rpc/create_post', (r) => { const b = JSON.parse(r.request().postData()); sent.push(b); return json(r, { id: 'p3', author: 'me', name: 'Luís', body: b.p_body, card: b.p_card, foil: b.p_foil, cards: b.p_cards, combo: b.p_combo, visibility: b.p_visibility, at: new Date().toISOString(), mine: true, likes: 0, comments_n: 0, comments: [] }); });
  await page.goto(url('feed/'));
  await expect(page.locator('[data-spost="old"] .pcard')).toHaveCount(1);   // older posts: one card, no combo
  const add = async (q, id) => { await page.locator('#cmpCard').click(); await page.locator('#pkQ').fill(q); await page.locator(`#cardPicker [data-card="${id}"] [data-use]`).click(); };
  await page.locator('#cmpText').fill('Combo do dia');
  await add('rapunzel tower', 'LOR13-80');
  await expect(page.locator('[data-testid="combo-ask"]')).toHaveCount(0);
  await add('fru fru vip', 'LOR14-1');
  await expect(page.locator('[data-testid="att-card"]')).toHaveCount(2);
  await expect(page.locator('#cmpCard')).toContainText('2/5');
  await page.locator('#cmpGo').click();   // must answer first
  await expect(page.locator('#cmpMsg')).toContainText('combo');
  expect(sent).toHaveLength(0);
  await page.locator('[data-combo="1"]').click();
  await page.locator('#cmpGo').click();
  await expect(page.locator('[data-spost="p3"] [data-testid="combo-tag"]')).toBeVisible();
  await expect(page.locator('[data-spost="p3"] .pcard')).toHaveCount(2);
  if (process.env.SHOT2) await page.locator('[data-spost="p3"]').screenshot({ path: process.env.SHOT2 });
  expect(sent[0]).toMatchObject({ p_body: 'Combo do dia', p_card: 'LOR13-80', p_combo: true, p_cards: [{ id: 'LOR13-80', foil: false }, { id: 'LOR14-1', foil: false }] });
  // the 6th card can't be added
  for (const q of ['rapunzel tower', 'fru fru vip', 'gurgi apple', 'stitch', 'mickey']) { await page.locator('#cmpCard').click(); await page.locator('#pkQ').fill(q); await page.locator('#cardPicker [data-use]:not([disabled])').first().click(); }
  await expect(page.locator('[data-testid="att-card"]')).toHaveCount(5);
  await expect(page.locator('#cmpCard')).toBeDisabled();
  await page.locator('[data-testid="att-card"] [data-nocard]').first().click();
  await expect(page.locator('#cmpCard')).toBeEnabled();
});

test('global search: people and communities from the top bar, also with "/"', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís' } });
  const qs = [];
  await page.route('**/rest/v1/rpc/search_all', (r) => { const b = JSON.parse(r.request().postData()); qs.push(b.p_q); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    people: [{ uid: 'u2', name: 'Rodrigo', handle: 'rodrigo', friend: true }, { uid: 'u3', name: 'Rodolfo <b>', handle: null, friend: false }],
    communities: [{ slug: 'loja-do-ze', name: 'Loja do Zé', city: 'São Paulo', mine: true }] }) }); });
  await page.goto(url('colecao/'));
  await page.locator('#iwFind').click();
  await page.locator('#iwFindQ').fill('r');
  await expect(page.locator('#iwFindR')).toContainText('pelo menos 2');
  await page.locator('#iwFindQ').fill('rod');
  const res = page.locator('#iwFindR');
  await expect(res.locator('a[href="../perfil/?u=rodrigo"]')).toContainText('Amigo');
  await expect(res.locator('a[href="../feed/#amigos"]')).toContainText('Rodolfo <b>');   // text, never HTML
  await expect(res.locator('a[href="../comunidades/?c=loja-do-ze"]')).toContainText('Você participa');
  expect(qs).toEqual(['rod']);
  if (process.env.SHOT3) { await page.screenshot({ path: process.env.SHOT3 + '-d.png' }); await page.setViewportSize({ width: 360, height: 760 }); await page.screenshot({ path: process.env.SHOT3 + '-m.png' }); }
  await page.keyboard.press('Escape');
  await expect(page.locator('#iwFindQ')).toHaveCount(0);
  await page.locator('h1').first().click();   // somewhere neutral (the middle of the page can be a card or a button)
  await page.keyboard.press('/');
  await expect(page.locator('#iwFindQ')).toBeFocused();
});

test('push: turn notices on and off for this device', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís' } });
  await page.addInitScript(() => {
    let sub = null;
    Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
    Notification.requestPermission = async () => 'granted';
    PushManager.prototype.getSubscription = async function () { return sub; };
    PushManager.prototype.subscribe = async function (o) {
      window.__vapidLen = o.applicationServerKey.length;
      sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'P', auth: 'A' } }; }, async unsubscribe() { sub = null; return true; } };
      return sub;
    };
  });
  const calls = [];
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/rest/v1/rpc/my_notifications', (r) => json(r, []));
  await page.route('**/rest/v1/rpc/*_push_sub', (r) => { calls.push([new URL(r.request().url()).pathname.split('/').pop(), JSON.parse(r.request().postData())]); return r.fulfill({ status: 204, body: '' }); });
  await page.goto(url('colecao/'));
  await page.locator('#iwBell').click();
  await page.locator('[data-push="on"]').click();
  await expect(page.locator('#iwPush')).toContainText('Avisos ligados neste aparelho');
  expect(calls[0]).toEqual(['save_push_sub', expect.objectContaining({ p_endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p_p256dh: 'P', p_auth: 'A' })]);
  expect(await page.evaluate(() => window.__vapidLen)).toBe(65);
  await page.locator('[data-push="off"]').click();
  await expect(page.locator('[data-push="on"]')).toBeVisible();
  expect(calls[1]).toEqual(['delete_push_sub', { p_endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }]);
});

test('notifications: a bell with the unread count; opening marks them read', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís' } });
  let read = 0;
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/rest/v1/rpc/my_notifications', (r) => json(r, [
    { id: 'n1', kind: 'comment', name: 'Rodrigo', handle: 'rodrigo', ref: { post: 'p1', text: 'Olha meu deck' }, at: new Date().toISOString(), unread: true },
    { id: 'n2', kind: 'event', name: 'Bia', ref: { event: 'e1', slug: 'liga-campinas', text: 'Liga de quinta' }, at: new Date().toISOString(), unread: false },
    { id: 'n3', kind: 'event_near', ref: { rph: 9, text: 'Set Championship', store: 'Loja B', at: '2030-01-05T17:00:00Z' }, at: new Date().toISOString(), unread: false },
    { id: 'n4', kind: 'event_near_many', ref: { n: 5, text: 'Bela Vista, São Paulo' }, at: new Date().toISOString(), unread: false }]));
  await page.route('**/rest/v1/rpc/read_notifications', (r) => { read++; return r.fulfill({ status: 204, body: '' }); });
  await page.goto(url('colecao/'));
  await expect(page.locator('#iwBellN')).toHaveText('1');
  await page.locator('#iwBell').click();
  const m = page.locator('.menu.notif');
  await expect(m.locator('a[href="../feed/#post-p1"]')).toContainText('Rodrigo comentou no seu post');
  await expect(m.locator('a[href="../comunidades/?c=liga-campinas#mesas"]')).toContainText('Liga de quinta');
  await expect(m.locator('a[href="../eventos/"]').first()).toContainText('Evento novo perto de você: Set Championship');
  await expect(m.locator('a[href="../eventos/"]').first()).toContainText('Loja B');
  await expect(m.locator('a[href="../eventos/"]').nth(1)).toContainText('5 eventos novos perto de você em Bela Vista, São Paulo');
  expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBe('../inkwell.webmanifest');
  await expect.poll(() => read).toBe(1);
  await expect(page.locator('#iwBellN')).toBeHidden();
});

test('terms and privacy page, linked from the sign-in sheet', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto(url('feed/'));
  await page.locator('#iwSignIn').click();
  await page.locator('#iwSignSheet a[href="../privacidade/"]').click();
  await expect(page.locator('h1')).toHaveText('Termos e privacidade');
  await expect(page.locator('#app')).toContainText('Baixar meus dados');
  await expect(page.locator('#app')).toContainText('18 anos ou mais');
  await expect(page.locator('#app a[href="mailto:inkwell.lorcana@gmail.com"]')).toHaveCount(1);
});

test('notices: a count on the avatar and the list in the menu; Início marks messages seen', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís' } });
  await page.addInitScript((me) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(`inkwell-seen-${me}`, '2026-10-01T00:00:00Z'); sessionStorage.setItem('seeded', '1'); } }, ME);
  await page.goto(url('perfil/?u=rafa_exemplo'));
  await expect(page.locator('#iwBadge')).toHaveText('4');   // 1 request + 2 recados + 1 new community message
  await page.locator('#iwAcct').click();
  const menu = page.locator('.menu');
  await expect(menu).toContainText('Pedido de amizade');
  await expect(menu).toContainText('Recados para aprovar');
  await expect(menu).toContainText('Mensagens nas comunidades');
  await page.goto(url('feed/'));
  await expect(page.locator('[data-testid="fy-posts"]')).toBeVisible();
  await page.goto(url('perfil/?u=rafa_exemplo'));
  await expect(page.locator('#iwBadge')).toHaveText('3');   // the message was seen on Início
});

test('Meu Inkwell › Avisos: this device, and new events near my saved place (radius, on/off, remove)', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís', adult: true } });
  const sent = []; let place = { lat: -23.61, lng: -46.7, label: 'Cidade Jardim, São Paulo', km: 25, notify: true };
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/rest/v1/rpc/my_place', (r) => json(r, place));
  await page.route('**/rest/v1/rpc/set_my_place', (r) => { const b = JSON.parse(r.request().postData()); sent.push(['set', b]); place = { lat: b.p_lat, lng: b.p_lng, label: b.p_label, km: b.p_km, notify: b.p_notify }; return json(r, place); });
  await page.route('**/rest/v1/rpc/delete_my_place', (r) => { sent.push(['delete']); place = null; return r.fulfill({ status: 204, body: '' }); });
  await page.route('**/rest/v1/rpc/my_notifications', (r) => json(r, []));
  await page.goto(url('perfil/#avisos'));
  const box = page.locator('[data-testid="my-notices"]');
  await expect(box.locator('[data-testid="nt-near"]')).toContainText('Perto de Cidade Jardim, São Paulo');
  await expect(box.locator('[data-testid="nt-device"]')).toBeVisible();
  await box.locator('#ntKm').selectOption('10');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual(['set', { p_lat: -23.61, p_lng: -46.7, p_label: 'Cidade Jardim, São Paulo', p_km: 10, p_notify: true }]);
  await box.locator('#ntOn').uncheck();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1][1]).toMatchObject({ p_km: 10, p_notify: false });
  await box.locator('#ntDel').click();
  await box.locator('#ntDel').click();
  await expect.poll(() => sent.at(-1)).toEqual(['delete']);
  await expect(box.locator('[data-testid="nt-near"]')).toContainText('Desligado');
  // the bell links here
  await page.locator('#iwBell').click();
  await expect(page.locator('[data-testid="notif-settings"]')).toHaveAttribute('href', '../perfil/#avisos');
});

test('invite friends to Inkwell: from "Para você" and from the account menu, with my invite link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page, { mine: { display_name: 'Luís', handle: 'luis', is_public: true, invite_code: 'abc123def0' } });
  await page.addInitScript(() => { delete Navigator.prototype.share; });
  await page.goto(url('feed/'));
  await page.locator('[data-testid="fy-invite"]').click();
  await expect(page.locator('[data-testid="fy-invite"]')).toContainText('Link copiado');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/Vem para o Inkwell!.*\/perfil\/\?convite=abc123def0&u=luis$/);
  await page.locator('#iwAcct').click();
  await page.locator('.menu [data-invite]').click();
  await expect(page.locator('.menu [data-invite]')).toContainText('Link copiado');
});

// ---------- Conquistas (supabase/achievements.sql) ----------
const ACH1 = { id: 'a1', kind: 'set_championship', title: 'Campeão do Set Championship', body: 'Steelsong 6-0', on: '2026-10-25', place: 'Loja do Zé', image: `${ME}/abc12345-0000.jpg`, visibility: 'public', mine: true };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGM4Mc0IjhiI4wAAk7IZAVNpIBEAAAAASUVORK5CYII=', 'base64');

test('achievements: add one with a photo (resized, sent to storage), friends told on Início; listed in the editor; deleted with its photo', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís', handle: 'luis', is_public: true, adult: true } });
  let list = [];
  const sent = [];
  const json = (r, v) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/rest/v1/rpc/achievements_of', (r) => json(r, list));
  await page.route('**/rest/v1/rpc/save_achievement', (r) => { const b = JSON.parse(r.request().postData()).p; sent.push(['save', b]); list = [{ ...b, id: 'a1', mine: true }]; return json(r, 'a1'); });
  await page.route('**/rest/v1/rpc/delete_achievement', (r) => { sent.push(['delete']); const img = list[0].image; list = []; return json(r, img); });
  await page.route('**/storage/v1/**', (r) => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS }); if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); const u = new URL(r.request().url()); sent.push(['storage', r.request().method(), u.pathname.replace(/.*\/storage\/v1\//, ''), r.request().headers()['content-type']]);
    return u.pathname.includes('/object/sign/') ? json(r, JSON.parse(r.request().postData()).paths.map((p) => ({ path: p, signedURL: `/object/sign/achievements/${p}?token=t` }))) : json(r, {}); });
  await page.goto(url('perfil/?editar=1'));
  await expect(page.locator('#myAchs')).toContainText('Nenhuma conquista ainda');
  await page.locator('[data-testid="ach-add"]').click();
  const form = page.locator('[data-testid="ach-form"]');
  await form.locator('[data-k="set_championship"]').click();
  await expect(form.locator('#aTitle')).toHaveAttribute('placeholder', 'Campeão do Set Championship');
  await form.locator('#aPlace').fill('Loja do Zé');
  await form.locator('#aBody').fill('Steelsong 6-0');
  await form.locator('[data-testid="ach-photo"]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await expect(form.locator('img.ach-img')).toBeVisible();
  await expect(form.locator('#aPublic')).toBeChecked();   // public profile: public by default
  await page.locator('[data-testid="ach-save"]').click();
  await expect(page.locator('#toast')).toContainText('seus amigos veem no Início');
  const up = sent.find((x) => x[0] === 'storage' && x[1] === 'POST' && !x[2].includes('/sign/'));
  expect(up[2]).toMatch(new RegExp(`^object/achievements/${ME}/[0-9a-f-]{36}\\.jpg$`));
  expect(up[3]).toBe('image/jpeg');   // re-encoded on the device
  const save = sent.find((x) => x[0] === 'save')[1];
  expect(save).toMatchObject({ id: '', kind: 'set_championship', title: 'Campeão do Set Championship', place: 'Loja do Zé', body: 'Steelsong 6-0', visibility: 'public', announce: true });
  expect(save.image).toBe(up[2].replace('object/achievements/', ''));
  const card = page.locator('#myAchs [data-ach="a1"]');
  await expect(card).toContainText('Campeão do Set Championship');
  await expect(card.locator('img')).toHaveAttribute('src', /storage\/v1\/object\/sign\/achievements\//);
  await card.locator('[data-ach-del="a1"]').click();
  await card.locator('[data-ach-del="a1"]').click();
  await expect(page.locator('#myAchs')).toContainText('Nenhuma conquista ainda');
  expect(sent.some((x) => x[0] === 'storage' && x[1] === 'DELETE')).toBe(true);   // the photo goes too
});

test('achievements show on a public profile, and on Início when announced', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, { mine: { display_name: 'Luís', adult: true } });
  const json = (r, v) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/rest/v1/rpc/achievements_of', (r) => json(r, [{ ...ACH1, mine: false }]));
  await page.route('**/rest/v1/rpc/achievements_by_ids', (r) => json(r, [{ ...ACH1, mine: false }]));
  await page.route('**/storage/v1/object/sign/**', (r) => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: CORS }) : r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : json(r, JSON.parse(r.request().postData()).paths.map((p) => ({ path: p, signedURL: `/object/sign/achievements/${p}?token=t` }))));
  await page.goto(url('perfil/?u=rafa_exemplo'));
  await expect(page.locator('[data-testid="achievements"]')).toHaveCount(1);   // example profiles: none
  await page.goto(url('perfil/?u=ana'));
  const box = page.locator('[data-testid="achievements"]');
  await expect(box).toBeVisible();
  await expect(box).toContainText('Campeão do Set Championship');
  await expect(box).toContainText('Loja do Zé');
  await expect(box.locator('img')).toHaveAttribute('src', /object\/sign\/achievements\//);
  await page.route('**/rest/v1/profiles?**', (r) => json(r, [{ user_id: ME, display_name: 'Luís', default_visibility: 'friends' }]));
  await page.route('**/rest/v1/rpc/feed_posts', (r) => json(r, [{ id: 'p9', author: 'u2', name: 'Ana', handle: 'ana', avatar: null, body: 'Campeão do Set Championship', achievement: 'a1', visibility: 'friends', at: new Date().toISOString(), mine: false, likes: 0, liked: false, comments_n: 0, comments: [] }]));
  await page.goto(url('feed/'));
  const post = page.locator('[data-testid="post-achievement"]');
  await expect(post).toContainText('Set Championship');
  await expect(post).toContainText('Steelsong 6-0');
  await expect(post.locator('img')).toBeVisible();
});

test('achievements: link the Play Hub event (one marked in Eventos, or a pasted link); the card links to it', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís', handle: 'luis', is_public: true, adult: true } });
  let list = [];
  const saves = [];
  const json = (r, v) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  const past = new Date(Date.now() - 3 * 864e5).toISOString();
  await page.route('**/rest/v1/rpc/my_event_marks', (r) => json(r, [{ rph_id: 412345, status: 'going', snap: { name: 'Liga de Terça', store: 'Loja do Zé', start: past } },
    { rph_id: 999, status: 'going', snap: { name: 'Futuro', store: 'X', start: new Date(Date.now() + 9 * 864e5).toISOString() } }]));
  await page.route('**/functions/v1/rph-events**', (r) => json(r, { id: 777, name: 'Set Championship - October 25, 2026', store: { name: 'Taverna' }, start: '2026-10-25T17:00:00Z' }));
  await page.route('**/rest/v1/rpc/achievements_of', (r) => json(r, list));
  await page.route('**/rest/v1/rpc/save_achievement', (r) => { const b = JSON.parse(r.request().postData()).p; saves.push(b); list = [{ ...b, id: 'a1', mine: true }]; return json(r, 'a1'); });
  await page.goto(url('perfil/?editar=1'));
  await page.locator('[data-testid="ach-add"]').click();
  await page.locator('[data-testid="ach-event-open"]').click();
  const pick = page.locator('[data-testid="ach-event-pick"]');
  await expect(pick).toContainText('Liga de Terça');
  await expect(pick).not.toContainText('Futuro');   // only events that already happened
  await pick.locator('[data-ev="412345"]').click();
  await expect(page.locator('[data-testid="ach-event"]')).toContainText('Liga de Terça');
  await expect(page.locator('#aPlace')).toHaveValue('Loja do Zé');
  await expect(page.locator('#aOn')).toHaveValue(past.slice(0, 10) === new Date(past).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) ? past.slice(0, 10) : new Date(past).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
  // change it to a pasted link
  await page.locator('#evChange').click();
  await page.locator('#evLink').fill('https://tcg.ravensburgerplay.com/events/777');
  await page.locator('#evFind').click();
  await expect(page.locator('[data-testid="ach-event"]')).toContainText('Set Championship');
  await expect(page.locator('#aOn')).toHaveValue('2026-10-25');
  await page.locator('[data-testid="ach-save"]').click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]).toMatchObject({ rph_id: '777', rph_name: 'Set Championship', rph_store: 'Taverna', on: '2026-10-25', place: 'Loja do Zé' });
  await expect(page.locator('#myAchs [data-testid="ach-rph"]')).toHaveAttribute('href', 'https://tcg.ravensburgerplay.com/events/777');
});

test('on a phone, the date field is as wide as the other fields (iPhone draws it its own way)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { mine: { display_name: 'Luís', handle: 'luis', is_public: true, adult: true } });
  await page.route('**/rest/v1/rpc/achievements_of', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(url('perfil/?editar=1'));
  await page.locator('[data-testid="ach-add"]').click();
  const w = async (sel) => (await page.locator(sel).boundingBox()).width;
  expect(Math.abs(await w('#aOn') - await w('#aTitle'))).toBeLessThan(2);
  expect(await page.locator('#aOn').evaluate((e) => getComputedStyle(e).textAlign)).toBe('left');
});

test('Registrar conquista from a past event opens the form with that event', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís', handle: 'luis', is_public: true, adult: true } });
  const json = (r, v) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/rest/v1/rpc/achievements_of', (r) => json(r, []));
  await page.route('**/rest/v1/rpc/my_event_marks', (r) => json(r, [{ rph_id: 90, status: 'went', snap: { name: 'Set Championship - Winterspell', store: 'Tuzzy', start: '2026-10-30T22:00:00Z' } }]));
  await page.goto(url('perfil/?editar=1&conquista=90'));
  await expect(page.locator('[data-testid="ach-event"]')).toContainText('Set Championship - Winterspell');
  await expect(page.locator('#aOn')).toHaveValue('2026-10-30');
  await expect(page.locator('#aPlace')).toHaveValue('Tuzzy');
  await expect(page).not.toHaveURL(/conquista=/);
});

test('Início: reply to a comment (one level, @name), like a comment, delete my reply', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, { mine: { display_name: 'Luís', adult: true } });
  const sent = [];
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  const at = new Date().toISOString();
  const c1 = { id: 'c1', name: 'Bia', handle: 'bia', body: 'Que deck!', at, mine: false, parent: null, likes: 1, liked: false };
  const c2 = { id: 'c2', name: 'Luís', body: 'Valeu', at, mine: true, parent: 'c1', reply_name: 'Bia', likes: 0, liked: false };
  let post = { id: 'p1', author: 'u2', name: 'Rodrigo', handle: 'rodrigo', body: 'post', visibility: 'friends', at, mine: false, likes: 0, liked: false, comments_n: 2, comments: [c1, c2] };
  await page.route('**/rest/v1/profiles?**', (r) => json(r, [{ user_id: ME, display_name: 'Luís', default_visibility: 'friends' }]));
  await page.route('**/rest/v1/rpc/feed_posts', (r) => json(r, [post]));
  await page.route('**/rest/v1/rpc/like_comment', (r) => { sent.push(['like', JSON.parse(r.request().postData())]); return r.fulfill({ status: 204, body: '' }); });
  await page.route('**/rest/v1/rpc/comment_post', (r) => { const b = JSON.parse(r.request().postData()); sent.push(['comment', b]); return json(r, post); });
  await page.route('**/rest/v1/rpc/post_comments_all', (r) => json(r, [c1, c2, { id: 'c3', name: 'Luís', body: 'De novo', at, mine: true, parent: 'c1', reply_name: 'Bia', likes: 0, liked: false }]));
  await page.route('**/rest/v1/rpc/moderate_post', (r) => { sent.push(['del', JSON.parse(r.request().postData())]); return r.fulfill({ status: 204, body: '' }); });
  await page.goto(url('feed/'));
  const p = page.locator('[data-spost="p1"]');
  await expect(p.locator('.cmt.reply')).toContainText('@Bia Valeu');
  // like Bia's comment
  await p.locator('[data-clike="c1"]').click();
  await expect(p.locator('[data-clike="c1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(p.locator('[data-clike="c1"]')).toContainText('2');
  expect(sent[0]).toEqual(['like', { p_comment: 'c1', p_on: true }]);
  // reply to Bia
  await p.locator('[data-creply="c1"]').click();
  await expect(p.locator('.replying')).toContainText('Respondendo a Bia');
  await p.locator('[data-pform] input').fill('De novo');
  await p.locator('[data-psend]').click();
  await expect(p.locator('.cmt.reply')).toHaveCount(2);
  expect(sent[1]).toEqual(['comment', { p_post: 'p1', p_body: 'De novo', p_reply: 'c1' }]);
  // a plain comment again has no p_reply
  await p.locator('[data-pcmt]').click(); await p.locator('[data-pcmt]').click();
  await expect(p.locator('.replying')).toBeHidden();
  // the post author is not me, but my reply c2 is mine: delete it (asks twice)
  await p.locator('[data-cdel="c2"]').click(); await p.locator('[data-cdel="c2"]').click();
  await expect(p.locator('[data-cmt-id="c2"]')).toHaveCount(0);
  await expect(p.locator('[data-cmt-id="c1"]')).toContainText('Que deck!');
});

test('the bell: a reply, and comment likes grouped per comment', async ({ page }) => {
  await setup(page, { mine: { display_name: 'Luís' } });
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  const at = new Date().toISOString();
  await page.route('**/rest/v1/rpc/my_notifications', (r) => json(r, [
    { id: 'n1', kind: 'reply', name: 'Bia', ref: { post: 'p1', comment: 'c9' }, at, unread: true },
    { id: 'n2', kind: 'comment_like', name: 'Ana', ref: { post: 'p1', comment: 'c1' }, at, unread: true },
    { id: 'n3', kind: 'comment_like', name: 'Caio', ref: { post: 'p1', comment: 'c1' }, at, unread: true },
    { id: 'n4', kind: 'comment_like', name: 'Duda', ref: { post: 'p1', comment: 'c1' }, at, unread: false }]));
  await page.route('**/rest/v1/rpc/read_notifications', (r) => r.fulfill({ status: 204, body: '' }));
  await page.goto(url('colecao/'));
  await page.locator('#iwBell').click();
  const m = page.locator('.menu.notif');
  await expect(m.locator('.menu-item')).toHaveCount(2);
  await expect(m.locator('.menu-item').first()).toContainText('Bia respondeu seu comentário');
  await expect(m.locator('.menu-item').nth(1)).toContainText('Ana e mais 2 curtiram seu comentário');
  await expect(page.locator('#iwBellN')).toBeHidden();
});

test('Enviar feedback: a visitor from the footer, with an e-mail', async ({ page }) => {
  let calls = await setup(page, { signedIn: false });
  await page.goto(url('decks/'));
  await page.locator('[data-testid="feedback-open"]').click();
  const fb = page.locator('#iwFeedback');
  await expect(fb).toBeVisible();
  await fb.locator('[data-fbk="idea"]').click();
  await expect(fb).toContainText('Qual é a ideia?');
  await fb.locator('#iwFbText').fill('Filtro por set');
  await fb.locator('#iwFbMail').fill('eu@exemplo.com');
  await fb.locator('#iwFbSend').click();
  await expect(fb.locator('[data-testid="feedback-done"]')).toContainText('Recebido');
  const b = rpcCalls(calls, 'send_feedback')[0];
  expect(b).toMatchObject({ p_kind: 'idea', p_body: 'Filtro por set', p_page: 'decks', p_path: '/decks/', p_email: 'eu@exemplo.com' });
  expect(b.p_device).toContain('x');
});

test('Enviar feedback: a member from the menu; unticking the device sends no page or browser', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís' } });
  await page.goto(url('colecao/'));
  await page.locator('#iwAcct').click();
  await page.locator('.menu [data-feedback]').click();
  const fb = page.locator('#iwFeedback');
  await expect(fb.locator('#iwFbMail')).toHaveCount(0);
  await fb.locator('#iwFbText').fill('ok');
  await fb.locator('#iwFbSend').click();
  await expect(fb.locator('#iwFbMsg')).toContainText('Escreva um pouco mais');
  await fb.locator('#iwFbText').fill('O botão de importar some');
  await fb.locator('#iwFbDev').uncheck();
  await fb.locator('#iwFbSend').click();
  await expect(fb.locator('[data-testid="feedback-done"]')).toBeVisible();
  expect(rpcCalls(calls, 'send_feedback')[0]).toEqual({ p_kind: 'bug', p_body: 'O botão de importar some', p_page: 'cards', p_path: null, p_device: null, p_email: null });
});

test('admin: Feedback tab (from the notice link), text shown as text, mark as handled', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís' }, admin: true });
  await page.goto(url('admin/?tab=feedback'));
  const list = page.locator('[data-testid="feedback"]');
  await expect(list.locator('.adm-row')).toHaveCount(1);
  await expect(list).toContainText('O scanner <b>não</b> abre');
  await expect(list).toContainText('Visitante · eu@exemplo.com');
  await expect(list).toContainText('Coleção · /inkwell/colecao/');
  await expect(page.locator('[data-tab="feedback"] .count')).toHaveText('1');
  await page.locator('[data-fbf="all"]').click();
  await expect(list.locator('.adm-row')).toHaveCount(2);
  await page.locator('[data-fbdone="f1"]').click();
  await expect.poll(() => rpcCalls(calls, 'admin_feedback_done')[0]).toEqual({ p_id: 'f1', p_done: true });
});
