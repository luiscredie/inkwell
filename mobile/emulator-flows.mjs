// Inkwell Mobile — flows run INSIDE the installed app on the Android emulator (not a browser): Playwright connects to
// the app's WebView over adb (debug builds have WebView debugging on) and drives the real pages.
//
//   node emulator-flows.mjs <package> <evidence dir>        (CI: after the APK is installed and started)
//
// Every call to Supabase is answered here with fake data: no e-mail is sent, no account or collection is touched.
// Flows: start page; sign-in with an e-mail code; Coleção; Decks; scanner, one card (a card filmed by a fake camera)
// up to the saved list; scanner, 3×3 page (a still photo) with the check screen. Exit code 1 if any step fails.
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
await page.route(/supabase\.co\//, async (route) => {
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

await step('scanner, 3×3 page: nine pockets checked on the phone (still photo, Web Worker)', async () => {
  await fakeCamera([null]);
  await page.getByRole('button', { name: 'Escanear' }).first().click();
  await page.getByTestId('scan-mode').getByRole('button', { name: 'Página 3×3' }).click();
  const t0 = Date.now();
  await page.evaluate(async ({ IMG, files }) => {
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1440; const ctx = c.getContext('2d');
    ctx.fillStyle = '#5c4634'; ctx.fillRect(0, 0, c.width, c.height);
    const x0 = 140, y0 = 150, W = 800, H = W / 0.72; ctx.fillStyle = '#1c1d24'; ctx.fillRect(x0, y0, W, H);
    await Promise.all(files.map(async (f, i) => { if (!f) return; const im = new Image(); im.crossOrigin = 'anonymous'; im.src = `${IMG}${f}.jpg`; await im.decode();
      const cw = W / 3, ch = H / 3; ctx.drawImage(im, x0 + (i % 3) * cw + cw * 0.04, y0 + Math.floor(i / 3) * ch + ch * 0.03, cw * 0.92, ch * 0.94); }));
    window.__inkwellScanPageFrom(c, [[x0 + 8, y0 - 6], [x0 + W - 4, y0 + 5], [x0 + W + 6, y0 + H - 3], [x0 - 5, y0 + H + 4]]);
  }, { IMG, files: PAGE9 });
  await until(page, () => window.__inkwellScanPageState()?.busy === false, undefined, 120000);
  const st = await page.evaluate(() => ({ s: window.__inkwellScanPageState(), engine: window.__inkwellScanWorker(), ms: document.querySelector('[data-testid="page-ms"]')?.textContent }));
  await shot(page, '6-scanner-pagina');
  const statuses = st.s.pockets.map((p) => p.status);
  if (statuses[8] !== 'empty') throw new Error('pocket 9 should be empty: ' + statuses.join(','));
  const right = st.s.pockets.slice(0, 8).filter((p, i) => p.id === PAGE9[i].split('__')[1]).length;
  if (right < 7) throw new Error(`only ${right}/8 identified: ${JSON.stringify(st.s.pockets.map((p) => [p.status, p.id]))}`);
  if (saved().length !== 1) throw new Error('the page saved something without confirmation');
  await page.keyboard.press('Escape');
  return `${right}/8 identified, pocket 9 empty, engine=${st.engine}, ${st.ms || ''} shown on the check screen, ${Math.round((Date.now() - t0) / 1000)} s with drawing`;
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
