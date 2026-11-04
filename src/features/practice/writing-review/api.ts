import type { WritingReviewJob, WritingReviewSummary } from '@/types/writingReview'

export const MIN_LENGTH = 30
export const MAX_LENGTH = 5000

/** Steps of a review in order, with the label shown while each one runs ("retry" only when a fix needs it). */
export const STEPS: { id: string; label: string }[] = [
  { id: 'retrieve', label: 'Truy vấn kho cụm từ theo chủ đề' },
  { id: 'dol', label: 'AI tách cụm tiếng Việt, tra từ điển DOL (Việt → Anh)' },
  { id: 'diagnose', label: 'AI đọc bài và chẩn đoán lỗi' },
  { id: 'dictionary', label: 'Đối chiếu Longman + OZDIC' },
  { id: 'retry', label: 'Chọn lại cách sửa theo từ điển' },
  { id: 'essay_plan', label: 'Giám khảo đọc bản nháp: giữ, sửa, viết lại từng câu' },
  { id: 'model_essay', label: 'Viết bài nâng cấp mới (NeuralSymbolic)' },
  { id: 'essay_review', label: 'Giám khảo soát bài nâng cấp' },
  { id: 'essay_dictionary', label: 'Tra Longman + OZDIC các cụm AI tự viết' },
  { id: 'classify', label: 'Phân loại chủ đề và dạng đề bài' },
]

export class OfflineError extends Error {
  constructor() {
    super('Writing review needs the local server (npm run dev / npm start).')
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

export const writingReviewApi = {
  history: (limit = 100) =>
    request<{ items: WritingReviewSummary[]; ready: boolean; model: string; effort: string; engine?: string }>(
      `/api/writing-review/history?limit=${limit}`,
    ),
  start: (text: string, vietnameseText?: string, prompt?: string, title?: string) =>
    request<{ job: WritingReviewJob }>('/api/writing-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, vietnameseText, prompt, title }),
    }),
  get: (id: string) => request<{ job: WritingReviewJob }>(`/api/writing-review?id=${encodeURIComponent(id)}`),
  remove: (id: string) => request<{ ok: true }>(`/api/writing-review?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  analyzeEdit: (id: string, userEdited: string) =>
    request<{ result: import('@/types/writingReview').WritingReviewResult }>('/api/writing-review/analyze-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, userEdited }),
    }),
  resetEdit: (id: string) =>
    request<{ result: import('@/types/writingReview').WritingReviewResult }>('/api/writing-review/reset-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }),
}
