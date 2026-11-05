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
  mid: l.game_id.startsWith('a') ? 'match-a' : null, mgn: l.game_id.startsWith('a') ? '3' : null, on1: l.players[1].name, om1: 'false',   // a1–a3: linked from a match.json
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
  const add = (at, q, gim, win, first, list, opp, mmrd, mid = null) => {
    n += 1;
    out.push({ user_id: ME, game_id: `s${n}`, source: 'duels_ink', played_at: new Date(at).toISOString(), visibility: 'private', created_at: new Date(at).toISOString(), mid,
      summary: { result: win ? 'win' : 'loss', my_deck: 'Amber/Steel', my_inks: 'Amber/Steel', opp_deck: opp, opp_inks: opp, went_first: first, my_lore: win ? 20 : 12, opp_lore: win ? 12 : 20,
        queue: q, gim, mmr_before: mmrd == null ? null : mmr, mmr_delta: mmrd, list_key: list } });
    if (mmrd != null) mmr += mmrd;
  };
  for (let d = 29; d >= 0; d--) {
    const day = now - d * 864e5, list = d > 12 ? 'v1aaaaaaaa' : 'v2bbbbbbbb';
    add(day - 5 * 36e5, 'Core Set 14 BO1', 1, d % 3 !== 0, d % 2 === 0, list, opps[d % 3], d % 3 !== 0 ? 14 : -15);
    // a best-of-3: games 1 and 2 (and 3 on some days), MMR only on the last game
    const won = d % 4 !== 0, three = d % 2 === 0;
    // linked by a match id (from duels.ink's match.json), except on day 5: the same games without the link are not a match
    const mid = d === 5 ? null : `m${d}`;
    add(day - 3 * 36e5, 'Core Set 14 BO3', 1, won, true, list, opps[(d + 1) % 3], null, mid);
    if (three) {
      add(day - 3 * 36e5 + 15 * 6e4, 'Core Set 14 BO3', 2, !won, false, list, opps[(d + 1) % 3], null, mid);
      add(day - 3 * 36e5 + 30 * 6e4, 'Core Set 14 BO3', 3, won, true, list, opps[(d + 1) % 3], won ? 12 : -16, mid);
    } else add(day - 3 * 36e5 + 15 * 6e4, 'Core Set 14 BO3', 2, won, false, list, opps[(d + 1) % 3], won ? 12 : -16, mid);
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
  // 30 best-of-3 days, 29 linked by match id (day 5, a win, is not): 21–8; games still count one by one
  await expect(T('Bo3 confirmados')).toContainText('em melhor de 3');
  await expect(T('Bo3 confirmados')).toContainText('21–8');
  await expect(T('Sequência')).toBeVisible();
  await expect(page.locator('[data-testid="mmr"]')).toContainText('pico');
  await expect(page.locator('.mx td').first()).toBeVisible();
  // filter one queue, then a deck: versions appear and a version shows its list and what changed
  await page.locator('#svQueue').selectOption('Core Set 14 BO1');
  await expect(T('Bo3 confirmados')).toContainText('0');   // none confirmed here: zero, with how to group, not "no history"
  await expect(T('Bo3 confirmados')).toContainText('Importe o match.json para agrupar');
  await expect(page.locator('[data-testid="record"]')).toContainText('30 jogos');
  await page.locator('#svQueue').selectOption('all');
  await expect(page.locator('#svDeck')).toHaveCount(0);   // one deck only: no deck picker, its versions show directly
  await page.locator('[data-ver="v2bbbbbbbb"]').click();
  await expect(page.locator('#verBox')).toContainText('Mudanças desde a versão 1');
  await expect(page.locator('#verBox .vdiff')).toContainText('+2');
  await page.locator('#svVer').selectOption('v1aaaaaaaa');
  await expect(page.locator('[data-testid="record"]')).toContainText(`${rows.filter((r) => r.summary.list_key === 'v1aaaaaaaa').length} jogos`);
});


