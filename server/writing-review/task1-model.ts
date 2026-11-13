// Writing Task 1 ↔ the learner's own model essay: where the answer can learn from the model (intro, overview, grouping,
// comparisons, figures, language), and the phrases of the model worth learning, each checked in Longman / OZDIC.
// The model is a source of technique, never of ideas: every quote must be the essays' own words (checked in code).
import { z } from 'zod'
import type {
  WritingTask1Comparison,
  WritingTask1ModelLesson,
  WritingTask1VocabCategory,
  WritingTask1VocabItem,
} from '../../src/types/writingReview.ts'
import { cachedModelVocab, essayHash, saveModelVocab, savedModelEssay, type Task1Context } from '../writing-task1/store.ts'
import type { LlmProvider } from './llm-types.ts'
import { writingCheckEffort } from './llm.ts'
import { CheckSchema, dictionaries, proofOf, verifyPhrase, type DictionaryCheck } from './rewrite.ts'
import { countWords, quoteInSentence } from './score.ts'
import { task1Skill } from './task1.ts'

/* ───────────── Comparison ───────────── */

const AREAS = ['intro', 'overview', 'grouping', 'comparison', 'data', 'language'] as const

export const CompareSchema = z.object({
  summary: z.string().describe('Vietnamese, one sentence: the biggest thing the answer can learn from the model.'),
  points: z.array(
    z.object({
      area: z.enum(AREAS).catch('language'),
      yours: z.string().describe('A few words copied exactly from the ANSWER that this point is about; "" when the answer has nothing for it.'),
      model: z.string().describe('Words copied exactly from the MODEL ESSAY that show the better way.'),
      why: z.string().describe('Vietnamese, at most 30 words: why the model’s way is better for Task 1.'),
      try: z.string().describe('English: the learner’s own sentence redone with the model’s technique, keeping the learner’s figures and ideas.'),
    }),
  ),
})

const COMPARE_SYSTEM = `You are an IELTS Writing Task 1 teacher. A Vietnamese learner wrote an answer; they also have a model essay for the same question. Show what the answer can learn from the model, point by point.
- 3-6 points, most useful first, over these areas: intro (paraphrasing the question), overview (stating main trends/comparisons), grouping (how the body paragraphs group the data), comparison (comparison structures), data (how figures are introduced and varied), language (trend, approximation and linking language).
- Learn TECHNIQUE from the model, never its content: "try" rewrites one of the learner's own sentences (or adds the missing one) with the model's technique, keeping the learner's own figures and ideas.
- "yours" and "model" are copied word for word from the answer and the model essay (a few words to one sentence). Use "" for yours when the answer has nothing for the point.
- Skip points where the answer already does as well as the model. Never invent faults.
- Write "why" and "summary" in Vietnamese; quote English words with curly quotes “ ”.
- The learner studies the guide below; use its terms (paraphrase, overview, STUCP, “followed a similar pattern”…) when they fit.`

/* ───────────── Vocabulary ───────────── */

const CATEGORIES = ['trend', 'comparison', 'proportion', 'approximation', 'overview', 'sequence', 'other'] as const

export const ModelVocabSchema = z.object({
  items: z.array(
    z.object({
      phrase: z.string().describe('The phrase as it appears in the model essay, in its base form when that reads naturally.'),
      category: z.enum(CATEGORIES).catch('other'),
      meaning_vi: z.string().describe('Vietnamese meaning, short.'),
      example: z.string().describe('The model essay’s words that use the phrase, copied exactly.'),
      checks: z.array(CheckSchema).describe('The word combinations inside the phrase for a collocation dictionary; [] for one word.'),
    }),
  ),
})

const VOCAB_SYSTEM = `You pick vocabulary for a Vietnamese IELTS learner from a Task 1 model essay. Choose 6-12 phrases worth learning and reusable in other Task 1 answers: trend verbs and nouns ("climb steadily", "dip"), comparison and proportion structures ("by far the largest share"), approximation ("almost half"), overview frames ("Overall, …"), sequencing and linking ("Over the next two years"). Skip topic words that only fit this chart (charity names, places), plain everyday words, and numbers. checks: for each two-word combination inside the phrase, base = lemma of the headword whose dictionary entry lists it (the noun for verb+noun, adjective+noun and noun+noun; the verb for verb+adverb and verb+preposition; the adjective for adverb+adjective), collocate = lemma of the partner word, pattern.`

/** Dictionary proof of a phrase, or unverified. Lookups go to Longman / OZDIC (cached), within a time budget. */
export type VerifyPhrase = (phrase: string, checks: DictionaryCheck[]) => Promise<Pick<WritingTask1VocabItem, 'verified' | 'dictionary' | 'sources'>>

const VERIFY_BUDGET_MS = 25_000

