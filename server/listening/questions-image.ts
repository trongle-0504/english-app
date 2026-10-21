// Listening → Simplify: screenshots of the question paper (often with the answers filled in) are read by Gemini into
// plain text lines, which go into the "questions / answers" box for the learner to check before the analysis runs.
// Through the configured engine: the Antigravity CLI opens the images from a temporary folder.
import { ApiError } from '../api.ts'
import { generate, geminiConfigured } from '../gemini.ts'

const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif|heic|heif)$/
export const MAX_QUESTION_IMAGES = 4
const MAX_IMAGE_BASE64 = 14_000_000 // ≈ 10 MB decoded

const SYSTEM = `You transcribe IELTS Listening question papers from screenshots. Output plain text only, no commentary, no markdown.
- One line per numbered question, in order: "<number>. <the question text, with the gap written as ___> → <answer>".
- The answer is whatever is written, filled in, highlighted or marked as correct in the gap or next to the number. Copy it exactly (keep alternatives like "string / strings"). If no answer is visible for a question, end the line after the question text without "→" — never guess an answer.
- Multiple choice: put the options on the same line ("A ... B ... C ..."), then "→ <letter>" only when the chosen letter is marked.
- Keep the title and section headings as their own short lines. Skip instructions such as "Write ONE WORD ONLY".`

/** `images` from a request body: 1–4 `{ mimeType, data }` with base64 data (a data: prefix is allowed). */
export function parseImages(value: unknown): { mimeType: string; data: string }[] {
  if (!Array.isArray(value) || !value.length) throw new ApiError(400, 'Add at least one image.')
  if (value.length > MAX_QUESTION_IMAGES) throw new ApiError(400, `At most ${MAX_QUESTION_IMAGES} images at a time.`)
  return value.map((item: { mimeType?: unknown; data?: unknown }, i) => {
    if (typeof item?.mimeType !== 'string' || typeof item.data !== 'string') throw new ApiError(400, `"images[${i}]" must be { mimeType, data }.`)
    if (!IMAGE_TYPES.test(item.mimeType)) throw new ApiError(400, `"images[${i}]" has unsupported type ${item.mimeType}.`)
    if (item.data.length > MAX_IMAGE_BASE64) throw new ApiError(400, `"images[${i}]" is larger than 10 MB.`)
    return { mimeType: item.mimeType, data: item.data.replace(/^data:[^,]*,/, '') }
  })
}

export async function readQuestionImages(images: { mimeType: string; data: string }[]): Promise<string> {
  if (!geminiConfigured()) throw new ApiError(503, 'Chưa có Antigravity CLI hoặc GEMINI_API_KEY để đọc ảnh.')
  const { value } = await generate<string>({
    label: 'listening: read questions',
    system: SYSTEM,
    prompt: images.length > 1 ? `Transcribe these ${images.length} screenshots in order as one list.` : 'Transcribe this screenshot.',
    images,
    thinking: 'low',
  })
  return value.replace(/^```\w*\n?|```$/g, '').trim()
}
