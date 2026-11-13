import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RouteClass } from './users/access.ts'
import { requestUser, type RequestUser } from './users/context.ts'

export interface ApiContext {
  /** Absolute path of the content/ folder. */
  contentDir: string
  /** Absolute path of the project root. */
  rootDir: string
  /** Call after writing to content/ so /data is rebuilt. */
  onContentChange: () => void
  /** Multi-user app: the account this request works for (rootDir/contentDir are that account's own folder). */
  user?: RequestUser & { email: string }
}

/**
 * Multi-user app: builds the context of one request, or answers it (401/403) by throwing ApiError. `routeKey` is
 * "METHOD /path"; `routeClass` its access class (server/users/access.ts).
 */
export type ContextResolver = (req: IncomingMessage, routeKey: string, routeClass: RouteClass) => Promise<ApiContext>

export interface ApiRequest {
  method: string
  path: string
  query: URLSearchParams
  headers: IncomingMessage['headers']
  /** Parsed JSON body (undefined when the body is empty or not JSON). */
  body: unknown
  /** Raw body bytes, for multipart uploads. */
  rawBody: Buffer
  /** The underlying request, for the auth routes (cookie, client IP, HTTPS). */
  incoming: IncomingMessage
}

/** JSON, or raw bytes (`body` with its `contentType`: a recording). */
export type ApiResult = { status?: number; json?: unknown; body?: Buffer; contentType?: string; headers?: Record<string, string> }
export type ApiHandler = (req: ApiRequest, ctx: ApiContext) => Promise<ApiResult> | ApiResult

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Routes = Record<string, ApiHandler>

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  const max = maxBodyBytes()
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    // Recordings and pictures arrive as base64 JSON (a few MB); anything far larger is refused before it fills memory.
    if (size > max) throw new ApiError(413, 'Dữ liệu gửi lên quá lớn.')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

/**
 * Connect-style middleware mounted at /api. Routes are keyed "METHOD /path" (path relative to /api).
 * Used by the Vite dev server and by server/index.ts in production.
 */
export interface MultiUserHooks {
  ctx: ContextResolver
  classOf: (key: string) => RouteClass
  /** Takes the day's allowance for an AI route (throws 429); returns the refund. */
  charge?: (ctx: ApiContext, routeKey: string, body: unknown) => Promise<(() => Promise<void>) | null>
}

const maxBodyBytes = () => (Number(process.env.MAX_BODY_MB) || 60) * 1024 * 1024

export function createApiMiddleware(base: ApiContext, routes: Routes, resolve?: MultiUserHooks) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = (req.method ?? 'GET').toUpperCase()
    const handler = routes[`${method} ${url.pathname}`]
    if (!handler) return next()

    const send = (status: number, json: unknown) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(json))
    }

    try {
      const key = `${method} ${url.pathname}`
      const ctx = resolve ? await resolve.ctx(req, key, resolve.classOf(key)) : base
      const rawBody = method === 'GET' ? Buffer.alloc(0) : await readBody(req)
      let body: unknown
      if (rawBody.length && String(req.headers['content-type'] ?? '').includes('application/json')) {
        try {
          body = JSON.parse(rawBody.toString('utf8'))
        } catch {
          throw new ApiError(400, 'Invalid JSON body.')
        }
      }
      const request: ApiRequest = { method, path: url.pathname, query: url.searchParams, headers: req.headers, body, rawBody, incoming: req }
      const refund = ctx.user && resolve?.charge ? await resolve.charge(ctx, key, body) : null
      let result: ApiResult
      try {
        result = ctx.user
          ? await requestUser.run({ id: ctx.user.id, role: ctx.user.role, viewAs: ctx.user.viewAs }, () => handler(request, ctx))
          : await handler(request, ctx)
      } catch (error) {
        // The work never started for a server reason (busy, AI down): the allowance is given back.
        const status = error instanceof ApiError ? error.status : 500
        if (refund && (status >= 500 || status === 429 || status === 409)) await refund().catch(() => {})
        throw error
      }
      for (const [name, value] of Object.entries(result.headers ?? {})) res.setHeader(name, value)
      if (result.body) {
        const body = result.body
        res.setHeader('Content-Type', result.contentType ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'private, max-age=3600')
        // Byte ranges: without them a browser cannot seek in a recording it has not fully loaded.
        res.setHeader('Accept-Ranges', 'bytes')
        const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
        if (range && (range[1] || range[2])) {
          const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]))
          const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
          if (start > end || start >= body.length) {
            res.statusCode = 416
            res.setHeader('Content-Range', `bytes */${body.length}`)
            res.end()
            return
          }
          res.statusCode = 206
          res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`)
          res.setHeader('Content-Length', end - start + 1)
          res.end(body.subarray(start, end + 1))
        } else {
          res.statusCode = result.status ?? 200
          res.setHeader('Content-Length', body.length)
          res.end(body)
        }
      } else send(result.status ?? 200, result.json)
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500
      if (status >= 500) console.error('[api]', error)
      send(status, { error: (error as Error).message || 'Internal error' })
    }
  }
}
