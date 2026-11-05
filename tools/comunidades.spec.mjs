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
    manage: [{ uid: ME, name: 'Luís', role: 'owner' }, { uid: '33333333-3333-4333-8333-333333333333', name: 'Ana', role: 'member', adult: true }] },
  'loja-do-ze': { slug: 'loja-do-ze', name: 'Loja do Zé', kind: 'store', city: 'São Paulo', description: 'Liga às quintas.', avatar: null, mock: false,
    contact: { address: 'Rua das Flores, 10', phone: '(11) 98765-4321', email: 'contato@lojadoze.com.br', site: 'https://lojadoze.com.br', instagram: 'lojadoze' },
    member_n: 2, members: [], week_posts: 0, posts: [], role: 'owner', can_join: false,
    manage: [{ uid: ME, name: 'Luís', role: 'owner' }, { uid: '44444444-4444-4444-8444-444444444444', name: 'Bia', role: 'member', adult: true }] },
};

async function setup(page, { signedIn = true, adult = true, rpcs = {}, fn = null } = {}) {
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
    if (rpcs[path]) { const v = rpcs[path](body); return v === undefined ? route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }) : json(v); }
    if (path === 'rpc/communities_list') return json(LIST);
    if (path === 'rpc/community_view') return json(VIEW[body.p_slug] || null);
    if (path === 'rpc/my_profile') return json({ display_name: 'Luís', adult, hidden: false });
    if (path === 'rpc/create_community') return json({ slug: 'liga-campinas' });
    if (['rpc/join_community', 'rpc/post_in_community', 'rpc/moderate_community', 'rpc/report_community_post', 'rpc/update_community', 'rpc/set_community_role', 'rpc/transfer_community'].includes(path)) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    if (path === 'rpc/my_duels_sync') return json(null);
    return json([]);
  });
  if (fn) await page.route('**/functions/v1/rph-events**', (route) => {
    const q = Object.fromEntries(new URL(route.request().url()).searchParams);
    calls.push({ path: 'fn', q });
    const r = fn(q);
    return r instanceof Error ? route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"play hub 503"}' }) : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
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
  await expect(page.getByTestId('cm-young')).toContainText('O Inkwell é novo: por enquanto são poucas comunidades.');   // no pretending it is busy
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

test('store: contact for everyone; owner edits it, makes an admin and hands over the community', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(url('comunidades/?c=loja-do-ze'));
  const ct = page.locator('[data-testid="contact"]');
  await expect(ct).toContainText('Rua das Flores, 10');
  await expect(ct.locator('a[href^="https://wa.me/5511987654321"]')).toHaveCount(1);
  await expect(ct.locator('a[href="https://instagram.com/lojadoze"]')).toContainText('@lojadoze');
  await expect(ct.locator('a[href="https://lojadoze.com.br"]')).toHaveCount(1);
  await page.locator('#edit').click();
  await expect(page.locator('#fN')).toBeFocused();   // the sheet puts the cursor in the name first
  await page.locator('[data-ct="instagram"]').fill('@lojadoze2');
  await page.locator('#cfSave').click();
  await expect.poll(() => rpcCalls(calls, 'update_community').length).toBe(1);
  expect(rpcCalls(calls, 'update_community')[0].p.contact).toMatchObject({ instagram: '@lojadoze2', address: 'Rua das Flores, 10' });
  await page.locator('#manage').click();
  const bia = page.locator('[data-member="44444444-4444-4444-8444-444444444444"]');
  await bia.locator('[data-role]').click();
  await expect.poll(() => rpcCalls(calls, 'set_community_role')).toEqual([{ p_slug: 'loja-do-ze', p_user: '44444444-4444-4444-8444-444444444444', p_role: 'admin' }]);
  await bia.locator('[data-own]').click();
  expect(rpcCalls(calls, 'transfer_community')).toEqual([]);
  await bia.locator('[data-own]').click();
  await expect.poll(() => rpcCalls(calls, 'transfer_community')).toEqual([{ p_slug: 'loja-do-ze', p_user: '44444444-4444-4444-8444-444444444444' }]);
});

