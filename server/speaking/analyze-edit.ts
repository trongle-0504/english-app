import { z } from 'zod'
import {
  LINEAR_TOOLS,
  type AnswerSentence,
  type SpeakingAnswer,
  type SpeakingPart,
  type SpeakingResult,
} from '../../src/types/speaking.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { readJsonFile, writeJsonFile } from '../files.ts'
import { annotate, keepWritersText, type JsonModel } from '../annotate.ts'
import { CheckSchema } from '../writing-review/rewrite.ts'
import { defaultSpeakingEngine, speakingEffort, speakingJson } from './llm.ts'
import { fileOf, jobs, markSentence, sentenceTool, validId } from './suggest.ts'
import { OwnedMap } from '../users/context.ts'

export interface AnalyzeEditJob {
  id: string
  status: 'running' | 'done' | 'error'
  startedAt: string
  result?: SpeakingResult
  error?: string
  credited?: boolean
}

const editJobs = new OwnedMap<string, AnalyzeEditJob>()

const AnalyzeEditSchema = z.object({
  sentences: z.array(
    z.object({
      tool: z.enum(LINEAR_TOOLS).catch('description'),
      marked_text: z
        .string()
        .describe(
          "The candidate's exact sentence without altering any words, wrapping library/topic phrases in [[ ]] and NeuralSymbolic structures/markers in {{ }}.",
        ),
    }),
  ),
  structures: z.array(
    z.object({
      pattern: z.string().describe('The pattern as in the guide or extended, e.g. "The main reason is that SV".'),
      text: z.string().describe("The exact words used in the candidate's sentence."),
      tool: z.enum(LINEAR_TOOLS).catch('description'),
      from_guide: z.boolean(),
    }),
  ),
  wording: z.array(
    z.object({
      sentence: z.number().int().describe('1-based index of the sentence.'),
      text: z.string().describe("The exact collocation or verb pattern from the candidate's sentence."),
      meaning_vi: z.string().optional().describe('Vietnamese meaning of this collocation or phrase.'),
      checks: z.array(CheckSchema),
    }),
  ),
})

const analyzeEditSystem = (part: SpeakingPart, guide: string, picksList: string) => `You are an IELTS Speaking examiner and coach.
You analyze an IELTS Speaking candidate's own customized response for Speaking Part ${part}.

CRITICAL REQUIREMENTS:
1. You must PRESERVE 100% of the candidate's exact words, punctuation, and capitalization.
2. DO NOT rewrite, paraphrase, correct, improve, add, or delete ANY word or letter.
3. Your role is strictly to:
   - Split the text into sentences
   - Classify each sentence's NeuralSymbolic function
   - Mark NeuralSymbolic structures in {{ }} and collocations/vocabulary in [[ ]]
   - Extract structures and collocations for dictionary verification.

TASKS:
1. Split the candidate's text into sentences.
2. For each sentence:
   - Identify its NeuralSymbolic tool:
     - answer: direct answer to the question (usually sentence 1, unless specifying the question)
     - description: details of what / how / who / when / where
     - cause: reason, motive, positive or negative effect, opinion
     - effect: feeling, wish, consequence, habit, action
     - example: concrete illustration ("For instance...", "Take me as an example...")
     - specify: splits a broad question into cases ("When it comes to...", "It depends on...")
     ${part === 2 ? '- lead_in, introduction, conclusion (Part 2 framework)' : ''}
   - In "marked_text":
     - Wrap NeuralSymbolic structures or sentence framing markers in {{ }}.
       Examples: {{The main reason is that}}, {{That is why}}, {{When it comes to}}, {{allows me to}}, {{It is worth mentioning that}}, {{Not only ... but also ...}} (wrap each fixed part in {{ }}).
     - Wrap topic collocations, library phrases, or idioms in [[ ]].
       Especially look for any phrases from the candidate's suggested library picks:
       ${picksList || '(none)'}
       Also wrap other natural topic collocations the candidate wrote in [[ ]].
     - STRICT: Removing all [[, ]], {{, }} from marked_text MUST reproduce the candidate's exact original sentence character-for-character.
     - NEVER nest [[ ]] inside {{ }} or vice versa.
3. structures:
   - pattern: the structure frame pattern (e.g. "The main reason is that SV")
   - text: the exact words in the candidate's sentence
   - tool: the Linear tool of that sentence
   - from_guide: true if found in the standard NeuralSymbolic guide, false if an extended spoken frame
4. wording:
   - Identify natural collocations and verb patterns the candidate wrote outside [[ ]] and {{ }} that can be verified against a collocation dictionary (Longman / OZDIC):
     - Verb + noun (e.g. "pursue a career", "relieve stress")
     - Adjective + noun (e.g. "hectic schedule", "pressing issue")
     - Adverb + adjective (e.g. "deeply rewarding", "exceptionally high")
     - Verb + preposition (e.g. "cater to", "embark on")
     - Noun + noun (e.g. "traffic congestion")
   - Each with:
     - sentence: 1-based sentence number
     - text: the exact shortest words in that sentence
     - checks: array of { base, collocate, pattern }
       - base: lemma of headword (noun for verb+noun, adjective+noun, noun+noun, noun+verb; verb for verb+preposition; adjective for adverb+adjective)
       - collocate: lemma of partner word
       - pattern: one of 'verb + noun' | 'adjective + noun' | 'noun + verb' | 'noun + noun' | 'preposition' | 'adverb' | 'quantifier' | 'phrase'

<linearthinking_guide>
${guide || '(use direct answer followed by description, cause, effect, example)'}
</linearthinking_guide>`

