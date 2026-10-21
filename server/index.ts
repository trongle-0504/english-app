// Production server: serves dist/, live /data from content/, and /api. Run with `npm start`.
import { createReadStream, existsSync, statSync, watch } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { createGzip } from 'node:zlib'
import { createContentStore } from '../content-pipeline/store.ts'
import { createApiMiddleware } from './api.ts'
import { gate } from './auth/middleware.ts'
import { loadEnv } from './env.ts'
import { routes } from './routes.ts'

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

const api = createApiMiddleware({ contentDir, rootDir, onContentChange: store.invalidate }, routes)
const data = store.middleware({ cache: 'no-cache', compress: true })

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

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  let file = path.join(distDir, urlPath)
  // Images uploaded through the admin after the last build live only in public/.
  if (!existsSync(file)) file = path.join(rootDir, 'public', urlPath)
  if (!file.startsWith(distDir + path.sep) && !file.startsWith(path.join(rootDir, 'public') + path.sep)) {
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
    return data(req, res, () => {
      res.statusCode = 404
      res.end('{}')
    })
  }
  serveStatic(req, res)
})

const port = Number(process.env.PORT || 4173)
server.listen(port, () => console.log(`English App running at http://localhost:${port}`))
