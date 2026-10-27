// Eventos (/eventos/) against a fake Supabase and a fake rph-events function.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/eventos.spec.mjs
import { test, expect } from '@playwright/test';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';
const url = (p) => new URL(p, ROOT).href;
const ME = '11111111-1111-4111-8111-111111111111';
const at = (days, h) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const EVENTS = [
  { id: 101, name: 'Terça de Lorcana', start: at(3, 19), end: at(3, 23), format: 'Core Constructed', cost_cents: 2500, currency: 'BRL', capacity: 16, registered: 5, address: 'Rua A, 1, São Paulo', km: 13, store: { name: 'Pimp My Deck' }, url: 'https://tcg.ravensburgerplay.com/events/101' },
  { id: 102, name: 'Set Championship', start: at(3, 14), format: 'Core Constructed', cost_cents: 0, currency: 'BRL', capacity: 32, registered: 10, address: 'Rua B, 2', km: 40, store: { name: 'Loja B' }, url: 'https://tcg.ravensburgerplay.com/events/102' },
  { id: 103, name: 'Draft de sábado', start: at(6, 15), format: 'Sealed', cost_cents: 9000, currency: 'BRL', capacity: 8, registered: 2, address: 'Rua C, 3', km: 80, store: { name: 'Loja C' }, url: 'https://tcg.ravensburgerplay.com/events/103' },
];

async function setup(page, { signedIn = true, where = true } = {}) {
  const calls = [];
  await page.addInitScript(([me, signed, w]) => {
    localStorage.setItem('inkwell-lang', 'pt');
    if (w) localStorage.setItem('inkwell-events-where', JSON.stringify({ lat: -23.55, lng: -46.63, label: 'São Paulo, SP', km: 100 }));
    if (!signed) return;
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, [ME, signedIn, where]);
  await page.route('**/functions/v1/rph-events**', (route) => {
    const q = new URL(route.request().url()).searchParams;
    calls.push({ path: 'fn', q: Object.fromEntries(q) });
    const body = q.get('geocode') ? { lat: -22.9, lng: -47.06, label: 'Campinas, SP, BR' } : { events: EVENTS, total: 3 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('https://nominatim.openstreetmap.org/**', (route) => {
    const q = new URL(route.request().url()).searchParams;
    calls.push({ path: 'osm', q: Object.fromEntries(q) });
    const hit = /paulista/i.test(q.get('q') || '') ? [{ lat: '-23.5614', lon: '-46.6559', name: 'Avenida Paulista', address: { suburb: 'Bela Vista', city: 'São Paulo' } }] : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hit) });
  });
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ path, body });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'rpc/my_event_marks') return json([{ rph_id: 102, status: 'going', registered: true, paid: false, snap: { name: 'Set Championship', start: EVENTS[1].start } }]);
    if (path === 'rpc/friends_on_events') return json({ 101: [{ name: 'Rodrigo', status: 'going' }] });
    if (path === 'rpc/my_events') return json([{ id: 'e1', title: 'Liga de quinta', starts_at: at(4, 19), place: 'Loja do Zé', capacity: 8, community: 'Loja do Zé', slug: 'loja-do-ze', going: 3, me: null }]);
    if (path === 'rpc/mark_event' || path === 'rpc/rsvp_event') return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    if (path === 'rpc/my_profile') return json({ display_name: 'Luís', adult: true });
    return json([]);
  });
  return calls;
}

test('list: events by day, friends going, table from my community, marks and same-day alert', async ({ page }) => {
  const calls = await setup(page);
  await page.goto(url('eventos/'));
  await expect(page.locator('.ev')).toHaveCount(4);
  const fn = calls.find((c) => c.path === 'fn');
  expect(fn.q).toMatchObject({ km: '100', lat: '-23.5500' });
  await expect(page.locator('[data-ev="rph:101"]')).toContainText('Rodrigo');
  await expect(page.locator('[data-ev="rph:101"]')).toContainText('R$');
  await expect(page.locator('[data-ev="rph:102"]')).toContainText('Grátis');
  await expect(page.locator('[data-ev="tb:e1"]')).toContainText('Mesa da comunidade');
  await expect(page.locator('[data-ev="rph:102"] [data-act="registered"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="clash"]')).toHaveCount(0);
  // "Vou" on the other event that day -> warning
  await page.locator('[data-ev="rph:101"] [data-act="going"]').click();
  await expect(page.locator('[data-testid="clash"]')).toContainText('2 eventos');
  const m = calls.filter((c) => c.path === 'rpc/mark_event').map((c) => c.body);
  expect(m[0]).toMatchObject({ p_rph_id: 101, p_status: 'going', p_registered: false, p_paid: false });
  expect(m[0].p_snap).toMatchObject({ name: 'Terça de Lorcana', url: 'https://tcg.ravensburgerplay.com/events/101' });
  // paid flag
  await page.locator('[data-ev="rph:101"] [data-act="paid"]').click();
  await expect.poll(() => calls.filter((c) => c.path === 'rpc/mark_event').length).toBe(2);
  expect(calls.filter((c) => c.path === 'rpc/mark_event')[1].body).toMatchObject({ p_status: 'going', p_paid: true });
  // community table goes through rsvp_event
  await page.locator('[data-ev="tb:e1"] [data-act="going"]').click();
  await expect.poll(() => calls.filter((c) => c.path === 'rpc/rsvp_event').map((c) => c.body)[0]).toEqual({ p_event: 'e1', p_status: 'going' });
  // filters
  await page.locator('#mine').click();
  await expect(page.locator('.ev')).toHaveCount(3);
  await page.locator('#mine').click();
  await page.locator('#free').click();
  await expect(page.locator('.ev')).toHaveCount(2);   // the free one + the community table
});

