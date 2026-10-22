// Accounts (data/auth/users.json). Supports 'admin' (full access + shared library management) and 'learner' (personal data only).
import { randomUUID } from 'node:crypto'
import { hashPassword } from './password.ts'
import { readAuthFile, updateAuthFile } from './store.ts'

export type UserRole = 'admin' | 'learner'

export interface User {
  id: string
  email: string
  passwordHash: string
  role: UserRole
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

export async function createUser(email: string, password: string, role: UserRole = 'learner'): Promise<User> {
  const passwordHash = await hashPassword(password)
  let created!: User
  await updateAuthFile<User[]>(FILE, [], (users) => {
    const normalized = normalizeEmail(email)
    if (users.some((u) => u.email === normalized)) throw new Error(`An account for ${normalized} already exists.`)
    created = {
      id: randomUUID(),
      email: normalized,
      passwordHash,
      role,
      createdAt: new Date().toISOString(),
    }
    return [...users, created]
  })
  return created
}

export async function setPassword(id: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password)
  await updateAuthFile<User[]>(FILE, [], (users) => users.map((u) => (u.id === id ? { ...u, passwordHash } : u)))
}

export async function setDisabled(id: string, disabled: boolean): Promise<void> {
  await updateAuthFile<User[]>(FILE, [], (users) => users.map((u) => (u.id === id ? { ...u, disabled } : u)))
}

export async function setRole(id: string, role: UserRole): Promise<void> {
  await updateAuthFile<User[]>(FILE, [], (users) => users.map((u) => (u.id === id ? { ...u, role } : u)))
}