test('my own Lore Counter game can be deleted with two taps; duels.ink games cannot', async ({ page }) => {
  const counterLog = { ...game('c1', '2026-10-21T20:00:00Z', 1, 'Mesa', true, 0), source: 'lore_counter', event: { kind: 'paper' }, source_ref: {}, lore_track: [{ t: 0, p1: 0, p2: 0 }, { t: 600, p1: 20, p2: 12 }] };
  let rows = [...ROWS, { user_id: ME, game_id: 'c1', source: 'lore_counter', played_at: counterLog.played_at, visibility: 'private', created_at: counterLog.played_at, summary: { result: 'win', my_deck: 'Amber/Steel', opp_deck: 'Ruby', my_lore: 20, opp_lore: 12 } }];
  const deletes = [];
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', (route) => {
    const u = new URL(route.request().url()), path = u.pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (route.request().method() === 'DELETE') {
      deletes.push(`${path}?${u.searchParams.toString()}`);
      if (path === 'game_logs') rows = rows.filter((r) => `eq.${r.game_id}` !== u.searchParams.get('game_id'));
      return route.fulfill({ status: 204, body: '' });
    }
    if (path === 'game_logs') {
      const id = (u.searchParams.get('game_id') || '').replace(/^eq\./, '');
      return json(id ? [{ log: id === 'c1' ? counterLog : LOGS[id] }] : rows);
    }
    if (path === 'rpc/my_profile') return json({ display_name: 'Luís', adult: true });
    return json(path.startsWith('rpc/') ? null : []);
  });
  await page.goto(url('coach/?game=a2'));
  await expect(page.locator('[data-testid="match-charts"]')).toBeVisible();
  await expect(page.locator('[data-testid="game-delete"]')).toHaveCount(0);   // duels.ink: no delete
  await page.goto(url('coach/?game=c1'));
  const del = page.locator('[data-testid="game-delete"]');
  await expect(del).toHaveText('Apagar jogo');
  await del.click();
  await expect(del).toContainText('Apagar este jogo e os comentários?');
  expect(deletes).toEqual([]);
  await del.click();
  await expect.poll(() => deletes.length).toBe(2);
  expect(deletes[0]).toContain('game_notes?owner_id=eq.' + ME);
  expect(deletes[1]).toContain('game_logs?user_id=eq.' + ME);
  expect(deletes[1]).toContain('game_id=eq.c1');
  await expect(page.locator('.game[data-k="c1"]')).toHaveCount(0);
  await expect(page.locator('.game[data-k="a2"]')).toHaveCount(1);
});

test('a game without a deck list can take one of my Inkwell decks', async ({ page }) => {
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', (route) => {
    const u = new URL(route.request().url()), path = u.pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'game_logs') { const id = (u.searchParams.get('game_id') || '').replace(/^eq\./, ''); return json(id ? [{ log: LOGS[id] }] : ROWS); }
    if (path === 'inkwell_profiles') return json([{ profile: 'principal', decks: [{ id: 'd1', name: 'Circle of Life', cards: { 'LOR14-1': 4, 'LOR12-195': 2 } }, { id: 'd2', name: 'Vazio', cards: {} }] }]);
    if (path === 'rpc/my_profile') return json({ display_name: 'Luís', adult: true });
    return json(path.startsWith('rpc/') ? null : []);
  });
  await page.route('https://duels.ink/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>replay</p>' }));
  await page.goto(url('coach/?game=a2'));
  const pick = page.locator('[data-testid="deck-pick"]');
  await expect(pick.locator('option')).toHaveCount(2);   // the empty deck is left out
  await pick.selectOption({ label: 'Circle of Life' });
  await expect(page.locator('#deckBox')).toBeVisible();
  await expect(page.locator('#deckText')).toHaveValue(/^4 .+\n2 .+$/);
});

test('filter: online (duels.ink) or at the table (Lore Counter)', async ({ page }) => {
  const rows = [...ROWS, { user_id: ME, game_id: 'c1', source: 'lore_counter', played_at: '2026-10-21T20:00:00Z', visibility: 'private', created_at: '2026-10-21T20:00:00Z', summary: { result: 'win', my_deck: 'Amber/Steel', opp_deck: 'Ruby', my_lore: 20, opp_lore: 12 } }];
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', (route) => {
    const u = new URL(route.request().url()), path = u.pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'game_logs') return json(u.searchParams.get('game_id') ? [] : rows);
    if (path === 'rpc/my_profile') return json({ display_name: 'Luís', adult: true });
    return json(path.startsWith('rpc/') ? null : []);
  });
  await page.goto(url('coach/'));
  await page.locator('#groupChip').click();   // by date: one row per game
  await expect(page.locator('.game[data-k]')).toHaveCount(5);
  await page.locator('[data-place="table"]').click();
  await expect(page.locator('.game[data-k]')).toHaveCount(1);
  await expect(page.locator('.game[data-k="c1"]')).toHaveCount(1);
  await page.locator('[data-place="online"]').click();
  await expect(page.locator('.game[data-k]')).toHaveCount(4);
});

