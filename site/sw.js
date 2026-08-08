/* Inkwell Brasil — service worker (M3 PWA).
 *
 * Caching follows how the data actually behaves, not one blanket rule:
 *
 *   app shell      network-first  — an update must be able to land
 *   data manifest  network-first  — it is the version pointer; a stale one pins
 *                                   everything else to an old build
 *   versioned data cache-first    — the manifest names a version, so those files
 *                                   are immutable and safe to keep forever
 *   prices         network-first  — they move daily; the app already labels
 *                                   staleness, so a cached copy is honest
 *   card art       cache-first + a hard cap, or a full collection would quietly
 *                                   eat hundreds of megabytes
 *   user data      NEVER cached   — it lives in localStorage and Supabase, and a
 *                                   cached copy could resurrect deleted records
 */
const VERSION = 'inkwell-v1';
const SHELL = VERSION + '-shell';
const DATA = VERSION + '-data';
const ART = VERSION + '-art';
const ART_MAX = 600;              // roughly a large collection, not every card ever printed

const SHELL_URLS = [
  './',
  './index.html',
  './support.js',
  './match-center-engine.js',
  './manifest.webmanifest',
  './ink/logo-coin.png',
  './ink/icon-192.png',
  './ink/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // addAll fails the whole install if any single URL 404s; tolerate absentees
    await Promise.all(SHELL_URLS.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length <= max) return;
  // oldest-first: Cache Storage preserves insertion order
  await Promise.all(keys.slice(0, keys.length - max).map(k => c.delete(k)));
}

async function networkFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, cacheName, cap) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) {
    await c.put(req, res.clone());
    if (cap) trimCache(cacheName, cap);
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase, fonts: leave alone

  const path = url.pathname;

  // user data must never be served from a cache
  if (path.includes('/users/') || path.includes('sync-config')) return;

  if (/\.(png|jpg|jpeg|webp|avif)$/i.test(path)) {
    e.respondWith(cacheFirst(req, ART, ART_MAX).catch(() => caches.match(req)));
    return;
  }
  if (path.endsWith('data-manifest.json') || path.endsWith('prices.json')) {
    e.respondWith(networkFirst(req, DATA));
    return;
  }
  if (path.endsWith('.json')) {
    e.respondWith(cacheFirst(req, DATA).catch(() => caches.match(req)));
    return;
  }
  if (req.mode === 'navigate' || path.endsWith('.html') || path.endsWith('.js')) {
    e.respondWith(networkFirst(req, SHELL).catch(() => caches.match('./index.html')));
    return;
  }
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});
