import type { SpeakingEngine, SpeakingPart, SpeakingQuestionInput, SpeakingRequest } from '../../src/types/speaking.ts'
import { guarded } from '../admin/auth.ts'
import { ApiError, type ApiHandler } from '../api.ts'
import { antigravityAvailable } from '../llm/antigravity-cli.ts'
import { claudeCodeAvailable } from '../llm/claude-code.ts'
import { creditInBackground } from '../practice/real-use.ts'
import { analyzeUserEditedAnswer, resetUserEditedAnswer } from '../speaking/analyze-edit.ts'
import { antigravityModel, defaultSpeakingEngine, speakingEffort, speakingModel } from '../speaking/llm.ts'
import { deleteQuestion, deleteSuggestion, getSuggestion, listSuggestions, MAX_QUESTIONS, startSuggest, updateAnswerUserEdit } from '../speaking/suggest.ts'
import { startSync, stopSync, syncStatus } from '../speaking/sync.ts'

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

function parseRequest(body: unknown): SpeakingRequest {
  const b = (body ?? {}) as { topic?: unknown; part?: unknown; questions?: unknown; mode?: unknown; engine?: unknown }
  const part = b.part === 2 || b.part === 3 ? b.part : 1
  const questions: SpeakingQuestionInput[] = (Array.isArray(b.questions) ? b.questions : [])
    .map((q: { question?: unknown; idea?: unknown }) => ({
      question: text(q?.question, part === 2 ? 1500 : 300),
      idea: text(q?.idea, part === 2 ? 5000 : 2000),
    }))
    .filter((q) => q.question)
  if (!questions.length) throw new ApiError(400, 'Add at least one question.')
  if (questions.length > MAX_QUESTIONS) throw new ApiError(400, `At most ${MAX_QUESTIONS} questions at a time.`)
  const engine = (b.engine as SpeakingEngine) || defaultSpeakingEngine()
  return { topic: text(b.topic, 120) || 'General', part, questions, mode: b.mode === 'phrases' ? 'phrases' : 'answer', engine }
}

/** Practice → Speaking ideas: library suggestions and model answers for IELTS Speaking questions. */
export const speakingRoutes: Record<string, ApiHandler> = {
  /** Body `{ topic, part, questions: [{ question, idea? }], mode?, engine? }` → `{ job }` (running; poll GET /speaking?id=). */
  'POST /speaking': (req, ctx) => {
    const request = parseRequest(req.body)
    if (request.engine === 'antigravity') {
      if (!antigravityAvailable()) {
        throw new ApiError(503, "Antigravity CLI ('agy') is not available. Please ensure Antigravity CLI is installed.")
      }
    } else {
      if (!claudeCodeAvailable()) {
        throw new ApiError(503, 'Claude Code is not installed. Install it (claude.ai/install.sh) and sign in once with `claude`.')
      }
    }
    return { status: 202, json: { job: startSuggest(ctx, request) } }
  },

  'GET /speaking': async (req, ctx) => {
    const job = await getSuggestion(ctx, req.query.get('id') ?? '')
    if (!job) throw new ApiError(404, 'Suggestion not found.')
    return { json: { job } }
  },

  /** `?from=&to=` (ISO, optional) → `{ items }`: saved suggestions, newest first. */
  'GET /speaking/history': async (req, ctx) => ({
    json: { items: await listSuggestions(ctx, { from: req.query.get('from') || undefined, to: req.query.get('to') || undefined }) },
  }),

  'DELETE /speaking': async (req, ctx) => {
    const id = req.query.get('id') ?? ''
    const answerIndex = req.query.get('answerIndex')
    if (answerIndex !== null && answerIndex !== '') {
      const idx = Number(answerIndex)
      if (Number.isInteger(idx)) {
        return { json: await deleteQuestion(ctx, id, idx) }
      }
    }
    await deleteSuggestion(ctx, id)
    return { json: { ok: true, deletedSession: true } }
  },

  /** Body `{ id, answerIndex, userEdited }` → `{ result }`: updates user's edited answer for a question. */
  'PATCH /speaking': async (req, ctx) => {
    const b = (req.body ?? {}) as { id?: unknown; answerIndex?: unknown; userEdited?: unknown }
    const id = String(b.id ?? '')
    const answerIndex = Number(b.answerIndex)
    const userEdited = typeof b.userEdited === 'string' ? b.userEdited : ''
    const result = await updateAnswerUserEdit(ctx, id, answerIndex, userEdited)
    return { json: { result } }
  },

  /** Body `{ id, answerIndex, userEdited, part }` → `{ result }`: analyzes and formats user edited answer. */
  'POST /speaking/analyze-edit': async (req, ctx) => {
    const b = (req.body ?? {}) as { id?: unknown; answerIndex?: unknown; userEdited?: unknown; part?: unknown }
    const id = String(b.id ?? '')
    const answerIndex = Number(b.answerIndex)
    const userEdited = typeof b.userEdited === 'string' ? b.userEdited : ''
    const part = (Number(b.part) === 2 || Number(b.part) === 3 ? Number(b.part) : 1) as SpeakingPart
    const result = await analyzeUserEditedAnswer(ctx, { id, answerIndex, userEdited, part })
    // Review cards you used yourself in your answer.
    creditInBackground(ctx, 'speaking', id)
    return { json: { result } }
  },

  /** Body `{ id, answerIndex }` → `{ result }`: restores original AI answer for a question. */
  'POST /speaking/reset-edit': async (req, ctx) => {
    const b = (req.body ?? {}) as { id?: unknown; answerIndex?: unknown }
    const id = String(b.id ?? '')
    const answerIndex = Number(b.answerIndex)
    const result = await resetUserEditedAnswer(ctx, id, answerIndex)
    return { json: { result } }
  },

  /** → `{ status, model, effort }`: library size, what a sync would tag, the running sync. */
  'GET /speaking/sync': async (_req, ctx) => ({
    json: {
      status: await syncStatus(ctx),
      model: defaultSpeakingEngine() === 'antigravity' ? antigravityModel() : (speakingModel() || 'Claude'),
      effort: speakingEffort(),
    },
  }),

  /** Body `{ limit? }`: tag at most `limit` items (a trial run). */
  'POST /speaking/sync': guarded(async (req, ctx) => {
    const limit = Number((req.body as { limit?: unknown } | undefined)?.limit)
    return { status: 202, json: { job: await startSync(ctx, { limit: Number.isFinite(limit) ? limit : undefined }) } }
  }),

  'POST /speaking/sync/stop': guarded(() => ({ json: { job: stopSync() ?? null } })),
}
