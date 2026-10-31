import path from 'node:path'
import { authenticate } from '../auth/middleware.ts'
import { readJsonFile, writeJsonFile } from '../files.ts'
import { ApiError, type ApiHandler } from '../api.ts'

type StoredAttempt = {
  setId: string
  updatedAt: string
  session: unknown
  results: Record<string, unknown>
  durations: Record<string, number>
}
type StoredAttempts = Record<string, StoredAttempt>

const fileOf = (rootDir: string, userId: string) => path.join(rootDir, 'progress', 'speaking-mock', `${userId}.json`)

function attemptsBody(body: unknown): StoredAttempts {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Invalid attempts payload.')
  const attempts = (body as { attempts?: unknown }).attempts
  if (!attempts || typeof attempts !== 'object' || Array.isArray(attempts)) throw new ApiError(400, 'Invalid attempts payload.')
  const entries = Object.entries(attempts)
  if (entries.length > 500) throw new ApiError(400, 'Too many saved attempts.')
  for (const [key, value] of entries) {
    if (!/^[a-z0-9_-]{1,160}$/i.test(key) || !value || typeof value !== 'object') {
      throw new ApiError(400, 'Invalid saved attempt.')
    }
  }
  return attempts as StoredAttempts
}

export const speakingMockRoutes: Record<string, ApiHandler> = {
  'GET /speaking-mock/attempts': async (req, ctx) => {
    const user = await authenticate(req.incoming)
    if (!user) throw new ApiError(401, 'Not logged in.')
    return { json: { attempts: await readJsonFile<StoredAttempts>(fileOf(ctx.rootDir, user.id), {}) } }
  },

  'PUT /speaking-mock/attempts': async (req, ctx) => {
    const user = await authenticate(req.incoming)
    if (!user) throw new ApiError(401, 'Not logged in.')
    const incoming = attemptsBody(req.body)
    const file = fileOf(ctx.rootDir, user.id)
    const current = await readJsonFile<StoredAttempts>(file, {})
    const merged = { ...current }
    for (const [key, attempt] of Object.entries(incoming)) {
      if (!merged[key] || attempt.updatedAt >= merged[key].updatedAt) merged[key] = attempt
    }
    await writeJsonFile(file, merged)
    return { json: { ok: true, attempts: merged } }
  },
}