export function dictionaryVerifier(): VerifyPhrase {
  const dict = dictionaries()
  return async (phrase, checks) => {
    const unverified = { verified: false, dictionary: [], sources: [] }
    const lookup = verifyPhrase(phrase, checks, dict)
      .then((issue) => {
        if (!issue.verified) return unverified
        const proof = proofOf(issue)
        return { verified: true, dictionary: proof.dictionary ?? [], sources: proof.sources ?? [] }
      })
      .catch(() => unverified)
    const timeout = new Promise<typeof unverified>((resolve) => setTimeout(() => resolve(unverified), VERIFY_BUDGET_MS).unref())
    return Promise.race([lookup, timeout])
  }
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/** The answer uses the phrase (its words in a row, ignoring case and punctuation). */
export function usedIn(phrase: string, text: string): boolean {
  const p = words(phrase)
  const t = words(text)
  if (!p.length) return false
  for (let i = 0; i + p.length <= t.length; i++) if (p.every((w, j) => t[i + j] === w)) return true
  return false
}

/** The model essay's sentence that holds `quote`, for an example the model wrote badly. */
function sentenceWith(text: string, quote: string): string {
  return text.split(/(?<=[.!?])\s+|\n+/).find((s) => quoteInSentence(quote, s))?.trim() ?? ''
}

export async function compareWithModel(
  llm: LlmProvider,
  input: { text: string; model: string; prompt?: string; skill: string },
): Promise<WritingTask1Comparison> {
  const { value } = await llm.json({
    label: 'task1 compare',
    system: COMPARE_SYSTEM,
    prompt: [
      `Task 1 question:\n“${input.prompt?.trim() || '(not given)'}”`,
      `The learner's ANSWER:\n${input.text.trim()}`,
      `The MODEL ESSAY:\n${input.model.trim()}`,
      input.skill ? `The guide the learner studies:\n<guide>\n${input.skill}\n</guide>` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    schema: CompareSchema,
    effort: writingCheckEffort(),
  })
  // A point must quote the model; "yours" must be the answer's words or nothing.
  const points = value.points
    .filter((p) => p.model.trim() && quoteInSentence(p.model, input.model) && p.why.trim())
    .map((p) => ({
      area: p.area,
      yours: p.yours.trim() && quoteInSentence(p.yours, input.text) ? p.yours.trim() : '',
      model: p.model.trim(),
      why: p.why.trim(),
      try: p.try.trim(),
    }))
    .slice(0, 6)
  return { summary: value.summary.trim(), points }
}

/** The phrases worth learning (without `used`, which depends on the answer). */
export async function modelVocabulary(
  llm: LlmProvider,
  input: { model: string; prompt?: string },
  verify: VerifyPhrase,
): Promise<Omit<WritingTask1VocabItem, 'used'>[]> {
  const { value } = await llm.json({
    label: 'task1 vocab',
    system: VOCAB_SYSTEM,
    prompt: `Task 1 question:\n“${input.prompt?.trim() || '(not given)'}”\n\nModel essay:\n${input.model.trim()}`,
    schema: ModelVocabSchema,
    effort: 'low',
  })
  const seen = new Set<string>()
  const picked = value.items.filter((item) => {
    const key = item.phrase.trim().toLowerCase()
    // A phrase the model essay does not contain was made up: dropped.
    if (!key || seen.has(key) || !usedIn(item.phrase, input.model)) return false
    seen.add(key)
    return true
  })
  return Promise.all(
    picked.slice(0, 12).map(async (item) => ({
      phrase: item.phrase.trim(),
      category: item.category as WritingTask1VocabCategory,
      meaning_vi: item.meaning_vi.trim(),
      example: quoteInSentence(item.example, input.model) ? item.example.trim() : sentenceWith(input.model, item.phrase),
      ...(await verify(item.phrase.trim(), item.checks)),
    })),
  )
}

// One vocabulary pick at a time per model essay (the one started at "Bắt đầu" is shared with the review).
const vocabPicks = ((globalThis as { __task1VocabPicks?: Map<string, Promise<WritingTask1VocabItem[]>> }).__task1VocabPicks ??= new Map())

/** The model essay's phrases worth learning: from the store, or picked now (shared with a pick already running) and saved. */
export async function modelVocabFor(
  ctx: Task1Context,
  llm: LlmProvider,
  input: { promptId: string; model: string; prompt?: string },
  verify: VerifyPhrase = dictionaryVerifier(),
): Promise<WritingTask1VocabItem[]> {
  const hash = essayHash(input.model)
  const cached = await cachedModelVocab(ctx, input.promptId, hash)
  if (cached) return cached
  const key = `${ctx.rootDir}|${input.promptId}|${hash}`
  let pick = vocabPicks.get(key)
  if (!pick) {
    pick = modelVocabulary(llm, { model: input.model, prompt: input.prompt }, verify)
      .then(async (items) => {
        const withUsed = items.map((item) => ({ ...item, used: false }))
        await saveModelVocab(ctx, input.promptId, hash, withUsed).catch(() => {})
        return withUsed
      })
      .finally(() => vocabPicks.delete(key))
    vocabPicks.set(key, pick)
  }
  return pick
}

/**
 * The model-essay lesson of a Task 1 review: comparison (per answer) and vocabulary (per model essay, cached in the
 * store). Undefined when the question has no model essay.
 */
export async function task1ModelLesson(
  ctx: Task1Context,
  llm: LlmProvider,
  input: { promptId: string; text: string; prompt?: string },
  verify: VerifyPhrase = dictionaryVerifier(),
): Promise<WritingTask1ModelLesson | undefined> {
  const model = await savedModelEssay(ctx, input.promptId)
  if (!model?.text.trim()) return undefined
  const [comparison, vocab] = await Promise.all([
    task1Skill(ctx.rootDir).then((skill) => compareWithModel(llm, { text: input.text, model: model.text, prompt: input.prompt, skill })),
    modelVocabFor(ctx, llm, { promptId: input.promptId, model: model.text, prompt: input.prompt }, verify),
  ])
  return {
    modelUpdatedAt: model.updatedAt,
    modelWords: countWords(model.text),
    comparison,
    vocab: vocab.map((item) => ({ ...item, used: usedIn(item.phrase, input.text) })),
  }
}
