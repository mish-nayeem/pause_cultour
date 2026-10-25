// Service worker for the installed admin app (PAUSE Admin), scope /admin.
// Registered by src/lib/adminApp.js. It only steps in when the network is
// gone: an admin page that can't load shows /admin-offline.html instead of
// the browser's error. Data, logins and everything else go straight to the
// network untouched — the admin is never shown stale orders from a cache.
//
// It also shows the "New order" notifications the notify edge function
// sends (supabase/functions/notify), and opens that order when one is tapped.

const CACHE = 'pause-admin-v3'
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

self.addEventListener('push', (event) => {
  let msg = {}
  try {
    msg = event.data ? event.data.json() : {}
  } catch {
    msg = { body: event.data ? event.data.text() : '' }
  }
  // An admin already open fetches the new order straight away.
  const tellOpen = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((wins) => wins.forEach((w) => w.postMessage({ type: 'refresh' })))
  event.waitUntil(Promise.all([tellOpen,
    self.registration.showNotification(msg.title || 'PAUSE Admin', {
      body: msg.body || '',
      icon: '/admin-icon-192.png',
      badge: '/admin-icon-192.png',
      tag: msg.tag,
      renotify: Boolean(msg.tag),
      data: { url: msg.url || '/admin' },
    }),
  ]))
})

// Tapped: an admin window already open goes to that order; otherwise the
// app opens on it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/admin'
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const admin = wins.find((w) => new URL(w.url).pathname.startsWith('/admin'))
    if (admin) {
      await admin.focus()
      admin.postMessage({ type: 'open', url })
      return
    }
    await self.clients.openWindow(url)
  })())
})
