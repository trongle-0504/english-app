import { loadData } from '@/lib/data'

export const MAX_LENGTH = 4000

/** Matches the server's cache key, so a re-pasted sentence is recognised as already analysed. */
export const normalizeText = (text: string) => text.trim().replace(/\s+/g, ' ')

/**
 * `server`: the local API is running (new analyses possible when `gemini` is true).
 * `static`: static hosting — only the analyses exported to /data/grammar/history.json are available.
 */
export type AnalyzeBackend =
  | { mode: 'server'; items: string[]; gemini: boolean }
  | { mode: 'static'; entries: Record<string, string> }

export interface Analysis {
  text: string
  raw: string
  cached: boolean
}

/** The API is not there at all (network failure, or a static host answering with index.html). */
export class OfflineError extends Error {
  constructor() {
    super('Could not reach the analysis server. Start it with `npm run dev` or `npm start`.')
    this.name = 'OfflineError'
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new OfflineError()
  }
  if (!res.headers.get('content-type')?.includes('json')) throw new OfflineError()
  const json = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`)
  return json
}

export async function loadBackend(): Promise<AnalyzeBackend> {
  try {
    const { items, gemini } = await request<{ items: string[]; gemini: boolean }>('/api/analyze/history')
    return { mode: 'server', items, gemini }
  } catch (error) {
    if (!(error instanceof OfflineError)) throw error
    const entries = await loadData<Record<string, string>>('grammar/history.json').catch(() => ({}))
    return { mode: 'static', entries }
  }
}

export async function analyze(text: string): Promise<Analysis> {
  const { raw, cached } = await request<{ raw: string; cached: boolean }>('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  return { text, raw, cached }
}

export async function deleteHistoryItem(text: string): Promise<void> {
  await request(`/api/analyze/history?text=${encodeURIComponent(text)}`, { method: 'DELETE' })
}

/** Looks a text up in the static export (read-only mode). */
export function findStatic(entries: Record<string, string>, text: string): Analysis | undefined {
  const key = normalizeText(text)
  const stored = Object.keys(entries).find((k) => normalizeText(k) === key)
  return stored === undefined ? undefined : { text: stored, raw: entries[stored], cached: true }
}

/** Newest-first texts of a backend's history. */
export function historyItems(backend: AnalyzeBackend): string[] {
  return backend.mode === 'server' ? backend.items : Object.keys(backend.entries).reverse()
}
