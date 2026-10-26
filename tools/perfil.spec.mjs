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
  expect(order.slice(0, 2)).toEqual(['landHero', 'landEx']);   // examples right below the hero
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
  expect(await cover.locator('img.mi-loc').evaluate((i) => getComputedStyle(i).transform)).toMatch(/matrix\(0, 1, -1, 0|matrix\([-0-9.e]+, 1, -1/);
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