test('Analisar com IA: the game as a prompt for my own AI; the answer can be kept as a comment', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  const log = { ...LOGS.a1, turns: [
    { number: 1, player: 'p1', actions: [{ by: 'p1', seq: 1, type: 'ink', card_id: 'LOR11-174' }, { by: 'p1', seq: 2, type: 'play', card_id: 'LOR11-89' }], lore_end: { p1: 0, p2: 0 } },
    { number: 2, player: 'p2', actions: [{ by: 'p2', seq: 3, type: 'quest', value: 2, card_id: 'LOR11-86', lore_after: { p1: 0, p2: 2 } }], lore_end: { p1: 0, p2: 2 } }] };
  const notes = [];
  await page.route('**/rest/v1/**', (route) => {
    const req = route.request(), u = new URL(req.url()), path = u.pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'game_logs') { const id = (u.searchParams.get('game_id') || '').replace(/^eq\./, ''); return json(id ? [{ log }] : [ROWS[0]]); }
    if (path === 'game_notes' && req.method() === 'POST') { const b = JSON.parse(req.postData()); const row = (Array.isArray(b) ? b[0] : b); notes.push(row); return json([{ id: 'n1', owner_id: ME, created_at: new Date().toISOString(), ...row }]); }
    if (path === 'rpc/my_profile') return json({ display_name: 'Luís', adult: true });
    return json(path.startsWith('rpc/') ? null : []);
  });
  await page.goto(url('coach/?game=a1'));
  await page.locator('[data-testid="ai-analyse"]').click();
  const box = page.locator('#aiPrompt');
  await expect(box).toHaveValue(/Por que perdi/);
  await expect(box).toHaveValue(/T1 Eu \(inkwell 1\): tinta: Darkwing Duck - Crime Fighter; joga White Rabbit - Late Again/);
  await expect(box).toHaveValue(/- Vixey - Forest Friend \(3⬡/);
  await page.locator('#aiCopy').click();
  await expect(page.locator('#aiMsg')).toContainText('Copiado');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Você é um coach experiente de Disney Lorcana/);
  await expect(page.locator('[data-ai="ChatGPT"]')).toHaveAttribute('href', 'https://chatgpt.com/');
  await page.locator('#aiAnswer').fill('Você perdeu porque não desafiou a Vixey.');
  if (process.env.SHOT) { await page.screenshot({ path: process.env.SHOT + '-d.png' }); await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: process.env.SHOT + '-m.png' }); }
  await page.locator('#aiSave').click();
  await expect(page.locator('#aiMsg')).toContainText('Salvo');
  await expect.poll(() => notes.length).toBe(1);
  expect(JSON.stringify(notes[0])).toContain('Análise da IA:\\nVocê perdeu porque não desafiou a Vixey.');
});

