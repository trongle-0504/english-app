import { useSyncExternalStore } from 'react'
import type { ProduceVerdict, ReviewMode, ReviewSettings, ReviewStateResponse, StoredCard } from '@/types/review'
import { reviewApi, ReviewApiError } from './api'

/**
 * Review progress shared by every page (the ＋ Review buttons, the dashboard, sessions).
 * Loaded once from the local server; `offline` on static hosting where the API doesn't exist.
 */
export interface ReviewStore {
  status: 'idle' | 'loading' | 'ready' | 'offline'
  settings?: ReviewSettings
  cards: Record<string, StoredCard>
  today?: ReviewStateResponse['today']
  error?: string
}

let store: ReviewStore = { status: 'idle', cards: {} }
const listeners = new Set<() => void>()

function set(next: Partial<ReviewStore>) {
  store = { ...store, ...next }
  listeners.forEach((l) => l())
}

export async function loadReviews(force = false): Promise<void> {
  if (!force && (store.status === 'loading' || store.status === 'ready')) return
  set({ status: 'loading' })
  try {
    const state = await reviewApi.state()
    set({ status: 'ready', settings: state.settings, cards: state.cards, today: state.today, error: undefined })
  } catch (error) {
    set({ status: 'offline', error: (error as Error).message })
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (store.status === 'idle') void loadReviews()
  return () => listeners.delete(listener)
}

export function useReviewStore(): ReviewStore {
  return useSyncExternalStore(subscribe, () => store)
}

export async function addToReview(ids: string[]): Promise<void> {
  await reviewApi.add(ids)
  await loadReviews(true)
}

export async function removeFromReview(ids: string[]): Promise<void> {
  // Optimistic: the button flips at once.
  const cards = { ...store.cards }
  ids.forEach((id) => delete cards[id])
  set({ cards })
  await reviewApi.remove(ids)
  await loadReviews(true)
}

/** Marks cards as done (known, off the schedule) or moves them back to learning, due today. Optimistic. */
export async function setCardsDone(ids: string[], done: boolean): Promise<void> {
  const stamp = new Date().toISOString()
  const cards = { ...store.cards }
  for (const id of ids) {
    const card = cards[id]
    if (!card) continue
    const { done: _, ...rest } = card
    const dueNow = rest.fsrs.state !== 0 && Date.parse(rest.fsrs.due) > Date.parse(stamp)
    cards[id] = done ? { ...card, done: card.done ?? stamp } : dueNow ? { ...rest, fsrs: { ...rest.fsrs, due: stamp } } : rest
  }
  set({ cards })
  try {
    await reviewApi.setDone(ids, done)
  } finally {
    await loadReviews(true)
  }
}

/** One "Luyện dùng từ" answer: the card's stage (and practised day) change, its schedule does not. */
export async function practiseUsage(id: string, mode: ReviewMode, rating: 1 | 2 | 3 | 4, verdict?: ProduceVerdict): Promise<StoredCard> {
  const { card } = await reviewApi.usage({ id, mode, rating, verdict })
  set({ cards: { ...store.cards, [id]: card } })
  return card
}

/** Usage ladder on/off per card (off = only recognised). Shown at once; reloaded from the server if saving fails. */
export async function setCardsLadder(ids: string[], on: boolean): Promise<void> {
  const cards = { ...store.cards }
  for (const id of ids) {
    const card = cards[id]
    if (!card) continue
    const { ladder: _, ...rest } = card
    cards[id] = on ? rest : { ...rest, ladder: false }
  }
  set({ cards })
  try {
    await reviewApi.setLadder(ids, on)
  } catch (error) {
    await loadReviews(true)
    throw error
  }
}

export async function gradeCard(
  id: string,
  rating: 1 | 2 | 3 | 4,
  mode: ReviewMode,
  durationMs: number,
  verdict?: ProduceVerdict,
): Promise<StoredCard> {
  const { card } = await reviewApi.grade({ id, rating, mode, durationMs, verdict })
  const wasNew = store.cards[id]?.fsrs.state === 0
  const today = store.today && { ...store.today, reviewed: store.today.reviewed + 1, newStudied: store.today.newStudied + (wasNew ? 1 : 0) }
  set({ cards: { ...store.cards, [id]: card }, today })
  return card
}

export async function undoLastReview(): Promise<string> {
  const { id } = await reviewApi.undo()
  await loadReviews(true)
  return id
}

export async function updateReviewSettings(patch: Partial<ReviewSettings>): Promise<void> {
  const { settings } = await reviewApi.settings(patch)
  set({ settings })
}

export { ReviewApiError }
