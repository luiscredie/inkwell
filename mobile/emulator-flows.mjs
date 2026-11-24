// Inkwell Mobile — flows run INSIDE the installed app on the Android emulator (not a browser): Playwright connects to
// the app's WebView over adb (debug builds have WebView debugging on) and drives the real pages.
//
//   node emulator-flows.mjs <package> <evidence dir>        (CI: after the APK is installed and started)
//
// Every call to Supabase is answered here with fake data: no e-mail is sent, no account or collection is touched.
// Flows: start page; sign-in with an e-mail code; Coleção; Decks; scanner, one card (a card filmed by a fake camera)
// up to the saved list; scanner, 3×3 page (a still photo) corrected on the photo up to the review; Início in airplane
// mode and back online. Exit code 1 if any step fails.
import { _android as android } from 'playwright';
import fs from 'node:fs';

const PKG = process.argv[2] || 'br.com.inkwell.app';
const OUT = process.argv[3] || 'evidence';
fs.mkdirSync(OUT, { recursive: true });
const ME = '11111111-1111-4111-8111-111111111111';
const IMG = 'https://inkwell.com.br/lorcana-card-images/images/';
const CARD = 'Rapunzel_-_Tower_Defender__LOR13-80.jpg';
const PAGE9 = ['Rapunzel_-_Tower_Defender__LOR13-80', '4_Town_-_Hottest_Band_of_the_Year__LOR13-17', 'Owl_-_Hunny_Ranger__LOR13-185', 'Piglet_-_Hunny_Mage_Apprentice__LOR13-154',
  'Rabbit_-_Hunny_Paladin__LOR13-5', 'Roo_-_Hunny_Rogue__LOR13-83', 'Tigger_-_Hunny_Barbarian__LOR13-126', 'Winnie_the_Pooh_-_Hunny_Archmage__LOR13-40', null];

const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ step: name, ok: true, s: +((Date.now() - t0) / 1000).toFixed(1), note: note || '' }); console.log(`PASS ${name}${note ? ' — ' + note : ''}`); }
  catch (e) { results.push({ step: name, ok: false, s: +((Date.now() - t0) / 1000).toFixed(1), note: String(e.message || e).split('\n')[0] }); console.log(`FAIL ${name} — ${String(e.message || e).split('\n')[0]}`); }
};
// poll a condition in the page; a reload in between (sign-in does one) is not an error
const until = async (page, fn, arg, ms = 30000) => {
  const end = Date.now() + ms; let last = null;
  while (Date.now() < end) { try { if (await page.evaluate(fn, arg)) return; } catch (e) { last = e; } await new Promise((r) => setTimeout(r, 300)); }
  throw new Error('timed out' + (last ? ': ' + String(last.message).split('\n')[0] : ''));
};
const shot = (page, n) => page.screenshot({ path: `${OUT}/flow-${n}.png` }).catch(() => {});

// FLOWS_URL=http://localhost:8091/ runs the same steps in a desktop Chromium against the release bundle served by
// capserve.mjs (quick check of the script itself; the real run is the emulator).
let device = null, page, browser = null;
if (process.env.FLOWS_URL) {
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await page.goto(new URL('index.html', process.env.FLOWS_URL).href);
} else {
  [device] = await android.devices();
  if (!device) { console.log('FAIL no device'); process.exit(1); }
  console.log('device', device.model(), device.serial());
  const webview = await device.webView({ pkg: PKG }, { timeout: 60000 });
  page = await webview.page();
}
console.log('page at', page.url());

