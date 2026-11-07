// Minimal service worker: installable PWA + offline shell + planner push notifications. /api is never cached.
const VERSION = 'v8'
const STATIC = `static-${VERSION}`
const PAGES = `pages-${VERSION}`
const DATA = `data-${VERSION}`

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC, PAGES, DATA].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(request, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(fallbackKey ?? request, response.clone())
    return response
  } catch (error) {
    const cached = await cache.match(fallbackKey ?? request)
    if (cached) return cached
    throw error
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    // SPA: every route is the same shell.
    event.respondWith(networkFirst(request, PAGES, '/'))
  } else if (url.pathname.startsWith('/data/')) {
    event.respondWith(networkFirst(request, DATA))
  } else if (/^\/(assets|favicons|fonts)\//.test(url.pathname) || /\.(png|jpe?g|webp|svg|woff2?|mp3)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request))
  }
})

// ───────────── Planner push notifications ─────────────

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'NeSy', body: event.data?.text() ?? '' } }
  const show = self.registration.showNotification(data.title || 'NeSy', {
    body: data.body || '',
    tag: data.tag,
    renotify: Boolean(data.tag),
    icon: '/favicons/icon-192.png',
    badge: '/favicons/icon-192.png',
    data: { url: data.url || '/', taskId: data.taskId },
    actions: data.actions || [],
  })
  const badge = typeof data.badge === 'number' && 'setAppBadge' in self.navigator
    ? (data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {})
    : Promise.resolve()
  event.waitUntil(Promise.all([show, badge]))
})

self.addEventListener('notificationclick', (event) => {
  const { url, taskId } = event.notification.data || {}
  event.notification.close()
  if (event.action === 'done' || event.action === 'snooze') {
    const path = event.action === 'done' ? '/api/planner/task/done' : '/api/planner/task/snooze'
    const body = event.action === 'done' ? { id: taskId, done: true } : { id: taskId, minutes: 60 }
    event.waitUntil(fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' }).catch(() => {}))
    return
  }
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = all.find((c) => new URL(c.url).origin === location.origin)
    if (open) { await open.focus(); return open.navigate(url || '/') }
    return self.clients.openWindow(url || '/')
  })())
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('/api/planner/push/key', { credentials: 'same-origin' })
    if (!res.ok) return
    const { publicKey } = await res.json()
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey })
    await fetch('/api/planner/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ subscription: sub.toJSON(), device: 'renewed' }) })
  })())
})