test('Mesas & Ligas: the owner sets up a table, members say Vou', async ({ page }) => {
  const calls = await setup(page);
  let evs = [];
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/rest/v1/rpc/community_events', (r) => json(r, evs));
  await page.route('**/rest/v1/rpc/save_event', (r) => { const b = JSON.parse(r.request().postData()); calls.push({ path: 'rpc/save_event', body: b });
    evs = [{ id: 'e1', title: b.p.title, starts_at: b.p.starts_at, place: b.p.place, details: b.p.details, capacity: +b.p.capacity || null, going: 0, maybe: 0, me: null, cancelled: false, people: [] }]; return json(r, evs[0]); });
  await page.route('**/rest/v1/rpc/rsvp_event', (r) => { const b = JSON.parse(r.request().postData()); calls.push({ path: 'rpc/rsvp_event', body: b }); evs = [{ ...evs[0], me: b.p_status, going: 1 }]; return json(r, evs[0]); });
  await page.goto(url('comunidades/?c=liga-campinas'));
  await expect(page.locator('[data-testid="events"]')).toContainText('Nenhuma mesa marcada ainda.');
  await page.locator('#evNew').click();
  await page.locator('#evT').fill('Liga de quinta');
  await page.locator('#evW').fill('2030-01-03T19:00');
  await page.locator('#evP').fill('Loja do Zé');
  await page.locator('#evC').fill('16');
  await page.locator('#evD').fill('Inscrição: https://exemplo.com/liga?x=1&y=2. Regras em www.lorcana.com <script> Play Hub: https://tcg.ravensburgerplay.com/events/123');
  await page.locator('#evSave').click();
  await expect(page.locator('[data-ev="e1"]')).toContainText('Liga de quinta');
  const links = page.locator('[data-ev="e1"] p a');
  await expect(links).toHaveCount(3);
  await expect(links.first()).toHaveText('Abrir link (exemplo.com)');   // a short name, not the whole address
  await expect(links.nth(2)).toHaveText('Ver no Play Hub');
  await expect(links.first()).toHaveAttribute('href', 'https://exemplo.com/liga?x=1&y=2');
  await expect(links.first()).toHaveAttribute('target', '_blank');
  await expect(links.nth(1)).toHaveAttribute('href', 'https://www.lorcana.com');
  await expect(page.locator('[data-ev="e1"] p')).toContainText('<script>');
  const saved = rpcCalls(calls, 'save_event')[0];
  expect(saved).toMatchObject({ p_slug: 'liga-campinas', p_id: null, p: { title: 'Liga de quinta', place: 'Loja do Zé', capacity: '16' } });
  expect(Date.parse(saved.p.starts_at)).toBe(new Date('2030-01-03T19:00').getTime());
  await page.locator('[data-rsvp="e1:going"]').click();
  await expect(page.locator('[data-rsvp="e1:going"]')).toHaveAttribute('aria-pressed', 'true');
  expect(rpcCalls(calls, 'rsvp_event')).toEqual([{ p_event: 'e1', p_status: 'going' }]);
});