test('calendar: month grid, pick a day', async ({ page }) => {
  await setup(page);
  await page.goto(url('eventos/'));
  await expect(page.locator('.ev')).toHaveCount(4);
  await page.locator('[data-view="cal"]').click();
  await expect(page.locator('[data-testid="calendar"] [data-day]')).toHaveCount(42);
  const d = EVENTS[2].start; const k = new Date(d); const key = `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`;
  if (await page.locator(`[data-day="${key}"]`).count() === 0) await page.locator('#mNext').click();
  await page.locator(`[data-day="${key}"]`).click();
  await expect(page.locator('.ev')).toHaveCount(1);
  await expect(page.locator('.ev')).toContainText('Draft de sábado');
});

test('first visit: ask where, city lookup; guests see events and are asked to sign in to mark', async ({ page }) => {
  const calls = await setup(page, { signedIn: false, where: false });
  await page.goto(url('eventos/'));
  await expect(page.locator('[data-testid="where"]')).toContainText('Onde você joga?');
  await expect(page.locator('.ev')).toHaveCount(0);
  await page.locator('#city').fill('Campinas');
  await page.locator('#cityF button').click();
  await expect(page.locator('.ev')).toHaveCount(3);
  await expect(page.locator('[data-testid="where"]')).toContainText('Campinas');
  expect(calls.filter((c) => c.path === 'osm').map((c) => c.q.q)).toEqual(['Campinas']);   // not in the (fake) OpenStreetMap -> our function
  expect(calls.filter((c) => c.path === 'fn').map((c) => c.q.geocode || c.q.lat)).toEqual(['Campinas', '-22.9000']);
  expect(calls.some((c) => c.path === 'rpc/my_event_marks')).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('inkwell-events-where')).label)).toBe('Campinas, SP, BR');
});

test('shot', async ({ page }) => {
  if (!process.env.SHOT) test.skip();
  await setup(page);
  for (const [w, h, n] of [[1280, 900, 'd'], [390, 844, 'm']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(url('eventos/'));
    await page.locator('.ev').first().waitFor();
    await page.locator('[data-ev="rph:101"] [data-act="going"]').click();
    await page.screenshot({ path: `/tmp/claude-0/-home-claude/ba98388b-1cd5-5e26-b0aa-015deca9e67c/scratchpad/ev-${n}.png`, fullPage: true });
    await page.locator('[data-view="cal"]').click();
    await page.screenshot({ path: `/tmp/claude-0/-home-claude/ba98388b-1cd5-5e26-b0aa-015deca9e67c/scratchpad/ev-${n}-cal.png` });
  }
});

test('an English browser still gets Portuguese until the person picks English', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/functions/v1/rph-events**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [{ id: 1, name: 'Liga', start: new Date(Date.now() + 3 * 864e5).toISOString(), cost_cents: 2700, currency: 'BRL', store: { name: 'Loja' }, url: 'https://tcg.ravensburgerplay.com/events/1' }], total: 1 }) }));
  await page.addInitScript(() => localStorage.setItem('inkwell-events-where', JSON.stringify({ lat: -23.55, lng: -46.63, label: 'São Paulo', km: 100 })));
  await page.goto(url('eventos/'));
  await expect(page.locator('h1')).toHaveText('Eventos');
  await expect(page.locator('.ev')).toContainText('R$ 27,00');
  await expect(page.locator('.ev .time')).toHaveText(/^\d{2}:\d{2}$/);
  await ctx.close();
});

