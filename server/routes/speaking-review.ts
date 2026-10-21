import { ApiError, type ApiHandler } from '../api.ts'
import { antigravityAvailable } from '../llm/antigravity-cli.ts'
import {
  deleteTalkReview,
  getTalkReview,
  listTalkReviews,
  restartModel,
  retryTalkReview,
  startTalkReview,
  talkAudio,
} from '../speaking-review/review.ts'
import { modelDir, sttAvailable } from '../speaking-review/stt.ts'

/** Practice → Speaking review: record an answer, get it transcribed (on this machine) and reviewed like an examiner. */
export const speakingReviewRoutes: Record<string, ApiHandler> = {
  /** → `{ stt, reviewer, modelDir }`: whether the speech-to-text model and the AI reviewer are there. */
  'GET /speaking-review/status': (_req, ctx) => ({
    json: { stt: sttAvailable(ctx.rootDir), reviewer: antigravityAvailable(), modelDir: modelDir(ctx.rootDir) },
  }),

  /** Body `{ part, question?, topic?, script?, audio }` (audio: 16 kHz mono WAV, base64) → `{ job }` (poll GET ?id=). */
  'POST /speaking-review': async (req, ctx) => {
    if (!sttAvailable(ctx.rootDir)) throw new ApiError(503, `The speech-to-text model is not in ${modelDir(ctx.rootDir)}.`)
    if (!antigravityAvailable()) throw new ApiError(503, "Antigravity CLI ('agy') is not available. Please ensure Antigravity CLI is installed.")
    return { status: 202, json: { job: await startTalkReview(ctx, req.body) } }
  },

  'GET /speaking-review': async (req, ctx) => {
    const job = await getTalkReview(ctx, req.query.get('id') ?? '')
    if (!job) throw new ApiError(404, 'Review not found.')
    return { json: { job } }
  },

  /** The recording (WAV). */
  'GET /speaking-review/audio': async (req, ctx) => ({ body: await talkAudio(ctx, req.query.get('id') ?? ''), contentType: 'audio/wav' }),

  'GET /speaking-review/history': async (_req, ctx) => ({ json: { items: await listTalkReviews(ctx) } }),

  /** Body `{ id }` → `{ job }`: review a failed recording again. */
  'POST /speaking-review/retry': async (req, ctx) => ({
    status: 202,
    json: { job: await retryTalkReview(ctx, String((req.body as { id?: unknown } | undefined)?.id ?? '')) },
  }),

  /** Body `{ id }` → `{ result }`: start the model answer (Speaking ideas) again. */
  'POST /speaking-review/model': async (req, ctx) => ({
    json: { result: await restartModel(ctx, String((req.body as { id?: unknown } | undefined)?.id ?? '')) },
  }),

  'DELETE /speaking-review': async (req, ctx) => {
    await deleteTalkReview(ctx, req.query.get('id') ?? '')
    return { json: { ok: true } }
  },
}
