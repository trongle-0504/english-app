import { ApiError, type ApiHandler } from '../api.ts'
import {
  analyzeReviewEdit,
  deleteReview,
  getReview,
  listReviews,
  MAX_LENGTH,
  MIN_LENGTH,
  resetReviewEdit,
  startReview,
} from '../writing-review/service.ts'
import {
  defaultWritingReviewEngine,
  writingReviewEffort,
  writingReviewEngineAvailable,
  writingReviewModelName,
} from '../writing-review/llm.ts'

/** Practice → Writing Review: collocation and word-choice review checked against ozdic.com. */
export const writingReviewRoutes: Record<string, ApiHandler> = {
  /** Body `{ text }` → `{ job }` (running; poll GET /writing-review?id=). */
  'POST /writing-review': (req, ctx) => {
    const body = req.body as { text?: unknown; title?: unknown; prompt?: unknown; vietnameseText?: unknown } | undefined
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const title = typeof body?.title === 'string' ? body.title.trim() : undefined
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : undefined
    const vietnameseText = typeof body?.vietnameseText === 'string' ? body.vietnameseText.trim() : undefined
    if (text.length < MIN_LENGTH) throw new ApiError(400, `Please paste a paragraph (at least ${MIN_LENGTH} characters).`)
    if (text.length > MAX_LENGTH) throw new ApiError(400, `Text is too long (max ${MAX_LENGTH} characters).`)
    if (!writingReviewEngineAvailable()) {
      const isAntigravity = defaultWritingReviewEngine() === 'antigravity'
      throw new ApiError(
        503,
        isAntigravity
          ? "Antigravity CLI ('agy') is not available. Please ensure Antigravity CLI is installed."
          : 'Claude Code is not installed. Install it (claude.ai/install.sh) and sign in once with `claude`.',
      )
    }
    return { status: 202, json: { job: startReview(ctx, text, prompt, vietnameseText, title) } }
  },

  /** `?id=` → `{ job }` (running, done with `result`, or error). */
  'GET /writing-review': async (req, ctx) => {
    const job = await getReview(ctx, req.query.get('id') ?? '')
    if (!job) throw new ApiError(404, 'Review not found.')
    return { json: { job } }
  },

  /** → `{ items, ready, model, effort, engine }`: saved reviews, newest first. */
  'GET /writing-review/history': async (req, ctx) => {
    const limitParam = req.query.get('limit')
    const limit = limitParam ? Number(limitParam) : 100
    return {
      json: {
        items: await listReviews(ctx, Number.isFinite(limit) && limit > 0 ? limit : 100),
        ready: writingReviewEngineAvailable(),
        model: writingReviewModelName(),
        effort: writingReviewEffort(),
        engine: defaultWritingReviewEngine(),
      },
    }
  },

  'DELETE /writing-review': async (req, ctx) => {
    await deleteReview(ctx, req.query.get('id') ?? '')
    return { json: { ok: true } }
  },

  /** Body `{ id, userEdited }` → `{ result }`: analyzes and formats user edited essay. */
  'POST /writing-review/analyze-edit': async (req, ctx) => {
    const b = (req.body ?? {}) as { id?: unknown; userEdited?: unknown }
    const id = String(b.id ?? '')
    const userEdited = typeof b.userEdited === 'string' ? b.userEdited : ''
    const result = await analyzeReviewEdit(ctx, id, userEdited)
    return { json: { result } }
  },

  /** Body `{ id }` → `{ result }`: restores original AI model essay. */
  'POST /writing-review/reset-edit': async (req, ctx) => {
    const b = (req.body ?? {}) as { id?: unknown }
    const id = String(b.id ?? '')
    const result = await resetReviewEdit(ctx, id)
    return { json: { result } }
  },
}
