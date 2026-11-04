// Decks > Visão geral do deck (stats, the grid of card art, Copiar lista, the image to share with its QR code) and the
// link the QR code opens (/perfil/?u=<handle>#deck-<id>), against a fake Supabase and the real catalog and card images.
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/overview.spec.mjs
// The PNG files go to docs/evidencias/deck-overview/ (OV_EVIDENCE=1) so a person can open them.
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = process.env.INKWELL_URL || 'http://localhost:8080/index.html';
const BASE = new URL('decks/', ROOT).href;
const ME = '11111111-1111-4111-8111-111111111111';
const JSQR = createRequire(import.meta.url).resolve('jsqr');
const EVID = new URL('../docs/evidencias/deck-overview/', import.meta.url);

// 60 cards, 20 printings: 10 characters + an Enchanted one, 3 songs, 2 actions (Epic, Enchanted), 2 items, 2 locations
const OVD = { id: 'deck-ov', name: 'Âmbar Esmeralda', format: 'core', colors: ['Amber', 'Emerald'], public: true, created_at: '2026-10-01',
  cards: { 'LOR10-1': 3, 'LOR10-10': 4, 'LOR10-11': 4, 'LOR10-12': 4, 'LOR10-13': 4, 'LOR10-14': 4, 'LOR10-15': 4, 'LOR10-16': 4, 'LOR10-17': 4, 'LOR10-18': 2,
    'LOR10-223': 1, 'LOR11-94': 4, 'LOR13-101': 2, 'LOR13-103': 2, 'LOR10-207': 2, 'LOR10-231': 2, 'LOR10-100': 2, 'LOR10-101': 2, 'LOR10-102': 3, 'LOR10-34': 3 } };
const COLLECTION = { 'LOR10-1': { n: 1, f: 0 }, 'LOR10-10': { n: 4, f: 0 }, 'LOR11-94': { n: 2, f: 1 }, 'LOR13-101': { n: 9, f: 0 } };   // 1 + 4 + 3 + 2 = 10 of the deck

async function setup(page, { deck = OVD, decks = [deck], profile = { handle: 'luis', is_public: true, adult: true, featured_deck: null },
  pub = 'listed', signedIn = true, collection = COLLECTION } = {}) {
  const calls = [];
  await page.addInitScript(([signed, me]) => {
    localStorage.setItem('inkwell-lang', 'pt');
    if (signed) {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
    }
  }, [signedIn, ME]);
  const publicProfile = () => {
    if (!profile?.is_public || pub === 'none') return null;
    const listed = decks.filter((d) => d.public === true && d.id !== profile.featured_deck).map(({ id, name, format, colors, cards }) => ({ id, name, format, colors, cards }));
    const feat = decks.find((d) => d.id === profile.featured_deck);
    return { handle: profile.handle, name: 'Luís', inks: [], showcase: [], deck: feat ? { name: feat.name, format: feat.format, colors: feat.colors, cards: pub === 'stale' ? { 'LOR10-1': 4 } : feat.cards } : null,
      public_decks: pub === 'stale' ? listed.map((x) => ({ ...x, cards: { 'LOR10-1': 4 } })) : listed, friends: [], friends_n: 0, recados: [], relation: 'self' };
  };
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request(), u = new URL(req.url()), path = u.pathname.replace(/.*\/rest\/v1\//, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path, body });
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles') return json([{ profile: 'principal', updated_at: '2026-11-01T10:00:00Z', collection, decks }]);
    if (path === 'rpc/my_profile') return json(profile);
    if (path === 'rpc/public_profile') return pub === 'offline' ? route.fulfill({ status: 503, body: '' }) : json(publicProfile());
    if (path === 'profiles') return json([{ user_id: ME, display_name: 'Luís' }]);
    if (path === 'rpc/track') return route.fulfill({ status: 204, body: '' });
    if (path === 'rpc/my_duels_sync') return json(null);
    return json([]);
  });
  return calls;
}
const open = async (page, id = 'deck-ov') => { await page.goto(BASE + '?deck=' + id); await expect(page.getByTestId('deck-overview')).toBeVisible(); };