test('address lookup, sort by distance, the next two weeks first', async ({ page }) => {
  const calls = await setup(page);
  const far = { id: 104, name: 'Liga do mês que vem', start: at(25, 19), format: 'Core Constructed', cost_cents: 2000, currency: 'BRL', km: 5, store: { name: 'Loja D' }, url: 'https://tcg.ravensburgerplay.com/events/104' };
  EVENTS.push(far);
  try {
    await page.goto(url('eventos/'));
    await expect(page.locator('.ev')).toHaveCount(4);   // the one in 25 days waits behind "ver mais"
    await page.locator('[data-testid="more"]').click();
    await expect(page.locator('.ev')).toHaveCount(5);
    // hierarchy: price on the first line, store on its own line, address below
    const ev = page.locator('[data-ev="rph:101"]');
    await expect(ev.locator('.top [data-testid="price"]')).toHaveText('R$ 25,00');
    await expect(page.locator('[data-ev="rph:102"] [data-testid="price"]')).toHaveText('Grátis');
    await expect(ev.locator('.where1 .store')).toHaveText('Pimp My Deck');
    await expect(ev.locator('.meta.sub')).toContainText('13 km');
    // by distance: one list, nearest first, each with its day
    await page.locator('[data-testid="order"]').selectOption('km');
    await expect(page.locator('.ev-day')).toHaveCount(0);
    await expect(page.locator('.ev[data-ev^="rph"]').first()).toContainText('Liga do mês que vem');
    await expect(page.locator('.ev[data-ev^="rph"]').first().locator('.when')).not.toBeEmpty();
    // an address: OpenStreetMap, rounded to ~1 km, the district as the label
    await page.locator('#city').fill('Av. Paulista, 1000');
    await page.locator('#cityF button').click();
    await expect(page.locator('[data-testid="where"]')).toContainText('Bela Vista, São Paulo');
    await expect.poll(() => calls.filter((c) => c.path === 'fn' && c.q.lat).at(-1).q.lat).toBe('-23.5600');
    expect(calls.filter((c) => c.path === 'fn' && c.q.lat).at(-1).q.lng).toBe('-46.6600');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('inkwell-events-where')))).toMatchObject({ lat: -23.56, lng: -46.66, label: 'Bela Vista, São Paulo' });
  } finally { EVENTS.pop(); }
});

test('Início: "Encontre sua próxima mesa" for visitors goes to Eventos with the place; signed in shows the next ones', async ({ page }) => {
  const calls = await setup(page, { signedIn: false, where: false });
  await page.goto(url('feed/'));
  const box = page.locator('[data-testid="home-find-events"]');
  await expect(box).toContainText('Encontre sua próxima mesa');
  await expect(page.locator('#bpT')).toHaveCount(0);   // "Monte seu perfil" said the same as "Como funciona"
  await box.locator('#evFindQ').fill('Campinas');
  await box.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/eventos\/$/);
  await expect(page.locator('[data-testid="where"]')).toContainText('Campinas');
  await expect(page.locator('.ev')).toHaveCount(3);
  expect(calls.filter((c) => c.path === 'fn').map((c) => c.q.geocode || c.q.lat)).toEqual(['Campinas', '-22.9000']);
  // back on Início, the place is known: the next three show up
  await page.goto(url('feed/'));
  await expect(box.locator('.ev-next')).toHaveCount(3);
  await expect(box).toContainText('Próximos perto de Campinas');
});

test('Início signed in: the Play Hub events near me next to the community tables', async ({ page }) => {
  await setup(page);
  await page.route('**/rest/v1/profiles?**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ user_id: ME, display_name: 'Luís' }]) }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url('feed/'));
  const near = page.locator('[data-testid="home-near-events"]');
  await expect(near).toContainText('Play Hub perto de São Paulo, SP');
  await expect(near.locator('.ev-next')).toHaveCount(3);
  await expect(near.locator('.ev-next').first()).toHaveAttribute('href', /tcg\.ravensburgerplay\.com\/events\/\d+/);
});

test('keep the place in my account only when I tick the box; a new device picks it up', async ({ page }) => {
  await setup(page, { where: false });
  const sent = []; let saved = null;
  await page.route('**/rest/v1/rpc/my_place', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(saved) }));
  await page.route('**/rest/v1/rpc/set_my_place', (r) => { const b = JSON.parse(r.request().postData()); sent.push(['set', b]); saved = { lat: b.p_lat, lng: b.p_lng, label: b.p_label, km: b.p_km, notify: true }; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(saved) }); });
  await page.route('**/rest/v1/rpc/delete_my_place', (r) => { sent.push(['delete']); saved = null; return r.fulfill({ status: 204, body: '' }); });
  await page.goto(url('eventos/'));
  await page.locator('#city').fill('Campinas');
  await page.locator('#cityF button').click();
  const box = page.locator('[data-testid="keep-place"]');
  await expect(box).toContainText('nunca a rua');
  await expect(box.locator('input')).not.toBeChecked();
  expect(sent).toHaveLength(0);   // nothing goes to the account without the tick
  await box.locator('input').check();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual(['set', { p_lat: -22.9, p_lng: -47.06, p_label: 'Campinas, SP, BR', p_km: 100, p_notify: true }]);
  await expect(box.locator('input')).toBeChecked();
  // a radius change updates the saved place
  await page.locator('#km').selectOption('50');
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1][1]).toMatchObject({ p_km: 50 });
  // another device: nothing on it, the account has the place
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('[data-testid="where"]')).toContainText('Campinas, SP, BR');
  await expect(page.locator('[data-testid="where"]')).toContainText('50 km');
  await expect(page.locator('.ev').first()).toBeVisible();
  await page.locator('[data-testid="keep-place"] input').uncheck();
  await expect.poll(() => sent.at(-1)).toEqual(['delete']);
});
