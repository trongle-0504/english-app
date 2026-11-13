// Accounts (data/auth/users.json). The admin (the owner) and learners. A learner signs up at /register (status
// "pending" until the admin approves) or is added by the admin (active at once, must change the given password).
import { randomUUID } from 'node:crypto'
import { hashPassword } from './password.ts'
import { readAuthFile, updateAuthFile } from './store.ts'

export interface User {
  id: string
  email: string
  passwordHash: string
  role: UserRole
  disabled?: boolean
  /** Sign-up state (multi-user app). Missing = active (accounts made before sign-up existed). */
  status?: UserStatus
  displayName?: string
  /** What the person wrote in the sign-up form ("who told you about the app", target band). */
  signupNote?: string
  /** Set when the admin made the password: the next login must change it. */
  mustChangePassword?: boolean
  /** Devices this account has logged in from (learners: at most MAX_DEVICES). */
  devices?: Device[]
  /** Per-account limits; missing fields use the defaults (server/users/quota.ts). */
  quota?: Partial<Quota>
  approvedAt?: string
  /** Learner removed a device themself (once a week). */
  deviceRemovedAt?: string
  /** "Forgot password" pressed on the login page: waiting for the admin's reset link. */
  resetRequestedAt?: string
  /** Two-factor (server/auth/totp.ts): the encrypted TOTP secret once enabled; `totpPending` while setting up. */
  totpSecret?: string
  totpPending?: string
  /** Last accepted time step: a code works only once. */
  totpLastStep?: number
  /** SHA-256 of each unused recovery code. */
  recoveryHashes?: string[]
  createdAt: string
}

export type UserRole = 'admin' | 'learner'
export type UserStatus = 'pending' | 'active' | 'rejected'

export interface Device {
  /** SHA-256 of the device cookie. */
  idHash: string
  label: string
  firstSeen: string
  lastSeen: string
  lastIp: string
  lastCountry?: string
}

export interface Quota {
  writingPerDay: number
  speakingPerDay: number
  lightPerDay: number
  novaPerDay: number
  agyCallsPerDay: number
  storageMb: number
}

/** What the API may send to the browser. */
export type PublicUser = Pick<User, 'id' | 'email' | 'role'> & {
  twoFactor: boolean
  status: UserStatus
  displayName: string
  mustChangePassword: boolean
}

const FILE = 'users.json'

export const normalizeEmail = (email: string) => email.trim().toLowerCase()
export const statusOf = (u: Pick<User, 'status'>): UserStatus => u.status ?? 'active'
export const publicUser = (u: User): PublicUser => ({
  id: u.id,
  email: u.email,
  role: u.role,
  twoFactor: Boolean(u.totpSecret),
  status: statusOf(u),
  displayName: u.displayName || u.email.split('@')[0],
  mustChangePassword: Boolean(u.mustChangePassword),
})

export const listUsers = () => readAuthFile<User[]>(FILE, [])

export async function findByEmail(email: string): Promise<User | undefined> {
  const wanted = normalizeEmail(email)
  return (await listUsers()).find((u) => u.email === wanted)
}

export async function findById(id: string): Promise<User | undefined> {
  return (await listUsers()).find((u) => u.id === id)
}

export interface NewUserOptions {
  role?: UserRole
  status?: UserStatus
  displayName?: string
  signupNote?: string
  mustChangePassword?: boolean
}

/** The first account (the owner) is the admin; later ones are learners unless `role` says otherwise. */
export async function createUser(email: string, password: string, options: NewUserOptions = {}): Promise<User> {
  const first = (await listUsers()).length === 0
  const user: User = {
    id: randomUUID(),
    email: normalizeEmail(email),
    passwordHash: await hashPassword(password),
    role: options.role ?? (first ? 'admin' : 'learner'),
    createdAt: new Date().toISOString(),
    ...(options.status && options.status !== 'active' ? { status: options.status } : {}),
    ...(options.displayName ? { displayName: options.displayName } : {}),
    ...(options.signupNote ? { signupNote: options.signupNote } : {}),
    ...(options.mustChangePassword ? { mustChangePassword: true } : {}),
  }
  await updateAuthFile<User[]>(FILE, [], (users) => {
    if (users.some((u) => u.email === user.email)) throw new Error(`An account for ${user.email} already exists.`)
    return [...users, user]
  })
  return user
}

export async function setPassword(id: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password)
  await updateAuthFile<User[]>(FILE, [], (users) => users.map((u) => (u.id === id ? { ...u, passwordHash } : u)))
}

export async function setDisabled(id: string, disabled: boolean): Promise<void> {
  await updateAuthFile<User[]>(FILE, [], (users) => users.map((u) => (u.id === id ? { ...u, disabled } : u)))
}

/** Changes one account in place (two-factor fields). */
export async function updateUser(id: string, change: (user: User) => User): Promise<void> {
  await updateAuthFile<User[]>(FILE, [], (users) => users.map((u) => (u.id === id ? change(u) : u)))
}

/** Deletes the account record (its folder is moved away by the caller). */
export async function removeUser(id: string): Promise<void> {
  await updateAuthFile<User[]>(FILE, [], (users) => users.filter((u) => u.id !== id))
}
