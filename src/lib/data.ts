import { use } from 'react'

export class NotFoundError extends Error {
  constructor(key: string) {
    super(`Not found: ${key}`)
    this.name = 'NotFoundError'
  }
}

const cache = new Map<string, Promise<unknown>>()

/** Fetches /data/<key> once per session; concurrent callers share the same request. */
export function loadData<T>(key: string): Promise<T> {
  let promise = cache.get(key) as Promise<T> | undefined
  if (!promise) {
    promise = fetch(`/data/${key}?v=${__CONTENT_VERSION__}`).then(async (res) => {
      if (res.status === 404) throw new NotFoundError(key)
      if (!res.ok) throw new Error(`Failed to load ${key} (${res.status})`)
      const type = res.headers.get('content-type') ?? ''
      // Unknown paths fall through to index.html on static hosts.
      if (!type.includes('json')) throw new NotFoundError(key)
      return (await res.json()) as T
    })
    // Failed loads stay cached: use() must see the same rejected promise so the error boundary renders
    // (evicting it would refetch on every render). invalidateData() or a reload retries.
    promise.catch(() => {})
    cache.set(key, promise)
  }
  return promise
}

/** Suspends until /data/<key> is loaded. Wrap callers in <Suspense> and an error boundary. */
export function useData<T>(key: string): T {
  return use(loadData<T>(key))
}

/** Warm the cache, e.g. on link hover. Errors are ignored here and surface when the page renders. */
export function prefetchData(key: string): void {
  loadData(key).catch(() => {})
}

const invalidationListeners = new Set<(prefix: string) => void>()

/** Drop cached documents (after an admin edit or a content change) and tell subscribers. */
export function invalidateData(prefix = ''): void {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
  invalidationListeners.forEach((listener) => listener(prefix))
}

/** For state derived from /data outside React's use() (e.g. a search index); returns unsubscribe. */
export function onDataInvalidated(listener: (prefix: string) => void): () => void {
  invalidationListeners.add(listener)
  return () => invalidationListeners.delete(listener)
}
