/* The simulator (retired) had a service worker here (scope /sim/).
 * This version clears its cache, removes itself and reloads the open
 * pages, which then land on the redirect in ./index.html.
 * Keep this file published for a few months; nothing registers it. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('inkwell-sim-')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const open = await self.clients.matchAll({ type: 'window' });
    for (const c of open) c.navigate(c.url).catch(() => {});
  })());
});
