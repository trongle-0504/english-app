import { timingSafeEqual } from 'node:crypto'
import { ApiError, type ApiContext, type ApiHandler, type ApiRequest } from '../api.ts'

export function tokenRequired(): boolean {
  return false
}

function headerToken(req: ApiRequest): string {
  const value = req.headers['x-admin-token']
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

export function isAuthorized(req: ApiRequest, ctx?: ApiContext): boolean {
  if (ctx?.user?.role === 'admin') return true
  const expected = process.env.ADMIN_TOKEN
  if (expected) {
    const given = Buffer.from(headerToken(req))
    const wanted = Buffer.from(expected)
    if (given.length === wanted.length && timingSafeEqual(given, wanted)) return true
  }
  return false
}

/** Wraps a handler that modifies shared library content or views server-wide admin data with an admin role check. */
export function guarded(handler: ApiHandler): ApiHandler {
  return (req, ctx) => {
    if (!isAuthorized(req, ctx)) {
      throw new ApiError(403, 'Admin only.')
    }
    return handler(req, ctx)
  }
}