// fake Supabase for the whole run (nothing reaches production)
const calls = [];
const jwt = () => { const exp = Math.floor(Date.now() / 1000) + 3600; return 'x.' + Buffer.from(JSON.stringify({ sub: ME, exp, email: 'teste@example.com' })).toString('base64url') + '.y'; };
let offline = false;   // the Início airplane-mode step: no answer, as without network
await page.route(/supabase\.co\//, async (route) => {
  if (offline) return route.abort('internetdisconnected');
  const u = new URL(route.request().url()), path = u.pathname;
  calls.push({ method: route.request().method(), path, body: route.request().postData() || '' });
  const json = (v, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
  if (path.endsWith('/auth/v1/otp')) return json({});
  if (path.endsWith('/auth/v1/verify')) return json({ access_token: jwt(), refresh_token: 'r', expires_in: 3600, user: { id: ME, email: 'teste@example.com' } });
  if (path.includes('/auth/v1/')) return json({});
  if (path.endsWith('/rest/v1/inkwell_profiles')) return json([{ profile: 'teste', updated_at: '2026-11-20T10:00:00Z', collection: { 'LOR10-10': { n: 1, f: 0 } } }]);
  if (path.includes('/rest/v1/rpc/')) return route.fulfill({ status: 204, body: '' });
  if (path.includes('/functions/v1/')) return json({});
  return json([]);
});
const saved = () => calls.filter((c) => c.path.endsWith('/rpc/apply_collection_delta')).flatMap((c) => { try { return JSON.parse(c.body).p_delta || []; } catch { return []; } });

await step('app opens on the start page', async () => {
  await page.waitForLoadState('domcontentloaded');
  await until(page, () => /Seu lugar no mundo de Lorcana/.test(document.body.innerText));
  await shot(page, '1-inicio');
  return page.url().replace(/^https?:\/\/[^/]+/, '');
});

await step('sign in with an e-mail code (fake Supabase)', async () => {
  await page.evaluate(() => { localStorage.setItem('inkwell-passkey-offer', 'no'); window.INKWELL_SIGNIN(); });
  await page.locator('#iwSiEmail').fill('teste@example.com');
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await page.getByLabel('Código do e-mail').fill('12345678');
  await until(page, () => { try { return !!JSON.parse(localStorage.getItem('inkwell-counter-auth') || 'null')?.access_token; } catch { return false; } });
  await page.waitForLoadState('domcontentloaded');
  await shot(page, '2-login');
  if (!calls.some((c) => c.path.endsWith('/auth/v1/otp'))) throw new Error('no code request seen');
  return 'code requested and verified, session stored';
});

