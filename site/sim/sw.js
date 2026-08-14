// Service worker do simulador. Escopo: /sim/ apenas.
//
// Duas mudancas em relacao ao original, ambas por causa de acidente ja visto:
//   1. add() por item em vez de addAll(): com addAll, UM 404 falha a instalacao
//      inteira do service worker e o offline simplesmente nao existe, em silencio.
//   2. game.js e trace.js sao network-first. Sao bundles: cache-first serve a
//      versao velha para sempre se alguem esquecer de trocar CACHE apos um build.
//      O resto do shell (html, manifest) continua cache-first.
const CACHE = "inkwell-sim-v8";
const SHELL = [
  "./", "./index.html", "./trace.html", "./game.html", "./manifest.webmanifest",
];
const BUNDLES = ["game.js", "trace.js"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    await Promise.all(BUNDLES.map((u) => c.add("./" + u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // O catalogo e as imagens vivem fora de /sim/ e sao servidos pelo service
  // worker da raiz. Nao interceptar aqui evita duas politicas para o mesmo arquivo.
  if (!url.pathname.includes("/sim/")) return;

  const bundle = BUNDLES.some((b) => url.pathname.endsWith("/" + b));
  if (bundle) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await caches.match(req);
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
