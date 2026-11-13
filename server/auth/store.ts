// Accounts and sessions live in data/auth/ (DATA_DIR overrides data/): outside content/ and dist/, never served.
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { readJsonFile, writeJsonFile } from '../files.ts'

export const dataDir = () => path.resolve(process.env.DATA_DIR || path.join(import.meta.dirname, '..', '..', 'data'))
export const authFile = (name: string) => path.join(dataDir(), 'auth', name)

// Kept on globalThis: the dev server reloads server modules in-process.
const shared = ((globalThis as { __authStore?: { queues: Map<string, Promise<unknown>>; cache: Map<string, { mtimeMs: number; value: unknown }> } })
  .__authStore ??= { queues: new Map(), cache: new Map() })

/**
 * Every /api and /data request checks the session, so reads are cached — but only until the file changes: the
 * `scripts/user.ts` CLI writes these files from another process (a password reset must end sessions at once).
 */
export async function readAuthFile<T>(name: string, fallback: T): Promise<T> {
  const file = authFile(name)
  const mtimeMs = await stat(file).then((s) => s.mtimeMs, () => -1)
  const hit = shared.cache.get(file)
  if (hit && hit.mtimeMs === mtimeMs) return hit.value as T
  const value = mtimeMs < 0 ? fallback : await readJsonFile<T>(file, fallback)
  shared.cache.set(file, { mtimeMs, value })
  return value
}

/** Read-modify-write of one JSON file in data/auth/, one at a time: writeJsonFile's temp name is per process. */
export function updateAuthFile<T>(name: string, fallback: T, update: (value: T) => T | Promise<T>): Promise<T> {
  const file = authFile(name)
  const run = async () => {
    const next = await update(await readJsonFile<T>(file, fallback))
    // Accounts and sessions: readable by this user only.
    await writeJsonFile(file, next, 0o600)
    shared.cache.delete(file)
    return next
  }
  const result = (shared.queues.get(file) ?? Promise.resolve()).then(run)
  shared.queues.set(file, result.catch(() => {}))
  return result
}