await step('Coleção opens from the tab bar', async () => {
  await page.locator('nav a[href*="colecao"]').last().click();
  await until(page, () => /\/colecao\//.test(location.pathname) && !!document.querySelector('h1, #title') && /Coleção/.test(document.body.innerText));
  await until(page, () => !!document.querySelector('button') && [...document.querySelectorAll('button')].some((b) => /Escanear/.test(b.textContent)));
  await shot(page, '3-colecao');
  return new URL(page.url()).pathname;
});

await step('Decks opens from the tab bar', async () => {
  await page.locator('nav a[href*="decks"]').last().click();
  await until(page, () => /\/decks\//.test(location.pathname) && /Decks/.test(document.body.innerText));
  await shot(page, '4-decks');
});

const fakeCamera = async (draw) => page.evaluate(({ IMG, draw }) => {
  navigator.mediaDevices.getUserMedia = async () => {
    const c = document.createElement('canvas'); c.width = 720; c.height = 1280; const ctx = c.getContext('2d');
    const imgs = draw.map((f) => { if (!f) return null; const i = new Image(); i.crossOrigin = 'anonymous'; i.src = IMG + f; return i; });
    setInterval(() => {
      ctx.fillStyle = '#5a4535'; ctx.fillRect(0, 0, c.width, c.height);
      const g = window.__inkwellScanGuide?.(); if (!g) return;
      const im = imgs[0]; if (!im || !im.complete || !im.naturalWidth) return;
      const w = g.w * 0.93, h = w * 88 / 63; ctx.drawImage(im, g.x + (g.w - w) / 2, g.y + (g.h - h) / 2, w, h);
    }, 80);
    return c.captureStream(12);
  };
}, { IMG, draw });

await step('scanner, one card: read, listed, reviewed and saved (fake camera, fake Supabase)', async () => {
  await page.locator('nav a[href*="colecao"]').last().click();
  await until(page, () => /\/colecao\//.test(location.pathname));
  await fakeCamera([CARD]);
  await page.getByRole('button', { name: 'Escanear' }).first().click();
  await until(page, () => /1 na lista/.test(document.querySelector('[data-testid="scan-count"]')?.textContent || ''), undefined, 90000);
  await shot(page, '5-scanner-continuo');
  if (saved().length) throw new Error('something was saved before the confirmation');
  await page.getByRole('button', { name: 'Concluir' }).click();
  await page.getByTestId('scan-review').getByRole('button', { name: /Adicionar 1 carta/ }).click();
  await until(page, () => !document.getElementById('scan')?.open, undefined, 15000);
  for (let i = 0; i < 40 && !saved().length; i++) await new Promise((r) => setTimeout(r, 250));
  const d = saved(); if (!(d.length === 1 && d[0].card_id === 'LOR13-80' && d[0].qty === 1)) throw new Error('saved ' + JSON.stringify(d));
  return 'LOR13-80 ×1 saved only after confirming';
});

// A page like the one that blocked the real-phone round (24/11): reprints and two cards upside down, so several pockets
// need the person. Tapped on the photo, settled one after another, through to the final review; saved only then.
const HARD = ['Rapunzel_-_Tower_Defender__LOR13-80', '4_Town_-_Hottest_Band_of_the_Year__LOR13-17', 'Owl_-_Hunny_Ranger__LOR13-185', 'Piglet_-_Hunny_Mage_Apprentice__LOR13-154',
  'Rabbit_-_Hunny_Paladin__LOR13-5', 'Elsa_-_Concerned_Sister__LOR11-125', 'Junior_Woodchuck_Guidebook__LOR10-66|flip', 'Winnie_the_Pooh_-_Hunny_Archmage__LOR13-40', 'Winnie_the_Pooh_&_Piglet_-_Hunny_Mages__LOR13-62|flip'];
const WORDS = { 'LOR10-66': 'woodchuck guidebook', 'LOR13-62': 'hunny mages', 'LOR11-125': 'elsa concerned', 'LOR13-40': 'hunny archmage', 'LOR13-80': 'tower defender', 'LOR13-17': 'hottest band', 'LOR13-185': 'hunny ranger', 'LOR13-154': 'mage apprentice', 'LOR13-5': 'hunny paladin' };
const TRUTH = HARD.map((f) => f.split('|')[0].split('__')[1]);
let timing = null;
await step('scanner, 3×3 page: pockets to settle, tapped on the photo, through to the review (Web Workers)', async () => {
  await fakeCamera([null]);
  await page.getByRole('button', { name: 'Escanear' }).first().click();
  await page.getByTestId('scan-mode').getByRole('button', { name: 'Página 3×3' }).click();
  await new Promise((r) => setTimeout(r, 1500));   // a person framing the page: the Workers warm up meanwhile
  await page.evaluate(async ({ IMG, files }) => {
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1440; const ctx = c.getContext('2d');
    ctx.fillStyle = '#5c4634'; ctx.fillRect(0, 0, c.width, c.height);
    const x0 = 140, y0 = 150, W = 800, H = W / 0.72; ctx.fillStyle = '#1c1d24'; ctx.fillRect(x0, y0, W, H);
    await Promise.all(files.map(async (f, i) => { const [n, fx] = f.split('|'); const im = new Image(); im.crossOrigin = 'anonymous'; im.src = `${IMG}${n}.jpg`; await im.decode();
      const cw = W / 3, ch = H / 3, x = x0 + (i % 3) * cw + cw * 0.04, y = y0 + Math.floor(i / 3) * ch + ch * 0.03;
      if (fx === 'flip') { ctx.save(); ctx.translate(x + cw * 0.46, y + ch * 0.47); ctx.rotate(Math.PI); ctx.drawImage(im, -cw * 0.46, -ch * 0.47, cw * 0.92, ch * 0.94); ctx.restore(); }
      else ctx.drawImage(im, x, y, cw * 0.92, ch * 0.94); }));
    window.__inkwellScanPageFrom(c, [[x0 + 8, y0 - 6], [x0 + W - 4, y0 + 5], [x0 + W + 6, y0 + H - 3], [x0 - 5, y0 + H + 4]]);
  }, { IMG, files: HARD });
  await until(page, () => window.__inkwellScanPageState()?.busy === false, undefined, 120000);
  const st = await page.evaluate(() => window.__inkwellScanPageState());
  const wrong = st.pockets.filter((p, i) => p.status === 'ok' && p.id !== TRUTH[i]);
  if (wrong.length) throw new Error('confident and wrong: ' + JSON.stringify(wrong.map((p) => [p.i, p.id])));
  await shot(page, '6a-pagina-pendencias');
  const rev = page.getByTestId('page-review');
  // a finger that lands on the photo scrolls the screen (real touch on the emulator)
  let scrolled = 'browser mode: not measured';
  if (device) {
    const r = await page.evaluate(() => { const b = document.querySelector('#pgPhoto').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 0.55, dpr: devicePixelRatio, vh: innerHeight, sh: screen.height }; });
    const off = Math.max(0, r.sh - r.vh) * r.dpr * 0.5;   // status bar above the WebView (approximate; the photo is large)
    const X = Math.round(r.x * r.dpr), Y = Math.round(r.y * r.dpr + off);
    await device.shell(`input swipe ${X} ${Y} ${X} ${Math.max(10, Y - Math.round(260 * r.dpr))} 350`);
    await new Promise((res) => setTimeout(res, 800));
    const top = await page.evaluate(() => document.querySelector('#pageReview .items').scrollTop);
    if (!(top > 40)) throw new Error(`a swipe starting on the photo did not scroll (scrollTop ${top})`);
    if (await rev.getByTestId('pocket-edit').count()) throw new Error('the swipe opened a pocket');
    scrolled = `swipe on the photo scrolled ${Math.round(top)} px`;
  }
  // "Resolver N posições" or a tap on a pending card on the photo
  const pend = st.pockets.map((p, i) => (['check', 'choose', 'unknown'].includes(p.status) ? i : -1)).filter((i) => i >= 0);
  const pendNow = async () => (await page.evaluate(() => window.__inkwellScanPageState().pockets.map((p, i) => (['check', 'choose', 'unknown'].includes(p.status) && !p.resolved && !p.skip ? i : -1)).filter((i) => i >= 0)));
  let fixed = 0;
  if ((await pendNow()).length) {
    const first = (await pendNow())[0];
    const pk = rev.locator(`#pgPhoto [data-pk="${first}"] polygon`); await pk.scrollIntoViewIfNeeded();
    await pk.click();
    const ed = rev.getByTestId('pocket-edit');
    await ed.waitFor({ timeout: 10000 });
    await shot(page, '6b-posicao');
    for (let guard = 0; guard < 12 && await ed.count(); guard++) {
      const i = +(await ed.getAttribute('data-edit-pocket')), cur = (await page.evaluate((k) => window.__inkwellScanPageState().pockets[k], i));
      if (cur.id === TRUTH[i] && await ed.getByTestId('pocket-confirm').count()) await ed.getByTestId('pocket-confirm').click();
      else if (await ed.locator(`.pgs-alts [data-use="${TRUTH[i]}"]`).count()) await ed.locator(`.pgs-alts [data-use="${TRUTH[i]}"]`).first().click();
      else { await ed.getByTestId('pocket-find').click(); await ed.getByTestId('pocket-search').fill(WORDS[TRUTH[i]]); await ed.locator(`#pgFound [data-use="${TRUTH[i]}"]`).click(); }
      fixed++;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if ((await pendNow()).length) throw new Error('still pending: ' + (await pendNow()).join(','));
  await until(page, () => /Continuar para revisão \(9 cartas\)/.test(document.querySelector('[data-testid="page-add"]')?.textContent || ''), undefined, 15000);
  await shot(page, '6c-pagina-resolvida');
  if (saved().length !== 1) throw new Error('the page saved something before the review');
  await rev.getByTestId('page-add').click();
  await page.getByTestId('scan-review').waitFor({ timeout: 10000 });
  await shot(page, '6d-revisao');
  if (saved().length !== 1) throw new Error('saved before confirming the review');
  await page.getByTestId('scan-review').getByRole('button', { name: /Adicionar 9 cartas/ }).click();
  for (let i = 0; i < 60 && saved().length < 2; i++) await new Promise((r) => setTimeout(r, 250));
  const got = {}; for (const d of saved().slice(1)) got[d.card_id] = (got[d.card_id] || 0) + d.qty;
  if (JSON.stringify(Object.keys(got).sort()) !== JSON.stringify([...TRUTH].sort()) || Object.values(got).some((q) => q !== 1)) throw new Error('saved ' + JSON.stringify(got));
  // the reading of collector numbers (real OCR from the CDN here) may still be running: wait for its time, no longer than 60 s
  for (let i = 0; i < 120; i++) { timing = await page.evaluate(() => window.__inkwellScanPageTiming?.()).catch(() => null); if (timing?.ocr != null) break; await new Promise((r) => setTimeout(r, 500)); }
  fs.writeFileSync(`${OUT}/pagescan-timing.json`, JSON.stringify(timing, null, 1));
  console.log('TIMING ' + JSON.stringify(timing));
  return `${pend.length} pending at first (${st.pockets.map((p) => p.status).join(',')}), ${fixed} settled in the editor, 9 saved only after the review; ${scrolled}; ready ${timing?.ready} ms (engine ${timing?.engine} ms with ${timing?.workers} Worker(s)), OCR ${timing?.ocr ?? '?'} ms for ${timing?.ocrN ?? '?'} reprint(s)`;
});

// Airplane mode for real: Início says there is no internet; with the connection back it loads by itself, no tap.
await step('Início in airplane mode, then back online (loads by itself)', async () => {
  if (!device) return 'browser mode: skipped';
  offline = true;
  await device.shell('cmd connectivity airplane-mode enable');
  await new Promise((r) => setTimeout(r, 3000));
  await page.locator('nav a[href*="feed"]').last().click().catch(() => page.evaluate(() => { location.href = '../feed/index.html'; }));
  await until(page, () => /\/feed\//.test(location.pathname) && !!document.querySelector('[data-testid="keep-error"], [data-testid="home-error"]'), undefined, 40000);
  const why = await page.evaluate(() => ({ online: navigator.onLine, fail: window.__inkwellHomeFail?.() }));
  await shot(page, '7a-inicio-modo-aviao');
  offline = false;
  await device.shell('cmd connectivity airplane-mode disable');
  await until(page, () => !document.querySelector('[data-testid="keep-error"], [data-testid="home-error"]') && Object.keys(window.__inkwellHomeFail?.() || {}).length === 0, undefined, 60000);
  await shot(page, '7b-inicio-de-volta');
  return `offline: navigator.onLine=${why.online}, ${JSON.stringify(why.fail)}; back online: loaded by itself`;
});

await step('Android back button (recorded, not judged)', async () => {
  if (!device) return 'browser mode: skipped';
  const before = new URL(page.url()).pathname;
  await device.shell('input keyevent 4');
  await new Promise((r) => setTimeout(r, 2500));
  const top = String(await device.shell('dumpsys activity activities | grep topResumedActivity')).trim();
  let after = '(page gone)'; try { after = new URL(page.url()).pathname; } catch { /* */ }
  const inApp = top.includes(PKG);
  if (!inApp) { await device.shell(`am start -n ${PKG}/br.com.inkwell.app.MainActivity`); await new Promise((r) => setTimeout(r, 4000)); }
  return `from ${before}: ${inApp ? 'stayed in the app at ' + after : 'the app went to the background'}`;
});

const real = calls.length;   // every one of them was answered here
fs.writeFileSync(`${OUT}/flows.json`, JSON.stringify({ pkg: PKG, results, supabase_calls_answered_by_the_test: real }, null, 1));
console.log(`SUMMARY ${results.filter((r) => r.ok).length}/${results.length} flows passed; ${real} Supabase calls answered by the test (none reached production)`);
if (device) await device.close(); if (browser) await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