test('with approval: a visitor asks to join; the owner accepts and invites a friend', async ({ page }) => {
  const calls = await setup(page);
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  let access = { join_mode: 'approval', requested: false, invited: false, requests: null, invites: null };
  await page.route('**/rest/v1/rpc/community_access', (r) => { const b = JSON.parse(r.request().postData());
    return json(r, b.p_slug === 'loja-aberta' ? access : { join_mode: 'open', requested: false, invited: false, requests: [{ uid: '55555555-5555-4555-8555-555555555555', name: 'Caio', handle: 'caio' }], invites: [] }); });
  await page.route('**/rest/v1/rpc/join_community', (r) => { calls.push({ path: 'rpc/join_community', body: JSON.parse(r.request().postData()) }); access = { ...access, requested: true }; return json(r, 'requested'); });
  await page.route('**/rest/v1/rpc/answer_community_request', (r) => { calls.push({ path: 'rpc/answer_community_request', body: JSON.parse(r.request().postData()) }); return r.fulfill({ status: 204, body: '' }); });
  await page.route('**/rest/v1/rpc/set_community_join_mode', (r) => { calls.push({ path: 'rpc/set_community_join_mode', body: JSON.parse(r.request().postData()) }); return r.fulfill({ status: 204, body: '' }); });
  await page.route('**/rest/v1/rpc/my_friends', (r) => json(r, [{ id: '66666666-6666-4666-8666-666666666666', name: 'Rodrigo', handle: 'rodrigo' }]));
  await page.route('**/rest/v1/rpc/invite_to_community', (r) => { calls.push({ path: 'rpc/invite_to_community', body: JSON.parse(r.request().postData()) }); return r.fulfill({ status: 204, body: '' }); });
  // a visitor, community with approval
  await page.goto(url('comunidades/?c=loja-aberta'));
  await expect(page.locator('#join')).toHaveText(/Pedir para entrar/);
  await page.locator('#join').click();
  await expect(page.locator('[data-testid="requested"]')).toHaveText('Pedido enviado');
  expect(rpcCalls(calls, 'join_community')).toEqual([{ p_slug: 'loja-aberta', p_join: true }]);
  // the owner: a request waiting, accept; switch to approval; invite a friend
  await page.goto(url('comunidades/?c=liga-campinas'));
  await expect(page.locator('#manage .count')).toHaveText('1');
  await page.locator('#manage').click();
  await page.locator('[data-ans="55555555-5555-4555-8555-555555555555:1"]').click();
  await expect.poll(() => rpcCalls(calls, 'answer_community_request')).toEqual([{ p_slug: 'liga-campinas', p_user: '55555555-5555-4555-8555-555555555555', p_accept: true }]);
  await page.locator('[data-mode="approval"]').click();
  await expect.poll(() => rpcCalls(calls, 'set_community_join_mode')).toEqual([{ p_slug: 'liga-campinas', p_mode: 'approval' }]);
  await page.locator('#sheet [data-close]').first().click();
  await page.locator('#invite').click();
  await page.locator('[data-inv="66666666-6666-4666-8666-666666666666"]').click();
  await expect(page.locator('[data-testid="invite-list"]')).toContainText('Convidado');
  expect(rpcCalls(calls, 'invite_to_community')).toEqual([{ p_slug: 'liga-campinas', p_user: '66666666-6666-4666-8666-666666666666' }]);
});

test('community background: a Location fills the top; owners change it in Editar', async ({ page }) => {
  const calls = await setup(page);
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/rest/v1/rpc/community_access', (r) => json(r, { join_mode: 'open', cover: 'LOR10-102', requested: false, invited: false, requests: [], invites: [] }));
  const covers = [];
  await page.route('**/rest/v1/rpc/set_community_cover', (r) => { covers.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 204, body: '' }); });
  await page.goto(url('comunidades/?c=liga-campinas'));
  const cover = page.locator('[data-testid="cover"]');
  await expect(cover).toHaveClass(/loc/);
  await expect(cover.locator('img.cm-loc')).toHaveAttribute('src', /lorcana-card-images/);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await page.locator('#edit').click();
  await page.locator('#fCover').click();
  await page.locator('#pkQ').fill('rapunzel tower');
  await page.locator('#cardPicker [data-card="LOR13-80"] [data-use]').click();
  await expect(page.locator('[data-testid="cover-field"]')).toContainText('Rapunzel');
  await page.locator('#cfSave').click();
  await expect.poll(() => covers).toEqual([{ p_slug: 'liga-campinas', p_card: 'LOR13-80' }]);
});

