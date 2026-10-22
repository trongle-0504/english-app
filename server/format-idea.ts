// A learner's idea (Speaking's "Ý của bạn", Writing Review's Vietnamese text) laid out for reading, one way for both
// pages: the AI fixes spelling, punctuation and capitals, splits the text into paragraphs, and marks its parts with
// short bold labels or headings — it never adds, drops, summarises, translates or reorders an idea. Code then checks
// that: nearly every word of the learner's text is still there and almost nothing new came in; a layout that fails the
// check is dropped (the page shows the text as typed). Ideas are formatted when a result is made, and on demand for
// older results (POST /api/idea/format).
import path from 'node:path'
import { z } from 'zod'
import type { FormattedIdea, IdeaBlock, SpeakingResult } from '../src/types/speaking.ts'
import type { WritingReviewResult } from '../src/types/writingReview.ts'
import { ApiError, type ApiContext } from './api.ts'
import { userPath } from './paths.ts'
import type { JsonModel } from './annotate.ts'
import { readJsonFile, writeJsonFile } from './files.ts'

const FormatSchema = z.object({
  blocks: z.array(
    z.object({
      kind: z.enum(['heading', 'paragraph', 'bullet']).catch('paragraph'),
      label: z.string().optional().describe('Short bold label before the text (1-6 words), e.g. "Ý 1", "Khó khăn"; omit when none.'),
      text: z.string(),
    }),
  ),
})

const FORMAT_SYSTEM = `You lay out a Vietnamese learner's notes (the ideas for an IELTS answer or essay) so they are easy to read. The notes are often typed in a hurry: run-on lines, missing punctuation, typos.
Allowed, and nothing else:
- fix spelling and typos (Vietnamese diacritics, English words), punctuation, spacing and capital letters;
- split the text into paragraphs; put items the learner lists one after another as bullets;
- mark the parts of the outline: a heading for a section ("MỞ BÀI", "THÂN BÀI 1", "KẾT BÀI") and a short bold label before a paragraph ("Ý 1", "Khó khăn", "Kết quả") — use the learner's own words for them when the text has them; add one only where a part clearly starts.
Never add, drop, summarise, explain, translate or reorder an idea; keep every detail, name and number, and keep the learner's wording (Vietnamese stays Vietnamese, English stays English). When in doubt, leave the text as it is.
Output blocks in the order of the text: kind heading (the heading in text, no label), paragraph or bullet (an optional label, then the learner's words in text). A part's label goes in "label", never at the start of "text": "Ý 1 — Ai, biết đến thế nào: Hôm nay tôi…" is label "Ý 1 — Ai, biết đến thế nào", text "Hôm nay tôi…".`

/** Words without tone marks, lower case: a corrected diacritic still counts as the learner's word. */
const words = (text: string) =>
  (
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  )

/**
 * The layout keeps the learner's ideas: at least 90% of the learner's distinct words are in it, at most 12% of the
 * words of its texts are new (spelling fixes), and the headings and labels the AI added are short and few (a heading
 * or label in the learner's own words may be as long as the learner made it).
 */
function keepsIdeas(original: string, blocks: IdeaBlock[]): boolean {
  const had = new Set(words(original))
  const texts = blocks.flatMap((b) => (b.kind === 'heading' ? [] : words(b.text)))
  const extras = blocks.map((b) => [...(b.kind === 'heading' ? words(b.text) : []), ...words(b.label ?? '')])
  const kept = new Set([...texts, ...extras.flat()])
  const coverage = had.size ? [...had].filter((w) => kept.has(w)).length / had.size : 1
  const novelty = texts.length ? texts.filter((w) => !had.has(w)).length / texts.length : 0
  const added = extras.map((ws) => ws.filter((w) => !had.has(w)))
  const fewAdded = added.every((ws) => ws.length <= 6) && added.flat().length <= Math.max(12, texts.length * 0.1)
  return coverage >= 0.9 && novelty <= 0.12 && fewAdded
}

