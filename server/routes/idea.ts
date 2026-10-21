import type { JsonModel } from '../annotate.ts'
import { ApiError, type ApiHandler } from '../api.ts'
import { formatSavedIdea, type IdeaSource } from '../format-idea.ts'
import { defaultSpeakingEngine, speakingEffort, speakingJson } from '../speaking/llm.ts'
import { writingReviewModel } from '../writing-review/llm.ts'

/** The learner's idea, shared by Speaking and Writing Review. */
export const ideaRoutes: Record<string, ApiHandler> = {
  /**
   * Body `{ source: 'speaking', id, answerIndex }` or `{ source: 'writing', id }` → `{ formatted }`: the idea laid out
   * for reading (spelling, punctuation, paragraphs, labels; the ideas unchanged), formatted once and saved.
   */
  'POST /idea/format': async (req, ctx) => {
    const b = (req.body ?? {}) as { source?: unknown; id?: unknown; answerIndex?: unknown }
    const id = String(b.id ?? '')
    let at: IdeaSource
    let model: JsonModel
    if (b.source === 'speaking') {
      at = { source: 'speaking', id, answerIndex: Number(b.answerIndex) || 0 }
      const engine = defaultSpeakingEngine()
      model = { json: (call) => speakingJson({ ...call, effort: call.effort ?? speakingEffort(), engine }) }
    } else if (b.source === 'writing') {
      at = { source: 'writing', id }
      model = writingReviewModel()
    } else throw new ApiError(400, 'source must be "speaking" or "writing".')
    return { json: { formatted: await formatSavedIdea(ctx, at, model) } }
  },
}
