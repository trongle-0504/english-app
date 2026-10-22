// Review progress on disk: <userDir>/progress/review.json (settings + card states) and <userDir>/progress/review-log.jsonl
// (one line per review, append-only). Isolated per user and outside content/ so grading never triggers a content rebuild.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { newSchedulerCard, studyDay } from '../../src/features/review/schedule.ts'
import { DEFAULT_REVIEW_SETTINGS, type ReviewLogEntry, type ReviewSettings, type ReviewStateDoc, type UsageLogEntry } from '../../src/types/review.ts'
import type { ApiContext } from '../api.ts'
import { readJsonFile, writeJsonFile } from '../files.ts'
import { userPath, withUserLock } from '../paths.ts'

const dir = (ctx: ApiContext) => userPath(ctx, 'progress')
const stateFile = (ctx: ApiContext) => userPath(ctx, 'progress', 'review.json')
const logFile = (ctx: ApiContext) => userPath(ctx, 'progress', 'review-log.jsonl')
const usageLogFile = (ctx: ApiContext) => userPath(ctx, 'progress', 'usage-log.jsonl')

export const CARD_ID = /^(vocab|colloc|wcolloc|note|custom|essay):[a-z0-9:/_-]+$/

/** Serialises every read-modify-write of a user's progress files without blocking other users. */
export function withProgress<T>(ctx: ApiContext, task: () => Promise<T>): Promise<T> {
  return withUserLock(ctx.user.id, 'review-progress', task)
}

export async function readState(ctx: ApiContext): Promise<ReviewStateDoc> {
  const doc = await readJsonFile<Partial<ReviewStateDoc>>(stateFile(ctx), {})
  return {
    version: 1,
    settings: { ...DEFAULT_REVIEW_SETTINGS, ...doc.settings },
    cards: doc.cards ?? {},
  }
}

export async function writeState(ctx: ApiContext, state: ReviewStateDoc): Promise<void> {
  await writeJsonFile(stateFile(ctx), state)
}

export async function readLog(ctx: ApiContext): Promise<ReviewLogEntry[]> {
  let text = ''
  try {
    text = await readFile(logFile(ctx), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const entries: ReviewLogEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line) as ReviewLogEntry)
    } catch {
      // A torn last line (crash mid-write) is skipped rather than breaking stats.
    }
  }
  return entries
}

export async function appendLog(ctx: ApiContext, entry: ReviewLogEntry): Promise<void> {
  await mkdir(dir(ctx), { recursive: true })
  await appendFile(logFile(ctx), `${JSON.stringify(entry)}\n`)
}

/** Practice answers, kept apart from the review log (they do not touch the schedule or the review stats). */
export async function appendUsageLog(ctx: ApiContext, entry: UsageLogEntry): Promise<void> {
  await mkdir(dir(ctx), { recursive: true })
  await appendFile(usageLogFile(ctx), `${JSON.stringify(entry)}\n`)
}

/** Rewrites the log without its last entry (undo). */
export async function dropLastLog(ctx: ApiContext, entries: ReviewLogEntry[]): Promise<void> {
  const kept = entries.slice(0, -1)
  await mkdir(dir(ctx), { recursive: true })
  await writeFile(logFile(ctx), kept.map((e) => `${JSON.stringify(e)}\n`).join(''))
}

/** Adds cards (as new) to reviews; returns how many were not there yet. `learnToday` puts them in today's session. */
export function addCards(ctx: ApiContext, ids: string[], { learnToday = false }: { learnToday?: boolean } = {}): Promise<number> {
  return withProgress(ctx, async () => {
    const state = await readState(ctx)
    const now = new Date()
    const learnDay = learnToday ? today(state.settings, now) : undefined
    let added = 0
    for (const id of ids) {
      if (!CARD_ID.test(id) || state.cards[id]) continue
      // Stagger `added` by a millisecond so new cards are introduced in the order given.
      state.cards[id] = { added: new Date(now.getTime() + added).toISOString(), fsrs: newSchedulerCard(now), ...(learnDay ? { learnDay } : {}) }
      added++
    }
    if (added) await writeState(ctx, state)
    return added
  })
}

/** Used by the admin editors: adds saved entries (to be learned today) when "auto add" is on. Never throws. */
export async function autoAddFromAdmin(ctx: ApiContext, ids: string[]): Promise<void> {
  try {
    const { settings } = await readState(ctx)
    if (settings.autoAddFromAdmin) await addCards(ctx, ids, { learnToday: true })
  } catch (error) {
    console.warn('[review] auto-add failed:', (error as Error).message)
  }
}

export function today(settings: ReviewSettings, now = new Date()): string {
  return studyDay(now, settings)
}
