import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  LINEAR_TOOLS,
  type AnswerSegment,
  type AnswerSentence,
  type DolHint,
  type SpeakingPick,
  type UsedStructure,
} from '../../src/types/speaking.ts'
import type { WritingModelEssay, WritingReviewResult } from '../../src/types/writingReview.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { userPath } from '../paths.ts'

const reviewFile = (ctx: Pick<ApiContext, 'rootDir'> & { userDir?: string }, id: string) =>
  ctx.userDir ? userPath(ctx, 'progress', 'writing-reviews', `${id}.json`) : path.join(ctx.rootDir, 'progress', 'writing-reviews', `${id}.json`)
import { readJsonFile, writeJsonFile } from '../files.ts'
import { annotate, keepWritersText, plainOf, replaceInMarked, samePhrase, WordingItemSchema, type UnlistedReplacement } from '../annotate.ts'
import { markSentence } from '../speaking/suggest.ts'
import type { LlmProvider } from './llm-types.ts'
import { chosenHints, dolPromptBlock } from './dol.ts'
import { CheckSchema } from './rewrite.ts'

/**
 * The Task 2 part of the writing guide (content/blog/prompts/writing-skills.md). The study plan and Task 1 sections
 * that follow it (~28 KB, a third of the prompt) never help a Task 2 essay and only slow the call down.
 */