test('Mesas & Ligas: fill in from a Play Hub link, linked table points to the Play Hub; delete with two taps', async ({ page }) => {
  const calls = await setup(page);
  let evs = [];
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/functions/v1/rph-events**', (r) => json(r, { id: 904881, name: 'Terça de Lorcana - October 27, 2026', start: '2030-01-08T22:30:00+00:00', format: 'Core Constructed', cost_cents: 2500, currency: 'BRL', capacity: 32,
    address: 'Av. Dr. Cândido Motta Filho, 575', store: { name: 'Pimp My Deck' }, url: 'https://tcg.ravensburgerplay.com/events/904881' }));
  await page.route('**/rest/v1/rpc/community_events', (r) => json(r, evs));
  await page.route('**/rest/v1/rpc/save_event', (r) => { const b = JSON.parse(r.request().postData()); calls.push({ path: 'rpc/save_event', body: b });
    evs = [{ id: 'e7', title: b.p.title, starts_at: b.p.starts_at, place: b.p.place, details: b.p.details, capacity: +b.p.capacity || null, going: 0, maybe: 0, me: null, cancelled: false, people: [], can_edit: true }]; return json(r, evs[0]); });
  await page.route('**/rest/v1/rpc/link_event_rph', (r) => { const b = JSON.parse(r.request().postData()); calls.push({ path: 'rpc/link_event_rph', body: b }); evs = [{ ...evs[0], rph_id: b.p_rph_id }]; return json(r, evs[0]); });
  await page.route('**/rest/v1/rpc/delete_event', (r) => { calls.push({ path: 'rpc/delete_event', body: JSON.parse(r.request().postData()) }); evs = []; return r.fulfill({ status: 204, body: '' }); });
  await page.goto(url('comunidades/?c=liga-campinas'));
  await page.locator('#evNew').click();
  await expect(page.locator('#evT')).toBeFocused();   // the sheet puts the cursor in the title first
  await page.locator('#evR').fill('https://tcg.ravensburgerplay.com/events/904881');
  await page.locator('#evImp').click();
  await expect(page.locator('#evT')).toHaveValue('Terça de Lorcana');
  await expect(page.locator('#evP')).toHaveValue('Pimp My Deck · Av. Dr. Cândido Motta Filho, 575');
  await expect(page.locator('#evC')).toHaveValue('32');
  await expect(page.locator('#evD')).toHaveValue(/^Core Constructed · R\$\s25,00$/);
  await page.locator('#evSave').click();
  await expect.poll(() => rpcCalls(calls, 'link_event_rph')[0]).toEqual({ p_event: 'e7', p_rph_id: 904881 });
  await expect(page.locator('[data-ev="e7"] [data-testid="ev-playhub"]')).toHaveAttribute('href', 'https://tcg.ravensburgerplay.com/events/904881');
  // delete
  await page.locator('[data-evedit="e7"]').click();
  await expect(page.locator('#evR')).toHaveValue('https://tcg.ravensburgerplay.com/events/904881');
  await page.locator('#evDel').click();
  expect(rpcCalls(calls, 'delete_event')).toHaveLength(0);   // first tap only arms it
  await page.locator('#evDel').click();
  await expect.poll(() => rpcCalls(calls, 'delete_event')[0]).toEqual({ p_event: 'e7' });
  await expect(page.locator('[data-ev="e7"]')).toHaveCount(0);
  // a link that isn't a Play Hub event
  await page.locator('#evNew').click();
  await expect(page.locator('#evT')).toBeFocused();
  await page.locator('#evR').fill('https://exemplo.com/x');
  await page.locator('#evImp').click();
  await expect(page.locator('#evRh')).toContainText('não parece');
});

// ---------- store communities (supabase/community_store.sql, rph-events ?store= / ?stores=) ----------
const soon = (d, h) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
const SEV = [   // as rph-events answers for store 17617 (tools/fixtures/rph-stores-2026-11-05.json), dates moved to the future
  { id: 1237664, name: 'Set Championship - Hyperia City', start: soon(5, 14), format: 'Core Constructed', category: 'set_championship', category_source: 'observed', template_name: null, cost_cents: 6000, currency: 'BRL', capacity: 32, registered: 12, address: 'Av Brasil 1456, Campinas', store: { id: 17617, name: 'Muito Colecionaveis' }, url: 'https://tcg.ravensburgerplay.com/events/1237664', description: 'Inscrição no Play Hub.' },
  { id: 1242965, name: 'Into the Inkdark Prerelease', start: soon(9, 10), format: 'Sealed', category: 'prerelease', category_source: 'observed', template_name: null, cost_cents: 15000, currency: 'BRL', capacity: 16, registered: 3, address: 'Av Brasil 1456, Campinas', store: { id: 17617, name: 'Muito Colecionaveis' }, url: 'https://tcg.ravensburgerplay.com/events/1242965' },
  { id: 1250001, name: 'Weekly Play (Constructed)', start: soon(2, 19), format: 'Core Constructed', category: 'weekly', category_source: 'api', template_name: 'Weekly Play (Constructed)', cost_cents: 0, currency: 'BRL', capacity: 0, registered: 0, address: 'Av Brasil 1456, Campinas', store: { id: 17617, name: 'Muito Colecionaveis' }, url: 'https://tcg.ravensburgerplay.com/events/1250001' },
  { id: 1250002, name: 'Evento antigo', start: soon(-3, 10), format: 'Core Constructed', category: 'weekly', category_source: 'api', store: { id: 17617 }, url: 'https://tcg.ravensburgerplay.com/events/1250002' },   // past: left out
];
const STORE = { store_id: 17617, name: 'Muito Colecionaveis', city: 'Campinas', address: 'Av Brasil 1456', status: 'approved', verified: true };
const storeFn = (events = SEV, complete = true) => (q) => (q.stores ? { stores: [{ id: 17617, name: 'Muito Colecionaveis', city: 'Campinas', state: 'SP', address: 'Av Brasil 1456, Campinas' }, { id: 99001, name: 'Muito Colecionaveis', city: 'Recife', state: 'PE', address: 'Rua X, 1' }], total: complete ? 2 : 400, complete }
  : q.store_info ? (q.store_info === '17617' ? { found: true, store: { id: 17617, name: 'Muito Colecionaveis Comercio de Jogos e Acessorios Ltda', city: 'Campinas', address: 'Av Brasil 1456, Jardim Chapadao' }, events: 23 } : { found: false, store: null, events: 0 })
  : q.store ? { events, total: events.length, received: events.length, complete: true, issues: [] } : { events: [] });

