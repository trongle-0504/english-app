import { stripHeadingLines } from '../writing-review/headings'
import type { WritingTask1Extras, WritingTask1ExtrasMap } from '@/types/writingMock'

/** Task 1 timing: Vietnamese plan, then the English answer. */
export const TASK1_IDEA_SECONDS = 5 * 60
export const TASK1_ENGLISH_SECONDS = 20 * 60
/** Task 1 asks for at least 150 words (no band under it). */
export const TASK1_MIN_WORDS = 150

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new Error('Cần server local (npm run dev / npm start).')
  }
  if (!res.headers.get('content-type')?.includes('json')) throw new Error('Cần server local (npm run dev / npm start).')
  const json = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`)
  return json
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** The chart pictures and model essay the learner adds to a Task 1 question. */
export const task1Api = {
  extras: () => request<{ extras: WritingTask1ExtrasMap }>('/api/writing-task1/extras'),
  prompt: (id: string) => request<{ extras: WritingTask1Extras }>(`/api/writing-task1/prompt?id=${encodeURIComponent(id)}`),
  addImages: (promptId: string, images: { mimeType: string; data: string }[]) =>
    request<{ extras: WritingTask1Extras }>('/api/writing-task1/images', jsonInit('POST', { promptId, images })),
  removeImage: (promptId: string, n: number) =>
    request<{ extras: WritingTask1Extras }>(`/api/writing-task1/image?prompt=${encodeURIComponent(promptId)}&n=${n}`, { method: 'DELETE' }),
  imageUrl: (promptId: string, n: number) => `/api/writing-task1/image?prompt=${encodeURIComponent(promptId)}&n=${n}`,
  /** Reads the chart and picks the model essay's vocabulary in the background while the learner writes. */
  prepare: (promptId: string) => request<{ started: boolean }>('/api/writing-task1/prepare', jsonInit('POST', { promptId })),
  saveModelEssay: (promptId: string, text: string) =>
    request<{ extras: WritingTask1Extras }>('/api/writing-task1/model-essay', jsonInit('PUT', { promptId, text })),
}

/** Words as Writing Review counts them (letters or digits, with inner apostrophes and hyphens; heading lines left out). */
export function countWords(text: string): number {
  return stripHeadingLines(text).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

export function timerLabel(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

/** The exam date in a source title ("… ngày 04/01/2025 …"), or ''. */
export function examDate(title: string): string {
  return /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/.exec(title)?.[1] ?? ''
}

const MAX_SIDE = 1600

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error ?? new Error('Không đọc được file.'))
    reader.readAsDataURL(blob)
  })
}

/**
 * A picture ready to upload: shrunk in the browser (longest side ≤ 1600 px, on white) to WebP 0.92, or PNG where the
 * browser cannot write WebP. A picture the browser cannot decode (HEIC) is sent as it is; the server converts it.
 */
export async function imageForUpload(file: Blob): Promise<{ mimeType: string; data: string }> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const g = canvas.getContext('2d')
    if (!g) throw new Error('no canvas')
    g.fillStyle = '#fff'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92))
    const out = blob?.type === 'image/webp' ? blob : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!out) throw new Error('no blob')
    return { mimeType: out.type, data: await blobToBase64(out) }
  } catch {
    return { mimeType: file.type || 'image/png', data: await blobToBase64(file) }
  }
}
