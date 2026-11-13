// The two-device limit for learners (PLAN-multi-user-v2.md, 6.1). A device is a long-lived random cookie; the account
// remembers the SHA-256 of each one it logged in from. A learner's third device is refused (not swapped in for an old
// one: two people sharing an account could otherwise take turns). The admin has no limit and can remove devices.
import { createHash, randomBytes } from 'node:crypto'
import { ApiError, type ApiRequest } from '../api.ts'
import { clientIp, isHttps, readCookie } from './middleware.ts'
import { updateUser, type User } from './users.ts'

export const DEVICE_COOKIE = 'em_device'
export const maxDevices = () => Number(process.env.MAX_DEVICES) || 2
export const hashDevice = (token: string) => createHash('sha256').update(token).digest('hex')

/** A short label from the User-Agent ("iPhone · Safari", "Windows · Chrome"). */
export function deviceLabel(userAgent: string): string {
  const os = /iPhone|iPad/.test(userAgent) ? 'iPhone/iPad' : /Android/.test(userAgent) ? 'Android' : /Windows/.test(userAgent) ? 'Windows' : /Mac OS X/.test(userAgent) ? 'Mac' : /Linux/.test(userAgent) ? 'Linux' : 'Thiết bị'
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /CriOS|Chrome\//.test(userAgent) ? 'Chrome' : /FxiOS|Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : ''
  return browser ? `${os} · ${browser}` : os
}

export interface AdmittedDevice {
  hash: string
  /** Set-Cookie for a device seen for the first time. */
  cookie?: string
}

/**
 * Called after the password (and code) were right, before the session is made. Records the device on the account,
 * or refuses with 403 when a learner already has `maxDevices()` others.
 */
export async function admitDevice(req: ApiRequest, user: User): Promise<AdmittedDevice> {
  let token = readCookie(req.incoming, DEVICE_COOKIE)
  let cookie: string | undefined
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) {
    token = randomBytes(24).toString('base64url')
    const parts = [`${DEVICE_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${365 * 24 * 3600}`]
    if (isHttps(req.incoming)) parts.push('Secure')
    cookie = parts.join('; ')
  }
  const hash = hashDevice(token)
  const known = (user.devices ?? []).some((d) => d.idHash === hash)
  if (!known && user.role !== 'admin' && (user.devices ?? []).length >= maxDevices()) {
    throw new ApiError(
      403,
      `Tài khoản này đã đăng nhập trên ${maxDevices()} thiết bị. Gỡ một thiết bị trong trang Tài khoản (trên thiết bị cũ) hoặc nhờ admin gỡ giúp.`,
    )
  }
  const now = new Date().toISOString()
  const ip = clientIp(req.incoming)
  const country = String(req.headers['cf-ipcountry'] ?? '') || undefined
  const label = deviceLabel(String(req.headers['user-agent'] ?? ''))
  await updateUser(user.id, (u) => {
    const devices = [...(u.devices ?? [])]
    const i = devices.findIndex((d) => d.idHash === hash)
    if (i >= 0) devices[i] = { ...devices[i], lastSeen: now, lastIp: ip, ...(country ? { lastCountry: country } : {}) }
    else devices.push({ idHash: hash, label, firstSeen: now, lastSeen: now, lastIp: ip, ...(country ? { lastCountry: country } : {}) })
    return { ...u, devices }
  })
  return { hash, cookie }
}

/** The current device's hash (to mark it in the device list), or ''. */
export function currentDeviceHash(req: ApiRequest): string {
  const token = readCookie(req.incoming, DEVICE_COOKIE)
  return token ? hashDevice(token) : ''
}