// the PNGs as a person gets them: each "Baixar" clicked, the downloaded file read from disk (width and height from
// the file itself), then decoded again in the page and its QR code read back from the pixels by jsQR (null: none)
async function pngs(page) {
  await page.addScriptTag({ path: JSQR });
  const out = [];
  for (const a of await page.getByTestId('ov-download').all()) {
    const [dl] = await Promise.all([page.waitForEvent('download'), a.click()]);
    const b64 = readFileSync(await dl.path()).toString('base64');
    const qr = await page.evaluate(async (b) => {
      const bin = atob(b), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0);
      const px = ctx.getImageData(0, 0, cv.width, cv.height), r = window.jsQR(px.data, px.width, px.height);
      return r ? r.data : null;
    }, b64);
    out.push({ b64, qr, download: dl.suggestedFilename() });
  }
  return out;
}
function pngSize(b64) {   // the IHDR chunk of the file: what any image viewer will read
  const b = Buffer.from(b64, 'base64');
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(b.subarray(12, 16).toString()).toBe('IHDR');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}
function keep(name, b64) {
  if (!process.env.OV_EVIDENCE) return;
  mkdirSync(EVID, { recursive: true }); writeFileSync(new URL(name, EVID), Buffer.from(b64, 'base64'));
}
async function makeImage(page, fmt) {
  await page.getByTestId('ov-image-open').click();
  const sheet = page.getByTestId('ov-image');
  await expect(sheet).toBeVisible();
  if (fmt === 'h') await sheet.locator('[data-fmt="h"]').click();
  await expect(sheet.locator('#ovOut')).toHaveAttribute('data-fmt', fmt, { timeout: 20000 });
  await expect(sheet.locator('#ovOut')).not.toHaveAttribute('aria-busy', 'true', { timeout: 20000 });
  return sheet;
}

test('overview: the deck\'s numbers, no song counted twice, and the curve', async ({ page }) => {
  await setup(page);
  await open(page);
  const ov = page.getByTestId('deck-overview');
  await expect(ov.getByTestId('ov-total')).toContainText('60');
  await expect(ov.getByTestId('ov-total')).toContainText('Cartas');
  await expect(ov.getByTestId('ov-distinct')).toContainText('20');
  await expect(ov.getByTestId('ov-char')).toContainText('38');
  await expect(ov.getByTestId('ov-action')).toContainText('12');
  await expect(ov.getByTestId('ov-action')).toContainText('Ações (10 músicas)');
  await expect(ov.getByTestId('ov-item')).toContainText('4');
  await expect(ov.getByTestId('ov-location')).toContainText('6');
  await expect(ov.getByTestId('ov-noink')).toContainText('8');
  const bars = await ov.locator('[data-testid="ov-curve"] .bars b').allTextContents();
  expect(bars.length).toBe(7);
  expect(bars.map(Number).reduce((a, b) => a + b, 0)).toBe(60);
  // the same numbers in what the image is drawn from
  const data = await page.evaluate(() => window.INKWELL_DECK_IMAGE.data('deck-ov'));
  expect(data.stats).toMatchObject({ total: 60, char: 38, action: 12, song: 10, item: 4, location: 6, nonInk: 8 });
  expect(data.stats.char + data.stats.action + data.stats.item + data.stats.location).toBe(60);
  expect(data.curve).toEqual(bars.map(Number));
});

