// Accounts (data/auth/users.json). For now there is one account, the owner's, created with `node scripts/user.ts`;
// every account is an admin until data is split per user (PLAN-multi-user.md, Phase 2).
import { randomUUID } from 'node:crypto'
import { hashPassword } from './password.ts'
import { readAuthFile, updateAuthFile } from './store.ts'

export interface User {
  id: string
  email: string
  passwordHash: string
  role: 'admin'
  disabled?: boolean
  createdAt: string
}

/** What the API may send to the browser. */
export type PublicUser = Pick<User, 'id' | 'email' | 'role'>

const FILE = 'users.json'

export const normalizeEmail = (email: string) => email.trim().toLowerCase()
export const publicUser = ({ id, email, role }: User): PublicUser => ({ id, email, role })

export const listUsers = () => readAuthFile<User[]>(FILE, [])

export async function findByEmail(email: string): Promise<User | undefined> {
  const wanted = normalizeEmail(email)
  return (await listUsers()).find((u) => u.email === wanted)
}

export async function findById(id: string): Promise<User | undefined> {
  return (await listUsers()).find((u) => u.id === id)
}

export async function createUser(email: string, password: string): Promise<User> {
  const user: User = { id: randomUUID(), email: normalizeEmail(email), passwordHash: await hashPassword(password), role: 'admin', createdAt: new Date().toISOString() }
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
