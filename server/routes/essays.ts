import { guarded } from '../admin/auth.ts'
import * as essays from '../admin/essays.ts'
import { jsonBody, queryParam } from '../admin/input.ts'
import type { ApiHandler } from '../api.ts'
import { dictionaryBox } from '../essays/dictionary.ts'
import { checkRebuild, checkTransfer } from '../essays/practice.ts'

/** Model essays: admin editing (guarded writes) and the practice endpoints under /api/essays. */
export const essayRoutes: Record<string, ApiHandler> = {
  'GET /admin/essays': essays.listEssays,
  'GET /admin/essays/item': essays.getEssay,
  'POST /admin/essays/analyze': guarded(essays.analyzeAndSave),
  'PUT /admin/essays': guarded(essays.saveEssay),
  'DELETE /admin/essays': guarded(essays.deleteEssay),
  'POST /admin/essays/item': guarded(essays.addItem),
  'DELETE /admin/essays/item': guarded(essays.deleteItem),

  'POST /essays/rebuild': async (req, ctx) => ({ json: { feedback: await checkRebuild(ctx, jsonBody(req)) } }),
  'POST /essays/transfer': async (req, ctx) => ({ json: { feedback: await checkTransfer(ctx, jsonBody(req)) } }),
  'GET /essays/dictionary': async (req) => {
    const word = queryParam(req, 'word').slice(0, 60)
    const phrase = (req.query.get('phrase') ?? '').trim().slice(0, 120)
    return { json: await dictionaryBox(word, phrase) }
  },
}
