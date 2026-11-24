// Decks › Testar mão (Fase 3): opening hand and mulligan. The rules and the numbers are checked in
// tools/handlab.test.mjs; here: the screen shows exactly what handlab.js computes, nothing is saved, and it works by
// touch, mouse and keyboard from 320 px up. Chromium, and WebKit (iPhone) with PW_WEBKIT=1.
//   (cd site && python3 -m http.server 8080) &
//   npx playwright test tools/handlab.spec.mjs
import { test, expect } from '@playwright/test';

const BASE = new URL('decks/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';
const IDS = ['LOR10-1', 'LOR10-10', 'LOR10-11', 'LOR10-12', 'LOR10-13', 'LOR10-14', 'LOR10-15', 'LOR10-16',
  'LOR10-17', 'LOR10-18', 'LOR10-2', 'LOR10-21', 'LOR10-22', 'LOR10-23'];   // Amber, 14 × 4 = 56: not legal yet
const SHORT = { id: 'deck-a', name: 'Amber Test', format: 'core', colors: ['Amber'], cards: Object.fromEntries(IDS.map((id) => [id, 4])), created_at: '2026-10-01' };
const FULL = { ...SHORT, id: 'deck-f', name: 'Amber 60', cards: { ...SHORT.cards, 'LOR10-3': 4 } };   // + Rapunzel × 4 = 60, legal
const SEED = 1234;

async function setup(page, { decks = [SHORT, FULL], seed = SEED } = {}) {
  const calls = [];
  await page.addInitScript(({ me, seed }) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
    window.INKWELL_HAND_SEED = seed;
  }, { me: ME, seed });
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, '');
    calls.push({ path, method: req.method() });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles') return json([{ profile: 'luiscredie', updated_at: '2026-10-20T10:00:00Z', collection: {}, decks: JSON.parse(JSON.stringify(decks)) }]);
    if (path === 'profiles') return json([{ user_id: ME, display_name: 'Luis' }]);
    if (path === 'rpc/save_deck') return json({ ...JSON.parse(req.postData()).p_deck, updated_at: '2026-10-21T10:00:00Z' });
    return json([]);
  });
  return { calls };
}
const lab = (page) => page.getByTestId('lab');
// what handlab.js says for this deck and seed, computed in the page with the page's own card data
const expected = (page, deckCards, seed, back, order) => page.evaluate(({ deckCards, seed, back, order }) => {
  const H = window.INKWELL_HANDLAB, st = H.deal(deckCards, seed), hand = st.hand.map((c) => c.uid);
  if (back == null) return { hand };
  const r = H.mulligan(st, back.map((i) => hand[i]));
  return { hand, returned: r.returned.map((c) => c.uid), drawn: r.drawn.map((c) => c.uid), final: r.final.map((c) => c.uid) };
}, { deckCards, seed, back, order });
async function openLab(page, deck = 'deck-a') {
  await page.goto(BASE + '?deck=' + deck);
  await page.getByTestId('hand-open').click();
  await expect(lab(page)).toBeVisible();
}
const tapOrClick = async (page, loc) => ((await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) ? loc.tap() : loc.click());

test('seven cards from the deck: pictures, cost and inkable mark, the same as handlab.js for the seed', async ({ page }) => {
  await setup(page);
  await openLab(page);
  await expect(lab(page)).not.toContainText('%');   // nothing evaluated yet
  await page.getByTestId('lab-deal').click();
  const cards = page.getByTestId('lab-hand').getByTestId('lab-card');
  await expect(cards).toHaveCount(7);
  const want = await expected(page, SHORT.cards, SEED);
  expect(await page.$$eval('[data-testid="lab-hand"] [data-luid]', (b) => b.map((x) => x.dataset.luid))).toEqual(want.hand);
  for (const c of await cards.all()) {
    await expect(c.locator('.lab-img img')).toHaveCount(1);
    await expect(c.locator('.cost')).toHaveText(/^\d+$/);
  }
  // inkable mark: the cost has the ink frame exactly for inkable cards (the aria label says it in words)
  const marks = await page.$$eval('[data-testid="lab-hand"] [data-luid]', (b) => b.map((x) => [x.querySelector('.cost').classList.contains('ink'), /tintável/.test(x.getAttribute('aria-label')) && !/não tintável/.test(x.getAttribute('aria-label'))]));
  for (const [frame, says] of marks) expect(frame).toBe(says);
});

