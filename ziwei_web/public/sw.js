'use strict';
// No private page, API response, avatar, or session is ever cached offline.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// —— Web Push：通知从服务端（/push/send）推来，点开回到知微之家 ——
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || '知微';
  const body = data.body || '';
  const url = data.url || '/';
  event.waitUntil(self.registration.showNotification(title, {
    body: body,
    tag: data.tag || 'ziwei-push',
    renotify: true,
    data: { url: url },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    lang: 'zh-CN'
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if (client.url && 'focus' in client) {
        try {
          await client.focus();
          if (client.navigate) { try { await client.navigate(target); } catch (e) {} }
          return;
        } catch (e) {}
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