// ---------- best-of-3 linked by duels.ink's match.json (matchId + gameId, checked; nothing guessed) ----------
test('match.json links my best-of-3: one entry with the score, games inside, opponent for me; again changes nothing', async ({ page }) => {
  const dg = (n, at, win, opp = 'Zé') => { const l = game(`duels-g${n}`, at, n <= 3 ? n : 1, opp, win, 8); l.source = 'duels_ink'; l.source_ref.game_id = `g${n}`; return l; };
  const logs = { 'duels-g1': dg(1, '2026-10-20T22:35:00Z', false), 'duels-g2': dg(2, '2026-10-20T22:49:00Z', true), 'duels-g3': dg(3, '2026-10-20T23:00:00Z', true),
    'duels-g9': dg(9, '2026-10-20T23:30:00Z', true, 'Outro') };
  const patches = [];
  const rowOf = (l) => ({ user_id: ME, game_id: l.game_id, source: 'duels_ink', played_at: l.played_at, visibility: 'private', created_at: l.played_at,
    mid: l.event.match_id || null, mgn: l.event.match_games ? String(l.event.match_games) : null, gim: l.event.game_in_match ? String(l.event.game_in_match) : null, on0: l.players[0].name, on1: l.players[1].name, om1: 'false',
    summary: { result: l.result.winner === 'p1' ? 'win' : 'loss', my_deck: 'Amber/Steel', opp_deck: 'Ruby', my_lore: l.result.final_lore.p1, opp_lore: l.result.final_lore.p2, went_first: l.players[0].went_first } });
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', (route) => {
    const req = route.request(), u = new URL(req.url()), path = u.pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'game_logs' && req.method() === 'PATCH') {
      const id = (u.searchParams.get('game_id') || '').replace(/^eq\./, ''), body = JSON.parse(req.postData());
      patches.push({ id, keys: Object.keys(body), ev: body.log.event }); logs[id] = body.log;
      return route.fulfill({ status: 204, body: '' });
    }
    if (path === 'game_logs') { const id = (u.searchParams.get('game_id') || '').replace(/^eq\./, ''); return json(id ? [{ log: logs[id] }] : Object.values(logs).map(rowOf).reverse()); }
    if (path === 'rpc/my_profile') return json({ display_name: 'Luís', adult: true });
    return json(path.startsWith('rpc/') ? null : []);
  });
  await page.goto(url('coach/'));
  await expect(page.locator('.game')).toHaveCount(4);   // the old games all show, one by one
  await expect(page.locator('details.bo3')).toHaveCount(0);   // nothing grouped before the match file
  await expect(page.getByTestId('bo3-hint')).toContainText('importe o match.json de cada partida');
  const manifest = { matchId: 'M-1', matchFormat: 'bo3', playerNames: ['Luís', 'Zé'], matchWinner: 'Luís',
    games: [{ gameId: 'g1', gameNumber: 1, winner: 'Zé', matchScoreAfter: '0-1' }, { gameId: 'g2', gameNumber: 2, winner: 'Luís', matchScoreAfter: '1-1' },
      { gameId: 'g3', gameNumber: 3, winner: 'Luís', matchScoreAfter: '2-1' }, { gameId: 'gX', gameNumber: 3, winner: 'Luís' }] };
  const upload = () => page.locator('#addFile').setInputFiles({ name: 'match.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) });
  await upload();
  await expect(page.locator('#addStatus')).toHaveText('Bo3: 3 games vinculados, 0 já vinculados, 1 não encontrados aqui (ficam separados).');
  expect(patches.map((p) => p.id).sort()).toEqual(['duels-g1', 'duels-g2', 'duels-g3']);
  expect(patches.every((p) => p.keys.join() === 'log' && p.ev.match_id === 'M-1' && p.ev.match_games === 4)).toBe(true);   // only the log; visibility untouched
  expect(JSON.stringify(Object.values(logs).map((l) => l.event))).not.toContain('playerNames');
  // the list: one Bo3 entry (2–1, won) with its 3 games inside, and the game outside the match on its own
  const m = page.locator('details.bo3[data-match="M-1"]');
  await expect(m).toHaveCount(1);
  await expect(m.getByTestId('match-score')).toHaveText('2–1');
  await expect(m.locator('summary')).toContainText('Vitória');
  await expect(m.locator('summary')).toContainText('Zé');   // the opponent, for me
  await m.locator('summary').click();
  await expect(m.locator('.game')).toHaveCount(3);
  await expect(page.locator('details.bo3 .game[data-k="duels-g9"]')).toHaveCount(0);   // the game outside the match stays on its own
  await expect(page.locator('.game[data-k="duels-g9"]')).toHaveCount(1);
  await expect(page.locator('#jgSub')).toContainText('4 jogos · 1 confrontos Bo3 (1 vencidos de 1 terminados)');
  // the same file again: nothing written
  await upload();
  await expect(page.locator('#addStatus')).toHaveText('Bo3: 0 games vinculados, 3 já vinculados, 1 não encontrados aqui (ficam separados).');
  expect(patches).toHaveLength(3);
  // a game whose number does not match the file is not linked
  const other = { ...manifest, matchId: 'M-2', games: [{ gameId: 'g9', gameNumber: 2 }] };
  await page.locator('#addFile').setInputFiles({ name: 'match.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(other)) });
  await expect(page.locator('#addStatus')).toContainText('0 games vinculados, 0 já vinculados, 1 não encontrados');
  expect(patches).toHaveLength(3);
});

test('Feed: a linked best-of-3 is one post with the match score; an unlinked game stays its own post; no opponent names', async ({ page }) => {
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  const at = (h) => `2026-11-04T${h}:00:00Z`;
  const r = (id, h, win, mid) => ({ user_id: ME, game_id: id, source: 'duels_ink', played_at: at(h), visibility: 'friends', group_id: null, mid, mgn: mid ? '3' : null,
    summary: { result: win ? 'win' : 'loss', my_deck: 'Amber/Steel', opp_deck: 'Ruby', my_lore: win ? 20 : 9, opp_lore: win ? 9 : 20 } });
  const rows = [r('duels-g9', '13', true, null), r('duels-g3', '12', true, 'M-1'), r('duels-g2', '11', true, 'M-1'), r('duels-g1', '10', false, 'M-1')];
  let asked = '';
  await page.route('**/rest/v1/**', (route) => {
    const u = new URL(route.request().url()), path = u.pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'game_logs' && u.searchParams.get('visibility') === 'neq.private') { asked = u.searchParams.get('select'); return json(rows); }
    if (path === 'profiles') return json([{ user_id: ME, display_name: 'Luís' }]);
    if (path === 'rpc/my_profile') return json({ display_name: 'Luís', handle: 'luis', adult: true, is_public: false });
    if (path === 'rpc/my_home') return json({ profile: { handle: 'luis', is_public: false, adult: true } });
    return json(path.startsWith('rpc/') ? null : []);
  });
  await page.goto(url('feed/'));
  await expect(page.locator('article.post')).toHaveCount(2);
  const bo3 = page.getByTestId('feed-bo3');
  await expect(bo3).toHaveCount(1);
  await expect(bo3).toContainText('Bo3 · Venceu');
  await expect(bo3.locator('.score')).toHaveText('2–1');
  await page.locator('details.bo3g summary').click();
  await expect(page.locator('details.bo3g li')).toHaveCount(3);
  const g1 = page.locator('details.bo3g li').first();
  await expect(g1.locator('.n')).toHaveText('Jogo 1');
  await expect(g1.locator('.loss')).toHaveText('Perdeu');
  await expect(g1.locator('.lore')).toHaveText('9–20');
  await expect(g1.getByRole('link', { name: 'Abrir jogo' })).toHaveAttribute('href', /game=duels-g1/);
  // both decks as split ink tokens, coloured from the inks (Amber/Steel vs Ruby)
  const sp = page.getByTestId('bo3-matchup').getByTestId('inksplit');
  await expect(sp).toHaveCount(2);
  expect(await sp.first().locator('i').evaluateAll((els) => els.map((e) => e.dataset.ink))).toEqual(['amber', 'steel']);
  const bg = await sp.nth(1).locator('i').first().evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  if (process.env.SHOT_DIR) for (const th of ['dia', 'noite']) { await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, th); await page.locator('article.post:has([data-testid="feed-bo3"])').screenshot({ path: `${process.env.SHOT_DIR}/feed-bo3-${th}.png` }); }
  // the composer's "who sees" list: readable options in both themes (they were white on the system's white list)
  for (const th of ['dia', 'noite']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, th);
    const c = await page.locator('#cmpVis option[value="public"]').evaluate((o) => [getComputedStyle(o).color, getComputedStyle(o).backgroundColor]);
    const lum = (x) => { const [r, g, b] = x.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const [a, b] = [lum(c[0]), lum(c[1])].sort((x, y) => y - x);
    expect((a + 0.05) / (b + 0.05), `${th}: ${c}`).toBeGreaterThan(4.5);
  }
  expect(asked).toContain('mid:log->event->>match_id');
  expect(asked).not.toMatch(/players|name/);   // the feed never reads opponents' names
});