test('pick by touch or click and by keyboard; no evaluation before confirming; then original, returned and final', async ({ page }) => {
  const { calls } = await setup(page);
  await openLab(page);
  await page.waitForLoadState('networkidle');
  const atDeal = calls.length;
  await page.getByTestId('lab-deal').click();
  const picks = page.locator('[data-testid="lab-hand"] [data-luid]');
  await tapOrClick(page, picks.nth(0));
  await picks.nth(1).focus(); await page.keyboard.press('Space');
  await picks.nth(2).focus(); await page.keyboard.press('Enter');
  await tapOrClick(page, picks.nth(2));   // and back
  await expect(picks.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(picks.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(picks.nth(2)).toHaveAttribute('aria-pressed', 'false');
  await expect(picks.nth(0)).toHaveAttribute('aria-label', /: devolver$/);
  await expect(page.getByTestId('lab-count')).toHaveText('Manter 5 · Devolver 2');
  await expect(page.getByTestId('lab-confirm')).toHaveText('Devolver 2 e comprar 2');
  await expect(page.getByTestId('lab-analysis')).toHaveCount(0);
  await expect(lab(page)).not.toContainText('%');
  await page.getByTestId('lab-confirm').click();
  const want = await expected(page, SHORT.cards, SEED, [0, 1]);
  const ids = (tid) => page.$$eval(`[data-testid="${tid}"] [data-card]`, (e) => e.map((x) => x.dataset.card));
  expect(await ids('lab-original')).toEqual(want.hand.map((u) => u.split('#')[0]));
  expect(await ids('lab-returned')).toEqual(want.returned.map((u) => u.split('#')[0]));
  expect(await ids('lab-final')).toEqual(want.final.map((u) => u.split('#')[0]));
  await expect(page.getByTestId('lab-original').locator('.lab-card.returned')).toHaveCount(2);
  await expect(page.getByTestId('lab-final').locator('.lab-card.new')).toHaveCount(2);
  expect(want.drawn.some((u) => want.returned.includes(u))).toBe(false);   // not drawn back right away
  await expect(page.locator('#labO')).toBeFocused();
  // one mulligan per hand: no way to pick again, only "Nova mão"
  await expect(page.locator('[data-luid]')).toHaveCount(0);
  await expect(page.getByTestId('lab-again')).toBeVisible();
  expect(calls.slice(atDeal)).toEqual([]);   // the lab itself asks nothing of the server (the page's own loading came before)
  expect(calls.filter((c) => c.path === 'rpc/save_deck')).toEqual([]);
});

test('the analysis shows exactly what handlab.js computes; going first or second changes it', async ({ page }) => {
  await setup(page);
  await openLab(page);
  await page.getByTestId('lab-deal').click();
  const picks = page.locator('[data-testid="lab-hand"] [data-luid]');
  await picks.nth(3).click(); await picks.nth(5).click();
  await page.getByTestId('lab-confirm').click();
  const an = page.getByTestId('lab-analysis');
  await expect(page.getByTestId('lab-label')).toHaveText(/^Análise heurística: .*Não é chance de vitória e ainda não usa partidas reais nem o motor de IA\.$/);
  const numbers = (order) => page.evaluate(({ cards, seed, order }) => {
    const H = window.INKWELL_HANDLAB, st = H.deal(cards, seed), r = H.mulligan(st, [st.hand[3].uid, st.hand[5].uid]);
    const a = H.analyze(r, window.INKWELL_HAND_INFO, order), pc = (p) => `${Math.round(p * 100)}%`;
    return Object.fromEntries(['ink', 'early', 'three'].map((k) => [k, [pc(a.probs.keep[k]), pc(a.probs.expect[k]), pc(a.probs.final[k])]]));
  }, { cards: SHORT.cards, seed: SEED, order });
  const row = (k) => an.locator(`tr[data-p="${k}"] td`);
  const shown = async () => Object.fromEntries(await Promise.all(['ink', 'early', 'three'].map(async (k) => [k, await row(k).allTextContents()])));
  const first = await shown();
  expect(first).toEqual(await numbers('first'));
  await page.locator('[data-lorder="second"]').click();
  const second = await shown();
  expect(second).toEqual(await numbers('second'));
  for (const k of ['ink', 'early', 'three']) for (const v of [...first[k], ...second[k]]) expect(v).toMatch(/^\d{1,3}%$/);
  // the second player draws one more card by every turn: no chance goes down
  for (const k of ['ink', 'early', 'three']) for (let i = 0; i < 3; i++) expect(parseInt(second[k][i])).toBeGreaterThanOrEqual(parseInt(first[k][i]));
  await expect(an).toContainText('Segundo jogador: você compra no turno 1.');
  // the three columns, labelled
  await expect(an.locator('thead th')).toContainText(['Manter as 7', 'Sua decisão (expectativa)', 'O que veio']);
  await expect(page.getByTestId('lab-lead')).toHaveText(/^(Em média, sua decisão (aumentou|reduziu|deixou praticamente igual) a chance de ter tintáveis para pôr tinta todo turno até o turno 4: \d+% → \d+%\. A compra veio (acima|abaixo|perto) disso \(\d+%\)\.|Todas as chances calculadas aqui deram 100%)/);
  await expect(page.getByTestId('lab-inknote')).toContainText('Não simula os turnos');
});

test('two copies of one card are two cards: one goes back, the other stays', async ({ page }) => {
  await setup(page);
  await openLab(page);
  // find a seed whose hand has two copies of the same card
  const seed = await page.evaluate((cards) => { const H = window.INKWELL_HANDLAB; for (let s = 1; s < 5000; s++) { const ids = H.deal(cards, s).hand.map((c) => c.id); if (new Set(ids).size < 7) return s; } }, SHORT.cards);
  await page.evaluate((s) => { window.INKWELL_HAND_SEED = s; }, seed);
  await page.getByTestId('lab-deal').click();
  const uids = await page.$$eval('[data-testid="lab-hand"] [data-luid]', (b) => b.map((x) => x.dataset.luid));
  const id = uids.map((u) => u.split('#')[0]).find((x, i, a) => a.indexOf(x) !== i);
  const copies = uids.filter((u) => u.startsWith(id + '#'));
  await page.locator(`[data-luid="${copies[0]}"]`).click();
  await page.getByTestId('lab-confirm').click();
  const want = await expected(page, SHORT.cards, seed, [uids.indexOf(copies[0])]);
  expect(want.final).toContain(copies[1]);
  expect(want.drawn).not.toContain(copies[0]);
  await expect(page.getByTestId('lab-returned').locator('[data-card]')).toHaveCount(1);
});

test('"Nova mão" again and again on the same deck; keeping all 7 says so', async ({ page }) => {
  await setup(page);
  await openLab(page);
  await page.getByTestId('lab-deal').click();
  const hands = [];
  for (let i = 0; i < 3; i++) {
    hands.push((await page.$$eval('[data-testid="lab-hand"] [data-luid]', (b) => b.map((x) => x.dataset.luid))).join());
    await expect(page.getByTestId('lab-confirm')).toHaveText('Manter as 7');
    await page.getByTestId('lab-confirm').click();
    await expect(page.getByTestId('lab-returned')).toHaveText('Nenhuma: você manteve as 7.');
    await expect(page.getByTestId('lab-lead')).toHaveText(/^(Você manteve as 7\. Chance de ter tintáveis para pôr tinta todo turno até o turno 4: \d+%\.|Todas as chances calculadas aqui deram 100%: .*)$/);
    await page.getByTestId('lab-again').click();
  }
  expect(new Set(hands).size).toBe(3);
  await expect(page.getByTestId('lab-n')).toHaveText('4 mãos nesta sessão');
  await expect(page).toHaveURL(/\?deck=deck-a/);
});

test('practice-only notice for a deck that is not legal; none for a legal 60-card deck', async ({ page }) => {
  await setup(page);
  await openLab(page, 'deck-a');
  await expect(page.getByTestId('lab-warn')).toContainText('Treino experimental');
  await expect(page.getByTestId('lab-warn')).toContainText('faltam 4 cartas para 60');
  await page.keyboard.press('Escape');
  await page.goto(BASE + '?deck=deck-f');
  await page.getByTestId('hand-open').click();
  await expect(lab(page)).toBeVisible();
  await expect(page.getByTestId('lab-warn')).toHaveCount(0);
});

test('fewer than 7 cards: no hand, and it says why', async ({ page }) => {
  await setup(page, { decks: [{ ...SHORT, cards: { 'LOR10-1': 3, 'LOR10-2': 2 } }] });
  await openLab(page);
  await page.getByTestId('lab-deal').click();
  await expect(page.getByTestId('lab-small')).toHaveText('Faltam cartas para uma mão de 7 (esta lista tem 5).');
});

test('nothing is saved and the deck is unchanged after several hands', async ({ page }) => {
  const { calls } = await setup(page);
  await openLab(page);
  await page.waitForLoadState('networkidle');
  const before = calls.length;
  for (let i = 0; i < 3; i++) {
    await page.getByTestId(i ? 'lab-again' : 'lab-deal').click();
    await page.locator('[data-testid="lab-hand"] [data-luid]').first().click();
    await page.getByTestId('lab-confirm').click();
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  expect(calls.slice(before)).toEqual([]);   // no save_deck, no request at all
  await expect(page.locator('[data-testid="deck-stats"]')).toContainText('56/60');
});

test('from the builder: the panel (computer) and the summary sheet (phone) open it; closing leaves the builder as it was', async ({ page }) => {
  await setup(page);
  await page.goto(BASE + '?deck=deck-a');
  await page.getByRole('button', { name: 'Editar lista' }).click();
  await expect(page.getByTestId('builder')).toBeVisible();
  await page.locator('[data-bcost="2"]').click();
  const phone = await page.getByTestId('bs-open').isVisible();
  if (phone) { await page.getByTestId('bs-open').click(); await page.locator('#sheet').getByTestId('bp-hand').click(); }
  else await page.getByTestId('bld-panel').getByTestId('bp-hand').click();
  await expect(lab(page)).toBeVisible();
  await page.getByTestId('lab-deal').click();
  await expect(page.getByTestId('lab-hand').getByTestId('lab-card')).toHaveCount(7);
  await page.keyboard.press('Escape');
  await expect(lab(page)).toBeHidden();
  await expect(page.getByTestId('builder')).toBeVisible();
  await expect(page.locator('[data-bcost="2"]')).toHaveAttribute('aria-pressed', 'true');   // Fase 2 filters as they were
});

test('accessibility: a titled dialog, Esc closes and gives the focus back, readable contrast', async ({ page }) => {
  await setup(page);
  await page.goto(BASE + '?deck=deck-a');
  const open = page.getByTestId('hand-open');
  await open.click();
  const sheet = page.locator('#sheet');
  await expect(sheet).toHaveAttribute('aria-labelledby', 'shT');
  await expect(sheet.locator('#shT')).toContainText('Testar mão');
  await page.getByTestId('lab-deal').click();
  await expect(page.locator('[data-luid]').first()).toBeFocused();
  const ratio = await page.$$eval('[data-testid="lab-hand"] .lab-nm, [data-testid="lab-count"]', (els) => {
    const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number), lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bg = (e) => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return rgb(c); } return [255, 255, 255]; };
    return Math.min(...els.map((e) => { const a = lum(rgb(getComputedStyle(e).color)), b = lum(bg(e)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(open).toBeFocused();
});

for (const w of [320, 360, 390, 430]) {
  test(`phone ${w}px: the sheet fills the screen, 3 columns, big enough to tap, the bar never covers a card`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 760 });
    await setup(page);
    await openLab(page);
    await page.getByTestId('lab-deal').click();
    const sheet = await page.locator('#sheet').boundingBox();
    expect(Math.round(sheet.width)).toBe(w);
    const xs = await page.$$eval('[data-testid="lab-hand"] .lab-card', (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
    expect(xs.length).toBe(3);
    const sizes = await page.$$eval('[data-luid]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
    for (const [wd, ht] of sizes) { expect(ht).toBeGreaterThanOrEqual(44); expect(wd).toBeGreaterThanOrEqual(80); }
    expect(await page.evaluate(() => { const s = document.querySelector('#sheet'); return s.scrollWidth <= s.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; })).toBe(true);
    // scrolled to the end, the last card sits above the confirm bar
    await page.locator('[data-luid]').last().scrollIntoViewIfNeeded();
    await page.locator('.lab-body').evaluate((b) => b.closest('dialog').scrollTo(0, 1e6));
    const last = await page.locator('[data-luid]').last().boundingBox(), bar = await page.locator('.lab-bar').boundingBox();
    expect(last.y + last.height).toBeLessThanOrEqual(bar.y + 1);
    await tapOrClick(page, page.locator('[data-luid]').nth(6));
    await expect(page.getByTestId('lab-count')).toHaveText('Manter 6 · Devolver 1');
    await page.getByTestId('lab-confirm').click();
    await expect(page.getByTestId('lab-analysis')).toBeVisible();
    expect(await page.evaluate(() => { const s = document.querySelector('#sheet'); return s.scrollWidth <= s.clientWidth + 1; })).toBe(true);
  });
}

test('every number at 100%: says these measures do not tell decisions apart, with no score', async ({ page }) => {
  // only inkable cards of cost 1, 2 and 3 (practice deck): every chance is 100% whatever is kept
  await setup(page, { decks: [{ ...SHORT, cards: { 'LOR10-5': 20, 'LOR10-3': 20, 'LOR10-12': 20 } }] });
  await openLab(page);
  await page.getByTestId('lab-deal').click();
  await page.locator('[data-luid]').first().click();
  await page.getByTestId('lab-confirm').click();
  await expect(page.getByTestId('lab-lead')).toHaveText('Todas as chances calculadas aqui deram 100%: estas medidas não diferenciam as decisões nesta mão. Para revisá-la, olhe outros aspectos — quais cartas você quer jogar nos primeiros turnos e o que funciona contra o adversário.');
  expect(await page.$$eval('[data-testid="lab-probs"] td', (td) => td.every((x) => x.textContent === '100%'))).toBe(true);
  await expect(page.getByTestId('lab-analysis')).not.toContainText(/nota|ideal|vitória \d/i);
});

test('a practice deck of 9 cards: putting back more than is left draws the whole rest, then returned cards; said, not zeroed', async ({ page }) => {
  await setup(page, { decks: [{ ...SHORT, cards: { 'LOR10-1': 5, 'LOR10-3': 4 } }] });   // 9 cards: 2 left after the hand
  await openLab(page);
  await expect(page.getByTestId('lab-warn')).toContainText('Com menos de 14 cartas, uma devolvida pode voltar');
  await page.getByTestId('lab-deal').click();
  const picks = page.locator('[data-luid]');
  for (let i = 0; i < 4; i++) await picks.nth(i).click();
  await page.getByTestId('lab-confirm').click();
  await expect(page.getByTestId('lab-forced')).toHaveText('Com 2 cartas no resto do deck, a troca não teve sorteio: veio todo o resto do deck e depois as primeiras devolvidas. A expectativa da decisão é esse resultado.');
  const cols = await page.$$eval('[data-testid="lab-probs"] tr[data-p] td', (td) => td.map((x) => x.textContent));
  for (let r = 0; r < 3; r++) expect(cols[r * 3 + 1]).toBe(cols[r * 3 + 2]);   // expectation = what came
  expect(cols.some((v) => v !== '0%')).toBe(true);
  await expect(page.getByTestId('lab-final').locator('[data-card]')).toHaveCount(7);
});

test('phone: from the deck summary, open, close and reopen the lab three times — full screen each time, focus where it should be', async ({ page }) => {
  test.setTimeout(90000);   // three full cycles, each with the sheets' animations
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto(BASE + '?deck=deck-a');
  await page.getByRole('button', { name: 'Editar lista' }).click();
  const line = page.getByTestId('bs-open'), sheet = page.locator('#sheet');
  for (let i = 0; i < 3; i++) {
    await line.click();
    await expect(sheet.getByRole('heading', { name: 'Resumo do deck' })).toBeVisible();
    expect(await sheet.evaluate((d) => d.classList.contains('lab'))).toBe(false);   // the summary keeps its own layout
    await sheet.getByTestId('bp-hand').click();
    await expect(lab(page)).toBeVisible();
    await sheet.evaluate((d) => Promise.all(d.getAnimations().map((a) => a.finished)));   // after the rise-in animation
    const box = await sheet.boundingBox();
    expect([Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]).toEqual([0, 0, 390, 844]);   // full screen
    await expect(page.locator('[data-lorder="first"]')).toBeFocused();   // the first control of the lab
    await page.getByTestId('lab-deal').click();
    await expect(page.locator('[data-luid]').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(line).toBeFocused();   // back to the line that opened the summary
    // the lab's layout is cleaned up by the dialog's "close" event, a moment after it hides
    await expect.poll(() => sheet.evaluate((d) => [d.classList.contains('lab'), d.classList.contains('wide'), !!d.dataset.lab])).toEqual([false, false, false]);
  }
  await expect(page.getByTestId('builder')).toBeVisible();
});

test('all 7 back in a 7-card practice deck: says the same 7 came back — never "random"', async ({ page }) => {
  await setup(page, { decks: [{ ...SHORT, cards: { 'LOR10-1': 4, 'LOR10-3': 3 } }] });
  await openLab(page);
  await page.getByTestId('lab-deal').click();
  const picks = page.locator('[data-luid]');
  for (let i = 0; i < 7; i++) await picks.nth(i).click();
  await page.getByTestId('lab-confirm').click();
  await expect(page.getByTestId('lab-notes')).toContainText('Você devolveu as 7, mas o deck só tem 7 cartas: as mesmas 7 voltaram, e a mão final é a original.');
  await expect(page.getByTestId('lab-notes')).not.toContainText('aleatória');
  await expect(page.getByTestId('lab-forced')).toContainText('Com 0 cartas no resto do deck');
  const ids = (tid) => page.$$eval(`[data-testid="${tid}"] [data-card]`, (e) => e.map((x) => x.dataset.card).sort());
  expect(await ids('lab-final')).toEqual(await ids('lab-original'));
});