/** A paragraph that starts with its own label ("Ý 1 — Ai: …", "Khó khăn: …") gets it as a bold label. */
function labelOf(block: IdeaBlock): IdeaBlock {
  if (block.kind === 'heading' || block.label) return block
  const head = /^([^:.!?\n]{1,70}):\s+([\s\S]+)$/.exec(block.text)
  return head ? { ...block, label: head[1].trim(), text: head[2].trim() } : block
}

/** The learner's idea laid out; `blocks` is [] when the layout failed or changed the ideas. */
export async function formatIdea(idea: string, model: JsonModel, label: string): Promise<FormattedIdea> {
  const text = idea.trim()
  if (!text) return { blocks: [] }
  const value = await model
    .json({ label: `${label}: format idea`, system: FORMAT_SYSTEM, prompt: text, schema: FormatSchema, effort: 'low' })
    .then((r) => r.value)
    .catch((error: Error) => {
      console.warn(`[format-idea] ${label}: skipped (${error.message})`)
      return { blocks: [] }
    })
  const blocks: IdeaBlock[] = value.blocks
    .map((b) => ({ kind: b.kind, ...(b.label?.trim() && b.kind !== 'heading' ? { label: b.label.trim().replace(/[:：]\s*$/, '') } : {}), text: b.text.trim() }))
    .filter((b) => b.text)
    .map(labelOf)
  if (!blocks.length) return { blocks: [] }
  if (!keepsIdeas(text, blocks)) {
    console.warn(`[format-idea] ${label}: layout dropped (it changed the learner's words too much)`)
    return { blocks: [] }
  }
  return { blocks }
}

/* ───────────── On demand, for saved results ───────────── */

export type IdeaSource = { source: 'speaking'; id: string; answerIndex: number } | { source: 'writing'; id: string }

const validId = (id: string) => /^[a-z0-9-]{6,40}$/.test(id)

/**
 * Formats the idea of a saved Speaking answer or Writing review once and saves it with the result; a result already
 * formatted answers at once. `model` is the source page's own model.
 */
export async function formatSavedIdea(ctx: Pick<ApiContext, 'rootDir'> & { userDir?: string }, at: IdeaSource, model: JsonModel): Promise<FormattedIdea> {
  if (!validId(at.id)) throw new ApiError(400, 'Invalid id.')
  if (at.source === 'speaking') {
    const file = ctx.userDir ? userPath(ctx, 'progress', 'speaking', `${at.id}.json`) : path.join(ctx.rootDir, 'progress', 'speaking', `${at.id}.json`)
    const result = await readJsonFile<SpeakingResult | null>(file, null)
    const answer = result?.answers?.[at.answerIndex]
    if (!answer) throw new ApiError(404, 'Answer not found.')
    if (answer.ideaFormatted?.blocks.length) return answer.ideaFormatted
    if (!answer.idea?.trim()) throw new ApiError(400, 'This answer has no idea to format.')
    answer.ideaFormatted = await formatIdea(answer.idea, model, 'speaking')
    // Read again before writing (an edit may have been saved meanwhile); a failed layout is not saved: asked again later.
    const latest = await readJsonFile<SpeakingResult | null>(file, null)
    if (answer.ideaFormatted.blocks.length && latest?.answers?.[at.answerIndex]) {
      latest.answers[at.answerIndex].ideaFormatted = answer.ideaFormatted
      await writeJsonFile(file, latest)
    }
    return answer.ideaFormatted
  }
  const file = ctx.userDir ? userPath(ctx, 'progress', 'writing-reviews', `${at.id}.json`) : path.join(ctx.rootDir, 'progress', 'writing-reviews', `${at.id}.json`)
  const result = await readJsonFile<WritingReviewResult | null>(file, null)
  if (!result) throw new ApiError(404, 'Writing review not found.')
  if (result.vietnameseFormatted?.blocks.length) return result.vietnameseFormatted
  if (!result.vietnameseText?.trim()) throw new ApiError(400, 'This review has no Vietnamese idea to format.')
  const formatted = await formatIdea(result.vietnameseText, model, 'writing')
  const latest = await readJsonFile<WritingReviewResult | null>(file, null)
  if (formatted.blocks.length && latest) {
    latest.vietnameseFormatted = formatted
    await writeJsonFile(file, latest)
  }
  return formatted
}
