// Coach chats on disk: progress/coach/sessions/<id>.json, one file per chat, written atomically.
import { randomBytes } from 'node:crypto'
import { readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { CoachSession, CoachSessionSummary } from '../../src/types/coach.ts'
import { updateJsonDoc } from '../admin/store.ts'

export const sessionsDir = (rootDir: string) => path.join(rootDir, 'progress', 'coach', 'sessions')
export const validSessionId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9]{12,40}$/.test(id)
const fileOf = (rootDir: string, id: string) => path.join(sessionsDir(rootDir), `${id}.json`)

export const newSessionId = () => randomBytes(9).toString('hex')

export async function readSession(rootDir: string, id: string): Promise<CoachSession | null> {
  if (!validSessionId(id)) return null
  try {
    return JSON.parse(await readFile(fileOf(rootDir, id), 'utf8')) as CoachSession
  } catch {
    return null
  }
}

/** Atomic read-modify-write; `create` is used when the file does not exist yet. */
export function updateSession<R>(rootDir: string, id: string, create: CoachSession | null, update: (s: CoachSession) => R): Promise<R> {
  return updateJsonDoc<CoachSession | null, R>(fileOf(rootDir, id), create, (doc) => {
    if (!doc) throw new Error('Chat not found.')
    return update(doc)
  })
}

/** Every saved chat (for the Admin stats). */
export async function allSessions(rootDir: string): Promise<CoachSession[]> {
  let names: string[]
  try {
    names = (await readdir(sessionsDir(rootDir))).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  return (await Promise.all(names.map((n) => readSession(rootDir, n.slice(0, -5))))).filter((s): s is CoachSession => Boolean(s))
}

export async function listSessions(rootDir: string, limit = 50): Promise<CoachSessionSummary[]> {
  let names: string[]
  try {
    names = (await readdir(sessionsDir(rootDir))).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const list = await Promise.all(names.map((n) => readSession(rootDir, n.slice(0, -5))))
  return list
    .filter((s): s is CoachSession => Boolean(s))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, turns: s.turns.length }))
}

export async function deleteSession(rootDir: string, id: string): Promise<boolean> {
  if (!validSessionId(id)) return false
  try {
    await rm(fileOf(rootDir, id))
    return true
  } catch {
    return false
  }
}

/** Sessions whose last message is older than `days` (retention). */
export async function expiredSessions(rootDir: string, days: number, now = new Date()): Promise<CoachSession[]> {
  let names: string[]
  try {
    names = (await readdir(sessionsDir(rootDir))).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const cutoff = now.getTime() - days * 86_400_000
  const list = await Promise.all(names.map((n) => readSession(rootDir, n.slice(0, -5))))
  return list.filter((s): s is CoachSession => Boolean(s) && Date.parse(s!.updatedAt) < cutoff)
}