test('overview grid: real art, cost → name → printing, copies, foil only where the printing is foil-only, tap to zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });   // a phone shows a preview first (tested below)
  await setup(page);
  await open(page);
  const tiles = page.locator('[data-testid="ov-grid"] .ov-card');
  await expect(tiles).toHaveCount(20);
  const ids = await tiles.evaluateAll((els) => els.map((e) => e.dataset.card));
  const data = await page.evaluate(() => window.INKWELL_DECK_IMAGE.data('deck-ov'));
  expect(ids).toEqual(data.cards.map((c) => c.id));
  for (let i = 1; i < data.cards.length; i++) {
    const a = data.cards[i - 1], b = data.cards[i];
    expect(a.cost < b.cost || (a.cost === b.cost && a.name.localeCompare(b.name) <= 0)).toBe(true);
  }
  // every image loaded, in the shape of a card (no stretching)
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.ov-card img')].map((i) => { i.loading = 'eager'; return i.decode().catch(() => null); })));
  const shapes = await tiles.evaluateAll((els) => els.map((e) => { const i = e.querySelector('img'), r = e.getBoundingClientRect(); return { nat: i ? i.naturalWidth / i.naturalHeight : 0, box: r.width / r.height, fit: i ? getComputedStyle(i).objectFit : '' }; }));
  for (const s of shapes) { expect(s.nat).toBeGreaterThan(0.65); expect(s.nat).toBeLessThan(0.78); expect(Math.abs(s.box - 5 / 7)).toBeLessThan(0.02); expect(s.fit).toBe('cover'); }
  await expect(page.locator('.ov-card[data-card="LOR10-10"] .ov-q')).toHaveText('4×');
  await expect(page.locator('.ov-card[data-card="LOR10-223"] .ov-q')).toHaveText('1×');
  // Enchanted and Epic exist only in foil; a Rare, a Legendary or a Common is never marked (the deck does not say the finish)
  const foil = await page.locator('.ov-card:has(.ov-foil)').evaluateAll((els) => els.map((e) => e.dataset.card).sort());
  expect(foil).toEqual(['LOR10-207', 'LOR10-223', 'LOR10-231']);
  await expect(page.locator('.ov-card[data-card="LOR10-207"]')).toHaveAttribute('aria-label', /LOR10 #207 · foil/);
  await expect(page.getByTestId('ov-foil-note')).toHaveText('Foil: só nas impressões que existem apenas em foil. O deck não guarda o acabamento de cada cópia.');
  const img = await page.evaluate(() => window.INKWELL_DECK_IMAGE.data('deck-ov').cards.filter((c) => c.foil).map((c) => c.id).sort());
  expect(img).toEqual(foil);   // the image marks exactly the same cards
  await page.locator('.ov-card[data-card="LOR10-17"]').click();
  await expect(page.locator('#iwZoom')).toBeVisible();
});

test('overview: "Você possui X de Y" only for the owner, and never in what the image is drawn from', async ({ page }) => {
  await setup(page);
  await open(page);
  await expect(page.getByTestId('ov-owned')).toHaveText('Você possui 10 de 60 cartas deste deck · só você vê isto.');
  const data = await page.evaluate(() => window.INKWELL_DECK_IMAGE.data('deck-ov', { url: 'https://x/perfil/?u=luis#deck-deck-ov', handle: 'luis' }));
  expect(Object.keys(data).sort()).toEqual(['cards', 'curve', 'format', 'handle', 'inks', 'name', 'qr', 'stats']);
  expect(Object.keys(data.stats).sort()).toEqual(['action', 'avg', 'char', 'distinct', 'item', 'location', 'nonInk', 'song', 'total']);
  for (const c of data.cards) expect(Object.keys(c).sort()).toEqual(['cost', 'foil', 'id', 'img', 'ink', 'inkable', 'name', 'print', 'q']);
  expect(JSON.stringify(data)).not.toMatch(/possui|own|have|price|preço|collection|cole[cç]/i);
});

test('Copiar lista: the usual lines plus the printing, and Importar reads the printing back', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit gives tests no clipboard permission');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(ROOT).origin });
  const calls = await setup(page);
  await open(page);
  await page.getByTestId('ov-copy').click();
  await expect(page.locator('#toast')).toContainText('Lista copiada');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const lines = text.split('\n');
  expect(lines).toHaveLength(20);
  expect(lines).toContain('1 Goofy - Galumphing Gumshoe (Enchanted) (LOR10-223)');
  expect(lines).toContain('4 Strike a Good Match (LOR11-94)');
  expect(lines.reduce((t, l) => t + +l.split(' ')[0], 0)).toBe(60);
  // pasted back into this deck: the same 20 printings
  await page.route('**/rest/v1/rpc/save_deck', (r) => { const b = JSON.parse(r.request().postData()); calls.push({ path: 'rpc/save_deck', body: b }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...b.p_deck, updated_at: '2026-11-04T10:00:00Z' }) }); });
  await page.locator('#more').click();
  await page.locator('#mImport').click();
  await page.locator('#iText').fill(text);
  await expect(page.locator('#iInfo')).toContainText('60 cartas reconhecidas');
  await page.locator('#iSave').click();
  await expect.poll(() => calls.filter((c) => c.path === 'rpc/save_deck').length).toBeGreaterThan(0);
  const saved = calls.filter((c) => c.path === 'rpc/save_deck').at(-1).body.p_deck.cards;
  expect(saved).toEqual(OVD.cards);
});

