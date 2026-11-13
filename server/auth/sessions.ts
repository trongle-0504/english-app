// Login sessions (data/auth/sessions.json). The browser holds a random token in an HttpOnly cookie; only its SHA-256
// is stored, so a leaked sessions.json cannot be replayed. Sessions last SESSION_TTL_DAYS (30) from login.
import { createHash, randomBytes } from 'node:crypto'
import { readAuthFile, updateAuthFile } from './store.ts'

interface Session {
  tokenHash: string
  userId: string
  /** SHA-256 of the device cookie the session was made on (multi-user device limit). */
  deviceHash?: string
  createdAt: string
  expiresAt: string
}

const FILE = 'sessions.json'
export const COOKIE = 'lt_session'

export const sessionTtlMs = () => (Number(process.env.SESSION_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const live = (s: Session) => Date.parse(s.expiresAt) > Date.now()

export async function createSession(userId: string, deviceHash?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  const session: Session = {
    tokenHash: hashToken(token),
    userId,
    ...(deviceHash ? { deviceHash } : {}),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + sessionTtlMs()).toISOString(),
  }
  // Expired sessions are dropped whenever a new one is written.
  await updateAuthFile<Session[]>(FILE, [], (all) => [...all.filter(live), session])
  return token
}

/** The user id behind a cookie token, or null when it is unknown or expired. */
export async function sessionUserId(token: string): Promise<string | null> {
  if (!token) return null
  const tokenHash = hashToken(token)
  const session = (await readAuthFile<Session[]>(FILE, [])).find((s) => s.tokenHash === tokenHash)
  return session && live(session) ? session.userId : null
}

export async function deleteSession(token: string): Promise<void> {
  const tokenHash = hashToken(token)
  await updateAuthFile<Session[]>(FILE, [], (all) => all.filter((s) => s.tokenHash !== tokenHash && live(s)))
}

/** Signs a user out everywhere (password reset, account disabled). */
export async function deleteUserSessions(userId: string): Promise<void> {
  await updateAuthFile<Session[]>(FILE, [], (all) => all.filter((s) => s.userId !== userId && live(s)))
}

/** Signs one device of a user out (the device was removed from the account). */
export async function deleteDeviceSessions(userId: string, deviceHash: string): Promise<void> {
  await updateAuthFile<Session[]>(FILE, [], (all) => all.filter((s) => !(s.userId === userId && s.deviceHash === deviceHash) && live(s)))
}
