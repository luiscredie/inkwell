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
