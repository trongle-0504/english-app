import type { IncomingMessage, ServerResponse } from 'node:http'
import { gzipSync } from 'node:zlib'
import { buildContent, type ContentBuild } from './index.ts'

/** Lazily (re)built in-memory copy of /data, shared by the Vite dev server and the production server. */
export function createContentStore(contentDir: string) {
  let build: ContentBuild | null = null
  let gzipped = new Map<string, Buffer>()

  const current = (): ContentBuild => {
    if (!build) {
      gzipped = new Map()
      build = buildContent(contentDir)
      for (const warning of build.warnings) console.warn(`[content] ${warning}`)
    }
    return build
  }

  const middleware =
    ({ cache, compress = false }: { cache: string; compress?: boolean }) =>
    (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const key = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '')
      const json = current().files.get(key)
      if (json === undefined) return next()
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', cache)
      res.setHeader('Vary', 'Accept-Encoding')
      if (compress && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
        let body = gzipped.get(key)
        if (!body) gzipped.set(key, (body = gzipSync(json)))
        res.setHeader('Content-Encoding', 'gzip')
        return res.end(body)
      }
      res.end(json)
    }

  return {
    current,
    invalidate: () => {
      build = null
    },
    middleware,
  }
}