test('image, vertical (Instagram): a real 1080×1350 PNG, QR code read back to the deck on the public profile', async ({ page }) => {
  await setup(page);
  await open(page);
  const sheet = await makeImage(page, 'v');
  await expect(sheet.getByTestId('ov-qr-note')).toHaveText('O QR code abre este deck no seu perfil público (@luis).');
  await expect(sheet.getByTestId('ov-png')).toHaveCount(1);
  await expect(sheet.getByTestId('ov-pages')).toHaveCount(0);
  const [p] = await pngs(page);
  expect(pngSize(p.b64)).toMatchObject({ w: 1080, h: 1350 });
  expect(p.qr).toBe(new URL('perfil/?u=luis#deck-deck-ov', ROOT).href);
  expect(p.download).toBe('inkwell-ambar-esmeralda-vertical.png');
  keep('vertical-1080x1350.png', p.b64);
  console.log('vertical: ' + (await sheet.locator('#ovOut').getAttribute('data-ms')) + ' ms');
});

test('image, horizontal (groups and Discord): a real 1920×1080 PNG with the same QR code', async ({ page }) => {
  await setup(page);
  await open(page);
  const sheet = await makeImage(page, 'h');
  const [p] = await pngs(page);
  expect(pngSize(p.b64)).toMatchObject({ w: 1920, h: 1080 });
  expect(p.qr).toBe(new URL('perfil/?u=luis#deck-deck-ov', ROOT).href);
  expect(p.download).toBe('inkwell-ambar-esmeralda-horizontal.png');
  keep('horizontal-1920x1080.png', p.b64);
  console.log('horizontal: ' + (await sheet.locator('#ovOut').getAttribute('data-ms')) + ' ms');
});

for (const pub of [false, true]) {
  test(`QR code: none for the featured deck (deck ${pub ? 'public' : 'private'}), it has no stable address`, async ({ page }) => {
    await setup(page, { deck: { ...OVD, public: pub }, profile: { handle: 'luis', is_public: true, adult: true, featured_deck: 'deck-ov' } });
    await open(page);
    const sheet = await makeImage(page, 'v');
    await expect(sheet.getByTestId('ov-qr-note')).toHaveText('Sem QR code para o deck em destaque, por enquanto: o perfil ainda não tem um endereço para ele que continue certo se o destaque mudar.');
    const [p] = await pngs(page);
    expect(pngSize(p.b64)).toMatchObject({ w: 1080, h: 1350 });
    expect(p.qr).toBeNull();
  });
}

for (const [label, opts, note] of [
  ['a private deck', { deck: { ...OVD, public: false } }, 'Sem QR code: este deck não aparece no seu perfil público.'],
  ['a private profile', { profile: { handle: 'luis', is_public: false, adult: true, featured_deck: null } }, 'Sem QR code: este deck não aparece no seu perfil público.'],
  ['no address yet', { profile: { handle: null, is_public: false, adult: true, featured_deck: null } }, 'Sem QR code: este deck não aparece no seu perfil público.'],
  ['a profile hidden from the public (18+, admin)', { pub: 'none' }, 'Sem QR code: este deck não aparece no seu perfil público.'],
  ['a profile showing an older version of the deck', { pub: 'stale' }, 'Sem QR code: este deck não aparece no seu perfil público.'],
  ['the profile cannot be checked', { pub: 'offline' }, 'Sem QR code: não deu para conferir seu perfil público agora.'],
]) {
  test(`no QR code for ${label}; the image is still made`, async ({ page }) => {
    await setup(page, opts);
    await open(page);
    const sheet = await makeImage(page, 'v');
    await expect(sheet.getByTestId('ov-qr-note')).toContainText(note);
    const [p] = await pngs(page);
    expect(pngSize(p.b64)).toMatchObject({ w: 1080, h: 1350 });
    expect(p.qr).toBeNull();
  });
}

