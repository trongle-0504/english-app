// Data access for the coach tools: VN-day helpers, size-capped results, and cached readers of the saved reviews.
// Reviews are read once and kept until their file changes (the Speaking folder is ~43 MB with audio word lists).
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { vnDay } from '../../src/features/planner/dates.ts'
import type { TalkReviewResult } from '../../src/types/speakingReview.ts'
import type { SpeakingResult } from '../../src/types/speaking.ts'
import type { WritingReviewResult } from '../../src/types/writingReview.ts'
import type { CoachProposal, CoachProposalItem, CoachProposalKind } from '../../src/types/coach.ts'

/** What a propose_* tool hands to the chat (the service adds id, status and time). */
export interface ProposalDraft {
  kind: CoachProposalKind
  title: string
  items: CoachProposalItem[]
  notes?: string[]
}

/** What every tool gets: the app folders and "now" (fixed in tests and in the eval). */
export interface ToolContext {
  rootDir: string
  contentDir: string
  now: Date
  /** Stores a proposal on the chat's running turn (only inside a coach turn). */
  propose?: (draft: ProposalDraft) => CoachProposal
}

/** VN calendar day of an ISO time ("2026-11-07T23:30Z" → "2026-11-08"). */
export const dayOf = (iso: string): string => vnDay(new Date(iso))

/** VN wall-clock HH:mm of an ISO time. */
export const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/^24/, '00')

export const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** A day range check; both ends optional and inclusive. */
export const inRange = (day: string, from?: string, to?: string) => (!from || day >= from) && (!to || day <= to)

/** Cut to `max` characters with "…". */
export function cut(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

export class ToolError extends Error {}

/**
 * Result cap (~1k tokens). agy returns ≤ 10 KB inline; we stay far lower, but not so low that the model needs extra
 * pages: each extra model call costs ~10k tokens of fixed prompt, far more than a slightly bigger result.
 */
export const MAX_RESULT_CHARS = 4000

/**
 * Shrinks a result until its JSON fits `max` characters: the longest array loses items from the end (and the result
 * says `truncated: true`). Always returns valid JSON. Pure (tested).
 */
export function fit(value: Record<string, unknown>, max = MAX_RESULT_CHARS): Record<string, unknown> {
  const copy = structuredClone(value)
  let size = JSON.stringify(copy).length
  for (let guard = 0; size > max && guard < 500; guard++) {
    const arrays: unknown[][] = []
    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        if (node.length) arrays.push(node)
        node.forEach(walk)
      } else if (node && typeof node === 'object') Object.values(node).forEach(walk)
    }
    walk(copy)
    if (!arrays.length) break
    const longest = arrays.reduce((a, b) => (JSON.stringify(b).length > JSON.stringify(a).length ? b : a))
    longest.pop()
    copy.truncated = true
    size = JSON.stringify(copy).length
  }
  return copy
}

/** Ids of saved reviews: what the review pages use. Anything else is refused before touching the disk. */
export const validWorkId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9-]{6,40}$/.test(id)

/* ───────────── Cached readers ───────────── */

interface Cached<T> {
  mtimeMs: number
  doc: T
}

const caches = new Map<string, Map<string, Cached<unknown>>>()

/** Every JSON file of a folder, parsed; a file is re-read only when its mtime changes. `slim` drops heavy fields. */
async function readFolder<T>(dir: string, slim: (doc: T) => T = (d) => d): Promise<T[]> {
  let names: string[]
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const cache = (caches.get(dir) ?? new Map()) as Map<string, Cached<T>>
  caches.set(dir, cache as Map<string, Cached<unknown>>)
  const docs = await Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name)
      try {
        const { mtimeMs } = await stat(file)
        const hit = cache.get(name)
        if (hit && hit.mtimeMs === mtimeMs) return hit.doc
        const doc = slim(JSON.parse(await readFile(file, 'utf8')) as T)
        cache.set(name, { mtimeMs, doc })
        return doc
      } catch {
        return null
      }
    }),
  )
  for (const name of cache.keys()) if (!names.includes(name)) cache.delete(name)
  return docs.filter((d): d is NonNullable<typeof d> => d !== null) as T[]
}

const newestFirst = <T extends { createdAt: string }>(list: T[]) => [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

export const writingDocs = async (ctx: Pick<ToolContext, 'rootDir'>) =>
  newestFirst(await readFolder<WritingReviewResult>(path.join(ctx.rootDir, 'progress', 'writing-reviews')))

/** Speaking review recordings, without the per-word timings (the bulk of each file). */
export const talkDocs = async (ctx: Pick<ToolContext, 'rootDir'>) =>
  newestFirst(await readFolder<TalkReviewResult>(path.join(ctx.rootDir, 'progress', 'speaking-reviews'), (d) => ({ ...d, words: [] })))

/** Speaking ideas (suggested answers), not recordings. */
export const ideaDocs = async (ctx: Pick<ToolContext, 'rootDir'>) =>
  newestFirst(await readFolder<SpeakingResult>(path.join(ctx.rootDir, 'progress', 'speaking')))
