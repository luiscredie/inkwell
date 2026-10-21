// Comunidades (/comunidades/) against a fake Supabase.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/comunidades.spec.mjs
import { test, expect } from '@playwright/test';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';
const url = (p) => new URL(p, ROOT).href;
const ME = '11111111-1111-4111-8111-111111111111';

const LIST = [
  { slug: 'taverna-da-tinta-exemplo', name: 'Taverna da Tinta (exemplo)', kind: 'store', city: 'São Paulo', description: 'Loja fictícia de exemplo.', avatar: 'LOR10-178', mock: true, members: 3, mine: false },
  { slug: 'liga-campinas', name: 'Liga Campinas', kind: 'city', city: 'Campinas', description: 'Quem joga em Campinas.', avatar: 'LOR14-2', mock: false, members: 1, mine: true },
];
const VIEW = {
  'taverna-da-tinta-exemplo': { slug: 'taverna-da-tinta-exemplo', name: 'Taverna da Tinta (exemplo)', kind: 'store', city: 'São Paulo', description: 'Loja fictícia de exemplo.', avatar: 'LOR10-178', mock: true,
    member_n: 3, members: [{ name: 'Rafa (exemplo)', handle: 'rafa_exemplo', avatar: 'LOR12-239', role: 'owner' }], week_posts: 3,
    posts: [{ id: 'p1', body: 'Quinta tem liga às 19h.', at: '2026-10-20T10:00:00Z', name: 'Rafa (exemplo)', handle: 'rafa_exemplo', avatar: 'LOR12-239', mine: false }], role: null, can_join: false, manage: null },
  'loja-aberta': { slug: 'loja-aberta', name: 'Loja Aberta', kind: 'store', city: 'Santos', description: '', avatar: null, mock: false,
    member_n: 5, members: [], week_posts: 2, posts: null, role: null, can_join: true, manage: null },
  'liga-campinas': { slug: 'liga-campinas', name: 'Liga Campinas', kind: 'city', city: 'Campinas', description: 'Quem joga em Campinas.', avatar: 'LOR14-2', mock: false,
    member_n: 2, members: [], week_posts: 1,
    posts: [{ id: 'p9', body: 'Oi, pessoal!', at: '2026-10-21T10:00:00Z', name: 'Ana', handle: null, avatar: null, mine: false }], role: 'owner', can_join: false,
    manage: [{ uid: ME, name: 'Luís', role: 'owner' }, { uid: '33333333-3333-4333-8333-333333333333', name: 'Ana', role: 'member' }] },
};

async function setup(page, { signedIn = true, adult = true } = {}) {
  const calls = [];
  await page.addInitScript(([me, signed]) => {
    localStorage.setItem('inkwell-lang', 'pt');
    if (!signed) return;
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, [ME, signedIn]);
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ path, body });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'rpc/communities_list') return json(LIST);
    if (path === 'rpc/community_view') return json(VIEW[body.p_slug] || null);
    if (path === 'rpc/my_profile') return json({ display_name: 'Luís', adult, hidden: false });
    if (path === 'rpc/create_community') return json({ slug: 'liga-campinas' });
    if (['rpc/join_community', 'rpc/post_in_community', 'rpc/moderate_community', 'rpc/report_community_post', 'rpc/update_community'].includes(path)) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    if (path === 'rpc/my_duels_sync') return json(null);
    return json([]);
  });
  return calls;
}
const rpcCalls = (calls, name) => calls.filter((c) => c.path === `rpc/${name}`).map((c) => c.body);

test('list: search, mine, example marked; create needs 18+', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(url('comunidades/'));
  const cards = page.locator('[data-testid="communities"] .cm-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('exemplo');
  await page.locator('#q').fill('campinas');
  await expect(cards).toHaveCount(1);
  await page.locator('#q').fill('');
  await page.locator('[data-tab="mine"]').click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Liga Campinas');
  await page.locator('#newC').click();
  await page.locator('#fN').fill('Liga Campinas');
  await page.locator('#sheet [data-k="city"]').click();
  await page.locator('#fC').fill('Campinas');
  await page.locator('#cfSave').click();
  await expect(page).toHaveURL(/\?c=liga-campinas/);
  expect(rpcCalls(calls, 'create_community')[0].p).toMatchObject({ name: 'Liga Campinas', kind: 'city', city: 'Campinas' });
});

test('without 18+ there is no create button', async ({ page }) => {
  await setup(page, { adult: false });
  await page.goto(url('comunidades/'));
  await expect(page.locator('[data-testid="communities"]')).toBeVisible();
  await expect(page.locator('#newC')).toHaveCount(0);
});

test('an example community is open to read and marked as fictional', async ({ page }) => {
  await setup(page, { signedIn: false });
  await page.goto(url('comunidades/?c=taverna-da-tinta-exemplo'));
  await expect(page.locator('[data-testid="mock-banner"]')).toContainText('comunidade fictícia');
  await expect(page.locator('[data-testid="conversation"]')).toContainText('Quinta tem liga às 19h.');
  await expect(page.locator('#compose')).toHaveCount(0);
  await expect(page.locator('#signIn')).toBeVisible();
});

test('a real community: conversation locked until you join', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(url('comunidades/?c=loja-aberta'));
  await expect(page.locator('[data-testid="locked"]')).toContainText('só para membros');
  await expect(page.locator('[data-testid="locked"]')).toContainText('2 mensagens esta semana');
  await page.locator('#join').click();
  await expect.poll(() => rpcCalls(calls, 'join_community')).toEqual([{ p_slug: 'loja-aberta', p_join: true }]);
});

test('owner: post, hide, report, delete with a second tap, remove a member', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(url('comunidades/?c=liga-campinas'));
  await page.locator('#body').fill('Sexta tem torneio!');
  await page.locator('#compose button[type=submit]').click();
  await expect.poll(() => rpcCalls(calls, 'post_in_community')).toEqual([{ p_slug: 'liga-campinas', p_body: 'Sexta tem torneio!' }]);
  const post = page.locator('[data-post="p9"]');
  await post.locator('[data-pa="hide_post"]').click();
  await expect.poll(() => rpcCalls(calls, 'moderate_community')).toEqual([{ p_action: 'hide_post', p_post: 'p9' }]);
  await page.locator('[data-post="p9"] [data-pa="delete_post"]').click();
  await expect(page.locator('[data-post="p9"] [data-pa="delete_post"]')).toHaveText('Toque de novo para confirmar');
  await page.locator('[data-post="p9"] [data-pa="delete_post"]').click();
  await expect.poll(() => rpcCalls(calls, 'moderate_community').length).toBe(2);
  await page.locator('[data-post="p9"] [data-pa="report"]').click();
  await page.locator('#rpWhy').fill('Spam de venda');
  await page.locator('#rpSend').click();
  await expect.poll(() => rpcCalls(calls, 'report_community_post')).toEqual([{ p_post: 'p9', p_reason: 'Spam de venda' }]);
  await page.locator('#manage').click();
  await page.locator('[data-rm="33333333-3333-4333-8333-333333333333"]').click();
  await page.locator('[data-rm="33333333-3333-4333-8333-333333333333"]').click();
  await expect.poll(() => rpcCalls(calls, 'moderate_community').at(-1)).toEqual({ p_action: 'remove_member', p_slug: 'liga-campinas', p_user: '33333333-3333-4333-8333-333333333333' });
});