test('a deck with many different cards: more images, each one full size, every card once', async ({ page }) => {
  const ids = await (async () => { const cat = JSON.parse(readFileSync(new URL('../site/data/cards.json', import.meta.url), 'utf8')).cards;
    return cat.filter((c) => c.image_file && c.ink_color === 'Amber' && c.card_type === 'Character' && /^LOR1[0-4]$/.test(c.set_code)).slice(0, 60).map((c) => c.card_id); })();
  const big = { id: 'deck-big', name: 'Sessenta diferentes', format: 'infinity', colors: ['Amber'], public: true, cards: Object.fromEntries(ids.map((id) => [id, 1])) };
  await setup(page, { deck: big });
  await open(page, 'deck-big');
  for (const fmt of ['v', 'h']) {
    const sheet = await makeImage(page, fmt);
    const n = +(await sheet.locator('#ovOut').getAttribute('data-pages'));
    expect(n).toBeGreaterThan(1);
    // every card on exactly one image, in order, the images as even as possible
    const split = (await sheet.locator('#ovOut').getAttribute('data-split')).split(',').map(Number);
    expect(split).toHaveLength(n);
    expect(split.reduce((a, b) => a + b, 0)).toBe(60);
    expect(Math.max(...split) - Math.min(...split)).toBeLessThanOrEqual(1);
    console.log(`${fmt}: ${n} images (${split.join(' + ')}), ${await sheet.locator('#ovOut').getAttribute('data-ms')} ms`);
    await expect(sheet.getByTestId('ov-pages')).toContainText(`${n} imagens`);
    const ps = await pngs(page);
    expect(ps).toHaveLength(n);
    for (const [i, p] of ps.entries()) {
      expect(pngSize(p.b64)).toMatchObject(fmt === 'h' ? { w: 1920, h: 1080 } : { w: 1080, h: 1350 });
      expect(p.download).toBe(`inkwell-sessenta-diferentes-${fmt === 'h' ? 'horizontal' : 'vertical'}-${i + 1}.png`);
      expect(p.qr).toBe(new URL('perfil/?u=luis#deck-deck-big', ROOT).href);
      keep(`muitas-cartas-${fmt}-${i + 1}.png`, p.b64);
    }
    await page.locator('#sheet [data-close]').click();
  }
});

test('a card whose art does not load: the image still comes out, with that card drawn by name', async ({ page }) => {
  await setup(page);
  await page.route('**/lorcana-card-images/**LOR10-17*', (r) => r.abort());
  await open(page);
  await makeImage(page, 'v');
  const [p] = await pngs(page);
  expect(pngSize(p.b64)).toMatchObject({ w: 1080, h: 1350 });
  keep('arte-faltando-vertical.png', p.b64);
});

