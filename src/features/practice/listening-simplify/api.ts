import type { ListeningHistoryItem, ListeningSaved, SimplifyMode, SimplifyResult } from '@/types/listening'

/** Same limits as the server (server/listening/simplify.ts). */
export const TRANSCRIPT_MAX = 30_000
const CHUNK_CHARS = 2_500
const PARALLEL = 4

/** Rough wait: parts of ~2,500 characters, 4 at a time; measured ~75 s for one part, ~95 s per round when split. */
export function estimate(length: number): { parts: number; seconds: number } {
  const parts = length <= CHUNK_CHARS * 1.3 ? 1 : Math.ceil(length / CHUNK_CHARS)
  return { parts, seconds: parts === 1 ? 75 : Math.ceil(parts / PARALLEL) * 95 + 15 }
}

const OFFLINE = 'Cần chạy server local (npm run dev / npm start).'

async function request<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new Error(OFFLINE)
  }
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error(OFFLINE)
  const json = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`)
  return json
}

export const listeningApi = {
  simplify: (transcript: string, questions: string, mode: SimplifyMode) =>
    request<{ result: SimplifyResult; id: string }>('/api/listening/simplify', { method: 'POST', body: { transcript, questions, mode } }),
  readImage: (images: { mimeType: string; data: string }[]) =>
    request<{ text: string }>('/api/listening/simplify/read-image', { method: 'POST', body: { images } }),
  get: (id: string) => request<{ saved: ListeningSaved }>(`/api/listening/simplify?id=${encodeURIComponent(id)}`),
  history: (range: { from?: string; to?: string } = {}) =>
    request<{ items: ListeningHistoryItem[] }>(
      `/api/listening/simplify/history?${new URLSearchParams(Object.entries(range).filter(([, v]) => v) as [string, string][])}`,
    ),
  remove: (id: string) => request<{ ok: true }>(`/api/listening/simplify?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
