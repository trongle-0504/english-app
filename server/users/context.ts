// Who the current request (and everything it starts: jobs, AI calls, usage logs) belongs to. Set once by the API
// middleware; read deep inside the code without passing it through every function.
import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestUser {
  id: string
  role: 'admin' | 'learner'
  /** Admin reading a learner's pages ("view as"): the request runs as that learner, read-only. */
  viewAs?: boolean
}

export const requestUser = ((globalThis as { __requestUser?: AsyncLocalStorage<RequestUser> }).__requestUser ??= new AsyncLocalStorage<RequestUser>())

export const currentUserId = (): string | undefined => requestUser.getStore()?.id

/**
 * A Map for background jobs that only hands a job back to the user who started it. `set` remembers the owner of the
 * running request; `get`/`has` from another user's request answer as if the job did not exist (the routes then
 * answer 404). Outside a request (single-user app, tests, timers) it is a plain Map.
 */
export class OwnedMap<K, V> extends Map<K, V> {
  private owners = new Map<K, string | undefined>()

  override set(key: K, value: V): this {
    if (!this.owners?.has(key)) this.owners?.set(key, currentUserId())
    return super.set(key, value)
  }

  private visible(key: K): boolean {
    const me = currentUserId()
    if (me === undefined) return true
    const owner = this.owners.get(key)
    return owner === undefined || owner === me
  }

  override get(key: K): V | undefined {
    return this.visible(key) ? super.get(key) : undefined
  }

  override has(key: K): boolean {
    return this.visible(key) && super.has(key)
  }

  override delete(key: K): boolean {
    if (!this.visible(key)) return false
    this.owners.delete(key)
    return super.delete(key)
  }
}

/** Upgrades a job Map kept on globalThis by an earlier module version (dev reloads) to an OwnedMap. */
export function ownedMap<K, V>(existing?: Map<K, V>): OwnedMap<K, V> {
  if (existing instanceof OwnedMap) return existing
  const map = new OwnedMap<K, V>()
  for (const [k, v] of existing ?? []) map.set(k, v)
  return map
}
