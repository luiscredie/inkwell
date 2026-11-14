// Coleção: idioma das cartas (supabase/card_langs.sql), against a fake Supabase that keeps the language rules.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/colecao-langs.spec.mjs
import { test, expect } from '@playwright/test';

const BASE = new URL('colecao/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';
const MUSHU = 'LOR7-137', MICKEY = 'LOR1-115';

async function setup(page, { collection = { [MUSHU]: { n: 2, f: 1 }, [MICKEY]: { n: 1, f: 0 } }, prefs = {}, langs = true, revision = 7, failMark = null, last = null } = {}) {
  const calls = [], db = { collection: JSON.parse(JSON.stringify(collection)), prefs: { ...prefs }, revision, failMark };
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/.*\/rest\/v1\//, ''), body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ path, body });
    const json = (v, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    const err = (message) => json({ message, code: 'P0001' }, 400);
    if (path === 'inkwell_profiles') return json([{ profile: 'luiscredie', updated_at: '2026-11-13T10:00:00Z', collection: db.collection }]);
    if (path.startsWith('rpc/') && !langs && /lang|prefs/.test(path)) return json({ message: 'function not found', code: 'PGRST202' }, 404);
    if (path === 'rpc/collection_lang_state') return json({ revision: db.revision, prefs: db.prefs });
    if (path === 'rpc/last_lang_op') return json(last);
    if (path === 'rpc/set_collection_prefs') { Object.assign(db.prefs, body.p_prefs); for (const k of Object.keys(db.prefs)) if (db.prefs[k] === null) delete db.prefs[k]; db.revision++; return json({ prefs: db.prefs, revision: db.revision }); }
    if (path === 'rpc/mark_unknown_langs') {
      if (db.failMark) { const m = db.failMark; db.failMark = null; db.revision++; return err(m); }
      if (body.p_expected_revision !== db.revision) return err('collection_changed');
      let copies = 0;
      for (const it of body.p_items) { const e = db.collection[it.card_id], k = it.foil ? 'f' : 'n'; e.l = e.l || {}; e.l[it.lang] = { ...(e.l[it.lang] || {}), [k]: ((e.l[it.lang] || {})[k] || 0) + it.qty }; copies += it.qty; }
      if (body.p_rest) for (const e of Object.values(db.collection)) for (const k of ['n', 'f']) {
        const known = Object.values(e.l || {}).reduce((t, x) => t + (x[k] || 0), 0), u = (e[k] || 0) - known;
        if (u > 0) { e.l = e.l || {}; e.l[body.p_rest] = { ...(e.l[body.p_rest] || {}), [k]: ((e.l[body.p_rest] || {})[k] || 0) + u }; copies += u; }
      }
      db.revision++; return json({ status: 'applied', revision: db.revision, copies });
    }
    if (path === 'rpc/undo_lang_op') { db.revision++; return json({ status: 'undone', revision: db.revision }); }
    if (path === 'rpc/set_card_langs') { const e = { ...db.collection[body.p_card_id], l: body.p_langs }; db.collection[body.p_card_id] = e; db.revision++; return json({ status: 'applied', revision: db.revision, entry: e }); }
    if (['rpc/apply_collection_delta', 'rpc/collection_change', 'rpc/collection_move'].includes(path)) return route.fulfill({ status: 204, body: '' });
    if (path === 'loans' && req.method() === 'POST') return route.fulfill({ status: 201, body: '' });
    if (path === 'rpc/my_duels_sync') return json(null);
    return json([]);
  });
  return { calls, db };
}
const rpc = (calls, fn) => calls.filter((c) => c.path === `rpc/${fn}`).map((c) => c.body);
const deltas = (calls) => calls.filter((c) => /rpc\/(apply_collection_delta|collection_change)$/.test(c.path)).flatMap((c) => c.body.p_delta);

