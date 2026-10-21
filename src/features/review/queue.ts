import type { ReviewSettings, ReviewStateResponse, StoredCard } from '@/types/review'

/** Cards in learning come back within this window during a session (like Anki's "learn ahead"). */
export const LEARN_AHEAD_MS = 20 * 60_000

export interface QueueCounts {
  due: number
  learning: number
  newAvailable: number
  newToday: number
}

/**
 * What a session contains right now. `known` limits it to cards that still exist in the content
 * (a deleted word's progress stays in the file but is never shown); `only` restricts it to one deck.
 * Cards marked done are skipped.
 */
export function buildQueue(
  cards: Record<string, StoredCard>,
  settings: ReviewSettings,
  today: ReviewStateResponse['today'] | undefined,
  known: ReadonlySet<string>,
  {
    now = Date.now(),
    only,
    extraNew = 0,
    newLimit,
  }: {
    now?: number
    only?: ReadonlySet<string>
    extraNew?: number
    /** New cards to introduce, in place of today's limit (a "Bài gần đây" session: you chose these words). */
    newLimit?: number
  } = {},
) {
  const reviews: { id: string; due: number }[] = []
  const learning: { id: string; due: number }[] = []
  const fresh: { id: string; added: string; priority: boolean }[] = []
  for (const [id, card] of Object.entries(cards)) {
    if (card.done || !known.has(id) || (only && !only.has(id))) continue
    const due = Date.parse(card.fsrs.due)
    if (card.fsrs.state === 0) fresh.push({ id, added: card.added, priority: isLearnToday(card, today?.day) })
    else if (card.fsrs.state === 2 && due <= now) reviews.push({ id, due })
    else if (card.fsrs.state !== 2 && due <= now + LEARN_AHEAD_MS) learning.push({ id, due })
  }
  reviews.sort((a, b) => a.due - b.due)
  learning.sort((a, b) => a.due - b.due)
  fresh.sort((a, b) => Number(b.priority) - Number(a.priority) || a.added.localeCompare(b.added))

  // Cards marked "learn today" always come; the rest fill today's limit. `extraNew`: "learn N more" beyond it.
  const priority = fresh.filter((c) => c.priority).length
  const newToday = newLimit ?? Math.max(priority, Math.max(0, settings.newPerDay - (today?.newStudied ?? 0)) + extraNew)
  const newIds = fresh.slice(0, newToday).map((c) => c.id)

  // Learning cards first (they are time-sensitive), then reviews with new cards spread evenly among them.
  const order: string[] = learning.map((c) => c.id)
  const reviewIds = reviews.map((c) => c.id)
  const gap = newIds.length ? Math.max(1, Math.floor(reviewIds.length / newIds.length)) : Infinity
  let n = 0
  reviewIds.forEach((id, i) => {
    order.push(id)
    if ((i + 1) % gap === 0 && n < newIds.length) order.push(newIds[n++])
  })
  order.push(...newIds.slice(n))

  const counts: QueueCounts = { due: reviews.length, learning: learning.length, newAvailable: fresh.length, newToday: newIds.length }
  return { order, counts }
}

/** A new card created in Admin, due to be learned today (or earlier and still not learned). */
export function isLearnToday(card: StoredCard, day: string | undefined): boolean {
  return Boolean(card.learnDay && day && card.learnDay <= day)
}

/** Mode for one card: the session's modes, picked at random when several are enabled. */
export function pickMode<T>(modes: T[]): T {
  return modes[Math.floor(Math.random() * modes.length)]
}

/** Practice (cram) session: every card already studied, shuffled. Grades are not saved. */
export function practiceQueue(cards: Record<string, StoredCard>, known: ReadonlySet<string>, only?: ReadonlySet<string>): string[] {
  const ids = Object.entries(cards)
    .filter(([id, card]) => !card.done && known.has(id) && (!only || only.has(id)) && card.fsrs.state !== 0)
    .map(([id]) => id)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  return ids
}
