import { ApiError, type ApiHandler, type ApiRequest } from '../api.ts'
import { authenticate, clientIp, isHttps, readCookie } from '../auth/middleware.ts'
import { DUMMY_HASH, MIN_PASSWORD_LENGTH, verifyPassword } from '../auth/password.ts'
import { clearFailures, lockedFor, recordFailure } from '../auth/rate-limit.ts'
import { COOKIE, createSession, deleteSession, deleteUserSessions, sessionTtlMs } from '../auth/sessions.ts'
import { consumeChallenge, createChallenge, failChallenge, peekChallenge } from '../auth/challenges.ts'
import { decryptSecret, encryptSecret, hashRecovery, newRecoveryCodes, newSecret, otpauthUri, verifyTotp } from '../auth/totp.ts'
import { findByEmail, findById, listUsers, normalizeEmail, publicUser, setPassword, updateUser, type User } from '../auth/users.ts'
import QRCode from 'qrcode'
import { admitDevice, currentDeviceHash } from '../auth/devices.ts'
import { deleteDeviceSessions } from '../auth/sessions.ts'
import { createUser, statusOf } from '../auth/users.ts'
import { audit } from '../users/audit.ts'
import { notifyAdmins } from '../users/notify.ts'
import { multiUser } from '../users/root.ts'
import { readSettings } from '../users/settings.ts'
import { verifyTurnstile, turnstileSiteKey } from '../users/turnstile.ts'

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

/**
 * The session after a successful login. Multi-user app: the device is recorded on the account first (a learner's
 * third device is refused with 403).
 */
async function startSession(req: ApiRequest, user: User) {
  const device = multiUser() ? await admitDevice(req, user) : null
  const token = await createSession(user.id, device?.hash)
  const cookies = [sessionCookie(req, token, Math.floor(sessionTtlMs() / 1000)), ...(device?.cookie ? [device.cookie] : [])]
  void audit('login', { email: user.email, ip: clientIp(req.incoming) })
  return { json: { user: publicUser((await findById(user.id)) ?? user) }, headers: { 'Set-Cookie': cookies as unknown as string } }
}

