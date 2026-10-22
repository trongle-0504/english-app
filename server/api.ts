import type { IncomingMessage, ServerResponse } from 'node:http'
import { authenticate } from './auth/middleware.ts'
import { publicUser, type PublicUser } from './auth/users.ts'
import { requestContext, userRootDir } from './paths.ts'

export interface BaseApiContext {
  /** Absolute path of the content/ folder. */
  contentDir: string
  /** Absolute path of the project root. */
  rootDir: string
  /** Call after writing to content/ so /data is rebuilt. */
  onContentChange: () => void
}

export interface ApiContext extends BaseApiContext {
  /** Authenticated user for the current request. */
  user: PublicUser
  /** Absolute path of the user's personal data directory (<dataDir>/users/<user.id>). */
  userDir: string
}

export interface ApiRequest {
  method: string
  path: string
  query: URLSearchParams
  headers: IncomingMessage['headers']
  /** Parsed JSON body (undefined when the body is empty or not JSON). */
  body: unknown
  /** Raw request bytes (for audio uploads). */
  rawBody: Buffer
  /** Underlying Node request (for streaming / abort listeners). */
  incoming: IncomingMessage
}

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
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

const ANONYMOUS_USER: PublicUser = { id: '_anonymous', email: '', role: 'learner' }

/**
 * Connect-style middleware mounted at /api. Routes are keyed "METHOD /path" (path relative to /api).
 * Used by the Vite dev server and by server/index.ts in production.
 */
export function createApiMiddleware(baseCtx: BaseApiContext, routes: Routes) {
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
      const authed = await authenticate(req)
      const user = authed ? publicUser(authed) : ANONYMOUS_USER
      const userDir = authed ? userRootDir(authed.id) : ''
      const ctx: ApiContext = { ...baseCtx, user, userDir }

      const rawBody = method === 'GET' ? Buffer.alloc(0) : await readBody(req)
      let body: unknown
      if (rawBody.length && String(req.headers['content-type'] ?? '').includes('application/json')) {
        try {
          body = JSON.parse(rawBody.toString('utf8'))
        } catch {
          throw new ApiError(400, 'Invalid JSON body.')
        }
      }
      const result = await requestContext.run({ userId: authed?.id, userDir: userDir || undefined }, () =>
        handler({ method, path: url.pathname, query: url.searchParams, headers: req.headers, body, rawBody, incoming: req }, ctx),
      )
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
