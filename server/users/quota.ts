// Daily AI limits per account (PLAN-multi-user-v2.md, 6.2): Writing 5 essays, Speaking 30 questions, 50 lighter AI
// actions, 50 Nova questions a day, and a hidden cap on real agy calls. Counted when the work is started (the route),
// given back when the start itself failed for a server reason. The admin has no limit.
import path from 'node:path'
import { ApiError, type ApiContext } from '../api.ts'
import { readJsonFile, writeJsonFile } from '../files.ts'
import { findById, type Quota } from '../auth/users.ts'
import { currentUserId } from './context.ts'
import { readSettings } from './settings.ts'

export type QuotaKind = 'writing' | 'speaking' | 'light' | 'nova'

const LIMIT_KEY: Record<QuotaKind, keyof Quota> = {
  writing: 'writingPerDay',
  speaking: 'speakingPerDay',
  light: 'lightPerDay',
  nova: 'novaPerDay',
}

export const QUOTA_LABEL: Record<QuotaKind, string> = {
  writing: 'bài Writing',
  speaking: 'lượt Speaking',
  light: 'lượt AI',
  nova: 'câu hỏi Nova',
}

/** Which routes start AI work, of which kind, and how many units one call costs. */
export function quotaFor(routeKey: string, body: unknown): { kind: QuotaKind; units: number } | null {
  const b = (body ?? {}) as Record<string, unknown>
  switch (routeKey) {
    case 'POST /writing-review':
    case 'POST /writing-task1/prepare':
      return { kind: 'writing', units: 1 }
    case 'POST /speaking':
      return { kind: 'speaking', units: Math.max(1, Array.isArray(b.questions) ? b.questions.length : 1) }
    case 'POST /speaking-review':
    case 'POST /speaking-review/retry':
    case 'POST /speaking-review/model':
      return { kind: 'speaking', units: 1 }
    case 'POST /coach/turn':
      return { kind: 'nova', units: 1 }
    case 'POST /analyze':
    case 'POST /notepad/format':
    case 'POST /translate':
    case 'POST /idea/format':
    case 'POST /listening/simplify':
    case 'POST /listening/simplify/read-image':
    case 'POST /review/produce':
    case 'POST /review/custom/generate':
    case 'POST /essays/rebuild':
    case 'POST /essays/transfer':
    case 'POST /speaking/analyze-edit':
    case 'POST /writing-review/analyze-edit':
    case 'POST /writing-review/task1/compare':
    case 'POST /planner/quick-add':
    case 'POST /planner/brief':
    case 'POST /planner/reschedule':
    case 'POST /planner/week/draft':
    case 'POST /admin/vocabulary/generate':
    case 'POST /admin/notes/generate':
    case 'POST /admin/drills/item':
      return { kind: 'light', units: 1 }
    default:
      return null
  }
}

interface DayCounts {
  day: string
  counts: Partial<Record<QuotaKind | 'agy', number>>
}

const vnDay = (d = new Date()) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
const fileOf = (rootDir: string) => path.join(rootDir, 'progress', 'quota.json')

// Read-modify-write of one account's counter file, one at a time per file.
const queues = ((globalThis as { __quotaQueues?: Map<string, Promise<unknown>> }).__quotaQueues ??= new Map())
function update<T>(file: string, fn: (doc: DayCounts) => T): Promise<T> {
  const run = async () => {
    const saved = await readJsonFile<DayCounts>(file, { day: vnDay(), counts: {} })
    const doc = saved.day === vnDay() ? saved : { day: vnDay(), counts: {} }
    const out = fn(doc)
    await writeJsonFile(file, doc)
    return out
  }
  const next = (queues.get(file) ?? Promise.resolve()).then(run, run)
  queues.set(file, next.catch(() => {}))
  return next
}

export async function limitsOf(uid: string): Promise<Quota> {
  const [settings, user] = await Promise.all([readSettings(), findById(uid)])
  return { ...settings.quota, ...(user?.quota ?? {}) }
}

/** Today's use and limits of an account (GET /me/quota, Admin → Users). */
export async function quotaStatus(rootDir: string, uid: string) {
  const [saved, limits] = await Promise.all([readJsonFile<DayCounts>(fileOf(rootDir), { day: vnDay(), counts: {} }), limitsOf(uid)])
  const counts = saved.day === vnDay() ? saved.counts : {}
  return {
    day: vnDay(),
    used: { writing: counts.writing ?? 0, speaking: counts.speaking ?? 0, light: counts.light ?? 0, nova: counts.nova ?? 0, agy: counts.agy ?? 0 },
    limits: { writing: limits.writingPerDay, speaking: limits.speakingPerDay, light: limits.lightPerDay, nova: limits.novaPerDay },
  }
}

/**
 * Takes `units` of `kind` from today's allowance or throws 429. Returns a refund function. Admin and view-as never
 * reach here (the API only charges a learner's own request).
 */
export async function charge(ctx: ApiContext, kind: QuotaKind, units: number): Promise<() => Promise<void>> {
  const uid = ctx.user?.id
  if (!uid || ctx.user?.role === 'admin') return async () => {}
  const limit = (await limitsOf(uid))[LIMIT_KEY[kind]]
  const file = fileOf(ctx.rootDir)
  await update(file, (doc) => {
    const used = doc.counts[kind] ?? 0
    if (used + units > limit) {
      throw new ApiError(429, `Hôm nay bạn đã dùng hết ${limit} ${QUOTA_LABEL[kind]}${used < limit ? ` (yêu cầu này cần ${units}, còn ${limit - used})` : ''}. Hạn mức mới bắt đầu lúc 0:00.`)
    }
    doc.counts[kind] = used + units
  })
  return async () => {
    await update(file, (doc) => {
      doc.counts[kind] = Math.max(0, (doc.counts[kind] ?? 0) - units)
    })
  }
}

/** Learner accounts of the multi-user app: the folder whose counter a running agy call is charged to. */
const agyRoots = ((globalThis as { __agyRoots?: Map<string, { root: string; admin: boolean }> }).__agyRoots ??= new Map())
export function rememberAccountRoot(uid: string, root: string, admin: boolean) {
  agyRoots.set(uid, { root, admin })
}

/**
 * The hidden cap on real agy calls per account per day (a "1 unit" action that turns into many calls cannot run up
 * the shared subscription). Called before each agy call; counts it.
 */
export async function chargeAgyCall(): Promise<void> {
  const uid = currentUserId()
  const account = uid ? agyRoots.get(uid) : undefined
  if (!uid || !account || account.admin) return
  const cap = (await limitsOf(uid)).agyCallsPerDay
  await update(fileOf(account.root), (doc) => {
    const used = doc.counts.agy ?? 0
    if (used >= cap) throw new ApiError(429, 'Hôm nay tài khoản đã dùng hết lượt AI. Hạn mức mới bắt đầu lúc 0:00.')
    doc.counts.agy = used + 1
  })
}
