import { z } from 'zod'
import {
  WRITING_REVIEW_TOPICS,
  WRITING_REVIEW_TYPES,
  type WritingReviewTopic,
  type WritingReviewType,
} from '../../src/features/practice/writing-review/categories.ts'
import {
  overallBand,
  type WritingCriterion,
  type WritingCriterionId,
  type WritingCriterionIssue,
  type WritingScore,
} from '../../src/types/writingReview.ts'
import type { LlmProvider } from './llm-types.ts'
import { writingScoreEffort } from './llm.ts'
import { splitParagraphs } from './rewrite.ts'

export const MIN_WORDS_FOR_SCORING = 150

/**
 * Counts words in an essay: tokens containing a letter or digit,
 * excluding paragraph labels such as "Mở bài:", "Thân bài 1:", "Kết bài:", "Introduction:" at the start of a paragraph.
 */
export function countWords(text: string): number {
  const PARAGRAPH_LABEL_REGEX = /^(?:Mở bài|Thân bài(?:\s*\d+)?|Body(?:\s*\d+)?|Kết bài|Kết luận|Conclusion|Introduction|Luận điểm(?:\s*\d+)?|Overview|Task\s*\d+)\s*[:\-–]/i
  const paragraphs = text.split(/\n+/)
  let total = 0
  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue
    const cleaned = trimmed.replace(PARAGRAPH_LABEL_REGEX, '').trim()
    const tokens = cleaned.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
    total += tokens.length
  }
  return total
}