test('store community, verified: its Play Hub events for a visitor, categories, official link, details by keyboard', async ({ page }) => {
  const calls = await setup(page, { signedIn: false, rpcs: { 'rpc/community_store': () => STORE }, fn: storeFn() });
  await page.goto(url('comunidades/?c=loja-aberta'));
  await expect(page.getByTestId('store-badge')).toHaveText('Loja verificada');
  await expect(page.getByTestId('store-unverified')).toHaveCount(0);
  const cards = page.locator('[data-sev]');
  await expect(cards).toHaveCount(3);                                   // the past one is not shown
  expect(calls.find((c) => c.path === 'fn').q).toEqual({ store: '17617' });   // by store id, not by the visitor's place
  await expect(page.locator('[data-sev="1237664"] [data-testid="sev-cat"]')).toHaveText('Set Championship*');
  await expect(page.locator('[data-sev="1242965"] [data-testid="sev-cat"]')).toHaveText('Pré-release*');
  await expect(page.locator('[data-sev="1250001"] [data-testid="sev-cat"]')).toHaveText('Weekly Play/Liga');
  await expect(page.locator('[data-sev="1237664"]')).toContainText('12/32 inscritos');
  await expect(page.locator('[data-sev="1250001"]')).toContainText('Grátis');
  await expect(page.locator('[data-sev="1237664"] [data-testid="sev-register"]')).toHaveAttribute('href', 'https://tcg.ravensburgerplay.com/events/1237664');
  await expect(page.locator('[data-sev="1237664"] [data-testid="sev-register"]')).toHaveAttribute('target', '_blank');
  const summary = page.locator('[data-sev="1237664"] summary');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-sev="1237664"] details')).toHaveAttribute('open', '');
  await expect(page.locator('[data-sev="1237664"] details')).toContainText('Av Brasil 1456');
  await page.locator('[data-sev="1237664"] [data-smark="1237664:going"]').click();   // a visitor is asked to sign in; nothing is saved
  expect(rpcCalls(calls, 'mark_event')).toEqual([]);
  await expect(page.getByTestId('conversation')).toBeVisible();          // the rest of the community is there
});

test('store community: Vou/Talvez use the same marks as Eventos (mark_event with the Play Hub id)', async ({ page }) => {
  const calls = await setup(page, { rpcs: { 'rpc/community_store': () => STORE, 'rpc/my_event_marks': () => [{ rph_id: 1242965, status: 'maybe', registered: true, paid: false, snap: {} }], 'rpc/mark_event': () => undefined }, fn: storeFn() });
  await page.goto(url('comunidades/?c=loja-aberta'));
  await expect(page.locator('[data-smark="1242965:maybe"]')).toHaveAttribute('aria-pressed', 'true');   // marked on Eventos, shown here
  await page.locator('[data-smark="1237664:going"]').click();
  await expect(page.locator('[data-smark="1237664:going"]')).toHaveAttribute('aria-pressed', 'true');
  const m = rpcCalls(calls, 'mark_event');
  expect(m[0]).toMatchObject({ p_rph_id: 1237664, p_status: 'going', p_registered: false, p_paid: false });
  expect(m[0].p_snap).toMatchObject({ name: 'Set Championship - Hyperia City', url: 'https://tcg.ravensburgerplay.com/events/1237664', category: 'set_championship', category_source: 'observed' });
  await page.locator('[data-smark="1242965:maybe"]').click();          // again = clear, keeps "registered"
  await expect.poll(() => rpcCalls(calls, 'mark_event').length).toBe(2);
  expect(rpcCalls(calls, 'mark_event')[1]).toMatchObject({ p_rph_id: 1242965, p_status: null, p_registered: true });
});

