import { ApiError, type ApiHandler } from '../api.ts'
import { geminiConfigured } from '../gemini.ts'
import { guarded, isAuthorized, tokenRequired } from '../admin/auth.ts'
import * as blog from '../admin/blog.ts'
import * as grammar from '../admin/grammar.ts'
import * as notes from '../admin/notes.ts'
import * as usage from '../admin/usage.ts'
import * as vocabulary from '../admin/vocabulary.ts'
import { jsonBody, requiredText } from '../admin/input.ts'
import { prefetchDictionary } from '../admin/ozdic-grounding.ts'
import { getGenerateJob, retryGeneratePart } from '../admin/generate-jobs.ts'
import { drillsForItem, drillsStatus, runNightlyDrills, startDrillsScheduler } from '../admin/drills-nightly.ts'

/**
 * Admin editor endpoints (served under /api). Reads are open; every write goes through `guarded`,
 * which enforces ADMIN_TOKEN when it is set (see server/admin/auth.ts).
 */
export const adminRoutes: Record<string, ApiHandler> = {
  'GET /admin/session': (req) => ({
    json: { tokenRequired: tokenRequired(), authorized: isAuthorized(req), gemini: geminiConfigured() },
  }),

  'GET /admin/vocabulary': vocabulary.listVocabulary,
  'GET /admin/vocabulary/word': vocabulary.getWord,
  'POST /admin/vocabulary/topics': guarded(vocabulary.createTopic),
  'POST /admin/vocabulary/sub-topics': guarded(vocabulary.createSubTopic),
  'POST /admin/vocabulary/generate': guarded(vocabulary.generateWord),
  'PUT /admin/vocabulary/word': guarded(vocabulary.saveWord),
  'GET /admin/vocabulary/images': guarded(vocabulary.searchWordImages),
  'POST /admin/vocabulary/image': guarded(vocabulary.setWordImage),
  // Admin → Vocabulary "Word" field lost focus: warm the Longman/OZDIC cache (no AI, no agy).
  'POST /admin/dictionary/prefetch': guarded(async (req) => ({ status: 202, json: prefetchDictionary(requiredText(jsonBody(req), 'word', { max: 120, collapse: true })) })),
  // Picture / practice made in the background after Generate (Vocabulary and Notes).
  'GET /admin/generate/job': guarded(async (req) => ({ json: { job: getGenerateJob(req.query.get('id') ?? '') } })),
  'POST /admin/generate/job/retry': guarded(async (req) => {
    const body = jsonBody(req)
    const part = body.part === 'image' || body.part === 'practice' ? body.part : null
    if (!part) throw new ApiError(400, '"part" must be "image" or "practice".')
    return { json: { job: retryGeneratePart(requiredText(body, 'id', { max: 100 }), part) } }
  }),
  // Review drills: written by the nightly batch (03:00 VN); status, "Chạy ngay" and "Tạo drills ngay".
  'GET /admin/drills': guarded(async (_req, ctx) => {
    startDrillsScheduler(ctx)
    return { json: await drillsStatus(ctx) }
  }),
  'POST /admin/drills/run': guarded(async (_req, ctx) => {
    startDrillsScheduler(ctx)
    void runNightlyDrills(ctx, 'manual').catch((error) => console.warn('[drills] manual run:', (error as Error).message))
    return { status: 202, json: await drillsStatus(ctx) }
  }),
  'POST /admin/drills/item': guarded(async (req, ctx) => {
    startDrillsScheduler(ctx)
    const body = jsonBody(req)
    const kind = body.kind === 'word' || body.kind === 'note' ? body.kind : null
    if (!kind) throw new ApiError(400, '"kind" must be "word" or "note".')
    return { json: { entry: await drillsForItem(ctx, kind, requiredText(body, 'key', { max: 200, collapse: true })) } }
  }),
  // Adding many words at once: ask Nova Agent (propose_library_add → Confirm → server/coach/library-job.ts).

  'GET /admin/grammar': grammar.listGrammar,
  'GET /admin/grammar/lesson': grammar.getLesson,
  'POST /admin/grammar/topics': guarded(grammar.createTopic),
  'POST /admin/grammar/generate': guarded(grammar.generateLesson),
  'PUT /admin/grammar/lesson': guarded(grammar.saveLesson),

  'GET /admin/notes': notes.listNotes,
  'POST /admin/notes/generate': guarded(notes.generateNote),
  'PUT /admin/notes': guarded(notes.saveNote),
  'DELETE /admin/notes': guarded(notes.deleteNote),
  'GET /admin/notes/images': guarded(notes.searchNoteImages),
  'POST /admin/notes/image': guarded(notes.setNoteImage),

  'GET /admin/usage': guarded(usage.getUsage),
  'PUT /admin/usage/pricing': guarded(usage.savePricing),

  'GET /admin/blog': blog.listBlog,
  'GET /admin/blog/post': blog.getPost,
  'POST /admin/blog/topics': guarded(blog.createTopic),
  'POST /admin/blog/sub-topics': guarded(blog.createSubTopic),
  'PUT /admin/blog/post': guarded(blog.savePost),
  'DELETE /admin/blog/post': guarded(blog.deletePost),
  'POST /admin/blog/images': guarded(blog.uploadImages),
}
