/* Inkwell Lore Counter: service worker (scope: this folder).
 *
 *   the page    network first (up to 2.5 s) when online, so an update lands at once; the saved copy offline
 *   app files   cache first, refreshed in the background
 *   fonts       cache first (Google Fonts), so the look is the same offline
 *   everything else, including the Inkwell database, is never cached
 */
const VERSION = "sealed-2026-11-08";
const APP = `lorecounter-${VERSION}`;
const FONTS = "lorecounter-fonts";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "../ink/icon-192.png", "../ink/icon-512.png", "../data/meta-archetypes.json",
  ...["amber", "amethyst", "emerald", "ruby", "sapphire", "steel"].map((i) => `../ink/${i}.svg`)];   // official ink symbols, for offline use

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(APP);
    await Promise.all(FILES.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("lorecounter-") && k !== APP && k !== FONTS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith((async () => {
      const c = await caches.open(FONTS);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") c.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope);
  const isApp = url.pathname.startsWith(scope.pathname) || FILES.some((f) => new URL(f, scope).pathname === url.pathname);
  if (!isApp) return;
  e.respondWith((async () => {
    const c = await caches.open(APP);
    const key = req.mode === "navigate" ? new URL("./index.html", scope).href : req;
    const hit = await c.match(key, { ignoreSearch: true });
    const fresh = fetch(req, req.mode === "navigate" ? { cache: "no-store" } : undefined).then((res) => { if (res.ok) c.put(key, res.clone()); return res; }).catch(() => null);
    // the page itself: the newest version when there is signal (waiting at most 2.5 s), the saved copy when not,
    // so an update lands the first time the counter is opened. Other files: the saved copy, refreshed behind.
    if (req.mode === "navigate" && hit) {
      const res = await Promise.race([fresh, new Promise((r) => setTimeout(() => r(null), 2500))]);
      if (res && res.ok) return res;
      e.waitUntil(fresh); return hit;
    }
    if (hit) { e.waitUntil(fresh); return hit; }
    return (await fresh) || new Response("Offline", { status: 503 });
  })());
});