test('store community, owner: choose the store by name (two with the same name), then it is pending, not verified', async ({ page }) => {
  let link = null;
  const calls = await setup(page, { rpcs: {
    'rpc/community_store': () => link,
    'rpc/request_community_store': (b) => { link = { store_id: +b.p_store.id, name: b.p_store.name, city: b.p_store.city, address: b.p_store.address, status: 'pending', verified: false }; return { store_id: +b.p_store.id, status: 'pending' }; },
  }, fn: storeFn() });
  await page.goto(url('comunidades/?c=loja-do-ze'));
  await expect(page.getByTestId('store-none')).toContainText('Escolha a loja desta comunidade no Play Hub');
  await expect(page.getByTestId('store-badge')).toHaveCount(0);
  await page.locator('#pickStore').click();
  await page.locator('#stQ').fill('Muito');
  await page.locator('#stQ').press('Enter');
  const rows = page.locator('[data-testid="store-results"] [data-pickstore]');
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('store-results')).toContainText('ID 99001');   // same name, told apart by city and id
  await page.locator('[data-pickstore="17617"]').click();
  expect(rpcCalls(calls, 'request_community_store')[0]).toEqual({ p_slug: 'loja-do-ze', p_store: { id: '17617', name: 'Muito Colecionaveis', city: 'Campinas', address: 'Av Brasil 1456, Campinas' } });
  await expect(page.getByTestId('store-badge')).toHaveText('Vínculo com a loja em análise');
  await expect(page.getByTestId('store-unverified')).toContainText('ainda não verificou');
  await expect(page.locator('[data-sev]')).toHaveCount(3);
});

test('store community: a store already verified elsewhere is refused; the owner can remove the link', async ({ page }) => {
  let link = { ...STORE, status: 'pending', verified: false };
  const calls = await setup(page, { rpcs: {
    'rpc/community_store': () => link,
    'rpc/request_community_store': () => { throw new Error('unused'); },
    'rpc/remove_community_store': () => { link = null; return undefined; },
  }, fn: storeFn() });
  await page.route('**/rest/v1/rpc/request_community_store', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"store_taken"}' }));
  await page.goto(url('comunidades/?c=loja-do-ze'));
  await page.locator('#pickStore').click();
  await expect(page.getByTestId('store-current')).toContainText('ID 17617');
  await page.locator('#stQ').fill('Muito'); await page.locator('#stQ').press('Enter');
  await page.locator('[data-pickstore="99001"]').click();
  await expect(page.locator('#stMsg')).toHaveText('Esta loja já está verificada para outra comunidade.');
  await page.locator('#stRm').click(); await page.locator('#stRm').click();   // two taps
  await expect(page.getByTestId('store-none')).toBeVisible();
  expect(rpcCalls(calls, 'remove_community_store')).toEqual([{ p_slug: 'loja-do-ze' }]);
});

test('store community: no events, Play Hub down (retry), incomplete list, refused link', async ({ page }) => {
  let mode = 'empty', link = STORE;
  await setup(page, { signedIn: false, rpcs: { 'rpc/community_store': () => link }, fn: (q) => (mode === 'down' ? new Error('x') : mode === 'empty' ? { events: [], total: 0, received: 0, complete: true } : { events: SEV.slice(0, 1), total: 3, received: 1, complete: false }) });
  await page.goto(url('comunidades/?c=loja-aberta'));
  await expect(page.getByTestId('store-empty')).toContainText('Nenhum evento futuro desta loja');
  mode = 'down'; await page.reload();
  await expect(page.getByTestId('store-error')).toContainText('Não conseguimos falar com o Play Hub');
  await expect(page.getByTestId('conversation')).toBeVisible();
  mode = 'partial'; await page.locator('#sevRetry').click();
  await expect(page.getByTestId('store-partial')).toContainText('informou 3 eventos, mas só recebemos 1');
  await expect(page.locator('[data-sev]')).toHaveCount(1);
  link = null; await page.reload();                                      // a refused link isn't shown to visitors
  await expect(page.getByTestId('store-events')).toHaveCount(0);
});

