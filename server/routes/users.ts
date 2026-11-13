// Multi-user accounts: Admin → Users (approve sign-ups, add people, limits, devices, passwords, delete) and the
// learner's own quota, export and account deletion (PLAN-multi-user-v2.md, 6.1–6.3, 7.4).
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ApiError, type ApiHandler, type ApiRequest } from '../api.ts'
import { authenticate } from '../auth/middleware.ts'
import { verifyPassword } from '../auth/password.ts'
import { deleteDeviceSessions, deleteUserSessions } from '../auth/sessions.ts'
import { dataDir } from '../auth/store.ts'
import { createUser, findByEmail, findById, listUsers, normalizeEmail, removeUser, setPassword, statusOf, updateUser, type Quota, type User, type UserRole } from '../auth/users.ts'
import { audit } from '../users/audit.ts'
import { quotaStatus } from '../users/quota.ts'
import { ensureUserRoot, forgetUserRoot, userRootDir } from '../users/root.ts'
import { readSettings, updateSettings } from '../users/settings.ts'

const run = promisify(execFile)
const appRoot = path.resolve(import.meta.dirname, '..', '..')
const body = (req: ApiRequest) => (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** A readable one-time password: 12 letters/digits without look-alikes. */
function tempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from(randomBytes(12), (b) => alphabet[b % alphabet.length]).join('')
}

async function account(id: string): Promise<User> {
  const user = id ? await findById(id) : undefined
  if (!user) throw new ApiError(404, 'Không có tài khoản này.')
  return user
}

const sizeCache = new Map<string, { at: number; bytes: number }>()
/** Bytes used by an account's folder (links to shared content not followed); cached 10 minutes. */
async function folderBytes(uid: string): Promise<number> {
  const hit = sizeCache.get(uid)
  if (hit && Date.now() - hit.at < 600_000) return hit.bytes
  const dir = userRootDir(uid)
  if (!existsSync(dir)) return 0
  const { stdout } = await run('du', ['-sb', dir]).catch(() => ({ stdout: '0' }))
  const bytes = Number(stdout.split(/\s/)[0]) || 0
  sizeCache.set(uid, { at: Date.now(), bytes })
  return bytes
}

const activeLearners = (users: User[]) => users.filter((u) => u.role === 'learner' && !u.disabled && statusOf(u) === 'active').length

/** The account's folder as a .tar.gz (links to shared content kept as links). */
async function exportFolder(uid: string): Promise<Buffer> {
  const dir = userRootDir(uid)
  const { stdout } = await run('tar', ['-czf', '-', '-C', path.dirname(dir), path.basename(dir)], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 })
  return stdout as unknown as Buffer
}

/** Moves an account's folder to <DATA_DIR>/deleted/ (removed for good after 30 days by the nightly cleanup). */
async function retireFolder(uid: string) {
  const dir = userRootDir(uid)
  forgetUserRoot(uid)
  if (!existsSync(dir)) return
  const deleted = path.join(dataDir(), 'deleted')
  await mkdir(deleted, { recursive: true })
  await rename(dir, path.join(deleted, `${uid}-${new Date().toISOString().slice(0, 10)}`))
}

