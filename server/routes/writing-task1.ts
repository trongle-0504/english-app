import type { ApiHandler } from '../api.ts'
import { parseImages } from '../images.ts'
import { TASK1_MAX_IMAGES } from '../../src/types/writingMock.ts'
import { prepareTask1 } from '../writing-task1/prepare.ts'
import { addImages, getExtras, listExtras, readImage, removeImage, saveModelEssay } from '../writing-task1/store.ts'

/** Writing Mock Test → Task 1: the chart pictures and the model essay the learner adds to a question. */
export const writingTask1Routes: Record<string, ApiHandler> = {
  /** → `{ extras }`: questions with a picture or a model essay. */
  'GET /writing-task1/extras': async (_req, ctx) => ({ json: { extras: await listExtras(ctx) } }),

  /** `?id=` → `{ extras }` of one question. */
  'GET /writing-task1/prompt': async (req, ctx) => ({ json: { extras: await getExtras(ctx, req.query.get('id')) } }),

  /** Body `{ promptId, images: [{ mimeType, data }] }` → `{ extras }`. */
  'POST /writing-task1/images': async (req, ctx) => {
    const b = (req.body ?? {}) as { promptId?: unknown; images?: unknown }
    return { json: { extras: await addImages(ctx, b.promptId, parseImages(b.images, TASK1_MAX_IMAGES)) } }
  },

  /** `?prompt=&n=` → `{ extras }`. */
  'DELETE /writing-task1/image': async (req, ctx) => ({
    json: { extras: await removeImage(ctx, req.query.get('prompt'), req.query.get('n')) },
  }),

  /** `?prompt=&n=` → the WebP picture (behind the login gate like every /api route). */
  'GET /writing-task1/image': async (req, ctx) => ({
    body: await readImage(ctx, req.query.get('prompt'), req.query.get('n')),
    contentType: 'image/webp',
  }),

  /** Body `{ promptId, text }` → `{ extras }`; empty text removes the model essay. */
  'PUT /writing-task1/model-essay': async (req, ctx) => {
    const b = (req.body ?? {}) as { promptId?: unknown; text?: unknown }
    return { json: { extras: await saveModelEssay(ctx, b.promptId, b.text) } }
  },

  /**
   * Body `{ promptId }` → `{ started }`: reads the chart and picks the model essay's vocabulary in the background while
   * the learner writes (called when an attempt starts), so grading only has to score.
   */
  'POST /writing-task1/prepare': async (req, ctx) => {
    const b = (req.body ?? {}) as { promptId?: unknown }
    return { status: 202, json: await prepareTask1(ctx, b.promptId) }
  },
}
