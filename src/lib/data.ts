import { use } from 'react'
import type { ReviewIndex } from '@/types/content'

export class NotFoundError extends Error {
  constructor(key: string) {
    super(`Not found: ${key}`)
    this.name = 'NotFoundError'
  }
}

const cache = new Map<string, Promise<unknown>>()

async function fetchJson<T>(url: string, keyForError: string): Promise<T> {
  const res = await fetch(url)
  if (res.status === 404) throw new NotFoundError(keyForError)
  if (!res.ok) throw new Error(`Failed to load ${keyForError} (${res.status})`)
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) throw new NotFoundError(keyForError)
  return (await res.json()) as T
}

async function fetchMergedReviewIndex(): Promise<ReviewIndex> {
  const [shared, custom] = await Promise.all([
    fetchJson<ReviewIndex>(`/data/review/index.json?v=${__CONTENT_VERSION__}`, 'review/index.json'),
    fetch('/api/me/review-cards', { cache: 'no-store' })
      .then((res) => (res.ok && (res.headers.get('content-type') ?? '').includes('json') ? (res.json() as Promise<ReviewIndex>) : { cards: [], decks: [] }))
      .catch(() => ({ cards: [], decks: [] })),
  ])
  if (!custom.cards.length && !custom.decks.length) return shared
  const seenCards = new Set(shared.cards.map((c) => c.id))
  const seenDecks = new Set(shared.decks.map((d) => d.id))
  return {
    cards: [...shared.cards, ...custom.cards.filter((c) => !seenCards.has(c.id))],
    decks: [...shared.decks, ...custom.decks.filter((d) => !seenDecks.has(d.id))],
  }
}

/** Fetches /data/<key> once per session (and merges per-user custom cards for review/index.json); concurrent callers share the same request. */
export function loadData<T>(key: string): Promise<T> {
  let promise = cache.get(key) as Promise<T> | undefined
  if (!promise) {
    promise =
      key === 'review/index.json'
        ? (fetchMergedReviewIndex() as Promise<T>)
        : fetchJson<T>(`/data/${key}?v=${__CONTENT_VERSION__}`, key)
    promise.catch(() => {})
    cache.set(key, promise)
  }
  return promise
}

/** Suspends until /data/<key> is loaded. Wrap callers in <Suspense> and an error boundary. */
export function useData<T>(key: string): T {
  return use(loadData<T>(key))
}

/** Suspends until the merged shared + per-user custom review index is loaded. */
export function useReviewCards(): ReviewIndex {
  return useData<ReviewIndex>('review/index.json')
}

/** Warm the cache, e.g. on link hover. Errors are ignored here and surface when the page renders. */
export function prefetchData(key: string): void {
  loadData(key).catch(() => {})
}

const invalidationListeners = new Set<(prefix: string) => void>()

/** Drop cached documents (after an admin edit, custom card mutation, or logout) and tell subscribers. */
export function invalidateData(prefix = ''): void {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
  invalidationListeners.forEach((listener) => listener(prefix))
}

/** For state derived from /data outside React's use() (e.g. a search index); returns unsubscribe. */
export function onDataInvalidated(listener: (prefix: string) => void): () => void {
  invalidationListeners.add(listener)
  return () => invalidationListeners.delete(listener)
}
