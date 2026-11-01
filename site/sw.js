/* The old Inkwell app (retired) had a service worker here, with scope
 * over the whole site. Browsers that still have it come back to this
 * file to check for updates: this version clears the old app's caches,
 * removes itself and reloads the open pages, so nothing stale is served.
 * Keep this file published for a few months; nothing registers it. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('inkwell-v1')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const open = await self.clients.matchAll({ type: 'window' });
    for (const c of open) c.navigate(c.url).catch(() => {});
  })());
});
