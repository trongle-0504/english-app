import type { ReviewCardInput } from '@/types/content'
import type { ProduceItem, ProduceResponse, ProduceVerdict, ReviewHistoryEntry, ReviewSettings, ReviewStateResponse, ReviewStats, StoredCard } from '@/types/review'
import { invalidateData } from '@/lib/data'
import { getAdminToken } from '../admin/api'

export class ReviewApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getAdminToken()
  if (token) headers['x-admin-token'] = token
  let res: Response
  try {
    res = await fetch(`/api/review/${path}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
  } catch {
    throw new ReviewApiError(0, 'Cannot reach the local server (npm run dev / npm start).')
  }
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new ReviewApiError(0, 'Reviews need the local server (npm run dev / npm start).')
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new ReviewApiError(res.status, data.error ?? `Request failed (${res.status})`)
  return data
}

export const reviewApi = {
  state: () => call<ReviewStateResponse>('state'),
  stats: () => call<ReviewStats>('stats'),
  history: () => call<{ entries: ReviewHistoryEntry[] }>('history'),
  add: (ids: string[]) => call<{ added: number }>('add', { method: 'POST', body: { ids } }),
  remove: (ids: string[]) => call<{ removed: number }>('remove', { method: 'POST', body: { ids } }),
  /** "Luyện dùng từ": one answer; moves the usage stage only. */
  usage: (body: { id: string; mode: string; rating: 1 | 2 | 3 | 4; verdict?: ProduceVerdict }) =>
    call<{ id: string; card: StoredCard }>('usage', { method: 'POST', body }),
  setLadder: (ids: string[], on: boolean) => call<{ changed: number }>('ladder', { method: 'POST', body: { ids, on } }),
  setDone: (ids: string[], done: boolean) => call<{ changed: number }>('status', { method: 'POST', body: { ids, done } }),
  grade: (body: { id: string; rating: 1 | 2 | 3 | 4; mode: string; durationMs: number; verdict?: ProduceVerdict }) =>
    call<{ id: string; card: StoredCard }>('grade', { method: 'POST', body }),
  /** Checks own sentences (usage stage "Tự dùng"), several in one Gemini call. */
  produce: (items: ProduceItem[]) => call<ProduceResponse>('produce', { method: 'POST', body: { items } }),
  undo: () => call<{ id: string; card: StoredCard | null }>('undo', { method: 'POST' }),
  settings: (patch: Partial<ReviewSettings>) => call<{ settings: ReviewSettings }>('settings', { method: 'PUT', body: patch }),
  saveCard: async (deck: string, card: ReviewCardInput, replace = false) => {
    const res = await call<{ deck: string; saved: string[] }>('custom', { method: 'POST', body: { deck, card, replace } })
    invalidateData('review/')
    return res
  },
  generateCard: async (deck: string, term: string, hint?: string) => {
    const res = await call<{ deck: string; saved: string[]; card: ReviewCardInput }>('custom/generate', { method: 'POST', body: { deck, term, hint } })
    invalidateData('review/')
    return res
  },
  importCards: async (deck: string, text: string, fill: boolean, replace = false) => {
    const res = await call<{ deck: string; saved: string[]; skipped: string[] }>('custom/import', { method: 'POST', body: { deck, text, fill, replace } })
    invalidateData('review/')
    return res
  },
  deleteCard: async (deck: string, card: string) => {
    const res = await call<{ ok: true }>(`custom?${new URLSearchParams({ deck, card })}`, { method: 'DELETE' })
    invalidateData('review/')
    return res
  },
}