test('before card_langs.sql runs: no language parts, changes go as before', async ({ page }) => {
  const { calls } = await setup(page, { langs: false });
  await page.goto(BASE);
  await expect(page.locator('#count')).toHaveText('2 cartas');
  await expect(page.locator('[data-testid="lang-ask"]')).toHaveCount(0);
  await expect(page.locator('#openLangs')).toHaveCount(0);
  await page.locator(`[data-card="${MUSHU}"]`).click();
  await expect(page.locator('[data-testid="card-langs"]')).toHaveCount(0);
  await page.locator('#cardSheet [data-d^="n:1"]').first().click();
  await expect.poll(() => deltas(calls)).toEqual([{ card_id: MUSHU, qty: 1, foil: false }]);
});

test('old copies: the question once; "Decidir depois" hides it and nothing changes', async ({ page }) => {
  const { calls } = await setup(page);
  await page.goto(BASE);
  const ask = page.locator('[data-testid="lang-ask"]');
  await expect(ask).toContainText('Você tem 4 cópias sem idioma. Como quer marcar?');
  await ask.getByRole('button', { name: 'Decidir depois' }).click();
  await expect(ask).toHaveCount(0);
  await expect(page.locator('[data-testid="lang-progress"]')).toHaveCount(0);
  expect(rpc(calls, 'set_collection_prefs')).toEqual([{ p_owner: null, p_profile: 'luiscredie', p_prefs: { card_lang_prompt: 'later' } }]);
  expect(rpc(calls, 'mark_unknown_langs')).toEqual([]);
  await expect(page.locator('#openLangs')).toBeVisible();   // can be reopened
});

test('mark all as Italian: one operation with the revision, undo from the notice', async ({ page }) => {
  const { calls } = await setup(page);
  await page.goto(BASE);
  await page.locator('[data-testid="lang-ask"]').getByRole('button', { name: 'Marcar todas como…' }).click();
  const sh = page.locator('#langSheet');
  await sh.locator('[data-lall="it"]').click();
  await sh.getByRole('button', { name: 'Marcar 4 como Italiano' }).click();
  await expect.poll(() => rpc(calls, 'mark_unknown_langs').length).toBe(1);
  const m = rpc(calls, 'mark_unknown_langs')[0];
  expect(m).toMatchObject({ p_owner: null, p_profile: 'luiscredie', p_items: [], p_rest: 'it', p_expected_revision: 7 });
  expect(m.p_op).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.locator('#toast')).toContainText('4 cópias marcadas.');
  await expect(page.locator('[data-testid="lang-ask"]')).toHaveCount(0);
  await page.locator('#toast').getByRole('button', { name: 'Desfazer' }).click();
  await expect.poll(() => rpc(calls, 'undo_lang_op')).toEqual([{ p_op: m.p_op }]);
  expect(rpc(calls, 'set_collection_prefs').map((x) => x.p_prefs)).toEqual([{ card_lang_prompt: 'done' }]);
});

