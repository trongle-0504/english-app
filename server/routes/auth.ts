import { ApiError, type ApiHandler, type ApiRequest } from '../api.ts'
import { authenticate, clientIp, isHttps, readCookie } from '../auth/middleware.ts'
import { DUMMY_HASH, MIN_PASSWORD_LENGTH, verifyPassword } from '../auth/password.ts'
import { clearFailures, lockedFor, recordFailure } from '../auth/rate-limit.ts'
import { COOKIE, createSession, deleteSession, deleteUserSessions, sessionTtlMs } from '../auth/sessions.ts'
import { findByEmail, listUsers, normalizeEmail, publicUser, setPassword } from '../auth/users.ts'

/** HttpOnly: page scripts cannot read it. SameSite=Lax: other sites' forms and fetches do not carry it. */
function sessionCookie(req: ApiRequest, token: string, maxAgeSeconds: number): string {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`]
  if (isHttps(req.incoming)) parts.push('Secure')
  return parts.join('; ')
}

const field = (body: unknown, name: string) => {
  const value = (body as Record<string, unknown> | undefined)?.[name]
  return typeof value === 'string' ? value : ''
}

/** Login endpoints; the gate (server/auth/middleware.ts) lets them through without a session. */
export const authRoutes: Record<string, ApiHandler> = {
  /** Body `{ email, password }` → `{ user }` and the session cookie. */
  'POST /auth/login': async (req) => {
    const email = normalizeEmail(field(req.body, 'email'))
    const password = field(req.body, 'password')
    if (!email || !password) throw new ApiError(400, 'Nhập email và mật khẩu.')
    const ip = clientIp(req.incoming)
    const wait = lockedFor(ip, email)
    if (wait) throw new ApiError(429, `Sai quá nhiều lần. Thử lại sau ${wait} phút.`)

    const user = await findByEmail(email)
    // An unknown email still costs one scrypt, so the answer time does not tell which emails exist.
    const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH))
    if (!user || !ok || user.disabled) {
      recordFailure(ip, email)
      throw new ApiError(401, 'Email hoặc mật khẩu không đúng.')
    }
    clearFailures(ip, email)
    const token = await createSession(user.id)
    return { json: { user: publicUser(user) }, headers: { 'Set-Cookie': sessionCookie(req, token, Math.floor(sessionTtlMs() / 1000)) } }
  },

  'POST /auth/logout': async (req) => {
    const token = readCookie(req.incoming, COOKIE)
    if (token) await deleteSession(token)
    return { json: { ok: true }, headers: { 'Set-Cookie': sessionCookie(req, '', 0) } }
  },

  /**
   * Body `{ current, next }` → `{ ok }`. Needs a session (the gate does not let it through without one) and the current
   * password. Every other session of the account ends; this one is replaced by a fresh cookie.
   */
  'POST /auth/change-password': async (req) => {
    const user = await authenticate(req.incoming)
    if (!user) throw new ApiError(401, 'Not logged in.')
    const current = field(req.body, 'current')
    const next = field(req.body, 'next')
    if (next.length < MIN_PASSWORD_LENGTH) throw new ApiError(400, `Mật khẩu mới cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`)
    if (next === current) throw new ApiError(400, 'Mật khẩu mới phải khác mật khẩu hiện tại.')
    // Same limit as logging in: a stolen session must not become a way to guess the password.
    const ip = clientIp(req.incoming)
    const wait = lockedFor(ip, user.email)
    if (wait) throw new ApiError(429, `Sai quá nhiều lần. Thử lại sau ${wait} phút.`)
    if (!(await verifyPassword(current, user.passwordHash))) {
      recordFailure(ip, user.email)
      throw new ApiError(400, 'Mật khẩu hiện tại không đúng.')
    }
    clearFailures(ip, user.email)
    await setPassword(user.id, next)
    await deleteUserSessions(user.id)
    const token = await createSession(user.id)
    return { json: { ok: true }, headers: { 'Set-Cookie': sessionCookie(req, token, Math.floor(sessionTtlMs() / 1000)) } }
  },

  /** → `{ user }`, or 401 with `needsSetup` when no account exists yet (the login page then says how to create one). */
  'GET /auth/me': async (req) => {
    const user = await authenticate(req.incoming)
    if (user) return { json: { user: publicUser(user) } }
    return { status: 401, json: { error: 'Not logged in.', needsSetup: (await listUsers()).length === 0 } }
  },
}