export async function writingLinearGuide(ctx: Pick<ApiContext, 'rootDir'>): Promise<string> {
  try {
    const guide = await readFile(path.join(ctx.rootDir, 'content', 'blog', 'prompts', 'writing-skills.md'), 'utf8')
    const end = guide.search(/^## (Hướng dẫn học IELTS Writing|Task 1\b)/m)
    return (end > 0 ? guide.slice(0, end) : guide).trim()
  } catch {
    return ''
  }
}

const EssayPlanSchema = z.object({
  dol: z
    .array(z.string())
    .describe('Refs (d1, d2…) of the "Dictionary entries (DOL)" that say part of the writer\'s ideas exactly; [] when none were listed.'),
  meaning: z
    .string()
    .describe(
      "Summary of the writer's ideas in English structured as a concise outline with arrows (→), separated by newlines for each paragraph (e.g. 'Intro: ... → ...\\nBody 1: ... → ...\\nBody 2: ... → ...\\nConclusion: ... → ...').",
    ),
  draft: z.array(
    z.object({
      n: z.number().int().describe('Draft sentence number.'),
      verdict: z.enum(['keep', 'fix', 'rewrite']).catch('fix'),
      keep: z.array(z.string()).describe('Exact phrases of this sentence that are correct, natural and precise: the essay keeps them word for word.'),
      problems: z.string().describe('What an examiner would mark down in this sentence, in English; "" when nothing.'),
    }),
  ),
  develop: z
    .array(z.string())
    .describe("0-3 places where an idea needs one more step (cause, effect or example) taken from the writer's own idea; never a new opinion."),
  picks: z
    .array(z.object({ ref: z.string(), idea: z.string().describe("The writer's idea it says exactly.") }))
    .describe("Library candidates that say one of the writer's ideas exactly; [] is normal."),
})
export type EssayPlan = z.infer<typeof EssayPlanSchema>

const WritingModelEssaySchema = z.object({
  picks: z.array(
    z.object({
      ref: z.string().describe('Candidate ref, e.g. "k1".'),
      how: z.string().describe('Vietnamese explanation of how/where this phrase fits, max 20 words.'),
      example: z.string().describe('An example sentence using this phrase in the context of the essay.'),
    }),
  ),
  extras: z.array(
    z.object({
      phrase: z.string().describe('Outside collocation or verb pattern worth learning.'),
      meaning_vi: z.string().describe('Vietnamese meaning.'),
      example: z.string().describe('Example sentence.'),
      checks: z.array(CheckSchema),
    }),
  ),
  sentences: z.array(
    z.object({
      tool: z.enum(LINEAR_TOOLS).catch('description'),
      text: z.string().describe('One sentence. Candidate phrases wrapped in [[ ]], Linearthinking structures/frames wrapped in {{ }}.'),
    }),
  ).describe('The complete model essay sentences. For a full IELTS Task 2 essay, strictly target 270-320 words (prioritize around 300 words). If the input is a single paragraph, target 90-120 words.'),
  structures: z.array(
    z.object({
      pattern: z.string().describe('As written in the Linearthinking guide, e.g. "This results in N", ", which + V", "This enables sb to V".'),
      text: z.string().describe('ONLY the short fixed framing words of the pattern used in the sentence (1-5 words, e.g. "It is true that", "One possible issue is that", "For instance,", ", which can lead to"), NEVER the full sentence or clause.'),
      tool: z.enum(LINEAR_TOOLS).catch('description'),
      from_guide: z.boolean(),
    }),
  ),
})

const EssayReviewSchema = z.object({
  sentences: z.array(
    z.object({
      n: z.number().int().describe('Sentence number.'),
      verdict: z.enum(['ok', 'edit']).catch('ok').describe('ok = natural and right for a written essay as it is.'),
      edits: z.array(
        z.object({
          original: z.string().describe('Shortest exact substring of this sentence, as printed without brackets.'),
          replacement: z.string().describe('"" drops the words.'),
          kind: z.enum(['meaning', 'natural', 'register', 'overwritten', 'clumsy', 'consistency']).catch('natural'),
          why: z.string().describe('Vietnamese, max 25 words.'),
        }),
      ),
    }),
  ),
})

export function sanitizeSentenceMarkers(raw: string): string {
  return raw.replace(/\{\{([\s\S]*?)\}\}/g, (match, inner) => {
    const trimmed = inner.trim()
    const words = trimmed.split(/\s+/)
    if (words.length <= 6 && trimmed.length <= 40) {
      return match
    }
    const frameMatch = trimmed.match(
      /^(It is true that|Although|Even though|While|In contrast|On the one hand,?|On the other hand,?|One possible issue is that|Another detrimental effect could be that|The most obvious benefit could be that|Another merit worth mentioning is that|For instance,?|For example,?|To illustrate,?|This is because|This results in|This leads to|This allows|This enables|In conclusion,?|To sum up,?|Overall,?|Nevertheless,?|Moreover,?|Furthermore,?|Consequently,?|As a result,?|there can be some minor|which can give rise to|which can lead to|and thus|thereby)([\s\S]*)$/i,
    )
    if (frameMatch) {
      const frame = frameMatch[1].trim()
      const remainder = frameMatch[2]
      return `{{${frame}}}${remainder}`
    }
    return trimmed
  })
}

export function sanitizeStructureText(text: string, pattern: string): string {
  let t = text.trim().replace(/^[,.;:\s]+|[,.;:\s]+$/g, '')
  const words = t.split(/\s+/)
  if (words.length <= 6 && t.length <= 40) return t

  const knownPrefixRegex =
    /^(It is true that|Although|Even though|While|In contrast|On the one hand|On the other hand|One possible issue is that|Another detrimental effect could be that|The most obvious benefit could be that|Another merit worth mentioning is that|For instance|For example|To illustrate|This is because|This results in|This leads to|This allows|This enables|In conclusion|To sum up|Overall|Nevertheless|Moreover|Furthermore|Consequently|As a result|there can be some minor|which can give rise to|which can lead to|and thus|thereby)/i
  const match = t.match(knownPrefixRegex)
  if (match) return match[1]

  const placeholderIndex = pattern.search(/(\bS\b|\bV\b|\bN\b|\bdoing\b|\bsb\b|\bVerb\b|\+)/)
  if (placeholderIndex > 0) {
    const rawPrefix = pattern.slice(0, placeholderIndex).trim().replace(/^[,.;:\s]+|[,.;:\s+]+$/g, '')
    if (rawPrefix.length >= 3 && t.toLowerCase().includes(rawPrefix.toLowerCase())) {
      return rawPrefix
    }
  }

  return words.slice(0, 4).join(' ')
}

/** Thinking for the model-essay steps (plan, write, review, dictionary fix): WRITING_ESSAY_EFFORT, default medium. */
const essayEffort = () =>
  (['low', 'medium', 'high', 'xhigh', 'max'] as const).find((l) => l === process.env.WRITING_ESSAY_EFFORT) ?? 'medium'

const ESSAY_PLAN_SYSTEM = `You are an IELTS Writing Task 2 examiner preparing a model essay for a Vietnamese learner. You do not write the essay: you read the learner's draft and decide what the model essay keeps and what it changes.
The Vietnamese text is what the learner means (ground truth). The corrected draft is the learner's English after confirmed spelling, grammar and collocation fixes; the original draft is shown for reference. Paragraph labels such as "Mở bài:", "Thân bài 1:", "Kết bài:" only mark paragraphs.
- meaning: the learner's ideas as a concise English outline with arrows (→), one line per paragraph ("Intro: … → …", "Body 1: …", "Body 2: …", "Conclusion: …").
- draft: one item per corrected draft sentence:
  * verdict: keep = a skilled writer would write this sentence exactly this way in an essay (frames included); fix = the idea and most of the wording are right, but some part is wrong, clumsy, wordy, vague, too spoken or too formal for an essay, or reads like a translation; rewrite = unclear, wrong or clumsy as a whole, so the idea is said again from the Vietnamese.
  * keep: the phrases of the sentence that are correct, natural, concise and precise, copied exactly — plain ones too. Plain and correct beats formal and rare: a phrase is never marked for change just because a more academic synonym exists ("use technology" is better than "utilise technological devices").
  * problems: what an examiner would mark down. Grammatical is not enough: wrong words, unnatural combinations, Vietnamese-style or word-for-word phrasing, wordy or roundabout wording ("there are many negative effects of people working from home" → "working from home has several drawbacks"; "people who live in the area of the countryside" → "people in rural areas"), vague words, weak logic, a claim the idea does not support; "" when nothing.
- develop: at most 3 places where an idea is too thin to convince a reader and needs one more Linearthinking step (cause, effect or a concrete example) built from the learner's own idea; never a new opinion. [] when the draft is developed enough.
- picks: a library candidate only when it says exactly one of the learner's ideas and would sit naturally in that sentence. Most candidates will not fit; [] is normal.
- dol: the refs of the DOL entries that say part of the learner's idea exactly.`

const WRITING_ESSAY_SYSTEM = (guide: string) => `You are an IELTS Writing Task 2 coach writing a model essay from a Vietnamese learner's draft, following the Linearthinking® method and an examiner's plan.
The goal is natural, accurate English that fits a written essay: the words a skilled writer would choose for this context — clear and precise, neither spoken and casual ("kids", "a lot of", "stuff") nor rare, long or formal for show. The best model essay is the learner's own essay done right: the same ideas in the same order, the learner's correct wording kept, every error fixed, every unclear or thin point said clearly.

1. START FROM THE DRAFT, SENTENCE BY SENTENCE, AS THE PLAN SAYS:
   - keep: use the sentence as it is.
   - fix: keep the sentence and its "keep" phrases word for word; say the parts the plan's problems name the way a skilled writer would — concise, direct, idiomatic, in plain words.
   - rewrite: say the Vietnamese idea again in plain, precise English.
   - Every phrase the plan lists under "keep" appears exactly as written. Never swap a correct word for a rarer synonym (use → utilise, help → facilitate, cause → precipitate, show → manifest, a lot of → a plethora of).
   - Keep the learner's Linearthinking frames where they fit; the guide's templates are welcome.
2. MEANING: exactly the learner's ideas (the Vietnamese is the ground truth). Develop only where the plan's "develop" says, from the learner's own idea. No new opinions, numbers, or claims stronger than the learner's ("dramatically", "drastically", "substantially" when the learner said "can").
3. LENGTH: a full essay is 270–320 words (about 300); one paragraph is 90–120 words. Reach it by developing the learner's ideas, never by padding.
4. STYLE: one idea per sentence, stated directly. Avoid what examiners mark down as over-writing: noun stacks ("the risk of the development of lung disease" → "the risk of lung disease"), stacked adjectives or intensifiers, redundant pairs ("past history", "future plans"), two unlike things joined by "and" ("lack experience and public transport"), vague formal nouns ("vehicular mobility solutions" → "cars"), clichés ("a double-edged sword"). Contrast pairs (other topics — style only, never copy their words or content):
   ✗ "they are compelled to engage in self-study by downloading past exam questions"   ✓ "they have to study on their own, using past exam papers they download"
   ✗ "This practice can cause acute physical exhaustion, since these learners frequently stay up late over multiple consecutive months."   ✓ "This can be exhausting, as many of them have to stay up late revising for months."
   ✗ "this rigorous process also enables them to cultivate greater self-reliance and thus significantly eases the financial burden placed upon their parents"   ✓ "this also makes them more independent and eases the financial burden on their parents"
   ✗ "a substantial escalation in vehicular congestion"   ✓ "a sharp rise in traffic"
5. LIBRARY PHRASES: use only the approved candidates listed, each only where it says that idea exactly; using none is fine. Never stretch a sentence around one or add a sentence to hold one.
   extras: 0-3 phrases outside the candidates that a skilled writer would naturally use for these ideas in an essay — common, dictionary-listed combinations, each used in the essay. checks: the word combinations inside the phrase for a collocation dictionary (base = lemma of the headword whose entry lists it: the noun for verb+noun, adjective+noun and noun+noun; the verb for verb+preposition; the adjective for adverb+adjective; collocate = lemma of the partner word, pattern); [] for one word.
6. DICTIONARY ENTRIES (DOL), when listed: the dictionary's English for the learner's Vietnamese ideas. Where the draft says one of these ideas wrongly, prefer the entry's wording.
7. MARKERS in "sentences":
   - Wrap each approved candidate or extra used in [[ ]] (inflected forms are fine).
   - Wrap only the short fixed words of each Linearthinking frame (1-5 words) in {{ }}; never a clause or a whole sentence. Examples (other topics):
     {{It is true that}} more people now work from home…
     {{Although}} this trend has some drawbacks, the benefits…
     {{One possible issue is that}} remote workers may feel isolated…
     … {{which can lead to}} [[a drop in productivity]].
     {{For instance,}} employees may miss informal chats with colleagues…
     {{This is because}} public transport is cheaper than driving…
     {{This enables}} commuters to save money…
     {{In conclusion,}} despite these drawbacks, …
   - Everything else is plain text. Never nest or overlap [[ ]] and {{ }}.
8. OUTPUT:
   - sentences: the essay, one sentence each, with its Linearthinking tool ('lead_in', 'introduction', 'answer', 'description', 'cause', 'effect', 'example', 'specify', 'conclusion'). No paragraph labels.
   - picks: the approved candidates you used (by ref), with how (Vietnamese, max 20 words) and an example sentence.
   - structures: each frame used: the pattern as in the guide, its short fixed words exactly as in the essay (1-5 words), the tool, from_guide.

<linearthinking_guide>
${guide || '(Follow standard Linearthinking: Topic sentence -> Cause -> Effect -> Example -> Conclusion with linking words and This + verb patterns)'}
</linearthinking_guide>`

const ESSAY_REVIEW_SYSTEM = `You are a strict IELTS Writing examiner and a native-speaker editor. You get a model Task 2 essay a coach wrote from a Vietnamese learner's draft, with the learner's idea (Vietnamese) and draft. In the essay, [[ ]] = suggested phrases and {{ }} = Linearthinking frames.
Edit only what an examiner would mark down:
- meaning: wording that changes, overstates or adds to the learner's idea (compare every sentence with the Vietnamese). A shorter or more specific way to say the same idea is not a meaning change ("a part-time job" for "a job which is not full time").
- natural: combinations or word choices an educated native writer would not use; two unlike things joined by "and".
- register: words too spoken or casual for an essay ("kids", "a lot of", "stuff", "get fired") or too formal or rare for the point ("utilise", "plethora"); the word that fits written English in this context.
- overwritten: a rare or formal word where a plain one is clearer ("facilitate" → "help", "precipitate" → "cause"), noun stacks ("the risk of the development of lung disease" → "the risk of lung disease"), redundant words ("past history" → "history"), stacked adjectives or intensifiers, vague abstract nouns ("vehicular mobility solutions" → "cars"), a suggested phrase squeezed in where it does not fit.
- clumsy: grammatical but wordy, roundabout or word-for-word phrasing a skilled writer would say more directly ("there are many negative effects of people working from home" → "working from home has several drawbacks"; "people who live in the area of the countryside" → "people in rural areas"; "in the case that" → "if").
- consistency: a thesis or conclusion that names points the body never makes, or a body point the conclusion contradicts; the same word or idea repeated close together.
When an edit is needed and the learner's draft says that thing correctly and naturally, use the learner's words. Never undo the essay's improvements: wording that is already natural and precise stays, even when the draft said it differently. Keep the frames that read naturally, the order of ideas and the length (±10%). Dropping a [[ ]] phrase is fine when it is what sounds forced (the replacement is then plain words). An essay that needs no edits gets none: never edit for the sake of it.
Go through EVERY sentence, one item each: read it as an examiner would and give verdict ok (natural and right for a written essay; no edits) or edit (with the edits). For each edit: original = the shortest exact substring of that sentence as printed, without brackets; replacement; kind; why in Vietnamese (at most 25 words).`

export interface CandidateItem {
  id: string
  term: string
  slot?: string
  meaning_vi: string
  origin: string
  example?: string
  isTopicCollocation?: boolean
}

export interface EssayInput {
  /** The writer's English draft as typed. */
  text: string
  vietnameseText?: string
  /** The draft after the review's confirmed fixes: the essay starts from it. */
  correctedSentences?: string[]
  candidates: CandidateItem[]
  guide: string
  dolHints?: DolHint[]
  onStep?: (step: string) => void
}

export interface EssayReviewEdit {
  original: string
  replacement: string
  kind: string
  why: string
}

const tidy = (text: string) =>
  text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/^[\s,;:]+/, '')
    .trim()

