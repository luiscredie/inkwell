/* Inkwell Lore Counter: service worker (scope: this folder).
 *
 *   app files   cache first, refreshed in the background: opens instantly with no signal,
 *               and a new version lands on the next launch
 *   fonts       cache first (Google Fonts), so the look is the same offline
 *   everything else, including the Inkwell database, is never cached
 */
const VERSION = "6c53e25015";
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
    const fresh = fetch(req).then((res) => { if (res.ok) c.put(key, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    return (await fresh) || new Response("Offline", { status: 503 });
  })());
});
