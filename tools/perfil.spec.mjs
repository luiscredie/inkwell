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