export const userRoutes: Record<string, ApiHandler> = {
  /* ───────────── Admin ───────────── */

  'GET /admin/users': async () => {
    const [users, settings] = await Promise.all([listUsers(), readSettings()])
    const rows = await Promise.all(
      users.map(async (u) => {
        const exists = existsSync(userRootDir(u.id))
        return {
          id: u.id,
          email: u.email,
          displayName: u.displayName || u.email.split('@')[0],
          role: u.role,
          status: statusOf(u),
          disabled: Boolean(u.disabled),
          twoFactor: Boolean(u.totpSecret),
          mustChangePassword: Boolean(u.mustChangePassword),
          signupNote: u.signupNote ?? '',
          createdAt: u.createdAt,
          approvedAt: u.approvedAt ?? null,
          resetRequestedAt: u.resetRequestedAt ?? null,
          devices: (u.devices ?? []).map((d) => ({ id: d.idHash.slice(0, 16), label: d.label, firstSeen: d.firstSeen, lastSeen: d.lastSeen, lastIp: d.lastIp, lastCountry: d.lastCountry ?? '' })),
          quota: u.quota ?? {},
          usage: exists ? await quotaStatus(userRootDir(u.id), u.id) : null,
          storageBytes: await folderBytes(u.id),
        }
      }),
    )
    return { json: { users: rows, settings, activeLearners: activeLearners(users) } }
  },

  /** Body `{ email, displayName, role? }` → `{ user, password }`: active at once; the password is shown this once. */
  'POST /admin/users': async (req, ctx) => {
    const b = body(req)
    const email = normalizeEmail(str(b.email))
    const displayName = str(b.displayName).slice(0, 60)
    const role: UserRole = b.role === 'admin' ? 'admin' : 'learner'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Email không hợp lệ.')
    if (await findByEmail(email)) throw new ApiError(409, 'Email này đã có tài khoản.')
    const users = await listUsers()
    const settings = await readSettings()
    if (role === 'learner' && activeLearners(users) >= settings.maxActiveLearners) {
      throw new ApiError(409, `Đã đủ ${settings.maxActiveLearners} học viên đang hoạt động. Tăng giới hạn trong Cài đặt hoặc khóa bớt tài khoản.`)
    }
    const password = tempPassword()
    const user = await createUser(email, password, { role, displayName, mustChangePassword: true })
    await updateUser(user.id, (u) => ({ ...u, approvedAt: new Date().toISOString() }))
    ensureUserRoot(user.id, appRoot)
    void audit('admin.user.create', { admin: ctx.user?.email, email, role })
    return { json: { user: { id: user.id, email }, password } }
  },

  /** Body `{ id }` → `{ ok }`: a pending sign-up becomes active (if there is room under the learner limit). */
  'POST /admin/users/approve': async (req, ctx) => {
    const user = await account(str(body(req).id))
    if (statusOf(user) === 'active') return { json: { ok: true } }
    const settings = await readSettings()
    if (user.role === 'learner' && activeLearners(await listUsers()) >= settings.maxActiveLearners) {
      throw new ApiError(409, `Đã đủ ${settings.maxActiveLearners} học viên đang hoạt động. Tăng giới hạn trong Cài đặt hoặc khóa bớt tài khoản.`)
    }
    await updateUser(user.id, ({ status: _s, ...u }) => ({ ...u, approvedAt: new Date().toISOString() }))
    ensureUserRoot(user.id, appRoot)
    void audit('admin.user.approve', { admin: ctx.user?.email, email: user.email })
    return { json: { ok: true } }
  },

  'POST /admin/users/reject': async (req, ctx) => {
    const user = await account(str(body(req).id))
    if (user.role === 'admin') throw new ApiError(400, 'Không từ chối tài khoản admin.')
    await updateUser(user.id, (u) => ({ ...u, status: 'rejected' }))
    await deleteUserSessions(user.id)
    void audit('admin.user.reject', { admin: ctx.user?.email, email: user.email })
    return { json: { ok: true } }
  },

  /** Body `{ id, disabled?, displayName?, quota? }` → `{ ok }`. */
  'PATCH /admin/users': async (req, ctx) => {
    const b = body(req)
    const user = await account(str(b.id))
    if (user.id === ctx.user?.id && b.disabled === true) throw new ApiError(400, 'Không tự khóa tài khoản của mình.')
    const quota: Partial<Quota> = {}
    if (b.quota && typeof b.quota === 'object') {
      for (const [k, v] of Object.entries(b.quota as Record<string, unknown>)) {
        if (['writingPerDay', 'speakingPerDay', 'lightPerDay', 'novaPerDay', 'agyCallsPerDay', 'storageMb'].includes(k) && typeof v === 'number' && v >= 0 && v <= 10_000) {
          quota[k as keyof Quota] = Math.floor(v)
        }
      }
    }
    await updateUser(user.id, (u) => ({
      ...u,
      ...(typeof b.disabled === 'boolean' ? { disabled: b.disabled } : {}),
      ...(str(b.displayName) ? { displayName: str(b.displayName).slice(0, 60) } : {}),
      ...(Object.keys(quota).length ? { quota: { ...(u.quota ?? {}), ...quota } } : {}),
    }))
    if (b.disabled === true) await deleteUserSessions(user.id)
    void audit('admin.user.update', { admin: ctx.user?.email, email: user.email, change: Object.keys(b).filter((k) => k !== 'id') })
    return { json: { ok: true } }
  },

  /** Body `{ id }` → `{ password }`: a one-time password (shown once); the person must change it at the next login. */
  'POST /admin/users/reset-password': async (req, ctx) => {
    const user = await account(str(body(req).id))
    const password = tempPassword()
    await setPassword(user.id, password)
    await updateUser(user.id, ({ resetRequestedAt: _r, ...u }) => ({ ...u, mustChangePassword: true }))
    await deleteUserSessions(user.id)
    void audit('admin.user.reset-password', { admin: ctx.user?.email, email: user.email })
    return { json: { password } }
  },

  'POST /admin/users/reset-2fa': async (req, ctx) => {
    const user = await account(str(body(req).id))
    await updateUser(user.id, ({ totpSecret: _s, totpPending: _p, totpLastStep: _l, recoveryHashes: _r, ...u }) => u)
    await deleteUserSessions(user.id)
    void audit('admin.user.reset-2fa', { admin: ctx.user?.email, email: user.email })
    return { json: { ok: true } }
  },

  /** ?id=&device= → `{ ok }`: removes one device (and signs it out). */
  'DELETE /admin/users/devices': async (req, ctx) => {
    const user = await account(req.query.get('id') ?? '')
    const prefix = req.query.get('device') ?? ''
    const device = (user.devices ?? []).find((d) => prefix.length >= 16 && d.idHash.startsWith(prefix))
    if (!device) throw new ApiError(404, 'Không có thiết bị này.')
    await updateUser(user.id, (u) => ({ ...u, devices: (u.devices ?? []).filter((d) => d.idHash !== device.idHash) }))
    await deleteDeviceSessions(user.id, device.idHash)
    void audit('device.remove', { admin: ctx.user?.email, email: user.email, device: device.label })
    return { json: { ok: true } }
  },

  /** ?id= → `{ ok }`: signs the account out, moves its folder to deleted/ and removes it. */
  'DELETE /admin/users': async (req, ctx) => {
    const user = await account(req.query.get('id') ?? '')
    if (user.id === ctx.user?.id) throw new ApiError(400, 'Không tự xóa tài khoản của mình.')
    await deleteUserSessions(user.id)
    await retireFolder(user.id)
    await removeUser(user.id)
    void audit('admin.user.delete', { admin: ctx.user?.email, email: user.email })
    return { json: { ok: true } }
  },

  /** ?id= → .tar.gz of that account's folder. */
  'GET /admin/users/export': async (req, ctx) => {
    const user = await account(req.query.get('id') ?? '')
    void audit('admin.user.export', { admin: ctx.user?.email, email: user.email })
    return {
      body: await exportFolder(user.id),
      contentType: 'application/gzip',
      headers: { 'Content-Disposition': `attachment; filename="english-${user.email.replace(/[^a-z0-9.@-]/gi, '_')}.tar.gz"` },
    }
  },

  /** Body `{ registration?, maxActiveLearners?, quota? }` → `{ settings }`. */
  'PUT /admin/system/settings': async (req, ctx) => {
    const b = body(req)
    const change: Parameters<typeof updateSettings>[0] = {}
    if (b.registration === 'open' || b.registration === 'closed') change.registration = b.registration
    if (typeof b.maxActiveLearners === 'number' && b.maxActiveLearners >= 0 && b.maxActiveLearners <= 100) change.maxActiveLearners = Math.floor(b.maxActiveLearners)
    if (b.quota && typeof b.quota === 'object') {
      const q: Partial<Quota> = {}
      for (const [k, v] of Object.entries(b.quota as Record<string, unknown>)) if (typeof v === 'number' && v >= 0 && v <= 10_000) q[k as keyof Quota] = Math.floor(v)
      change.quota = q as Quota
    }
    void audit('admin.settings', { admin: ctx.user?.email, change })
    return { json: { settings: await updateSettings(change) } }
  },

  /* ───────────── The learner's own ───────────── */

  'GET /me/quota': async (_req, ctx) => {
    if (!ctx.user) throw new ApiError(401, 'Not logged in.')
    return { json: { ...(await quotaStatus(ctx.rootDir, ctx.user.id)), unlimited: ctx.user.role === 'admin' } }
  },

  'GET /me/export': async (_req, ctx) => {
    if (!ctx.user || ctx.user.viewAs) throw new ApiError(403, 'Không xuất được ở chế độ xem.')
    void audit('user.export', { email: ctx.user.email })
    return { body: await exportFolder(ctx.user.id), contentType: 'application/gzip', headers: { 'Content-Disposition': 'attachment; filename="english-my-data.tar.gz"' } }
  },

  /** Body `{ password }` → `{ ok }`: deletes the caller's own account (learners only). */
  'POST /me/delete': async (req) => {
    const user = await authenticate(req.incoming)
    if (!user) throw new ApiError(401, 'Not logged in.')
    if (user.role === 'admin') throw new ApiError(400, 'Tài khoản admin không tự xóa được.')
    if (!(await verifyPassword(str(body(req).password), user.passwordHash))) throw new ApiError(400, 'Mật khẩu không đúng.')
    await deleteUserSessions(user.id)
    await retireFolder(user.id)
    await removeUser(user.id)
    void audit('user.delete', { email: user.email })
    return { json: { ok: true } }
  },
}
