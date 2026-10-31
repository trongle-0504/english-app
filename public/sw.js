// Minimal service worker: installable PWA + offline shell. /api is never cached.
const VERSION = 'v2'
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