for (const width of [320, 360, 390, 430]) {
  test(`phone ${width}px: compact preview, "Ver deck completo", nothing wider than the screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await setup(page);
    await open(page);
    const ov = page.getByTestId('deck-overview');
    await expect(ov.locator('.ov-card')).toHaveCount(12);
    // only the preview's images load (lazy), not the whole deck's
    const asked = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/lorcana-card-images/')).length);
    expect(asked).toBeLessThanOrEqual(12 + 20);   // the List tab shows its own small thumbnails
    const over = await page.evaluate(() => { const vw = document.documentElement.clientWidth, out = [];
      for (const el of document.querySelectorAll('[data-testid="deck-overview"], [data-testid="deck-overview"] *')) { const r = el.getBoundingClientRect(); if (r.width && (r.right > vw + 0.5 || r.left < -0.5)) out.push(el.className || el.tagName); }
      return out; });
    expect(over).toEqual([]);
    // the head of the section stays short: the numbers in a few lines, then the curve
    const head = await ov.locator('.ov-stats').boundingBox();
    expect(head.height).toBeLessThanOrEqual(width <= 360 ? 100 : 76);
    // the bars of the app as they really are: the top one stuck at the top, the tab bar at the bottom, and the
    // last buttons of the section reachable above the tab bar
    const bars = await page.evaluate(() => ({ app: getComputedStyle(document.querySelector('.appbar')).position, tab: getComputedStyle(document.querySelector('.tabbar')).position }));
    expect(bars).toEqual({ app: 'sticky', tab: 'fixed' });
    await page.evaluate(() => Promise.all([...document.querySelectorAll('.ov-card img')].map((i) => { i.loading = 'eager'; return i.decode().catch(() => null); })));
    await ov.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 64));
    if (process.env.OV_EVIDENCE) { mkdirSync(EVID, { recursive: true }); await page.screenshot({ path: new URL(`celular-${width}-tela-inicio.png`, EVID).pathname }); }
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    const last = await page.getByTestId('ov-image-open').boundingBox(), tab = await page.locator('.tabbar').boundingBox();
    expect(last.y + last.height).toBeLessThanOrEqual(tab.y);
    await page.getByTestId('ov-all').scrollIntoViewIfNeeded();
    if (process.env.OV_EVIDENCE) await page.screenshot({ path: new URL(`celular-${width}-tela-fim.png`, EVID).pathname });
    await ov.getByTestId('ov-all').click();
    await expect(ov.locator('.ov-card')).toHaveCount(20);
    await expect(ov.getByTestId('ov-all')).toHaveCount(0);
    const sheet = await makeImage(page, 'v');
    const sw = await sheet.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, wide: [...el.querySelectorAll('*')].filter((x) => x.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).map((x) => x.tagName + '.' + x.className + ':' + Math.round(x.getBoundingClientRect().width)).slice(0, 6) }));
    expect(sw.wide).toEqual([]);
    expect(sw.sw).toBeLessThanOrEqual(sw.cw + 1);
    if (width === 390) await page.screenshot({ path: process.env.OV_EVIDENCE ? new URL('celular-390-folha.png', EVID).pathname : test.info().outputPath('s.png') });
  });
}

test('computer: the whole grid at once, no "Ver deck completo"', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page);
  await open(page);
  const ov = page.getByTestId('deck-overview');
  await expect(ov.locator('.ov-card')).toHaveCount(20);
  await expect(ov.getByTestId('ov-all')).toHaveCount(0);
  if (process.env.OV_EVIDENCE) { mkdirSync(EVID, { recursive: true }); await page.evaluate(() => Promise.all([...document.querySelectorAll('.ov-card img')].map((i) => { i.loading = 'eager'; return i.decode().catch(() => null); }))); await ov.screenshot({ path: new URL('computador-1280.png', EVID).pathname }); }
});

test('time and memory to make the image (lab numbers, Chromium on a computer: not a phone)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'memory figures come from Chromium only');
  await setup(page);
  await open(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); const m = (await cdp.send('Performance.getMetrics')).metrics; return Math.round(m.find((x) => x.name === 'JSHeapUsedSize').value / 1048576); };
  const before = await heap(), times = [];
  for (const fmt of ['v', 'h', 'v', 'h']) {
    const t = await page.evaluate(async (f) => { const d = window.INKWELL_DECK_IMAGE.data('deck-ov', { url: location.origin + '/perfil/?u=luis#deck-deck-ov', handle: 'luis' }); const r = await window.INKWELL_DECK_IMAGE.draw(d, f); return { ms: r.ms, kb: Math.round(r.blobs.reduce((a, b) => a + b.size, 0) / 1024) }; }, fmt);
    times.push(`${fmt} ${t.ms} ms ${t.kb} KB`);
  }
  const after = await heap();
  console.log(`generation: ${times.join(' · ')} · JS heap ${before} MB → ${after} MB after 4 images`);
  expect(after - before).toBeLessThan(40);   // nothing kept: images and canvases are let go
});

test('the overview can be hidden, and stays hidden on the next visit', async ({ page }) => {
  await setup(page);
  await open(page);
  await page.locator('#ovToggle').click();
  await expect(page.locator('#ovBody')).toBeHidden();
  await expect(page.locator('#ovToggle')).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.locator('#ovBody')).toBeHidden();
  await page.locator('#ovToggle').click();
  await expect(page.getByTestId('ov-grid')).toBeVisible();
});
