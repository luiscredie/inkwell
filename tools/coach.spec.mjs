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
  await page.route('https://duels.ink/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>replay</p>' }));
  await page.goto(url('coach/?game=a2'));
  const charts = page.locator('[data-testid="match-charts"] .mgame');
  await expect(charts).toHaveCount(3);
  await expect(charts.locator('svg')).toHaveCount(3);
  await expect(page.locator('[data-testid="match-charts"] .legend')).toContainText('Partida 2–1');
  await expect(charts.nth(1)).toHaveClass(/cur/);
  await expect(page.locator('[data-testid="replay-link"]')).toHaveAttribute('href', 'https://duels.ink/replay/a2-r');
  // the replay plays inside the page, above the chart, and survives the review redrawing
  await page.getByRole('button', { name: 'Assistir ao replay' }).click();
  const frame = page.locator('[data-testid="replay"] iframe');
  await expect(frame).toHaveAttribute('src', 'https://duels.ink/replay/a2-r?embed=1&autoplay=1');
  await frame.evaluate((f) => { f.dataset.mark = 'same'; });
  await page.locator('.game[data-k="a2"]').click();          // redraws this game's review
  await expect(page.locator('[data-testid="match-charts"] .mgame')).toHaveCount(3);
  await expect(frame).toHaveAttribute('data-mark', 'same');
  expect(await page.evaluate(() => { const r = document.querySelector('[data-testid="replay"]'); return !!(r.compareDocumentPosition(document.querySelector('[data-testid="match-charts"]')) & Node.DOCUMENT_POSITION_FOLLOWING); })).toBe(true);
  await expect(page.getByRole('button', { name: 'Tela cheia' })).toBeVisible();
  await charts.nth(0).locator('[data-open]').click();
  await expect(page.locator('#review .head')).toContainText('jogo 1');
  await expect(page.locator('[data-testid="match-charts"] .mgame').nth(0)).toHaveClass(/cur/);
  // a game of a single match keeps the one chart
  await page.goto(url('coach/?game=b1'));
  await expect(page.locator('#review .cchart svg')).toHaveCount(1);
  await expect(page.locator('[data-testid="match-charts"]')).toHaveCount(0);
});

// ---------- stats ----------
function statRows() {
  // 30 days: BO1 games and best-of-3 matches, two versions of one deck, MMR moving.
  const out = [], now = Date.parse('2026-10-21T23:00:00Z'), opps = ['Ruby/Sapphire', 'Amethyst/Steel', 'Emerald/Ruby'];
  let mmr = 1100, n = 0;
  const add = (at, q, gim, win, first, list, opp, mmrd) => {
    n += 1;
    out.push({ user_id: ME, game_id: `s${n}`, source: 'duels_ink', played_at: new Date(at).toISOString(), visibility: 'private', created_at: new Date(at).toISOString(),
      summary: { result: win ? 'win' : 'loss', my_deck: 'Amber/Steel', my_inks: 'Amber/Steel', opp_deck: opp, opp_inks: opp, went_first: first, my_lore: win ? 20 : 12, opp_lore: win ? 12 : 20,
        queue: q, gim, mmr_before: mmrd == null ? null : mmr, mmr_delta: mmrd, list_key: list } });
    if (mmrd != null) mmr += mmrd;
  };
  for (let d = 29; d >= 0; d--) {
    const day = now - d * 864e5, list = d > 12 ? 'v1aaaaaaaa' : 'v2bbbbbbbb';
    add(day - 5 * 36e5, 'Core Set 14 BO1', 1, d % 3 !== 0, d % 2 === 0, list, opps[d % 3], d % 3 !== 0 ? 14 : -15);
    // a best-of-3: games 1 and 2 (and 3 on some days), MMR only on the last game
    const won = d % 4 !== 0, three = d % 2 === 0;
    add(day - 3 * 36e5, 'Core Set 14 BO3', 1, won, true, list, opps[(d + 1) % 3], null);
    if (three) {
      add(day - 3 * 36e5 + 15 * 6e4, 'Core Set 14 BO3', 2, !won, false, list, opps[(d + 1) % 3], null);
      add(day - 3 * 36e5 + 30 * 6e4, 'Core Set 14 BO3', 3, won, true, list, opps[(d + 1) % 3], won ? 12 : -16);
    } else add(day - 3 * 36e5 + 15 * 6e4, 'Core Set 14 BO3', 2, won, false, list, opps[(d + 1) % 3], won ? 12 : -16);
  }
  return out;
}

async function stats(page, rows, logs = {}) {
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', (route) => {
    const u = new URL(route.request().url()), path = u.pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'game_logs') { const id = (u.searchParams.get('game_id') || '').replace(/^eq\./, ''); return json(id ? [{ log: logs[id] }] : rows); }
    if (path === 'rpc/my_profile') return json({ display_name: 'Luís', adult: true });
    return json(path.startsWith('rpc/') ? null : []);
  });
  await page.goto(url('coach/'));
  await page.locator('#tabStats').click();
}

test('stats: record, match win rate, streak, MMR, charts, matrix, deck versions', async ({ page }) => {
  const rows = statRows();
  const deck = (extra) => ({ format_version: '1.0', game_id: 'x', source: 'duels_ink', played_at: '2026-10-21T20:00:00Z', turns: [], result: { winner: 'p1' },
    players: [{ seat: 'p1', is_me: true, name: 'Luís', deck: { inks: ['Amber', 'Steel'], list: [{ card_id: 'LOR10-17', qty: 4 }, ...extra] } }, { seat: 'p2', name: 'X' }] });
  const last = (k) => rows.filter((r) => r.summary.list_key === k).at(-1).game_id;
  const logs = { [last('v1aaaaaaaa')]: deck([{ card_id: 'LOR14-2', qty: 2 }]), [last('v2bbbbbbbb')]: deck([{ card_id: 'LOR14-2', qty: 4 }]) };
  await stats(page, rows, logs);
  const T = (t) => page.locator('[data-testid="tiles"] .tile').filter({ hasText: t });
  const w = rows.filter((r) => r.summary.result === 'win').length;
  await expect(page.locator('[data-testid="record"]')).toContainText(`${rows.length} jogos`);
  await expect(page.locator('[data-testid="record"] b.win')).toHaveText(String(w));
  // 30 best-of-3 matches; won on 3 of every 4 days
  await expect(T('Partidas')).toContainText('em melhor de 3');
  await expect(T('Partidas')).toContainText('22–8');
  await expect(T('Sequência')).toBeVisible();
  await expect(page.locator('[data-testid="mmr"]')).toContainText('pico');
  await expect(page.locator('.mx td').first()).toBeVisible();
  // filter one queue, then a deck: versions appear and a version shows its list and what changed
  await page.locator('#svQueue').selectOption('Core Set 14 BO1');
  await expect(T('Partidas')).toHaveCount(0);
  await expect(page.locator('[data-testid="record"]')).toContainText('30 jogos');
  await page.locator('#svQueue').selectOption('all');
  await expect(page.locator('#svDeck')).toHaveCount(0);   // one deck only: no deck picker, its versions show directly
  await page.locator('[data-ver="v2bbbbbbbb"]').click();
  await expect(page.locator('#verBox')).toContainText('Mudanças desde a versão 1');
  await expect(page.locator('#verBox .vdiff')).toContainText('+2');
  await page.locator('#svVer').selectOption('v1aaaaaaaa');
  await expect(page.locator('[data-testid="record"]')).toContainText(`${rows.filter((r) => r.summary.list_key === 'v1aaaaaaaa').length} jogos`);
});

