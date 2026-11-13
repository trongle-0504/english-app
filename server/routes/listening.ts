import { ApiError, type ApiHandler } from '../api.ts'
import { deleteSimplify, getSimplify, listSimplify, saveSimplify } from '../listening/history.ts'
import { parseImages } from '../images.ts'
import { readQuestionImages } from '../listening/questions-image.ts'
import { SIMPLIFY_QUESTIONS_MAX, SIMPLIFY_TRANSCRIPT_MAX, simplifyTranscript } from '../listening/simplify.ts'

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim() : '').slice(0, max)

/** Listening: transcript tools that use Gemini through the Antigravity CLI. */
export const listeningRoutes: Record<string, ApiHandler> = {
  /**
   * Body `{ transcript, questions?, mode? }` → `{ result, id }`: the transcript split into backbone / skip / signpost /
   * key spans (a long one in parts, analysed side by side), saved to the history.
   */
  'POST /listening/simplify': async (req, ctx) => {
    const b = (req.body ?? {}) as { transcript?: unknown; questions?: unknown; mode?: unknown }
    const raw = typeof b.transcript === 'string' ? b.transcript.trim() : ''
    if (raw.length > SIMPLIFY_TRANSCRIPT_MAX) {
      throw new ApiError(400, `Transcript dài ${raw.length.toLocaleString('vi-VN')} ký tự, tối đa ${SIMPLIFY_TRANSCRIPT_MAX.toLocaleString('vi-VN')}.`)
    }
    const transcript = text(raw, SIMPLIFY_TRANSCRIPT_MAX)
    if (transcript.length < 20) throw new ApiError(400, 'Paste the transcript first.')
    const mode = b.mode === 'podcast' ? 'podcast' : 'ielts'
    const questions = mode === 'podcast' ? '' : text(b.questions, SIMPLIFY_QUESTIONS_MAX)
    const result = await simplifyTranscript(ctx, transcript, questions, mode)
    const saved = await saveSimplify(ctx, transcript, questions, result)
    return { json: { result, id: saved.id } }
  },

  /** Body `{ images: [{ mimeType, data }] }` → `{ text }`: screenshots of the questions (and answers) as text lines. */
  'POST /listening/simplify/read-image': async (req) => {
    const b = (req.body ?? {}) as { images?: unknown }
    return { json: { text: await readQuestionImages(parseImages(b.images)) } }
  },

  /** `?id=` → `{ saved }`: one analysis from the history with its transcript and questions. */
  'GET /listening/simplify': async (req, ctx) => {
    const saved = await getSimplify(ctx, req.query.get('id') ?? '')
    if (!saved) throw new ApiError(404, 'Analysis not found.')
    return { json: { saved } }
  },

  /** `?from=&to=` (ISO, optional) → `{ items }`: saved analyses, newest first. */
  'GET /listening/simplify/history': async (req, ctx) => ({
    json: { items: await listSimplify(ctx, { from: req.query.get('from') || undefined, to: req.query.get('to') || undefined }) },
  }),

  'DELETE /listening/simplify': async (req, ctx) => {
    await deleteSimplify(ctx, req.query.get('id') ?? '')
    return { json: { ok: true } }
  },
}
