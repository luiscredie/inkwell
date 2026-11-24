// Jogos › Estatísticas › "Contra cada deck": an opponent reported with many inks (duels.ink sends what the opponent
// showed; in some games that is 3 to 6 inks) must fit the card — the name wraps, nothing is cut, and the Jogos,
// Vitórias, Começando and Comprando columns stay. (The matrix below scrolls inside its own box, by design.) Chromium, and WebKit (iPhone) with PW_WEBKIT=1.
import { test, expect } from '@playwright/test';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';
const ME = '11111111-1111-4111-8111-111111111111';
const SIX = 'Amber/Amethyst/Emerald/Ruby/Sapphire/Steel';
const LONG = 'Amber/Amethyst/Emerald/Ruby/Sapphire/Steel/Amber/Amethyst/Emerald/Ruby/Sapphire/Steel';   // longer than anything real
function rows() {
  const out = [], now = Date.parse('2026-11-20T23:00:00Z');
  const opps = ['Ruby/Sapphire', 'Amethyst/Steel', SIX, SIX, 'Emerald/Ruby', 'Amber/Amethyst/Sapphire', LONG, 'Emerald'];
  for (let i = 0; i < 48; i++) {
    const at = new Date(now - i * 36e5).toISOString(), opp = opps[i % opps.length], win = i % 3 !== 0;
    out.push({ user_id: ME, game_id: `g${i}`, source: 'duels_ink', played_at: at, visibility: 'private', created_at: at,
      summary: { result: win ? 'win' : 'loss', my_deck: 'Amber/Steel', my_inks: 'Amber/Steel', opp_deck: opp, opp_inks: opp, went_first: i % 2 === 0, my_lore: win ? 20 : 12, opp_lore: win ? 12 : 20, queue: 'Core Set 14 BO1', gim: 1 } });
  }
  return out;
}
async function open(page, w, h = 844) {
  await page.setViewportSize({ width: w, height: h });
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  const R = rows();
  await page.route('**/rest/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'game_logs') return json(R);
    if (path === 'rpc/my_profile') return json({ display_name: 'Luís', adult: true });
    return json(path.startsWith('rpc/') ? null : []);
  });
  await page.goto(new URL('coach/', ROOT).href);
  await page.locator('#tabStats').click();
  const card = page.locator('.sv-card', { has: page.locator('h3', { hasText: 'Contra cada deck' }) });
  await expect(card.locator('tr[data-opp]').first()).toBeVisible();
  return card;
}

for (const w of [320, 390, 430, 1280]) {
  test(`${w}px: long ink lists wrap inside "Contra cada deck"; nothing is cut and every column stays`, async ({ page }) => {
    const card = await open(page, w);
    if (process.env.SHOTS) { await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS}-${w}.png` }); }
    const out = await card.evaluate((c) => {
      const cb = c.getBoundingClientRect(), table = c.querySelector('table.mt'), tb = table.getBoundingClientRect();
      const cells = [...c.querySelectorAll('tr[data-opp] td, tr th')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > cb.right + 0.5 || r.left < cb.left - 0.5; }).map((e) => e.textContent.trim());
      return { tableIn: tb.right <= cb.right + 0.5 && tb.left >= cb.left - 0.5, cardIn: cb.right <= innerWidth + 0.5, cells };
    });
    expect(out).toEqual({ tableIn: true, cardIn: true, cells: [] });
    // the whole name is there (wrapped, not cut), and the four columns
    for (const name of ['Amber/Amethyst/Emerald/Ruby/Sapphire/Steel', 'Amber/Amethyst/Sapphire']) {
      const r = card.locator(`tr[data-opp="${name}"]`);
      await expect(r.locator('td').first()).toHaveText(name);
      await expect(r.locator('td')).toHaveCount(5);
    }
    await expect(card.locator('tr').first().locator('th')).toHaveText(['Cores do oponente', 'Jogos', 'Vitórias', 'Começando', 'Comprando']);
    // a long name takes more lines, but its cell does not overflow
    const ov = await card.locator(`tr[data-opp="${LONG}"] td`).first().evaluate((td) => td.scrollWidth <= td.clientWidth + 1);
    expect(ov).toBe(true);
  });
}