test('store community on a phone, in English: fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await setup(page, { signedIn: false, rpcs: { 'rpc/community_store': () => ({ ...STORE, status: 'pending', verified: false }) }, fn: storeFn() });
  await page.addInitScript(() => localStorage.setItem('inkwell-lang', 'en'));
  await page.goto(url('comunidades/?c=loja-aberta'));
  await expect(page.getByTestId('store-badge')).toHaveText('Store link under review');
  await expect(page.locator('[data-sev="1242965"] [data-testid="sev-cat"]')).toHaveText('Prerelease*');
  await expect(page.locator('[data-sev="1242965"] [data-testid="sev-register"]')).toContainText('Register on the Play Hub');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('admin: each request next to the Play Hub\'s own data; approve with it, or only after an explicit manual check', async ({ page }) => {
  const calls = await setup(page, { rpcs: {
    'rpc/my_profile': () => ({ display_name: 'Luís', adult: true, hidden: false, is_admin: true }),
    'rpc/admin_users': () => [], 'rpc/admin_reports': () => [], 'rpc/admin_communities': () => [], 'rpc/admin_feedback': () => [],
    'rpc/admin_community_stores': () => [
      { community_id: 'c-1', slug: 'loja-do-ze', community: 'Loja do Zé', store_id: 17617, name: 'Loja Oficial do Zé', city: 'Campinas', status: 'pending', requested_by: 'Zé', requested_at: '2026-11-05T12:00:00Z', verified_elsewhere: false },   // a forged name
      { community_id: 'c-2', slug: 'outra', community: 'Outra', store_id: 555, name: 'Loja Y', status: 'pending', requested_at: '2026-11-05T12:00:00Z', verified_elsewhere: false },
      { community_id: 'c-3', slug: 'terceira', community: 'Terceira', store_id: 777, name: 'Loja Z', status: 'pending', requested_at: '2026-11-05T12:00:00Z', verified_elsewhere: true }],
    'rpc/decide_community_store': () => undefined,
  }, fn: storeFn() });
  await page.goto(url('admin/?tab=feedback'));
  await page.locator('[data-tab="comms"]').click();
  const row = (id) => page.locator(`[data-slink="${id}"]`);
  await expect(row('c-1').getByTestId('ph-check')).toContainText('Play Hub: Muito Colecionaveis Comercio de Jogos e Acessorios Ltda');
  await expect(row('c-1').getByTestId('ph-differs')).toBeVisible();                     // the forged name is flagged
  await expect(row('c-2').getByTestId('ph-check')).toContainText('não tem evento no Play Hub');
  await expect(row('c-2').locator('[data-sdec="approved"]')).toBeDisabled();            // no Play Hub data: not without a manual check
  await expect(row('c-3').locator('[data-sdec="approved"]')).toBeDisabled();            // already verified elsewhere
  await row('c-1').locator('[data-sdec="approved"]').click();
  await expect.poll(() => rpcCalls(calls, 'decide_community_store')[0]).toEqual({ p_community: 'c-1', p_decision: 'approved',
    p_check: { method: 'playhub', store: { id: 17617, name: 'Muito Colecionaveis Comercio de Jogos e Acessorios Ltda', city: 'Campinas', address: 'Av Brasil 1456, Jardim Chapadao' } } });   // the Play Hub's data, not the request's
  await row('c-2').locator('[data-mcheck="c-2"]').check();
  await expect(row('c-2').locator('[data-sdec="approved"]')).toBeDisabled();            // still needs a note
  await row('c-2').locator('[data-mnote="c-2"]').fill('Liguei para a loja e conferi o ID');
  await expect(row('c-2').locator('[data-sdec="approved"]')).toBeEnabled();
  await row('c-2').locator('[data-sdec="approved"]').click();
  await expect.poll(() => rpcCalls(calls, 'decide_community_store')[1]).toEqual({ p_community: 'c-2', p_decision: 'approved', p_note: 'Liguei para a loja e conferi o ID', p_check: { method: 'manual', confirmed: true } });
});

test('store search: when the Play Hub has more stores than we read, the owner is told to type more', async ({ page }) => {
  await setup(page, { rpcs: { 'rpc/community_store': () => null }, fn: storeFn(SEV, false) });
  await page.goto(url('comunidades/?c=loja-do-ze'));
  await page.locator('#pickStore').click();
  await page.locator('#stQ').fill('Mu'); await page.locator('#stQ').press('Enter');
  await expect(page.getByTestId('store-partial-search')).toContainText('só parte delas aparece');
});