async function analyzeUserEditedAnswer(
  ctx: ApiContext,
  params: {
    id: string
    answerIndex: number
    userEdited: string
    part: SpeakingPart
  },
): Promise<SpeakingResult> {
  const { id, answerIndex, userEdited, part } = params
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  const file = fileOf(ctx, id)
  const result = await readJsonFile<SpeakingResult | null>(file, null)
  if (!result || !result.answers) throw new ApiError(404, 'Suggestion not found.')
  if (answerIndex < 0 || answerIndex >= result.answers.length) throw new ApiError(400, 'Invalid answer index.')

  const targetAnswer: SpeakingAnswer = result.answers[answerIndex]
  const text = userEdited.trim()
  if (!text) {
    return resetUserEditedAnswer(ctx, id, answerIndex)
  }

  // Backup original AI answer if not already backed up
  if (!targetAnswer.originalAnswer) {
    targetAnswer.originalAnswer = {
      answer: targetAnswer.answer,
      sentences: targetAnswer.sentences,
      structures: targetAnswer.structures,
      wording: targetAnswer.wording,
    }
  }

  const picksList = targetAnswer.picks.map((p) => `- ${p.term} (${p.meaning_vi})`).join('\n')
  const engine = result.engine ?? defaultSpeakingEngine()

  const analysis = await speakingJson({
    label: 'speaking: analyze user edit',
    system: analyzeEditSystem(part, '', picksList),
    prompt: `Question: ${targetAnswer.question}\n\nCandidate's customized answer:\n"""\n${text}\n"""`,
    schema: AnalyzeEditSchema,
    effort: speakingEffort(),
    engine,
  })

  // The learner's words exactly as typed: a sentence the model changed is shown as the learner wrote it, unmarked.
  const { sentences: lines, restored } = keepWritersText(
    text,
    analysis.value.sentences.map((s) => ({ tool: s.tool, marked: s.marked_text })),
    (marked) => ({ tool: 'description' as const, marked }),
  )
  if (restored) console.warn(`[speaking] edit analysis: ${restored} sentence(s) did not match the learner's text; kept as typed`)

  // Every combination of the revision found and looked up; the learner's text is never changed (server/annotate.ts).
  const model: JsonModel = { json: (call) => speakingJson({ ...call, effort: call.effort ?? speakingEffort(), engine }) }
  const annotation = await annotate(
    {
      sentences: lines.map((l) => l.marked),
      picks: targetAnswer.picks,
      keepWrapped: (targetAnswer.extras || []).map((e) => e.phrase),
      learnerText: [text],
      mode: 'user',
      kind: `a learner's own IELTS Speaking Part ${part} answer (spoken English)`,
      seed: analysis.value.wording || [],
      dolHints: targetAnswer.dol,
      effort: speakingEffort(),
      label: 'speaking',
    },
    model,
  )

  const structureTexts = analysis.value.structures.map((s) => s.text)
  const sentences: AnswerSentence[] = annotation.sentences.map((marked, n) => {
    const segments = markSentence(marked, targetAnswer.extras || [], structureTexts, annotation.perSentence[n], targetAnswer.picks, annotation.note)
    return { tool: sentenceTool(lines[n].tool, segments.map((g) => g.text).join(''), n, part), segments }
  })

  // Reconstruct full answer segments
  const answerSegments = sentences.flatMap((x, n) => (n ? [{ text: ' ' }, ...x.segments] : x.segments))

  targetAnswer.sentences = sentences
  targetAnswer.structures = analysis.value.structures.map((s) => ({
    pattern: s.pattern,
    text: s.text,
    tool: s.tool,
    fromGuide: s.from_guide,
  }))
  targetAnswer.wording = annotation.wording
  targetAnswer.coverage = annotation.report
  targetAnswer.answer = answerSegments.filter((x) => x.text)
  targetAnswer.userEdited = text

  await writeJsonFile(file, result)

  const live = jobs.get(id)
  if (live) live.result = result

  return result
}

export function startAnalyzeEdit(ctx: ApiContext, params: Parameters<typeof analyzeUserEditedAnswer>[1]): AnalyzeEditJob {
  const job: AnalyzeEditJob = {
    id: `edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'running',
    startedAt: new Date().toISOString(),
  }
  editJobs.set(job.id, job)
  void analyzeUserEditedAnswer(ctx, params)
    .then((result) => {
      job.result = result
      job.status = 'done'
    })
    .catch((error) => {
      job.error = (error as Error).message
      job.status = 'error'
      console.error('[speaking] edit analysis', error)
    })
    .finally(() => setTimeout(() => editJobs.delete(job.id), 10 * 60_000).unref())
  return job
}

export function getAnalyzeEditJob(id: string): AnalyzeEditJob | null {
  return editJobs.get(id) ?? null
}

export async function resetUserEditedAnswer(ctx: ApiContext, id: string, answerIndex: number): Promise<SpeakingResult> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  const file = fileOf(ctx, id)
  const result = await readJsonFile<SpeakingResult | null>(file, null)
  if (!result || !result.answers) throw new ApiError(404, 'Suggestion not found.')
  if (answerIndex < 0 || answerIndex >= result.answers.length) throw new ApiError(400, 'Invalid answer index.')

  const targetAnswer = result.answers[answerIndex]
  if (targetAnswer.originalAnswer) {
    targetAnswer.answer = targetAnswer.originalAnswer.answer
    targetAnswer.sentences = targetAnswer.originalAnswer.sentences
    targetAnswer.structures = targetAnswer.originalAnswer.structures
    targetAnswer.wording = targetAnswer.originalAnswer.wording
    targetAnswer.originalAnswer = undefined
  }
  targetAnswer.userEdited = undefined

  await writeJsonFile(file, result)

  const live = jobs.get(id)
  if (live) live.result = result

  return result
}
