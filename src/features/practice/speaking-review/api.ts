import type { TalkHistoryItem, TalkReviewJob, TalkReviewRequest, TalkReviewResult } from '@/types/speakingReview'

export class OfflineError extends Error {
  constructor() {
    super('Speaking review needs the local server (npm run dev / npm start).')
    this.name = 'OfflineError'
  }
}

async function request<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new OfflineError()
  }
  if (!res.headers.get('content-type')?.includes('json')) throw new OfflineError()
  const json = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`)
  return json
}

export interface TalkStatus {
  stt: boolean
  reviewer: boolean
  modelDir: string
}

export const talkApi = {
  status: () => request<TalkStatus>('/api/speaking-review/status'),
  start: (body: TalkReviewRequest) => request<{ job: TalkReviewJob }>('/api/speaking-review', { method: 'POST', body }),
  get: (id: string) => request<{ job: TalkReviewJob }>(`/api/speaking-review?id=${encodeURIComponent(id)}`),
  history: () => request<{ items: TalkHistoryItem[] }>('/api/speaking-review/history'),
  remove: (id: string) => request<{ ok: true }>(`/api/speaking-review?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  retry: (id: string) => request<{ job: TalkReviewJob }>('/api/speaking-review/retry', { method: 'POST', body: { id } }),
  restartModel: (id: string) => request<{ result: TalkReviewResult }>('/api/speaking-review/model', { method: 'POST', body: { id } }),
}

export const audioUrl = (id: string) => `/api/speaking-review/audio?id=${encodeURIComponent(id)}`
