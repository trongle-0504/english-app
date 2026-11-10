import { ApiError, type ApiHandler, type ApiRequest } from '../api.ts'
import { authenticate, clientIp, isHttps, readCookie } from '../auth/middleware.ts'
import { DUMMY_HASH, MIN_PASSWORD_LENGTH, verifyPassword } from '../auth/password.ts'
import { clearFailures, lockedFor, recordFailure } from '../auth/rate-limit.ts'
import { COOKIE, createSession, deleteSession, deleteUserSessions, sessionTtlMs } from '../auth/sessions.ts'
import { consumeChallenge, createChallenge, failChallenge, peekChallenge } from '../auth/challenges.ts'
import { decryptSecret, encryptSecret, hashRecovery, newRecoveryCodes, newSecret, otpauthUri, verifyTotp } from '../auth/totp.ts'
import { findByEmail, findById, listUsers, normalizeEmail, publicUser, setPassword, updateUser, type User } from '../auth/users.ts'
import QRCode from 'qrcode'

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

/**
 * A 6-digit authenticator code, or one of the recovery codes (each works once). A wrong answer counts against the same
 * limits as a wrong password. Returns whether the second factor passed.
 */
async function checkSecondFactor(user: User, code: string, ip: string): Promise<boolean> {
  if (!user.totpSecret) return true
  const step = verifyTotp(await decryptSecret(user.totpSecret), code, user.totpLastStep ?? -1)
  if (step !== null) {
    await updateUser(user.id, (u) => ({ ...u, totpLastStep: step }))
    clearFailures(ip, user.email)
    return true
  }
  const hash = hashRecovery(code)
  if (user.recoveryHashes?.includes(hash)) {
    await updateUser(user.id, (u) => ({ ...u, recoveryHashes: (u.recoveryHashes ?? []).filter((h) => h !== hash) }))
    clearFailures(ip, user.email)
    return true
  }
  recordFailure(ip, user.email)
  return false
}

/** A signed-in user who also proves the password (changing the second factor must not work from a stolen session). */
async function reauthenticate(req: ApiRequest): Promise<User> {
  const user = await authenticate(req.incoming)
  if (!user) throw new ApiError(401, 'Not logged in.')
  const ip = clientIp(req.incoming)
  const wait = lockedFor(ip, user.email)
  if (wait) throw new ApiError(429, `Sai quá nhiều lần. Thử lại sau ${wait} phút.`)
  if (!(await verifyPassword(field(req.body, 'password'), user.passwordHash))) {
    recordFailure(ip, user.email)
    throw new ApiError(400, 'Mật khẩu không đúng.')
  }
  return user
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
    // Password right but two-factor on: no session yet, only a short-lived challenge. The failure count stays until the code is right too.
    if (user.totpSecret) return { json: { needs2fa: true, challenge: createChallenge(user.id) } }
    clearFailures(ip, email)
    const token = await createSession(user.id)
    return { json: { user: publicUser(user) }, headers: { 'Set-Cookie': sessionCookie(req, token, Math.floor(sessionTtlMs() / 1000)) } }
  },

  /** Body `{ challenge, code }` (code: authenticator code or recovery code) → `{ user }` and the session cookie. */
  'POST /auth/login/2fa': async (req) => {
    const challenge = field(req.body, 'challenge')
    const code = field(req.body, 'code')
    const pending = peekChallenge(challenge)
    const user = pending ? await findById(pending.userId) : undefined
    if (!pending || !user || user.disabled) throw new ApiError(401, 'Phiên xác thực đã hết hạn. Đăng nhập lại.')
    const ip = clientIp(req.incoming)
    const wait = lockedFor(ip, user.email)
    if (wait) throw new ApiError(429, `Sai quá nhiều lần. Thử lại sau ${wait} phút.`)
    if (!code.trim()) throw new ApiError(400, 'Nhập mã xác thực.')
    if (!(await checkSecondFactor(user, code, ip))) {
      const left = failChallenge(challenge)
      throw new ApiError(401, left ? 'Mã không đúng.' : 'Sai quá nhiều lần. Đăng nhập lại.')
    }
    consumeChallenge(challenge)
    const token = await createSession(user.id)
    return { json: { user: publicUser(user) }, headers: { 'Set-Cookie': sessionCookie(req, token, Math.floor(sessionTtlMs() / 1000)) } }
  },

  /** → `{ secret, uri, qr }`: a new secret waiting for its first code (`/auth/2fa/enable`). Nothing changes until then. */
  'POST /auth/2fa/setup': async (req) => {
    const user = await authenticate(req.incoming)
    if (!user) throw new ApiError(401, 'Not logged in.')
    if (user.totpSecret) throw new ApiError(400, 'Xác thực hai lớp đã được bật.')
    const secret = newSecret()
    const pending = await encryptSecret(secret)
    await updateUser(user.id, (u) => ({ ...u, totpPending: pending }))
    const uri = otpauthUri(secret, user.email)
    return { json: { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) } }
  },

  /** Body `{ code }` → `{ recoveryCodes }`, shown this once. Turns two-factor on. */
  'POST /auth/2fa/enable': async (req) => {
    const user = await authenticate(req.incoming)
    if (!user) throw new ApiError(401, 'Not logged in.')
    if (user.totpSecret) throw new ApiError(400, 'Xác thực hai lớp đã được bật.')
    if (!user.totpPending) throw new ApiError(400, 'Hãy bắt đầu thiết lập trước.')
    const ip = clientIp(req.incoming)
    const wait = lockedFor(ip, user.email)
    if (wait) throw new ApiError(429, `Sai quá nhiều lần. Thử lại sau ${wait} phút.`)
    const step = verifyTotp(await decryptSecret(user.totpPending), field(req.body, 'code'))
    if (step === null) {
      recordFailure(ip, user.email)
      throw new ApiError(400, 'Mã không đúng. Kiểm tra giờ trên điện thoại rồi thử lại.')
    }
    const recoveryCodes = newRecoveryCodes()
    await updateUser(user.id, ({ totpPending, ...u }) => ({ ...u, totpSecret: totpPending, totpLastStep: step, recoveryHashes: recoveryCodes.map(hashRecovery) }))
    return { json: { recoveryCodes } }
  },

  /** Body `{ password, code }` → `{ ok }`. */
  'POST /auth/2fa/disable': async (req) => {
    const user = await reauthenticate(req)
    if (!user.totpSecret) throw new ApiError(400, 'Xác thực hai lớp chưa được bật.')
    if (!(await checkSecondFactor(user, field(req.body, 'code'), clientIp(req.incoming)))) throw new ApiError(400, 'Mã không đúng.')
    await updateUser(user.id, ({ totpSecret: _s, totpPending: _p, totpLastStep: _l, recoveryHashes: _r, ...u }) => u)
    return { json: { ok: true } }
  },

  /** Body `{ password, code }` → `{ recoveryCodes }`: a fresh set; the old ones stop working. */
  'POST /auth/2fa/recovery': async (req) => {
    const user = await reauthenticate(req)
    if (!user.totpSecret) throw new ApiError(400, 'Xác thực hai lớp chưa được bật.')
    if (!(await checkSecondFactor(user, field(req.body, 'code'), clientIp(req.incoming)))) throw new ApiError(400, 'Mã không đúng.')
    const recoveryCodes = newRecoveryCodes()
    await updateUser(user.id, (u) => ({ ...u, recoveryHashes: recoveryCodes.map(hashRecovery) }))
    return { json: { recoveryCodes } }
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
