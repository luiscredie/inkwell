/* Inkwell — push notices only (supabase/push.sql, supabase/functions/push-send).
 * Scoped to /push/ on purpose: it never handles page requests, so it can't
 * clash with the caching worker at the site root or the Contador's own. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  const url = d.url || new URL('../feed/', self.registration.scope).href;
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'Inkwell', {
      body: d.body || '', tag: d.tag, data: { url },
      icon: new URL('../ink/icon-192.png', self.registration.scope).href,
      badge: new URL('../ink/icon-192.png', self.registration.scope).href,
    }),
    d.badge && self.navigator && 'setAppBadge' in self.navigator ? self.navigator.setAppBadge(d.badge).catch(() => {}) : null,
  ]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || new URL('../feed/', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = all.find((c) => c.url === url) || all.find((c) => new URL(c.url).origin === self.location.origin);
    if (same) { await same.focus(); if (same.url !== url && 'navigate' in same) await same.navigate(url).catch(() => {}); return; }
    await self.clients.openWindow(url);
  })());
});
