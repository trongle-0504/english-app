// Multi-user /data: each learner's build = the shared content + their own library (vocabulary, notes, review cards).
// A build is ~28 MB of JSON and ~0.7 s of CPU, so only the most recently used few are kept in memory.
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { createContentStore } from '../../content-pipeline/store.ts'
import { ensureUserRoot } from './root.ts'

type Store = ReturnType<typeof createContentStore>

export function createUserStores(appRoot: string, max = Number(process.env.MAX_DATA_STORES) || 3) {
  const stores = new Map<string, Store>() // insertion order = least recently used first

  const get = (uid: string): Store => {
    let store = stores.get(uid)
    if (store) stores.delete(uid)
    else store = createContentStore(path.join(ensureUserRoot(uid, appRoot), 'content'))
    stores.set(uid, store)
    while (stores.size > max) stores.delete(stores.keys().next().value as string)
    return store
  }

  return {
    middleware: (uid: string) => (req: IncomingMessage, res: ServerResponse, next: () => void) => get(uid).middleware({ cache: 'no-cache', compress: true })(req, res, next),
    invalidate: (uid: string) => stores.get(uid)?.invalidate(),
    invalidateAll: () => {
      for (const store of stores.values()) store.invalidate()
    },
  }
}
