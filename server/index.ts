// Production server: serves dist/, live /data from content/, and /api. Run with `npm start`.
import { createReadStream, existsSync, statSync, watch } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { createGzip } from 'node:zlib'
import { createContentStore } from '../content-pipeline/store.ts'
import { createApiMiddleware } from './api.ts'
import { authenticate, gate } from './auth/middleware.ts'
import { stopCoach } from './coach/service.ts'
import { loadEnv } from './env.ts'
import { startNewsScheduler } from './news/service.ts'
import { startPlannerScheduler } from './planner/scheduler.ts'
import { startDrillsScheduler } from './admin/drills-nightly.ts'
import { routes } from './routes.ts'
import { stopWarmAgent } from './llm/antigravity-cli.ts'
import { routeClass } from './users/access.ts'
import { assertActive, multiUserResolver } from './users/resolve.ts'
import { multiUser, ensureUserRoot } from './users/root.ts'
import { createUserStores } from './users/stores.ts'
import { charge, quotaFor } from './users/quota.ts'
import { startMultiUserSchedulers } from './users/schedulers.ts'

const rootDir = path.resolve(import.meta.dirname, '..')
const distDir = path.join(rootDir, 'dist')
const contentDir = path.join(rootDir, 'content')
loadEnv(rootDir)

const store = createContentStore(contentDir)
store.current()
// content/speaking/ (Speaking ideas' tags) is not part of the build.
watch(contentDir, { recursive: true }, (_event, file) => {
  if (!file?.startsWith('speaking')) store.invalidate()
})

const MULTI = multiUser()
// Multi-user app: one /data build per learner (their own library + the shared content), the few most recent kept.
const userStores = createUserStores(rootDir)
const base = { contentDir, rootDir, onContentChange: store.invalidate }
const api = createApiMiddleware(
  base,
  routes,
  MULTI
    ? {
        ctx: multiUserResolver({ appRoot: rootDir, base, invalidate: userStores.invalidate }),
        classOf: routeClass,
        charge: async (ctx, key, body) => {
          const q = quotaFor(key, body)
          return q ? charge(ctx, q.kind, q.units) : null
        },
      }
    : undefined,
)
if (process.env.NEWS_SCHEDULER !== 'off') startNewsScheduler({ rootDir })
if (MULTI) {
  // Shared content changed (a deploy): every learner's /data is rebuilt on next use.
  watch(contentDir, { recursive: true }, () => userStores.invalidateAll())
  startMultiUserSchedulers(rootDir, userStores.invalidate)
} else {
  startPlannerScheduler({ rootDir, contentDir })
  startDrillsScheduler({ rootDir, contentDir, onContentChange: store.invalidate })
}
const data = store.middleware({ cache: 'no-cache', compress: true })

/** Multi-user app: the logged-in, approved account behind a /data or picture request, or null. */
async function activeUser(req: IncomingMessage) {
  const user = await authenticate(req)
  if (!user) return null
  try {
    assertActive(user)
  } catch {
    return null
  }
  return user
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
}

/** Security headers on every answer. The PDF tab of a collocation lesson frames a same-origin PDF: SAMEORIGIN. */
function securityHeaders(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'; base-uri 'self'; object-src 'none'")
  // Speaking records with the microphone; nothing uses the camera or location.
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)')
  if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000')
}

/** Behind Cloudflare a visit over plain http is sent to https: the password, 2FA code and session cookie never travel unencrypted. */
function redirectToHttps(req: IncomingMessage, res: ServerResponse): boolean {
  if (process.env.TRUST_PROXY !== '1' || req.headers['x-forwarded-proto'] !== 'http' || !req.headers.host) return false
  res.statusCode = 301
  res.setHeader('Location', `https://${req.headers.host}${req.url ?? '/'}`)
  res.end()
  return true
}

/** Pictures pasted into Notepad are personal: only a logged-in visitor gets them (the page's <img> sends the cookie). */
const PRIVATE_STATIC = ['/notepad-images/']
/** Multi-user app: pictures of a learner's own words, notes and notepad live in their folder (then the shared ones). */
const USER_STATIC = ['/notepad-images/', '/vocab-images/', '/note-images/']

/** A learner's own copy of a picture, if there is one. */
function userStaticFile(uid: string, urlPath: string): string | null {
  const pub = path.join(ensureUserRoot(uid, rootDir), 'public')
  const file = path.resolve(pub, '.' + urlPath)
  if (!file.startsWith(pub + path.sep)) return null
  return existsSync(file) && statSync(file).isFile() ? file : null
}

