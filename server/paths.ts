import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'
import { ApiError } from './api.ts'
import { dataDir } from './auth/store.ts'

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

function assertSafeSegment(segment: string, label: string): void {
  if (!segment || segment === '.' || segment === '..' || !SAFE_SEGMENT.test(segment)) {
    throw new ApiError(400, `Invalid ${label}.`)
  }
}

/** Root directory for a specific user's personal data: <dataDir>/users/<uid>. */
export function userRootDir(uid: string): string {
  assertSafeSegment(uid, 'user id')
  const base = path.resolve(dataDir(), 'users')
  const resolved = path.resolve(base, uid)
  if (!resolved.startsWith(base + path.sep)) {
    throw new ApiError(400, 'Invalid user directory.')
  }
  return resolved
}

/**
 * Resolves a path inside the logged-in user's personal directory (<dataDir>/users/<uid>/...).
 * Every path segment is validated against traversal and illegal characters.
 */
export function userPath(ctx: { userDir?: string }, ...parts: string[]): string {
  if (!ctx.userDir) throw new ApiError(401, 'Not logged in.')
  const base = path.resolve(ctx.userDir)
  const segments: string[] = []
  for (const part of parts) {
    for (const seg of String(part).split(/[\\/]+/)) {
      if (!seg) continue
      assertSafeSegment(seg, 'path segment')
      segments.push(seg)
    }
  }
  const resolved = path.resolve(base, ...segments)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new ApiError(400, 'Invalid user path.')
  }
  return resolved
}

/** Resolves a path inside the shared content directory (content/...). */
export function sharedPath(ctx: { contentDir: string }, ...parts: string[]): string {
  const base = path.resolve(ctx.contentDir)
  const resolved = path.resolve(base, ...parts)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new ApiError(400, 'Invalid shared content path.')
  }
  return resolved
}

// Per-user + per-resource promise queue, kept on globalThis so dev-server module reloads preserve active locks.
const userLocks = ((globalThis as { __userLocks?: Map<string, Promise<unknown>> }).__userLocks ??= new Map())

/** Serializes read-modify-write operations per (userId, key) without blocking other users. */
export function withUserLock<T>(uid: string, key: string, fn: () => Promise<T>): Promise<T> {
  assertSafeSegment(uid, 'user id')
  const lockKey = `${uid}:${key}`
  const prev = userLocks.get(lockKey) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  const tail = next.then(
    () => undefined,
    () => undefined,
  )
  userLocks.set(lockKey, tail)
  tail.finally(() => {
    if (userLocks.get(lockKey) === tail) userLocks.delete(lockKey)
  })
  return next
}

export interface RequestStore {
  userId?: string
  userDir?: string
}

/** Carries the active request's userId and userDir into deep helpers (such as Gemini usage logging). */
export const requestContext = new AsyncLocalStorage<RequestStore>()
