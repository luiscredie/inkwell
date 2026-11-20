// The site and a fake Supabase on ONE local server, for the browser tests that also run in WebKit (#286).
//
// Why: with Playwright's request interception on (page.route), WebKit fails about 2% of navigations with
// "WebKit encountered an internal error" (measured 19/11: 7 of 300 navigations with a route, 0 of 300 without).
// So, locally and in CI, these tests don't intercept: each test worker serves site/ and answers the Supabase paths
// itself, on the same origin, so the pages' own Content-Security-Policy (connect-src 'self' …) stays in force.
// Against a deployed site (INKWELL_URL not local) there is nothing to serve: page.route is used, as before
// (those runs are Chromium only).
//
// Usage — the handlers are the ones page.route used, unchanged:
//   import { ROOT, fakeSupabase } from './fake-supabase.mjs';
//   const supa = await fakeSupabase(page);
//   await supa.route('**/rest/v1/**', async (route) => { const req = route.request(); ... return route.fulfill({...}); });
// route.request(): url(), method(), postData(), headers(). route.fulfill({ status, body, contentType, headers }).
// route.abort(): the connection is dropped; the page sees a network error (like "internetdisconnected").
// A later route wins over an earlier one, as with page.route. A Supabase path nobody handles answers 404.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV = process.env.INKWELL_URL || '';
export const LOCAL = !ENV || /^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(ENV);
// one port per test worker (Playwright sets TEST_WORKER_INDEX), so parallel workers never share a server
const PORT = 8100 + Number(process.env.TEST_WORKER_INDEX || 0);
export const ROOT = LOCAL ? `http://127.0.0.1:${PORT}/index.html` : ENV;

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const API = /^\/(rest|auth|functions|storage)\/v1\//;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain', '.wasm': 'application/wasm' };
const globRe = (glob) => new RegExp('^' + glob.split(/(\*\*|\*)/).map((p) => (p === '**' ? '.*' : p === '*' ? '[^/]*' : p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('') + '$');

let routes = [];   // the current test's handlers (tests in one worker run one after another)
let server = null;

function serveFile(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(SITE, p);
  if (!file.startsWith(SITE)) { res.writeHead(403); res.end(); return; }
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { /* not found below */ }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('File not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

async function handle(req, res) {
  const url = `http://${req.headers.host}${req.url}`;
  if (!API.test(new URL(url).pathname)) { serveFile(req, res); return; }
  let body = '';
  for await (const chunk of req) body += chunk;
  const request = { url: () => url, method: () => req.method, postData: () => body || null, headers: () => req.headers };
  let answered = false;
  const route = {
    request: () => request,
    fulfill: async ({ status = 200, body: out = '', contentType, headers = {} } = {}) => {
      answered = true;
      res.writeHead(status, { ...(contentType ? { 'Content-Type': contentType } : {}), ...headers });
      res.end(out);
    },
    abort: async () => { answered = true; req.socket.destroy(); },
  };
  const hit = routes.find(([re]) => re.test(url));
  try { if (hit) await hit[1](route); } catch (e) { if (!answered) { answered = true; res.writeHead(500); res.end(String(e)); } }
  if (!answered) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}'); }
}

async function start() {
  if (server) return;
  server = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.destroy(); } catch { /* */ } }); });
  server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
  server.unref();   // never keeps the worker alive
}

export async function fakeSupabase(page) {
  if (!LOCAL) {   // a deployed site: intercept, as the tests always did there
    const supa = { root: ROOT, route: (glob, handler) => page.route(glob, handler) };
    page.__supa = supa;
    return supa;
  }
  await start();
  routes = [];
  const origin = new URL(ROOT).origin;
  // every page sets window.INKWELL_CLOUD_CONFIG in an inline script; keep its key and redirect, use this origin
  await page.addInitScript((u) => {
    let v;
    Object.defineProperty(window, 'INKWELL_CLOUD_CONFIG', { configurable: true, get: () => v, set: (x) => { v = { ...x, url: u }; } });
  }, origin);
  const supa = { root: ROOT, route: async (glob, handler) => { routes.unshift([globRe(glob), handler]); } };
  page.__supa = supa;
  return supa;
}
// the fake of a page already set up (for a test that adds a route after setup)
export const supaOf = (page) => page.__supa;
