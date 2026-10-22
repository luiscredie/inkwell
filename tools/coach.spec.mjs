// Jogos (/coach/) against a fake Supabase: a duels.ink best-of-3 shows the lore line of every game.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/coach.spec.mjs
import { test, expect } from '@playwright/test';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';
const url = (p) => new URL(p, ROOT).href;
const ME = '11111111-1111-4111-8111-111111111111';

const game = (id, at, n, opp, win, turns) => ({
  format_version: '1.0', game_id: id, source: 'duels.ink', played_at: at,
  event: { kind: 'online', name: 'Core Set 14 BO3', game_in_match: n },
  source_ref: { queue: 'Core Set 14 BO3', game_id: id, replay_url: `https://duels.ink/r/${id}-r` },
  players: [{ seat: 'p1', name: 'Luís', is_me: true, went_first: n % 2 === 1, deck: { inks: ['Amber', 'Steel'] } }, { seat: 'p2', name: opp, deck: { inks: ['Ruby'] } }],
  turns: Array.from({ length: turns }, (_, i) => ({ number: i + 1, player: i % 2 ? 'p2' : 'p1', lore_end: { p1: Math.min(20, (i + 1) * (win ? 2 : 1)), p2: Math.min(20, (i + 1) * (win ? 1 : 2)) }, actions: [] })),
  result: { winner: win ? 'p1' : 'p2', reason: 'lore', final_lore: { p1: win ? 20 : 10, p2: win ? 10 : 20 } },
});
const LOGS = {
  a1: game('a1', '2026-10-20T22:35:00Z', 1, 'Zé', false, 12),
  a2: game('a2', '2026-10-20T22:49:00Z', 2, 'Zé', true, 10),
  a3: game('a3', '2026-10-20T23:00:00Z', 3, 'Zé', true, 10),
  b1: game('b1', '2026-10-20T23:20:00Z', 1, 'Outro', true, 10),   // next match, other opponent
};
const ROWS = Object.values(LOGS).map((l) => ({ user_id: ME, game_id: l.game_id, source: 'duels.ink', played_at: l.played_at, visibility: 'private', created_at: l.played_at,
  summary: { result: l.result.winner === 'p1' ? 'win' : 'loss', my_deck: 'Amber/Steel', opp_deck: 'Ruby', my_lore: l.result.final_lore.p1, opp_lore: l.result.final_lore.p2, went_first: l.players[0].went_first } }));

test('a best-of-3 shows one lore line per game, and each opens', async ({ page }) => {
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', (route) => {
    const u = new URL(route.request().url()), path = u.pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'game_logs') {
      const id = (u.searchParams.get('game_id') || '').replace(/^eq\./, '');
      return json(id ? [{ log: LOGS[id] }] : ROWS);
    }
    if (path === 'rpc/my_profile') return json({ display_name: 'Luís', adult: true });
    return json(path.startsWith('rpc/') ? null : []);
  });
  await page.goto(url('coach/?game=a2'));
  const charts = page.locator('[data-testid="match-charts"] .mgame');
  await expect(charts).toHaveCount(3);
  await expect(charts.locator('svg')).toHaveCount(3);
  await expect(page.locator('[data-testid="match-charts"] .legend')).toContainText('Partida 2–1');
  await expect(charts.nth(1)).toHaveClass(/cur/);
  await expect(page.locator('[data-testid="replay-link"]')).toHaveAttribute('href', 'https://duels.ink/replay/a2-r');
  await charts.nth(0).locator('[data-open]').click();
  await expect(page.locator('#review .head')).toContainText('jogo 1');
  await expect(page.locator('[data-testid="match-charts"] .mgame').nth(0)).toHaveClass(/cur/);
  // a game of a single match keeps the one chart
  await page.goto(url('coach/?game=b1'));
  await expect(page.locator('#review .cchart svg')).toHaveCount(1);
  await expect(page.locator('[data-testid="match-charts"]')).toHaveCount(0);
});
