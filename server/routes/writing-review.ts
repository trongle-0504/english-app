import { ApiError, type ApiHandler } from '../api.ts'
import {
  analyzeReviewEdit,
  deleteReview,
  getReview,
  listReviews,
  MAX_LENGTH,
  MIN_LENGTH,
  rerunTask1Model,
  resetReviewEdit,
  startReview,
} from '../writing-review/service.ts'
import { checkPromptId } from '../writing-task1/store.ts'
import type { WritingReviewSource } from '../../src/types/writingReview.ts'
import {
  defaultWritingReviewEngine,
  writingReviewEffort,
  writingReviewEngineAvailable,
  writingReviewModelName,
} from '../writing-review/llm.ts'

/** Practice → Writing Review: collocation and word-choice review checked against ozdic.com. */
export const writingReviewRoutes: Record<string, ApiHandler> = {
  /**
   * Body `{ text, title?, prompt?, vietnameseText?, task?: 1 | 2, promptId? }` → `{ job }` (running; poll GET
   * /writing-review?id=). `task: 1` (Writing Mock Test, Task 1) needs the question's `promptId`.
   */
  'POST /writing-review': async (req, ctx) => {
    const body = req.body as
      | { text?: unknown; title?: unknown; prompt?: unknown; vietnameseText?: unknown; task?: unknown; promptId?: unknown }
      | undefined
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const title = typeof body?.title === 'string' ? body.title.trim() : undefined
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : undefined
    const vietnameseText = typeof body?.vietnameseText === 'string' ? body.vietnameseText.trim() : undefined
    if (text.length < MIN_LENGTH) throw new ApiError(400, `Please paste a paragraph (at least ${MIN_LENGTH} characters).`)
    if (text.length > MAX_LENGTH) throw new ApiError(400, `Text is too long (max ${MAX_LENGTH} characters).`)
    if (body?.task !== undefined && body.task !== 1 && body.task !== 2) throw new ApiError(400, '"task" must be 1 or 2.')
    const source: WritingReviewSource = body?.task === 1 ? { task: 1, promptId: await checkPromptId(ctx, body.promptId) } : {}
    if (!writingReviewEngineAvailable()) {
      const isAntigravity = defaultWritingReviewEngine() === 'antigravity'
      throw new ApiError(
        503,
        isAntigravity
          ? "Antigravity CLI ('agy') is not available. Please ensure Antigravity CLI is installed."
          : 'Claude Code is not installed. Install it (claude.ai/install.sh) and sign in once with `claude`.',
      )
    }
    return { status: 202, json: { job: startReview(ctx, text, prompt, vietnameseText, title, source) } }
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

  /** Task 1: body `{ id }` → `{ result }` with the model-essay comparison made again (after adding or editing it). */
  'POST /writing-review/task1/compare': async (req, ctx) => {
    const b = (req.body ?? {}) as { id?: unknown }
    return { json: { result: await rerunTask1Model(ctx, String(b.id ?? '')) } }
  },
}
