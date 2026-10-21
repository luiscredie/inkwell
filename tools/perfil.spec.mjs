// My Inkwell (/perfil/), the public home (/feed/ signed out) and the admin panel (/admin/) against a fake Supabase.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/perfil.spec.mjs
import { test, expect } from '@playwright/test';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';
const url = (p) => new URL(p, ROOT).href;
const ME = '11111111-1111-4111-8111-111111111111';

const USER1 = {
  handle: 'user1', name: 'user1 (exemplo)', bio: 'Perfil fictício de exemplo.', avatar: 'LOR14-2', inks: ['Amber', 'Steel'], city: 'São Paulo', mock: true,
  showcase: [{ id: 'LOR13-80', own: true }, { id: 'LOR14-1', own: true }, { id: 'LOR10-10', own: false }],
  deck: { name: 'Amber/Steel exemplo', format: 'core', colors: ['Amber', 'Steel'], cards: { 'LOR14-1': 4, 'LOR14-10': 4, 'LOR14-11': 4 } },
  record: { w: 8, l: 4 }, trade: { want: ['LOR14-3'], have: [] },
};

async function setup(page, { signedIn = true, mine = null, admin = false } = {}) {
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
    calls.push({ path, body });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'rpc/public_profile') return json(body.p_handle === 'user1' ? USER1 : body.p_handle === 'ana' ? { ...USER1, handle: 'ana', name: 'Ana', mock: false } : null);
    if (path === 'rpc/example_profiles') return json([USER1, { ...USER1, handle: 'user2', name: 'user2 (exemplo)', deck: null }]);
    if (path === 'rpc/my_profile') return json(myRow ? { ...myRow, is_admin: admin } : null);
    if (path === 'rpc/save_my_profile') { myRow = { ...(myRow || {}), ...body.p, invite_code: 'abc123def0', hidden: false }; return json(myRow); }
    if (path === 'rpc/invite_info') return json(body.p_code === 'abc123def0' ? { name: 'Luís', handle: null } : null);
    if (path === 'rpc/accept_invite') return json({ ok: true, name: 'Luís' });
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

test('public home explains Inkwell and shows example profiles marked as fictional', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto(url('feed/'));
  const home = page.locator('[data-testid="public-home"]');
  await expect(home.locator('h1')).toHaveText('Seu canto na comunidade de Lorcana');
  await expect(home.locator('.land-feat')).toHaveCount(5);
  await expect(page.locator('[data-testid="example-profile"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="example-profile"]').first()).toContainText('Exemplo · perfil fictício');
  await page.locator('[data-testid="example-profile"]').first().click();
  await expect(page).toHaveURL(/perfil\/\?u=user1/);
  await expect(page.locator('[data-testid="mock-banner"]')).toContainText('perfil fictício');
});

test('a public profile shows only what its owner picked; signed out there is no report button', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto(url('perfil/?u=user1'));
  const p = page.locator('[data-testid="profile"]');
  await expect(p.locator('.mi-name')).toHaveText('user1 (exemplo)');
  await expect(p).toContainText('@user1');
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

test('my profile: private by default; public needs an address and 18+; card and invite', async ({ page }) => {
  const calls = await setup(page, { mine: { display_name: 'Luís', handle: null, bio: '', inks: [], city: '', showcase: [], is_public: false, adult: false, show_record: true, show_trade: false, invite_code: 'abc123def0' } });
  await page.goto(url('perfil/?editar=1'));
  await expect(page.locator('[data-testid="status"]')).toHaveText('Privado');
  await expect(page.locator('#fPublic')).toBeDisabled();
  await expect(page.locator('#fCity')).toBeDisabled();
  await page.locator('#fHandle').fill('Luis Credie!');
  await expect(page.locator('#fHandle')).toHaveValue('luiscredie');
  await page.locator('#fBio').fill('Jogo Amber/Steel.');
  await page.locator('.ed-inks [data-ink="Amber"]').click();
  await page.locator('.ed-inks [data-ink="Steel"]').click();
  await page.locator('.ed-inks [data-ink="Ruby"]').click();   // a third ink replaces the oldest
  await page.locator('#qAv').fill('abuelita');
  await page.locator('#avRes [data-pick]').first().click();
  await page.locator('#qShow').fill('rapunzel tower');
  await page.locator('#showRes [data-pick="LOR13-80"]').click();
  await page.locator('#qShow').fill('fru fru');
  await page.locator('#showRes [data-pick="LOR14-1"]').click();
  await expect(page.locator('[data-sk="0:own"]')).toHaveAttribute('aria-pressed', 'true');   // owned: Rapunzel
  await expect(page.locator('[data-sk="1:own"]')).toBeDisabled();                             // not owned: Fru Fru
  await page.locator('#fDeck').selectOption('d1');
  await page.locator('#fAdult').check();
  await page.locator('#fCity').fill('São Paulo');
  await page.locator('#fPublic').check();
  await page.locator('#edSave').click();
  await expect(page.locator('#toast')).toContainText('Salvo');
  const saved = rpcCalls(calls, 'save_my_profile')[0].p;
  expect(saved).toMatchObject({ handle: 'luiscredie', bio: 'Jogo Amber/Steel.', inks: ['Steel', 'Ruby'], adult: true, is_public: true, city: 'São Paulo', featured_deck: 'd1',
    showcase: [{ id: 'LOR13-80', k: 'own' }, { id: 'LOR14-1', k: 'fav' }] });
  expect(saved.avatar_card).toBeTruthy();
  await expect(page.locator('[data-testid="status"]')).toHaveText('Público');
  await expect(page.locator('#invLink')).toHaveValue(/perfil\/\?convite=abc123def0&u=luiscredie$/);
  await page.locator('#pcMake').click();
  await expect(page.locator('[data-testid="player-card"]')).toBeVisible();
  const size = await page.locator('[data-testid="player-card"]').evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  expect(size).toEqual([1080, 1350]);
});

test('an invite link: shown signed out, accepted after signing in', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto(url('perfil/?convite=abc123def0'));
  await expect(page.locator('[data-testid="invite"]')).toContainText('Luís convidou você para o Inkwell');
  expect(await page.evaluate(() => localStorage.getItem('inkwell-invite'))).toBe('abc123def0');

  const page2 = await page.context().newPage();
  const calls = await setup(page2, { mine: { display_name: 'Ana', handle: null, invite_code: 'zzz' } });
  await page2.goto(url('perfil/?editar=1'));
  await expect(page2.locator('#toast')).toContainText('Agora você e Luís são amigos');
  expect(rpcCalls(calls, 'accept_invite')).toEqual([{ p_code: 'abc123def0' }]);
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
