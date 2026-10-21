import type { SpeakingHistoryItem, SpeakingJob, SpeakingPart, SpeakingRequest, SpeakingResult, SpeakingSyncJob, SpeakingSyncStatus } from '@/types/speaking'

/** Steps of a suggestion run in order, with the label shown while each one runs. */
export const STEPS: { id: NonNullable<SpeakingJob['step']>; label: string }[] = [
  { id: 'analyze', label: 'AI đọc câu hỏi' },
  { id: 'match', label: 'Tìm cụm trong thư viện + từ điển DOL (Việt → Anh)' },
  { id: 'suggest', label: 'AI chọn cụm và viết câu trả lời' },
  { id: 'polish', label: 'AI đọc lại, chỉnh cho đúng ý và tự nhiên' },
  { id: 'dictionary', label: 'Tìm từng cụm trong câu trả lời, đối chiếu Longman + OZDIC, thay cụm AI tự viết chưa có trong từ điển' },
  // "Phrases only" mode: alternatives for idea phrases no dictionary lists.
  { id: 'alternatives', label: 'Lập danh sách ứng viên cho cụm chưa có trong từ điển' },
]

export class OfflineError extends Error {
  constructor() {
    super('Speaking ideas needs the local server (npm run dev / npm start).')
    this.name = 'OfflineError'
  }
}

async function request<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 75_000)
    try {
      res = await fetch(url, {
        method: init?.method ?? 'GET',
        headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('Yêu cầu xử lý quá thời gian quy định (timeout). Vui lòng thử lại.')
    }
    throw new OfflineError()
  }
  if (!res.headers.get('content-type')?.includes('json')) throw new OfflineError()
  const json = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`)
  return json
}

export const speakingApi = {
  start: (body: SpeakingRequest) => request<{ job: SpeakingJob }>('/api/speaking', { method: 'POST', body }),
  get: (id: string) => request<{ job: SpeakingJob }>(`/api/speaking?id=${encodeURIComponent(id)}`),
  history: (range: { from?: string; to?: string } = {}) =>
    request<{ items: SpeakingHistoryItem[] }>(
      `/api/speaking/history?${new URLSearchParams(Object.entries(range).filter(([, v]) => v) as [string, string][])}`,
    ),
  remove: (id: string) => request<{ ok: true; deletedSession?: boolean }>(`/api/speaking?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  removeQuestion: (id: string, answerIndex: number) =>
    request<{ ok: true; deletedSession: boolean; result?: SpeakingResult }>(
      `/api/speaking?id=${encodeURIComponent(id)}&answerIndex=${answerIndex}`,
      { method: 'DELETE' },
    ),
  saveUserEdit: (id: string, answerIndex: number, userEdited: string) =>
    request<{ result: SpeakingResult }>('/api/speaking', { method: 'PATCH', body: { id, answerIndex, userEdited } }),
  analyzeEdit: (id: string, answerIndex: number, userEdited: string, part: SpeakingPart) =>
    request<{ result: SpeakingResult }>('/api/speaking/analyze-edit', {
      method: 'POST',
      body: { id, answerIndex, userEdited, part },
    }),
  resetEdit: (id: string, answerIndex: number) =>
    request<{ result: SpeakingResult }>('/api/speaking/reset-edit', {
      method: 'POST',
      body: { id, answerIndex },
    }),
  syncStatus: () => request<{ status: SpeakingSyncStatus; model: string; effort: string }>('/api/speaking/sync'),
  sync: () => request<{ job: SpeakingSyncJob }>('/api/speaking/sync', { method: 'POST', body: {} }),
  stopSync: () => request<{ job: SpeakingSyncJob | null }>('/api/speaking/sync/stop', { method: 'POST', body: {} }),
}