/** A library phrase still in the essay: some [[ ]] span says it (inflected or slightly shortened forms count). */
const pickUsed = (term: string, wrapped: string[]) => wrapped.some((w) => samePhrase(term, w))

/**
 * The examiner's pass over the written essay: edits only what an examiner would mark down (meaning drift, unnatural or
 * over-written wording, an inconsistent conclusion), preferring the learner's own words. Edits `lines` in place and
 * drops sentences an edit empties; returns the edits made.
 */
async function reviewEssay(
  lines: { tool: AnswerSentence['tool']; text: string }[],
  draft: { text: string; vietnameseText?: string },
  llm: LlmProvider,
): Promise<EssayReviewEdit[]> {
  const value = await llm
    .json({
      label: 'writing: essay review',
      system: ESSAY_REVIEW_SYSTEM,
      prompt: [
        ...(draft.vietnameseText?.trim() ? [`Learner's idea (Vietnamese):\n"${draft.vietnameseText.trim()}"\n`] : []),
        `Learner's draft:\n"${draft.text.trim()}"`,
        `\nModel essay, one sentence per line:\n${lines.map((l, i) => `${i + 1}. [${l.tool}] ${l.text}`).join('\n')}`,
      ].join('\n'),
      schema: EssayReviewSchema,
      effort: essayEffort(),
    })
    .then((r) => r.value)
    .catch((error: Error) => {
      console.warn(`[writing-review] essay review skipped (${error.message})`)
      return { sentences: [] }
    })
  return applyEssayEdits(
    lines,
    value.sentences.flatMap((s) => s.edits.map((e) => ({ ...e, sentence: s.n }))),
  )
}