test('lists per language: a conflict blocks saving until fixed; normal and foil apart; the rest stays sem idioma', async ({ page }) => {
  const { calls } = await setup(page);
  await page.goto(BASE);
  await page.locator('[data-testid="lang-ask"]').getByRole('button', { name: 'Colar listas por idioma' }).click();
  const sh = page.locator('#langSheet');
  await sh.locator('#lText').fill('Inglês\n2 Mushu - Majestic Dragon\nItaliano\n1 Mushu - Majestic Dragon\n\nJaponês\n1 Mickey Mouse - Brave Little Tailor\n1 Carta Inventada');
  await sh.getByRole('button', { name: 'Conferir' }).click();
  await expect(sh.locator('[data-testid="lang-conflicts"]')).toContainText('você tem 2 sem idioma, a lista pede EN 2 + IT 1');
  await expect(sh.locator('[data-testid="lang-problems"]')).toContainText('1 Carta Inventada — carta não encontrada');
  await expect(sh.locator('#lSave')).toBeDisabled();
  await sh.getByRole('button', { name: 'Voltar e corrigir' }).click();
  await sh.locator('#lText').fill('Inglês\n1 Mushu - Majestic Dragon\n1 Mushu - Majestic Dragon (foil)\nItaliano\n1 Mushu - Majestic Dragon\n\nJaponês\n1 Mickey Mouse - Brave Little Tailor');
  await sh.getByRole('button', { name: 'Conferir' }).click();
  await expect(sh.locator('[data-testid="lang-plan-sum"]')).toHaveText('4 cópias vão ser marcadas: EN 2 · IT 1 · JA 1');
  await expect(sh.locator('[data-testid="lang-conflicts"]')).toHaveCount(0);
  await sh.getByRole('button', { name: 'Salvar (4 cópias)' }).click();
  await expect.poll(() => rpc(calls, 'mark_unknown_langs').length).toBe(1);
  const m = rpc(calls, 'mark_unknown_langs')[0];
  expect(m.p_rest).toBe(null);
  expect(m.p_items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual([
    { card_id: MICKEY, lang: 'ja', qty: 1, foil: false }, { card_id: MUSHU, lang: 'en', qty: 1, foil: false },
    { card_id: MUSHU, lang: 'en', qty: 1, foil: true }, { card_id: MUSHU, lang: 'it', qty: 1, foil: false }]);
  await page.locator(`[data-card="${MUSHU}"]`).click();
  await expect(page.locator('[data-testid="lang-summary"]')).toHaveText('EN 1 + 1 foil · IT 1');
});

test('the collection changed on another device: checked again before saving', async ({ page }) => {
  const { calls } = await setup(page, { failMark: 'collection_changed' });
  await page.goto(BASE);
  await page.locator('#openLangs').click();
  const sh = page.locator('#langSheet');
  await sh.locator('#lList').click();
  await sh.locator('#lText').fill('Japonês\n1 Mickey Mouse - Brave Little Tailor');
  await sh.getByRole('button', { name: 'Conferir' }).click();
  await sh.getByRole('button', { name: /Salvar/ }).click();
  await expect(sh.locator('[data-testid="lang-msg"]')).toContainText('A coleção mudou enquanto você conferia');
  await expect(sh.getByRole('button', { name: 'Salvar (1 cópias)' })).toBeEnabled();
  const states = calls.filter((c) => c.path === 'rpc/collection_lang_state').length;
  expect(states).toBeGreaterThanOrEqual(3);   // the page, the first check, the check again
  await sh.getByRole('button', { name: 'Salvar (1 cópias)' }).click();
  await expect.poll(() => rpc(calls, 'mark_unknown_langs').length).toBe(2);
  expect(rpc(calls, 'mark_unknown_langs')[1].p_expected_revision).toBe(8);
});

test('card sheet: "+" adds in the chosen language; "−" asks which when two languages could lose a copy', async ({ page }) => {
  const { calls } = await setup(page, { collection: { [MUSHU]: { n: 2, f: 0, l: { en: { n: 1 }, it: { n: 1 } } } }, prefs: { card_lang_prompt: 'done' } });
  await page.goto(BASE);
  await page.locator(`[data-card="${MUSHU}"]`).click();
  const box = page.locator('[data-testid="card-langs"]');
  await expect(box.locator('[data-testid="lang-summary"]')).toHaveText('EN 1 · IT 1');
  await box.locator('[data-lg-add="ja"]').click();
  await page.locator('#cardSheet [data-d^="n:1"]').first().click();
  await expect(box.locator('[data-testid="lang-summary"]')).toHaveText('EN 1 · IT 1 · JA 1');
  await expect.poll(() => deltas(calls)).toEqual([{ card_id: MUSHU, qty: 1, foil: false, lang: 'ja' }]);
  await page.locator('#cardSheet [data-d^="n:-1"]').first().click();
  const rm = page.locator('[data-testid="lang-rm"]');
  await expect(rm).toContainText('Tirar uma normal de qual idioma?');
  await rm.locator('[data-lg-rm="it"]').click();
  await expect(box.locator('[data-testid="lang-summary"]')).toHaveText('EN 1 · JA 1');
  await expect.poll(() => deltas(calls).length).toBe(2);
  expect(deltas(calls)[1]).toEqual({ card_id: MUSHU, qty: -1, foil: false, lang: 'it' });
});

test('"Perguntar sempre": "+" waits for a language', async ({ page }) => {
  const { calls } = await setup(page, { prefs: { card_lang_prompt: 'later', card_lang_ask: true } });
  await page.goto(BASE);
  await page.locator(`[data-card="${MICKEY}"]`).click();
  await page.locator('#cardSheet [data-d^="n:1"]').first().click();
  await expect(page.locator('[data-testid="lang-pick"]')).toHaveText('Escolha acima o idioma da nova cópia.');
  expect(deltas(calls)).toEqual([]);
  await page.locator('[data-lg-add="de"]').click();
  await expect.poll(() => deltas(calls)).toEqual([{ card_id: MICKEY, qty: 1, foil: false, lang: 'de' }]);
});

test('split one card by language from the sheet, with undo', async ({ page }) => {
  const { calls } = await setup(page, { prefs: { card_lang_prompt: 'later' } });
  await page.goto(BASE);
  await page.locator(`[data-card="${MUSHU}"]`).click();
  await page.locator('[data-testid="lang-edit"]').click();
  await page.locator('[data-le="en:n:1"]').click();
  await page.locator('[data-le="it:n:1"]').click();
  await expect(page.locator('[data-le="ja:n:1"]')).toBeDisabled();   // both normals have a language now
  await page.locator('[data-le="it:f:1"]').click();
  await expect(page.locator('[data-testid="lang-left"]')).toHaveText('Sem idioma: 0 normal · 0 foil');
  await page.getByRole('button', { name: 'Salvar idiomas' }).click();
  await expect.poll(() => rpc(calls, 'set_card_langs').length).toBe(1);
  expect(rpc(calls, 'set_card_langs')[0]).toMatchObject({ p_owner: null, p_profile: 'luiscredie', p_card_id: MUSHU, p_langs: { en: { n: 1 }, it: { n: 1, f: 1 } } });
  await expect(page.locator('[data-testid="lang-summary"]')).toHaveText('EN 1 · IT 1 + 1 foil');
  await page.locator('[data-testid="lang-saved"]').getByRole('button', { name: 'Desfazer' }).click();
  await expect.poll(() => rpc(calls, 'undo_lang_op').length).toBe(1);
});

test('lending a card with two languages: the loan says which copy', async ({ page }) => {
  const { calls } = await setup(page, { collection: { [MICKEY]: { n: 2, f: 0, l: { ja: { n: 1 }, en: { n: 1 } } } }, prefs: { card_lang_prompt: 'done' } });
  await page.goto(BASE);
  await page.locator(`[data-card="${MICKEY}"]`).click();
  await page.locator('#aLoan').click();
  await page.locator('[data-alng="0:ja"]').click();
  await page.locator('#aPerson').fill('Rafa');
  await page.locator('#aOk').click();
  await expect.poll(() => calls.filter((c) => c.path === 'loans' && c.body).map((c) => c.body.items)).toEqual([[{ card_id: MICKEY, qty: 1, foil: false, lang: 'ja' }]]);
});

test('undo the last marking after a reload', async ({ page }) => {
  const op = '00000000-0000-4000-8000-000000000042';
  const { calls } = await setup(page, { collection: { [MUSHU]: { n: 2, f: 1, l: { en: { n: 2 } } } }, prefs: { card_lang_prompt: 'done' }, last: { op_id: op, copies: 2, created_at: new Date().toISOString() } });
  await page.goto(BASE);
  await expect(page.locator('[data-testid="lang-progress"]')).toContainText('2 de 3 cópias · 1 ainda sem idioma');
  await page.locator('[data-testid="lang-progress"]').getByRole('button', { name: 'Classificar' }).click();
  await page.locator('[data-testid="lang-undo"]').click();
  await expect.poll(() => rpc(calls, 'undo_lang_op')).toEqual([{ p_op: op }]);
});

// ---------- etapa 2: filter and tag, scanner per card, import and export ----------
test('filter by card language, and the tag on cards with copies in another language', async ({ page }) => {
  await setup(page, { collection: { [MUSHU]: { n: 2, f: 0, l: { it: { n: 1 } } }, [MICKEY]: { n: 1, f: 0, l: { en: { n: 1 } } } }, prefs: { card_lang_prompt: 'done' } });
  await page.goto(BASE);
  await expect(page.locator(`[data-card="${MUSHU}"] [data-testid="lang-tag"]`)).toHaveText('IT');
  await expect(page.locator(`[data-card="${MICKEY}"] [data-testid="lang-tag"]`)).toHaveCount(0);   // English is the default: no tag
  await page.locator('#openFilters').click();
  await page.locator('[data-testid="filter-langs"] [data-k="it"]').click();
  await page.locator('#fApply').click();
  await expect(page.locator('#count')).toHaveText('1 cartas');
  await expect(page.locator(`[data-card="${MUSHU}"]`)).toBeVisible();
  await page.getByRole('button', { name: /Remover filtro IT/ }).click();
  await page.locator('#openFilters').click();
  await page.locator('[data-testid="filter-langs"] [data-k="none"]').click();
  await page.locator('#fApply').click();
  await expect(page.locator('#count')).toHaveText('1 cartas');   // only Mushu has a copy with no language
  await expect(page.locator(`[data-card="${MICKEY}"]`)).toHaveCount(0);
});

test('import: a file with a language column, compared language by language; lines without one get the language chosen', async ({ page }) => {
  const { calls } = await setup(page, { collection: { [MUSHU]: { n: 2, f: 0, l: { it: { n: 1 } } }, [MICKEY]: { n: 1, f: 0 } }, prefs: { card_lang_prompt: 'done' } });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Importar' }).click();
  await page.locator('#impFile').setInputFiles({ name: 'tcg.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Quantity,Language\nMushu - Majestic Dragon,2,Italian\nMickey Mouse - Brave Little Tailor,2,\n') });
  await expect(page.locator('[data-testid="imp-langs"]')).toHaveText('Idiomas no arquivo: IT 2 · 2 sem idioma');
  await expect(page.locator('[data-testid="imp-lang"] [data-ilang=""]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-testid="imp-lang"] [data-ilang="ja"]').click();
  await page.getByRole('button', { name: 'Adicionar 2 cartas à coleção' }).click();   // 1 more IT Mushu (has 1), 1 more Mickey (has 1 with no language)
  await expect.poll(() => deltas(calls)).toEqual([{ card_id: MUSHU, qty: 1, foil: false, lang: 'it' }, { card_id: MICKEY, qty: 1, foil: false, lang: 'ja' }]);
});

test('import: a plain list with language headings; a file with no languages keeps comparing totals, in the default language', async ({ page }) => {
  const { calls } = await setup(page, { collection: { [MUSHU]: { n: 1, f: 0 } }, prefs: { card_lang_prompt: 'done', card_lang: 'en' } });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Importar' }).click();
  await page.locator('#impText').fill('Japonês\n1 Mickey Mouse - Brave Little Tailor\nItaliano:\n2 Mushu - Majestic Dragon');
  await page.getByRole('button', { name: 'Ler a lista' }).click();
  await expect(page.locator('[data-testid="imp-langs"]')).toHaveText('Idiomas no arquivo: IT 2 · JA 1');
  await page.getByRole('button', { name: 'Adicionar 3 cartas à coleção' }).click();
  await expect.poll(() => deltas(calls)).toEqual([{ card_id: MICKEY, qty: 1, foil: false, lang: 'ja' }, { card_id: MUSHU, qty: 2, foil: false, lang: 'it' }]);
  await page.getByRole('button', { name: 'Importar' }).click();
  await page.locator('#impText').fill('4 Mushu - Majestic Dragon');
  await page.getByRole('button', { name: 'Ler a lista' }).click();
  await expect(page.locator('[data-testid="imp-lang"] [data-ilang="en"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Adicionar 1 cartas? à coleção$/ }).click();   // has 3 in all now: 1 more
  await expect.poll(() => deltas(calls).length).toBe(3);
  expect(deltas(calls)[2]).toEqual({ card_id: MUSHU, qty: 1, foil: false, lang: 'en' });
});

test('export: the Inkwell CSV has one line per card and language, and reads back', async ({ page }) => {
  await setup(page, { collection: { [MUSHU]: { n: 3, f: 1, l: { it: { n: 1 }, en: { n: 1, f: 1 } } } }, prefs: { card_lang_prompt: 'done' } });
  await page.goto(BASE);
  await page.locator('[data-testid="export"]').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid="export-go"]').click()]);
  const text = await (await import('node:fs')).promises.readFile(await dl.path(), 'utf8');
  const lines = text.slice(1).trim().split('\r\n').map((l) => l.split(';'));
  expect(lines[0].slice(7, 10)).toEqual(['language', 'normal', 'foil']);
  expect(lines.slice(1).map((l) => [l[0], l[7], l[8], l[9]])).toEqual([[MUSHU, 'EN', '1', '1'], [MUSHU, 'IT', '1', '0'], [MUSHU, '', '1', '0']]);
  const back = await page.evaluate((t) => { const r = window.INKWELL_COLL_IMPORT.parse(t, 'x.csv', [{ id: 'LOR7-137', name: 'Mushu - Majestic Dragon', set: 'LOR7', num: '137' }], []); return r.rows.map((x) => [x.id, x.lang, x.n, x.f]); }, text);
  expect(back).toEqual([[MUSHU, 'en', 1, 1], [MUSHU, 'it', 1, 0], [MUSHU, null, 1, 0]]);
});

const IMG = (f) => `../lorcana-card-images/images/${f}`;
test('scanner: each card in the list has its language; the one chosen stays for the next cards', async ({ page }) => {
  const { calls } = await setup(page, { prefs: { card_lang_prompt: 'done' } });
  await page.addInitScript((src) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas'); c.width = 720; c.height = 1280;
      const ctx = c.getContext('2d'), img = new Image(); img.src = src;
      setInterval(() => { ctx.fillStyle = '#4a3426'; ctx.fillRect(0, 0, c.width, c.height); const g = window.__inkwellScanGuide?.();
        if (g && img.complete && img.naturalWidth) { const w = g.w * 0.68, h = g.h * 0.68; ctx.drawImage(img, g.x + g.w * 0.02 - (w - g.w) / 2, g.y - g.h * 0.015 - (h - g.h) / 2, w, h); } }, 60);
      return c.captureStream(15);
    };
  }, IMG('Fru_Fru_-_VIP_Guest__LOR14-1.jpg'));
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Escanear' }).click();
  await expect(page.locator('[data-testid="scan-last"]')).toContainText('Fru Fru', { timeout: 15000 });
  await page.getByRole('button', { name: 'Concluir' }).click();
  const item = page.locator('[data-testid="scan-review"] [data-rev]').first();
  await expect(item.locator('[data-rlang]')).toHaveValue('en');
  await item.locator('[data-rlang]').selectOption('ja');
  await page.locator('[data-testid="scan-review"]').getByRole('button', { name: 'Adicionar 1 carta à coleção' }).click();
  await expect.poll(() => calls.filter((c) => /rpc\/(apply_collection_delta|collection_change)$/.test(c.path)).flatMap((c) => c.body.p_delta)).toEqual([{ card_id: 'LOR14-1', qty: 1, foil: false, lang: 'ja' }]);
});
