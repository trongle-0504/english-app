// The login gate, shared by the production server (server/index.ts) and the Vite dev server (vite.config.ts): /api and
// /data need a session; the page shell, scripts, styles and images do not (the login page must load). Everything else
// a visitor could do — read the content, run the AI tools, edit through Admin — goes through /api or /data.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { COOKIE, sessionUserId } from './sessions.ts'
import { findById, type User } from './users.ts'

/** Reachable without a session: logging in, and asking whether one is logged in. */
const PUBLIC_API = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/health'])

export function readCookie(req: IncomingMessage, name: string): string {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return ''
}

/** The logged-in user, or null (no cookie, unknown or expired session, disabled account). */
export async function authenticate(req: IncomingMessage): Promise<User | null> {
  const userId = await sessionUserId(readCookie(req, COOKIE))
  const user = userId ? await findById(userId) : undefined
  return user && !user.disabled ? user : null
}

/** Behind Cloudflare Tunnel every request comes from cloudflared on localhost: TRUST_PROXY=1 reads the visitor's IP. */
export function clientIp(req: IncomingMessage): string {
  const forwarded = process.env.TRUST_PROXY === '1' ? req.headers['cf-connecting-ip'] : undefined
  return String((Array.isArray(forwarded) ? forwarded[0] : forwarded) || req.socket.remoteAddress || '')
}

/** HTTPS as the visitor sees it (Cloudflare ends TLS and forwards plain HTTP with X-Forwarded-Proto). */
export const isHttps = (req: IncomingMessage) => req.headers['x-forwarded-proto'] === 'https' || 'encrypted' in req.socket

/**
 * A state-changing request must come from this site. The SameSite=Lax cookie already keeps other sites' forms from
 * carrying the session; this also refuses a request whose Origin names another host.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  const forwardedHost = req.headers['x-forwarded-host']
  return host === req.headers.host || host === (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)
}

function refuse(res: ServerResponse, status: number, error: string): false {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify({ error }))
  return false
}

/** Answers 401/403 itself and returns false, or returns true to let the request through. */
export async function gate(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? '/'
  const path = url.split('?')[0]
  const isApi = path.startsWith('/api/')
  if (!isApi && !path.startsWith('/data/')) return true
  if (isApi && !['GET', 'HEAD'].includes(req.method ?? 'GET') && !sameOrigin(req)) return refuse(res, 403, 'Cross-site request refused.')
  if (PUBLIC_API.has(path)) return true
  if (await authenticate(req)) return true
  return refuse(res, 401, 'Not logged in.')
}