/** Edits applied to the essay's marked lines (numbered as given); sentences an edit emptied go. */
function applyEssayEdits(
  lines: { tool: AnswerSentence['tool']; text: string }[],
  edits: (Omit<EssayReviewEdit, 'original' | 'replacement'> & { sentence: number; original: string; replacement: string })[],
): EssayReviewEdit[] {
  const done: EssayReviewEdit[] = []
  for (const edit of edits) {
    const line = lines[edit.sentence - 1]
    const original = edit.original.replace(/\[\[|\]\]|\{\{|\}\}/g, '').trim()
    const replacement = edit.replacement.replace(/\[\[|\]\]|\{\{|\}\}/g, '').trim()
    if (!line || !original || original === replacement) continue
    const next = replaceInMarked(line.text, original, replacement)
    if (next === null) {
      console.warn(`[writing-review] essay edit not in sentence ${edit.sentence}: "${original}"`)
      continue
    }
    line.text = tidy(next)
    done.push({ original, replacement, kind: edit.kind, why: edit.why })
  }
  for (let i = lines.length - 1; i >= 0; i--) if (!plainOf(lines[i].text).replace(/[\s.,;:!?]/g, '')) lines.splice(i, 1)
  return done
}

const PlanNotesSchema = z.object({
  notes: z.array(
    z.object({
      n: z.number().int().describe('Note number.'),
      sentence: z.number().int().describe('The essay sentence that says this draft sentence\'s idea.'),
      resolved: z.boolean().describe('True when that essay sentence no longer has the problem.'),
      original: z.string().describe('When not resolved: shortest exact substring of that essay sentence, as printed without brackets; "" otherwise.'),
      replacement: z.string().describe('When not resolved: the fix; "" otherwise.'),
      why: z.string().describe('Vietnamese, max 25 words.'),
    }),
  ),
})

