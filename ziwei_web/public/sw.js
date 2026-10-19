'use strict';
// No private page, API response, avatar, or session is ever cached offline.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