// Sign-ups per IP per day (in memory; a restart forgets them, which is fine for a small app).
const signups = ((globalThis as { __signups?: Map<string, { day: string; n: number }> }).__signups ??= new Map())
const today = () => new Date().toISOString().slice(0, 10)
const forgotRequests = ((globalThis as { __forgot?: Map<string, number> }).__forgot ??= new Map())

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
    if (statusOf(user) === 'rejected') throw new ApiError(403, 'Yêu cầu đăng ký của bạn chưa được chấp nhận.')
    // Password right but two-factor on: no session yet, only a short-lived challenge. The failure count stays until the code is right too.
    if (user.totpSecret) return { json: { needs2fa: true, challenge: createChallenge(user.id) } }
    clearFailures(ip, email)
    return startSession(req, user)
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
    return startSession(req, user)
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

  /** Body `{ code }` → `{ recoveryCodes }`, shown this once. Turns two-factor on and signs out every other device. */
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
    // Sessions made before two-factor existed never passed the second step: end them all (other phones and browsers
    // must log in again) and give this one a fresh cookie.
    await deleteUserSessions(user.id)
    const token = await createSession(user.id)
    return { json: { recoveryCodes }, headers: { 'Set-Cookie': sessionCookie(req, token, Math.floor(sessionTtlMs() / 1000)) } }
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
    if (user.mustChangePassword) await updateUser(user.id, ({ mustChangePassword: _m, ...u }) => u)
    await deleteUserSessions(user.id)
    const token = await createSession(user.id, currentDeviceHash(req) || undefined)
    return { json: { ok: true }, headers: { 'Set-Cookie': sessionCookie(req, token, Math.floor(sessionTtlMs() / 1000)) } }
  },

  /** → `{ user }`, or 401 with `needsSetup` when no account exists yet (the login page then says how to create one). */
  'GET /auth/me': async (req) => {
    const user = await authenticate(req.incoming)
    if (user) return { json: { user: publicUser(user) } }
    return { status: 401, json: { error: 'Not logged in.', needsSetup: (await listUsers()).length === 0 } }
  },

  /* ───────────── Multi-user: sign-up, forgotten password, devices ───────────── */

  /** → `{ open, turnstileSiteKey }`: whether the sign-up form is offered. */
  'GET /auth/register/config': async () => {
    const settings = await readSettings()
    return { json: { open: multiUser() && settings.registration === 'open', turnstileSiteKey: turnstileSiteKey() } }
  },

  /**
   * Body `{ displayName, email, password, note?, turnstileToken? }` → `{ ok }`. Creates a pending account (it can log in
   * but sees only "waiting for approval") and tells the admin. The same answer whether or not the email is taken.
   */
  'POST /auth/register': async (req) => {
    if (!multiUser()) throw new ApiError(404, 'Not found')
    const settings = await readSettings()
    if (settings.registration !== 'open') throw new ApiError(403, 'Hiện chưa mở đăng ký. Liên hệ admin để được tạo tài khoản.')
    const ip = clientIp(req.incoming)
    const seen = signups.get(ip)
    const count = seen && seen.day === today() ? seen.n : 0
    if (count >= 3) throw new ApiError(429, 'Bạn đã gửi quá nhiều yêu cầu hôm nay. Thử lại ngày mai.')
    const displayName = field(req.body, 'displayName').trim().slice(0, 60)
    const email = normalizeEmail(field(req.body, 'email'))
    const password = field(req.body, 'password')
    const note = field(req.body, 'note').trim().slice(0, 300)
    if (!displayName) throw new ApiError(400, 'Nhập tên của bạn.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new ApiError(400, 'Email không hợp lệ.')
    if (password.length < MIN_PASSWORD_LENGTH) throw new ApiError(400, `Mật khẩu cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`)
    if (!(await verifyTurnstile(field(req.body, 'turnstileToken'), ip))) throw new ApiError(400, 'Xác minh "không phải robot" chưa thành công. Thử lại.')
    signups.set(ip, { day: today(), n: count + 1 })
    const users = await listUsers()
    if (users.filter((u) => statusOf(u) === 'pending').length >= 20) throw new ApiError(503, 'Đang có nhiều yêu cầu chờ duyệt. Thử lại sau.')
    if (users.some((u) => u.email === email)) {
      void audit('register.duplicate', { email, ip })
      return { json: { ok: true } }
    }
    const user = await createUser(email, password, { role: 'learner', status: 'pending', displayName, signupNote: note })
    void audit('register', { email, ip, country: String(req.headers['cf-ipcountry'] ?? '') })
    void notifyAdmins({ title: 'Có người đăng ký mới', body: `${displayName} (${email}) đang chờ duyệt.`, tag: `signup-${user.id}`, url: '/admin/users' })
    return { json: { ok: true } }
  },

  /** Body `{ email }` → `{ ok }`: puts a "forgot my password" request in the admin's queue (no email is sent). */
  'POST /auth/forgot': async (req) => {
    if (!multiUser()) throw new ApiError(404, 'Not found')
    const email = normalizeEmail(field(req.body, 'email'))
    const ip = clientIp(req.incoming)
    const last = forgotRequests.get(ip) ?? 0
    if (Date.now() - last < 60_000) throw new ApiError(429, 'Vui lòng đợi một phút rồi thử lại.')
    forgotRequests.set(ip, Date.now())
    const user = email ? await findByEmail(email) : undefined
    if (user) {
      await updateUser(user.id, (u) => ({ ...u, resetRequestedAt: new Date().toISOString() }))
      void audit('password.forgot', { email, ip })
      void notifyAdmins({ title: 'Yêu cầu đặt lại mật khẩu', body: `${user.displayName || user.email} quên mật khẩu.`, tag: `forgot-${user.id}`, url: '/admin/users' })
    }
    return { json: { ok: true } }
  },

  /** → `{ devices, current, max }`: the devices this account is logged in from. */
  'GET /me/devices': async (req) => {
    const user = await authenticate(req.incoming)
    if (!user) throw new ApiError(401, 'Not logged in.')
    const current = currentDeviceHash(req)
    return {
      json: {
        devices: (user.devices ?? []).map((d) => ({ id: d.idHash.slice(0, 16), label: d.label, firstSeen: d.firstSeen, lastSeen: d.lastSeen, current: d.idHash === current })),
        max: user.role === 'admin' ? null : Number(process.env.MAX_DEVICES) || 2,
        canRemove: user.role === 'admin' || !user.deviceRemovedAt || Date.now() - Date.parse(user.deviceRemovedAt) > 7 * 24 * 3_600_000,
      },
    }
  },

  /** ?id= (first 16 hex of the device hash) → `{ ok }`. A learner may remove one device a week. */
  'DELETE /me/devices': async (req) => {
    const user = await authenticate(req.incoming)
    if (!user) throw new ApiError(401, 'Not logged in.')
    const id = req.query.get('id') ?? ''
    const device = (user.devices ?? []).find((d) => d.idHash.startsWith(id) && id.length >= 16)
    if (!device) throw new ApiError(404, 'Không có thiết bị này.')
    if (user.role !== 'admin' && user.deviceRemovedAt && Date.now() - Date.parse(user.deviceRemovedAt) < 7 * 24 * 3_600_000) {
      throw new ApiError(429, 'Mỗi tuần chỉ gỡ được một thiết bị. Nhờ admin nếu cần gấp.')
    }
    await updateUser(user.id, (u) => ({ ...u, devices: (u.devices ?? []).filter((d) => d.idHash !== device.idHash), deviceRemovedAt: new Date().toISOString() }))
    await deleteDeviceSessions(user.id, device.idHash)
    void audit('device.remove', { email: user.email, by: 'self', device: device.label })
    return { json: { ok: true } }
  },
}