const PLAN_NOTES_SYSTEM = `You check that a model essay fixed the problems an examiner noted in a Vietnamese learner's draft. In the essay, [[ ]] = suggested phrases and {{ }} = Linearthinking frames.
For EVERY note, one item: find the essay sentence that says that draft sentence's idea; resolved = true when that sentence no longer has the problem. When it still has it, give one edit: original = the shortest exact substring of that essay sentence as printed, without brackets; replacement = the fix, in natural written English that fits an essay — plain and precise, never more formal or rarer than needed; everything else in the sentence stays. why in Vietnamese (at most 25 words).`

/**
 * The plan's notes checked one by one against the written essay (the writer sometimes keeps a draft sentence the plan
 * said to fix): each still-present problem gets its edit. Edits `lines` in place.
 */
async function checkPlanNotes(
  lines: { tool: AnswerSentence['tool']; text: string }[],
  notes: string[],
  llm: LlmProvider,
): Promise<EssayReviewEdit[]> {
  if (!notes.length) return []
  const value = await llm
    .json({
      label: 'writing: plan notes',
      system: PLAN_NOTES_SYSTEM,
      prompt: [
        `Essay, one sentence per line:\n${lines.map((l, i) => `${i + 1}. ${l.text}`).join('\n')}`,
        `\nNotes on the draft ("draft sentence" — problem):\n${notes.map((n, i) => `${i + 1}. ${n}`).join('\n')}`,
      ].join('\n'),
      schema: PlanNotesSchema,
      effort: essayEffort(),
    })
    .then((r) => r.value)
    .catch((error: Error) => {
      console.warn(`[writing-review] plan notes check skipped (${error.message})`)
      return { notes: [] }
    })
  return applyEssayEdits(
    lines,
    value.notes.filter((n) => !n.resolved && n.original.trim()).map((n) => ({ ...n, kind: 'plan' })),
  )
}

/**
 * The model essay, in steps (quality over time):
 * 1. plan: an examiner reads the corrected draft sentence by sentence — keep / fix / rewrite, the phrases to keep word
 *    for word, where an idea is too thin, which library phrases truly fit;
 * 2. write: the essay from the corrected draft as the plan says (the learner's correct wording stays);
 * 3. check: each problem the plan noted is checked against the essay, and fixed where it is still there;
 * 4. review: an examiner edits what would be marked down (meaning, register, unnatural, clumsy or over-written wording,
 *    consistency), up to two rounds;
 * 5. wording: every collocation listed and looked up in Longman / OZDIC;
 * 6. unlisted: what the AI wrote that the dictionaries do not list becomes the learner's words or a listed combination
 *    where an examiner would mark it down (see fixUnlisted).
 */
