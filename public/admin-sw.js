// Service worker for the installed admin app (PAUSE Admin), scope /admin.
// Registered by src/lib/adminApp.js. It only steps in when the network is
// gone: an admin page that can't load shows /admin-offline.html instead of
// the browser's error. Data, logins and everything else go straight to the
// network untouched — the admin is never shown stale orders from a cache.

const CACHE = 'pause-admin-v1'
const OFFLINE = '/admin-offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/admin-icon-192.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pause-admin-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)))
})
