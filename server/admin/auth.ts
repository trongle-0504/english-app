import { timingSafeEqual } from 'node:crypto'
import { ApiError, type ApiHandler, type ApiRequest } from '../api.ts'

/*
 * The admin API only exists on the local Node server (Vite dev server or `npm start`); static hosting
 * has no /api at all. When the server is reachable by others, set ADMIN_TOKEN in .env: every admin
 * write then requires the header `x-admin-token: <ADMIN_TOKEN>` (the admin UI asks for it once and
 * keeps it in localStorage). Without ADMIN_TOKEN, writes are open — fine on localhost.
 */

export function tokenRequired(): boolean {
  return Boolean(process.env.ADMIN_TOKEN)
}

function headerToken(req: ApiRequest): string {
  const value = req.headers['x-admin-token']
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

export function isAuthorized(req: ApiRequest): boolean {
  const expected = process.env.ADMIN_TOKEN
  if (!expected) return true
  const given = Buffer.from(headerToken(req))
  const wanted = Buffer.from(expected)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/** Wraps a handler that writes content (or spends Gemini credits) with the ADMIN_TOKEN check. */
export function guarded(handler: ApiHandler): ApiHandler {
  return (req, ctx) => {
    if (!isAuthorized(req)) {
      throw new ApiError(401, headerToken(req) ? 'Invalid admin token.' : 'This server requires an admin token.')
    }
    return handler(req, ctx)
  }
}