export async function generateWritingModelEssay(
  input: EssayInput,
  llm: LlmProvider,
): Promise<WritingModelEssay & { dolRefs: string[]; unlistedFixes: UnlistedReplacement[]; reviewEdits: EssayReviewEdit[]; plan: EssayPlan }> {
  const { text, vietnameseText, candidates, guide, dolHints = [], onStep } = input
  const byRef = new Map(candidates.map((c, i) => [`k${i + 1}`, c]))
  const unref = (str: string) => str.replace(/\bk\d+\*?/g, (ref) => byRef.get(ref.replace('*', ''))?.term ?? ref)
  const draftSentences = input.correctedSentences?.length ? input.correctedSentences : [text.trim()]
  const draftBlock = draftSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const idea = vietnameseText?.trim() ? [`Learner's idea (Vietnamese, ground truth):\n"${vietnameseText.trim()}"`] : []

  // 1. Plan
  onStep?.('essay_plan')
  const candidateLines = [...byRef].map(([ref, c]) => `${ref}|${c.term}|${c.meaning_vi}|${(c.example ?? '').slice(0, 90)}`).join('\n')
  const { value: plan } = await llm.json({
    label: 'writing: essay plan',
    system: ESSAY_PLAN_SYSTEM,
    prompt: [
      ...idea,
      `\nOriginal draft:\n"${text.trim()}"`,
      `\nCorrected draft, one sentence per line:\n${draftBlock}`,
      `\nLibrary candidates (ref|phrase|meaning|example):\n${candidateLines || '(none)'}`,
      ...(dolHints.length ? [`\nDictionary entries (DOL):\n${dolPromptBlock(dolHints)}`] : []),
    ].join('\n'),
    schema: EssayPlanSchema,
    effort: essayEffort(),
  })

  // 2. Write
  onStep?.('model_essay')
  const approved = plan.picks.map((p) => ({ ref: p.ref.trim().replace(/\*$/, ''), idea: p.idea })).filter((p) => byRef.has(p.ref))
  const chosenDol = chosenHints(dolHints, plan.dol)
  const { value } = await llm.json({
    label: 'writing: model essay',
    system: WRITING_ESSAY_SYSTEM(guide),
    prompt: [
      ...idea,
      `\nCorrected draft, one sentence per line:\n${draftBlock}`,
      `\nExaminer's plan:\nOutline:\n${plan.meaning}\n\nSentence plan:\n${planLines(plan)}`,
      `\nDevelop:\n${plan.develop.map((d) => `- ${d}`).join('\n') || '(nothing: the draft is developed enough)'}`,
      `\nApproved library candidates (ref|phrase|meaning|the idea it says):\n${
        approved.map((p) => `${p.ref}|${byRef.get(p.ref)!.term}|${byRef.get(p.ref)!.meaning_vi}|${p.idea}`).join('\n') || '(none)'
      }`,
      ...(chosenDol.length ? [`\nDictionary entries (DOL):\n${dolPromptBlock(chosenDol)}`] : []),
    ].join('\n'),
    schema: WritingModelEssaySchema,
    effort: essayEffort(),
  })
  const lines = (value.sentences || [])
    .filter((s) => s.text.trim())
    .map((s) => ({ tool: s.tool, text: unref(sanitizeSentenceMarkers(s.text.trim())) }))

  // 3. Review: a second round only when the first changed something.
  onStep?.('essay_review')
  // The plan's problems, each with its draft sentence, checked one by one; then the examiner's review of the whole.
  const notes = plan.draft
    .filter((d) => d.verdict !== 'keep' && d.problems.trim() && draftSentences[d.n - 1])
    .map((d) => `"${draftSentences[d.n - 1]}" — ${d.problems.trim()}`)
  const reviewEdits: EssayReviewEdit[] = await checkPlanNotes(lines, notes, llm)
  for (let round = 0; round < 2; round++) {
    const edits = await reviewEssay(lines, { text, vietnameseText }, llm)
    reviewEdits.push(...edits)
    if (!edits.length) break
  }

  // 5. Every combination found and looked up, what the AI wrote that the dictionaries do not list fixed (see annotate).
  onStep?.('essay_dictionary')
  const usedRefs = (value.picks || []).map((p) => byRef.get(p.ref.trim().replace(/\*$/, ''))).filter((c): c is CandidateItem => Boolean(c))
  const annotation = await annotate(
    {
      sentences: lines.map((l) => l.text),
      picks: usedRefs.map((c) => ({ term: c.term, slot: c.slot })),
      extras: value.extras || [],
      learnerText: [text, ...(input.correctedSentences ?? [])],
      mode: 'model',
      kind: 'an IELTS Writing Task 2 model essay (written English)',
      dolHints: chosenDol,
      effort: essayEffort(),
      label: 'writing',
    },
    llm,
  )
  const markedSentences = annotation.sentences

  // Library phrases still in the essay after the review.
  const wrapped = markedSentences.flatMap((s) => [...s.matchAll(/\[\[([\s\S]*?)\]\]/g)].map((m) => m[1]))
  const seenPicks = new Set<string>()
  const picks: SpeakingPick[] = []
  for (const p of value.picks || []) {
    const c = byRef.get(p.ref.trim().replace(/\*$/, ''))
    if (!c || seenPicks.has(c.id) || !pickUsed(c.term, wrapped)) continue
    seenPicks.add(c.id)
    picks.push({
      cardId: c.id,
      term: c.term,
      slot: c.slot,
      meaning_vi: c.meaning_vi,
      origin: c.origin,
      how: unref(p.how),
      example: unref(p.example),
      inReview: false,
      learning: false,
      isTopicCollocation: c.isTopicCollocation ?? c.id.startsWith('topic-colloc:'),
    })
  }

  const cleanStructures = (value.structures || []).map((st) => ({ ...st, text: sanitizeStructureText(st.text, st.pattern) }))
  const structureTexts = cleanStructures.map((st) => st.text).filter((txt) => txt.split(/\s+/).length <= 6 && txt.length <= 40)
  const sentences: AnswerSentence[] = lines.map((l, i) => ({
    tool: l.tool,
    segments: markSentence(markedSentences[i], annotation.extras, structureTexts, annotation.perSentence[i], picks, annotation.note),
  }))
  const structures: UsedStructure[] = cleanStructures.map((st) => ({
    pattern: st.pattern,
    text: st.text,
    tool: st.tool,
    fromGuide: st.from_guide,
  }))

  return {
    meaning: plan.meaning,
    sentences,
    structures,
    wording: annotation.wording,
    picks,
    extras: annotation.extras,
    coverage: annotation.report,
    // Which DOL entries fit the writer's ideas (rewrite.ts keeps those for the page; not saved in the essay).
    dolRefs: plan.dol ?? [],
    // Not saved: rewrite.ts logs them.
    unlistedFixes: annotation.fixes,
    reviewEdits,
    plan,
  }
}

/** The plan's verdict per draft sentence, for the writing call. */
const planLines = (plan: EssayPlan) =>
  plan.draft
    .map((d) =>
      [
        `${d.n}. [${d.verdict}]`,
        d.keep.length ? ` keep: ${d.keep.map((k) => `"${k}"`).join(', ')}` : '',
        d.problems.trim() ? ` | problems: ${d.problems.trim()}` : '',
      ].join(''),
    )
    .join('\n')

/* ───────────── User In-Place Editing ───────────── */