function serveStatic(req: IncomingMessage, res: ServerResponse, userFile?: string) {
  let urlPath: string
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    // A malformed %-escape ("/%E0%A4%A") used to throw out of the request handler and stop the server.
    res.statusCode = 400
    return res.end('Bad request')
  }
  let file = userFile ?? path.join(distDir, urlPath)
  // Images uploaded through the admin after the last build live only in public/.
  if (!userFile && !existsSync(file)) file = path.join(rootDir, 'public', urlPath)
  if (!userFile && !file.startsWith(distDir + path.sep) && !file.startsWith(path.join(rootDir, 'public') + path.sep)) {
    res.statusCode = 403
    return res.end()
  }
  const isFile = existsSync(file) && statSync(file).isFile()
  if (!isFile) file = path.join(distDir, 'index.html') // SPA fallback
  const ext = path.extname(file)
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  res.setHeader('Vary', 'Accept-Encoding')
  const compressible = /\.(html|js|css|json|svg)$/.test(ext)
  if (compressible && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    res.setHeader('Content-Encoding', 'gzip')
    createReadStream(file).pipe(createGzip()).pipe(res)
    return
  }
  createReadStream(file).pipe(res)
}

const server = createServer(async (req, res) => {
  try {
    await handle(req, res)
  } catch (error) {
    // No request may take the server down: answer 500 and carry on.
    console.error('[server]', error)
    if (!res.headersSent) res.statusCode = 500
    res.end()
  }
})

async function handle(req: IncomingMessage, res: ServerResponse) {
  securityHeaders(req, res)
  if (redirectToHttps(req, res)) return
  // Login gate: /api and /data need a session (server/auth/middleware.ts).
  try {
    if (!(await gate(req, res))) return
  } catch (error) {
    console.error('[auth]', error)
    res.statusCode = 500
    return res.end('{"error":"Auth check failed."}')
  }
  const url = req.url ?? '/'
  if (url.startsWith('/api/')) {
    req.url = url.slice(4)
    return api(req, res, () => {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Not found' }))
    })
  }
  if (url.startsWith('/data/')) {
    req.url = url.slice(5)
    if (MULTI) {
      const user = await activeUser(req)
      if (!user) {
        res.statusCode = 403
        return res.end('{"error":"Account not active."}')
      }
      return userStores.middleware(user.id)(req, res, () => {
        res.statusCode = 404
        res.end('{}')
      })
    }
    return data(req, res, () => {
      res.statusCode = 404
      res.end('{}')
    })
  }
  if (MULTI && USER_STATIC.some((prefix) => url.startsWith(prefix))) {
    const user = await activeUser(req)
    let urlPath = ''
    try {
      urlPath = decodeURIComponent(new URL(url, 'http://x').pathname)
    } catch {
      /* serveStatic answers 400 */
    }
    const own = user && urlPath ? userStaticFile(user.id, urlPath) : null
    if (own) return serveStatic(req, res, own)
    // Notepad pictures are only ever personal; word and note pictures fall back to the shared ones.
    if (url.startsWith('/notepad-images/')) {
      res.statusCode = user ? 404 : 401
      return res.end()
    }
  }
  if (PRIVATE_STATIC.some((prefix) => url.startsWith(prefix)) && !(await authenticate(req))) {
    res.statusCode = 401
    return res.end()
  }
  serveStatic(req, res)
}

// Errors outside a request (a timer, a stream) are logged instead of stopping the server; systemd restarts it if it
// still dies.
process.on('unhandledRejection', (error) => console.error('[server] unhandled rejection', error))
process.on('uncaughtException', (error) => console.error('[server] uncaught exception', error))

const port = Number(process.env.PORT || 4173)
// Only this machine: Cloudflare Tunnel connects to 127.0.0.1, so nobody can reach the server around Cloudflare (and
// fake CF-Connecting-IP to dodge the login limit). HOST=0.0.0.0 opens it to the network again.
const host = process.env.HOST || '127.0.0.1'
server.listen(port, host, () => console.log(`English App running at http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`))

// The coach's agent process and MCP listener stop with the server (they start only on the first coach question).
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    stopWarmAgent()
    void stopCoach().finally(() => process.exit(0))
  })
}