function normalizeForMatch(str: string): string {
  return str
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Case-insensitive, ignores punctuation and straight/curly quotes. */
export function quoteInSentence(quote: string, sentence: string): boolean {
  const nQuote = normalizeForMatch(quote)
  if (!nQuote) return false
  const nSentence = normalizeForMatch(sentence)
  return nSentence.includes(nQuote)
}

const CriterionIssue = z.object({
  n: z.number().int().describe('Sentence number.'),
  quote: z.string().describe('A few words copied exactly from that sentence: the place to improve.'),
  problem: z.string().describe('Vietnamese, at most 20 words: what is wrong or missing here.'),
  better: z.string().describe('English: the improved wording; for tr and cc, briefly what to add or how to restructure.'),
})

const Criterion = z.object({
  strengths: z
    .array(z.string())
    .describe('1-3 items, English, a few words each with a short quote: what this essay clearly shows for this criterion.'),
  gaps: z.array(z.string()).describe('0-3 items, English, a few words each: what keeps it from the next band.'),
  band: z.number().int().describe('Whole band 0-9: the highest band whose features this essay fully shows.'),
  summary: z.string().describe('Vietnamese, ONE sentence (at most 25 words): what this essay needs for the next band.'),
  issues: z.array(CriterionIssue).describe('1-4 concrete places in this essay, most important first; fewer when there are fewer real ones.'),
})

export const WritingScoreSchema = z.object({
  criteria: z.object({ tr: Criterion, cc: Criterion, lr: Criterion, gra: Criterion }),
  topic: z.enum(WRITING_REVIEW_TOPICS),
  questionType: z.enum(WRITING_REVIEW_TYPES),
})

export const WRITING_SCORE_SYSTEM = `You are a trained IELTS Writing examiner rating a Task 2 essay by a Vietnamese learner against the public IELTS Writing Task 2 band descriptors. You get the question (when given), the essay numbered by paragraph (P…) and sentence, its word count, and — when given — what the learner meant in Vietnamese: use that only to understand their intention; rate the English.

1. HOW AN EXAMINER RATES — read before choosing any band:
- Each criterion gets a WHOLE band 0-9: the HIGHEST band whose features the essay fully shows. First collect the evidence — what the essay clearly shows (strengths) and what keeps it from the next band (gaps) — then decide. One or two slips never pull a criterion down a band: examiners rate the essay as a whole.
- Rate against the anchors below, never against a perfect native writer. Rare or “big” words and long sentences do not raise a band by themselves; natural, precise, accurate language does, and a misused rare word lowers it.
- Rate each criterion on its own evidence: ideas and position belong to TR, organisation and linking to CC, word choice and spelling to LR, grammar and punctuation to GRA. Never count the same weakness under two criteria.
- Length: Task 2 asks for at least 250 words. A clearly shorter essay usually cannot develop its ideas, which limits TR; there is no fixed penalty — judge the development.
- No question given: work out the question from the essay, say so in the tr summary, and rate TR against that question.
- In every text you write, quote words with curly quotes “ ” — never straight double quotes, which would break the JSON.

2. BAND ANCHORS (paraphrased from the public IELTS Writing Task 2 descriptors):
tr — Task Response:
  8: every part of the question addressed well; a clear, well-developed position; ideas relevant, well extended and supported; only occasional omissions.
  7: the main parts of the question addressed; a clear position kept throughout; main ideas extended and supported, though some may over-generalise or lack focus.
  6: the main parts addressed, some more fully than others; a relevant position, but the conclusion may be unclear or repetitive; some main ideas not developed enough or not clear.
  5: the question only partly addressed; a position whose development is not always clear; main ideas limited, under-developed, or mixed with irrelevant detail.
cc — Coherence & Cohesion:
  8: easy to follow; ideas logically sequenced; cohesion well managed; paragraphing sufficient and appropriate.
  7: logically organised with clear progression; linking words, reference and substitution used flexibly, with some misuse, over-use or under-use; each paragraph has a clear central topic.
  6: coherent with clear overall progression; linking used to some effect but sometimes faulty or mechanical; reference may be unclear or repetitive; paragraphing not always logical, or a paragraph's central topic not always clear.
  5: some organisation but not wholly logical; sentences not fluently linked; limited, over-used or inaccurate linkers; repetition from weak referencing; paragraphing inadequate.
lr — Lexical Resource:
  8: a wide resource used fluently and flexibly for precise meaning; skilful use of less common and idiomatic items; only occasional slips in word choice, collocation, spelling or word formation.
  7: enough range for some flexibility and precision; some less common items; awareness of style and collocation, with some inappropriate choices; a few spelling or word-formation errors that do not affect clarity.
  6: adequate and appropriate vocabulary for the task; meaning clear despite a rather restricted range or imprecise choices; some spelling or word-formation errors that do not impede communication.
  5: limited but minimally adequate; little variation; frequent inappropriate choices, simplifications or repetitions; spelling or word-formation errors may cause some difficulty.
gra — Grammatical Range & Accuracy:
  8: a wide range of structures used flexibly and accurately; most sentences error-free; punctuation well managed; only occasional non-systematic errors.
  7: a variety of complex structures used with some flexibility and accuracy; grammar and punctuation generally well controlled; error-free sentences frequent; a few errors remain.
  6: a mix of simple and complex forms with limited flexibility; complex forms less accurate than simple ones; errors in grammar and punctuation occur but rarely impede communication.
  5: a limited, repetitive range; complex sentences attempted but often faulty; errors may be frequent and cause some difficulty; punctuation may be faulty.

3. FOR EACH CRITERION (tr, cc, lr, gra), in this order:
- strengths: 1-3 short English notes, each with a short quote from the essay.
- gaps: 0-3 short English notes: what keeps it from the next band (empty at 9).
- band.
- summary: ONE Vietnamese sentence: what this essay needs for the next band (never a description of the essay).
- issues: 1-4 concrete places in THIS essay, most important first — fewer when there are fewer real ones; never invent one:
  * tr: a part of the question not answered, a position that is unclear or changes, an idea stated but not explained or supported, an over-general claim, a conclusion that does not match the body;
  * cc: a paragraph without a clear central topic, a missing or wrong link between sentences or paragraphs, a mechanical or over-used linker, an unclear “this”, “it” or “they”;
  * lr: an imprecise or unnatural word or combination, a repeated word, a word too informal for an essay, a spelling or word-formation error;
  * gra: a grammar or punctuation error, or a place where a more varied structure would fit naturally;
  * n = the sentence number; quote = a few words copied exactly from that sentence; problem in Vietnamese (at most 20 words); better = the improved English (for tr and cc: briefly what to add or how to restructure). Do not use the same quote under two criteria.

4. topic and questionType: one label each from the lists; Other only when none fits.`

export function buildScorePrompt(
  text: string,
  prompt?: string,
  vietnameseText?: string,
): { scorePrompt: string; sentences: string[]; paragraphStarts: number[]; words: number } {
  const { sentences, paragraphStarts } = splitParagraphs(text)
  const essay = sentences
    .map((s, i) => {
      const p = paragraphStarts.indexOf(i)
      return `${p >= 0 ? `P${p + 1}\n` : ''}${i + 1}. ${s}`
    })
    .join('\n')
  const words = countWords(text)

  const scorePrompt = [
    prompt?.trim()
      ? `IELTS Writing Task 2 question:\n“${prompt.trim()}”`
      : 'IELTS Writing Task 2 question: (not given — work it out from the essay)',
    `Word count: ${words} (Task 2 asks for at least 250)`,
    `Essay, by paragraph (P…) and sentence (numbers run on across paragraphs):\n${essay}`,
    ...(vietnameseText?.trim() ? [`What the learner meant, in Vietnamese (only to understand their intention):\n“${vietnameseText.trim()}”`] : []),
  ].join('\n\n')

  return { scorePrompt, sentences, paragraphStarts, words }
}

export async function scoreEssay(
  llm: LlmProvider,
  {
    text,
    prompt,
    vietnameseText,
  }: {
    text: string
    prompt?: string
    vietnameseText?: string
  },
): Promise<{ score: WritingScore; topic: WritingReviewTopic; questionType: WritingReviewType }> {
  const { scorePrompt, sentences, words } = buildScorePrompt(text, prompt, vietnameseText)

  const { value, model } = await llm.json({
    label: 'score',
    system: WRITING_SCORE_SYSTEM,
    prompt: scorePrompt,
    schema: WritingScoreSchema,
    effort: writingScoreEffort(),
  })

  let totalDropped = 0
  const cleanCriterion = (raw: z.infer<typeof Criterion>): WritingCriterion => {
    const band = Math.min(9, Math.max(0, Math.round(raw.band)))
    const validIssues: WritingCriterionIssue[] = []
    for (const issue of raw.issues.slice(0, 4)) {
      const sentenceIdx = issue.n - 1
      if (sentenceIdx >= 0 && sentenceIdx < sentences.length && quoteInSentence(issue.quote, sentences[sentenceIdx])) {
        validIssues.push({
          sentence: sentenceIdx,
          quote: issue.quote.trim(),
          problem: issue.problem.trim(),
          better: issue.better.trim(),
        })
      } else {
        totalDropped++
      }
    }
    return {
      band,
      summary: raw.summary.trim(),
      strengths: (raw.strengths || []).map((s) => s.trim()).filter(Boolean).slice(0, 3),
      gaps: (raw.gaps || []).map((g) => g.trim()).filter(Boolean).slice(0, 3),
      issues: validIssues,
    }
  }

  const criteria: Record<WritingCriterionId, WritingCriterion> = {
    tr: cleanCriterion(value.criteria.tr),
    cc: cleanCriterion(value.criteria.cc),
    lr: cleanCriterion(value.criteria.lr),
    gra: cleanCriterion(value.criteria.gra),
  }

  if (totalDropped > 0) {
    console.info(`[writing-score] dropped ${totalDropped} issue(s) not found in their sentence or out of range`)
  }

  const overall = overallBand([criteria.tr.band, criteria.cc.band, criteria.lr.band, criteria.gra.band])

  const score: WritingScore = {
    criteria,
    overall,
    words,
    questionGiven: Boolean(prompt?.trim()),
    reviewer: model,
  }

  return {
    score,
    topic: value.topic,
    questionType: value.questionType,
  }
}