const AnalyzeWritingEditSchema = z.object({
  sentences: z.array(
    z.object({
      tool: z.enum(LINEAR_TOOLS).catch('description'),
      marked_text: z
        .string()
        .describe(
          "The writer's exact sentence without altering any words, wrapping library/topic collocations in [[ ]] and Linearthinking structures/markers in {{ }}.",
        ),
    }),
  ),
  structures: z.array(
    z.object({
      pattern: z.string().describe('The pattern as in the guide or extended, e.g. "This results in N", ", which + V".'),
      text: z.string().describe("The exact short framing words used in the writer's sentence (1-5 words), NEVER the entire clause or sentence."),
      tool: z.enum(LINEAR_TOOLS).catch('description'),
      from_guide: z.boolean(),
    }),
  ),
  wording: z.array(WordingItemSchema),
})

const ANALYZE_WRITING_EDIT_SYSTEM = (guide: string, picksList: string) => `You are an expert IELTS Writing Task 2 examiner and coach.
You analyze a candidate's customized revision for their essay.

CRITICAL REQUIREMENTS:
1. PRESERVE 100% of the candidate's exact words, punctuation, and capitalization.
2. DO NOT rewrite, paraphrase, correct, improve, add, or delete ANY word or letter.
3. Your role is strictly to:
   - Split the text into sentences
   - Classify each sentence's Linearthinking function ('lead_in', 'introduction', 'answer', 'description', 'cause', 'effect', 'example', 'specify', 'conclusion')
   - Mark Linearthinking structures in {{ }} and collocations/vocabulary in [[ ]]
   - Extract structures and collocations for dictionary verification.

TASKS:
1. Split the candidate's text into sentences.
2. For each sentence:
   - Identify its Linearthinking tool:
     - lead_in: background statement, topic paraphrase
     - introduction: thesis statement, stance
     - answer: main argument, core topic sentence
     - description / specify: expanding or clarifying the main idea
     - cause: reason, motive, explanation ("This is because...", "due to", "since/as")
     - effect: result, consequence ("This results in...", ", which + V", ", thereby V-ing", "and thus")
     - example: illustration ("For example,...", "For instance,...")
     - conclusion: wrap-up sentence ("In conclusion,...", "Overall,...")
   - In "marked_text":
     - Wrap Linearthinking structures or sentence framing markers in {{ }}.
       CRITICAL: In {{ }}, wrap ONLY the short fixed framing words (1 to 5 words). NEVER wrap normal sentence content, clauses, or full sentences in {{ }}!
       Examples: {{This results in}}, {{This enables}} sb {{to V}}, {{, which leads to}}, {{For instance,}}, {{Although}} ..., {{This is because}}.
     - Wrap topic collocations, library phrases, or idioms in [[ ]].
       Especially look for any phrases from the candidate's suggested library picks:
       ${picksList || '(none)'}
     - STRICT: Removing all [[, ]], {{, }} from marked_text MUST reproduce the candidate's exact original sentence character-for-character.
     - NEVER nest [[ ]] inside {{ }} or vice versa.
3. structures:
   - pattern: the structure frame pattern (e.g. "This results in N", ", which + V")
   - text: the exact short framing words in the candidate's sentence (1 to 5 words). NEVER the full sentence or clause!
   - tool: the Linear tool of that sentence
   - from_guide: true if found in the standard Linearthinking guide, false if an extended frame
4. wording:
   - Identify EVERY natural collocation and verb pattern the candidate wrote outside [[ ]] and {{ }} that can be verified against a collocation dictionary (Longman / OZDIC) — about one per sentence (8-15 for a full essay), copied exactly as written:
     - Verb + noun (e.g. "pursue a career", "alleviate financial burden")
     - Adjective + noun (e.g. "prestigious university", "intense competition")
     - Adverb + adjective (e.g. "exceptionally competitive", "deeply rewarding")
     - Verb + preposition (e.g. "cater to", "focus on")
     - Noun + noun (e.g. "admission rates", "tuition fees")
   - Each with:
     - sentence: 1-based sentence number
     - text: the exact shortest words in that sentence
     - checks: array of { base, collocate, pattern }

<linearthinking_guide>
${guide || '(standard Linearthinking guide)'}
</linearthinking_guide>`

