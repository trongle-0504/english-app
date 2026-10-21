import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { invalidateData } from '@/lib/data'

/* ───────────── Admin token (only needed when the server sets ADMIN_TOKEN) ───────────── */

const TOKEN_KEY = 'english-app:admin-token'
const listeners = new Set<() => void>()
let tokenRejected = false

function emit() {
  for (const listener of listeners) listener()
}

export function getAdminToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAdminToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage blocked: the token only lives for this request cycle.
  }
  tokenRejected = false
  emit()
}

/** True after the server answered 401, until a new token is saved. */
export function useTokenRejected(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => tokenRejected,
  )
}

/* ───────────── Requests ───────────── */

export class AdminApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** Calls /api/admin/<path>. Throws AdminApiError with the server's message on failure. */
export async function adminApi<T>(
  path: string,
  { method = 'GET', body, query }: { method?: Method; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const url = `/api/admin/${path}${query ? `?${new URLSearchParams(query)}` : ''}`
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getAdminToken()
  if (token) headers['x-admin-token'] = token

  let res: Response
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new AdminApiError(0, 'Cannot reach the local server. Is `npm run dev` (or `npm start`) running?')
  }
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new AdminApiError(res.status, `The server did not return JSON (HTTP ${res.status}). The admin API needs the local server.`)
  }
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) {
    if (res.status === 401) {
      tokenRejected = true
      emit()
    }
    throw new AdminApiError(res.status, data.error ?? `Request failed (HTTP ${res.status}).`)
  }
  return data
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** After a save: drop cached /data documents so public pages show the new content. */
export function refreshSiteData(...prefixes: string[]): void {
  for (const prefix of [...prefixes, 'lookup.json']) invalidateData(prefix)
}

/* ───────────── Loading ───────────── */

export interface Resource<T> {
  data?: T
  error?: string
  loading: boolean
  reload: () => void
  setData: (data: T) => void
}

/** GETs /api/admin/<path> on mount; `setData` lets mutations apply the server's fresh response. */
export function useAdminResource<T>(path: string): Resource<T> {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    adminApi<T>(path).then(
      (data) => !cancelled && setState({ data, loading: false }),
      (error: unknown) => !cancelled && setState((s) => ({ ...s, error: errorMessage(error), loading: false })),
    )
    return () => {
      cancelled = true
    }
  }, [path, version])

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }))
    setVersion((v) => v + 1)
  }, [])
  const setData = useCallback((data: T) => setState({ data, loading: false }), [])

  return { ...state, reload, setData }
}