export async function analyzeUserEditedWriting(
  ctx: ApiContext,
  params: { id: string; userEdited: string },
  llm: LlmProvider,
): Promise<WritingReviewResult> {
  const filePath = reviewFile(ctx, params.id)
  const result = await readJsonFile<WritingReviewResult | null>(filePath, null)
  if (!result) throw new ApiError(404, 'Writing review not found.')
  if (!result.modelEssay) throw new ApiError(400, 'Review does not contain a model essay.')

  const guide = await writingLinearGuide(ctx)
  const picksList = (result.modelEssay.picks || []).map((p) => `- ${p.term} (${p.meaning_vi})`).join('\n')

  const { value } = await llm.json({
    label: 'writing: analyze edit',
    system: ANALYZE_WRITING_EDIT_SYSTEM(guide, picksList),
    prompt: `Candidate's edited text:\n"""\n${params.userEdited.trim()}\n"""`,
    schema: AnalyzeWritingEditSchema,
    effort: essayEffort(),
  })

  // The writer's words exactly as typed: a sentence the model changed is shown as the writer wrote it, unmarked.
  const { sentences: rawSentences, restored } = keepWritersText(
    params.userEdited,
    (value.sentences || []).map((s) => ({ tool: s.tool, marked: sanitizeSentenceMarkers(s.marked_text) })),
    (marked) => ({ tool: 'description' as const, marked }),
  )
  if (restored) console.warn(`[writing-review] edit analysis: ${restored} sentence(s) did not match the writer's text; kept as typed`)

  // Every combination of the revision found and looked up (the writer's text is never changed: see annotate).
  const essay = result.modelEssay
  const annotation = await annotate(
    {
      sentences: rawSentences.map((s) => s.marked),
      picks: essay.picks,
      keepWrapped: (essay.extras || []).map((e) => e.phrase),
      learnerText: [params.userEdited],
      mode: 'user',
      kind: "a learner's own IELTS Writing Task 2 essay (written English)",
      seed: value.wording || [],
      effort: essayEffort(),
      label: 'writing',
    },
    llm,
  )
  const markedSentences = annotation.sentences

  // Backup original answer if first edit
  if (!result.modelEssay.originalAnswer) {
    result.modelEssay.originalAnswer = {
      answer: result.modelEssay.sentences.flatMap((s) => s.segments),
      sentences: result.modelEssay.sentences,
      structures: result.modelEssay.structures,
      wording: result.modelEssay.wording,
    }
  }

  // Parse segments for sentences with sanitization
  const cleanStructures = (value.structures || []).map((st) => ({
    ...st,
    text: sanitizeStructureText(st.text, st.pattern),
  }))

  const structureTexts = cleanStructures
    .map((st) => st.text)
    .filter((txt) => txt.split(/\s+/).length <= 6 && txt.length <= 40)

  const sentences: AnswerSentence[] = rawSentences.map((s, i) => ({
    tool: s.tool,
    segments: markSentence(markedSentences[i], essay.extras || [], structureTexts, annotation.perSentence[i], essay.picks, annotation.note),
  }))

  const structures: UsedStructure[] = cleanStructures.map((st) => ({
    pattern: st.pattern,
    text: st.text,
    tool: st.tool,
    fromGuide: st.from_guide,
  }))

  essay.userEdited = params.userEdited.trim()
  essay.sentences = sentences
  essay.structures = structures
  essay.wording = annotation.wording

  await writeJsonFile(filePath, result)
  return result
}

export async function resetUserEditedWriting(ctx: ApiContext, id: string): Promise<WritingReviewResult> {
  const filePath = reviewFile(ctx, id)
  const result = await readJsonFile<WritingReviewResult | null>(filePath, null)
  if (!result) throw new ApiError(404, 'Writing review not found.')
  if (!result.modelEssay) throw new ApiError(400, 'Review does not contain a model essay.')

  if (result.modelEssay.originalAnswer) {
    if (result.modelEssay.originalAnswer.sentences) {
      result.modelEssay.sentences = result.modelEssay.originalAnswer.sentences
    }
    if (result.modelEssay.originalAnswer.structures) {
      result.modelEssay.structures = result.modelEssay.originalAnswer.structures
    }
    if (result.modelEssay.originalAnswer.wording) {
      result.modelEssay.wording = result.modelEssay.originalAnswer.wording
    }
    result.modelEssay.userEdited = undefined
    result.modelEssay.originalAnswer = undefined
  }

  await writeJsonFile(filePath, result)
  return result
}

/** A marked sentence back from its segments: frames in {{ }}, phrases in [[ ]]; looked-up wording (it has a note) stays plain. */
const markedOf = (segments: AnswerSegment[]) =>
  segments.map((s) => (s.mark === 'structure' ? `{{${s.text}}}` : s.mark && !s.note ? `[[${s.text}]]` : s.text)).join('')

/** Lists and looks up the shown essay's wording again, without rewriting the essay (for reviews saved with too little). */
export async function refreshEssayWording(ctx: Pick<ApiContext, 'rootDir'> & { userDir?: string }, id: string, llm: LlmProvider): Promise<WritingReviewResult> {
  const filePath = reviewFile(ctx, id)
  const result = await readJsonFile<WritingReviewResult | null>(filePath, null)
  if (!result) throw new ApiError(404, 'Writing review not found.')
  const essay = result.modelEssay
  if (!essay) throw new ApiError(400, 'Review does not contain a model essay.')

  // Found and looked up again, the text left as it is (fix: false), noted as the AI's essay or the writer's revision.
  const annotation = await annotate(
    {
      sentences: essay.sentences.map((s) => markedOf(s.segments)),
      picks: essay.picks,
      keepWrapped: (essay.extras || []).map((e) => e.phrase),
      learnerText: essay.userEdited ? [essay.userEdited] : [result.text, ...(result.correctedSentences ?? [])],
      mode: essay.userEdited ? 'user' : 'model',
      fix: false,
      kind: essay.userEdited ? "a learner's own IELTS Writing Task 2 essay (written English)" : 'an IELTS Writing Task 2 model essay (written English)',
      effort: essayEffort(),
      label: 'writing',
    },
    llm,
  )
  essay.sentences = essay.sentences.map((s, i) => ({
    tool: s.tool,
    segments: markSentence(annotation.sentences[i], essay.extras || [], [], annotation.perSentence[i], essay.picks, annotation.note),
  }))
  essay.wording = annotation.wording
  essay.coverage = annotation.report

  await writeJsonFile(filePath, result)
  return result
}
