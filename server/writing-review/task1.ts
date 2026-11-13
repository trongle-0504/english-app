// Writing Task 1 scoring: the chart pictures are read once (cached per question until they change), then the answer is
// rated on Task Achievement, Coherence & Cohesion, Lexical Resource and Grammar against the Task 1 descriptors, with the
// learner's Vietnamese ideas held against the chart. TA is kept in the `tr` slot of WritingScore (see its comment).
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { overallBand, type WritingScore, type WritingTask1Chart, type WritingTask1Review } from '../../src/types/writingReview.ts'
import type { Base64Image } from '../images.ts'
import { cachedChartRead, chartImages, saveChartRead, type Task1Context } from '../writing-task1/store.ts'
import type { LlmProvider } from './llm-types.ts'
import { writingScoreEffort } from './llm.ts'
import { splitParagraphs } from './rewrite.ts'
import { cleanCriteria, countWords, Criterion, quoteInSentence } from './score.ts'
import { checkFigures, mergeDataErrors } from './task1-figures.ts'

/* ───────────── The Task 1 guide the learner studies ───────────── */

/** content/writing/task1-skill.md, read on each review (an edit there applies to the next one); '' when missing. */
export async function task1Skill(rootDir: string): Promise<string> {
  try {
    return (await readFile(path.join(rootDir, 'content', 'writing', 'task1-skill.md'), 'utf8')).trim()
  } catch {
    return ''
  }
}

/* ───────────── Step 1: read the chart ───────────── */

export const ChartReadSchema = z.object({
  kind: z.string().describe('The chart type(s), e.g. "bar chart", "line graph and pie chart".'),
  subject: z.string().describe('What is measured, in a few words.'),
  unit: z.string().describe('The unit of the figures ("%", "$ thousand", "million tonnes"); "" when none is shown.'),
  period: z.string().describe('The time span or the years shown; "" when there is no time.'),
  categories: z.array(z.string()).describe('The groups compared, as labelled.'),
  overview: z.array(z.string()).describe('2-3 English sentences: the main trends or comparisons an overview should state.'),
  keyFeatures: z.array(z.string()).describe('3-6 English notes: highest, lowest, biggest change, notable comparisons, with figures.'),
  figures: z
    .array(z.object({ label: z.string().describe('Category and time, e.g. "Health 2013".'), value: z.string().describe('As read, with unit.') }))
    .describe('Every figure you can read; estimate from the axis when a bar or point has no label, and add "≈".'),
})

const CHART_SYSTEM = `You read IELTS Writing Task 1 charts for an examiner. Look at the attached picture(s) of the chart, table or diagram and report only what they show: never add knowledge from outside the picture. Read figures carefully from labels or axes; when you estimate from an axis, mark the value with "≈". Write in English.`

export async function readChart(llm: LlmProvider, images: Base64Image[], prompt?: string): Promise<WritingTask1Chart> {
  const { value } = await llm.json({
    label: 'task1 chart',
    system: CHART_SYSTEM,
    prompt: `${prompt?.trim() ? `The question describes the chart as:\n“${prompt.trim()}”\n\n` : ''}Read the attached chart picture(s).`,
    schema: ChartReadSchema,
    effort: 'low',
    images,
  })
  return {
    kind: value.kind.trim(),
    subject: value.subject.trim(),
    unit: value.unit.trim(),
    period: value.period.trim(),
    categories: value.categories.map((c) => c.trim()).filter(Boolean).slice(0, 20),
    overview: value.overview.map((c) => c.trim()).filter(Boolean).slice(0, 3),
    keyFeatures: value.keyFeatures.map((c) => c.trim()).filter(Boolean).slice(0, 6),
    figures: value.figures.filter((f) => f.label.trim() && f.value.trim()).slice(0, 80),
  }
}

/* ───────────── Step 2: score ───────────── */

export const Task1ScoreSchema = z.object({
  criteria: z.object({
    tr: Criterion.describe('Task Achievement (TA).'),
    cc: Criterion,
    lr: Criterion,
    gra: Criterion,
  }),
  overview: z.object({
    status: z.enum(['clear', 'unclear', 'missing']).catch('unclear'),
    note: z.string().describe('Vietnamese, one sentence: what the overview says well or what it lacks.'),
  }),
  keyFeatures: z.object({
    covered: z.array(z.string()).describe('Vietnamese, short: key features the answer reports.'),
    missed: z.array(z.string()).describe('Vietnamese, short: key features it leaves out; [] when none.'),
  }),
  dataErrors: z
    .array(
      z.object({
        n: z.number().int().describe('Sentence number.'),
        quote: z.string().describe('A few words copied exactly from that sentence.'),
        wrote: z.string().describe('What the answer says (figure, trend or ranking).'),
        correct: z.string().describe('What the chart shows instead, with the figure.'),
      }),
    )
    .describe('Figures, trends or rankings the answer reports wrongly compared with the chart; [] when none or when no chart picture is given.'),
  ideaCheck: z.object({
    summary: z.string().describe('Vietnamese, one sentence: how well the learner’s Vietnamese plan reads the chart; "" when no plan is given.'),
    matched: z.array(z.string()).describe('Vietnamese: planned ideas that match the chart.'),
    missing: z.array(z.string()).describe('Vietnamese: key features the plan does not have.'),
    wrong: z.array(z.string()).describe('Vietnamese: planned ideas the chart does not support, and why.'),
  }),
})

export const TASK1_SCORE_SYSTEM = `You are a trained IELTS Writing examiner rating an Academic Writing Task 1 answer by a Vietnamese learner against the public IELTS Writing Task 1 band descriptors. You get the question, the chart picture(s) when the learner added them, a reading of the chart, the answer numbered by paragraph (P…) and sentence, its word count, and — when given — the learner's plan in Vietnamese, written before the answer.

1. HOW AN EXAMINER RATES:
- Each criterion gets a WHOLE band 0-9: the HIGHEST band whose features the answer fully shows. Collect the evidence first (strengths, gaps), then decide. One or two slips never pull a criterion down a band.
- Rate each criterion on its own evidence; never count the same weakness under two criteria. Grammar or word choice never lowers TA.
- Length: Task 1 asks for at least 150 words; a clearly shorter answer usually cannot cover the key features, which limits TA. A few words under 150 is not a weakness.
- No chart picture: rate TA from the question text and say so in its summary; you cannot check figures, so leave dataErrors empty.
- In every text you write, quote words with curly quotes “ ” — never straight double quotes.

2. BAND ANCHORS (paraphrased from the public IELTS Writing Task 1 descriptors):
tr — Task Achievement:
  8: covers all requirements sufficiently; clearly presents and highlights the key features; a clear overview; figures accurate.
  7: covers the requirements; a clear overview of the main trends, differences or stages; clearly presents and highlights key features, though they could be more fully extended.
  6: addresses the requirements; an overview with information appropriately selected; presents and adequately highlights key features, but some details are irrelevant, inappropriate or inaccurate.
  5: generally addresses the task; recounts detail mechanically with no clear overview; key features not adequately covered; may focus on details; some figures may be inaccurate.
  4: attempts the task but does not cover all key features; key features may be confused with detail; parts unclear or inaccurate.
cc — Coherence & Cohesion:
  8: sequences information and ideas logically; manages all aspects of cohesion well; paragraphing sufficient and appropriate.
  7: logically organised with clear progression throughout; a range of cohesive devices used appropriately, with some under-/over-use.
  6: arranges information coherently with clear overall progression; cohesive devices used effectively but cohesion within or between sentences may be faulty or mechanical; referencing not always clear.
  5: some organisation but a lack of overall progression; inadequate, inaccurate or over-used cohesive devices; repetition from weak referencing.
lr — Lexical Resource:
  8: a wide range used fluently and flexibly to convey precise meanings (trend, comparison and approximation language); only rare slips.
  7: enough range for some flexibility and precision; less common items with awareness of style and collocation; occasional errors in word choice, spelling or word formation.
  6: an adequate range for the task; attempts less common vocabulary with some inaccuracy; some spelling or word-formation errors that do not impede communication.
  5: a limited range, minimally adequate; noticeable errors in spelling or word formation that may cause some difficulty.
gra — Grammatical Range & Accuracy:
  8: a wide range of structures; the majority of sentences error-free; only very occasional errors.
  7: a variety of complex structures; frequent error-free sentences; good control of grammar and punctuation with a few errors.
  6: a mix of simple and complex forms; some errors in grammar and punctuation that rarely reduce communication.
  5: a limited range; complex sentences attempted but less accurate than simple ones; frequent errors that may cause some difficulty.

3. FOR EACH CRITERION (tr = TA, cc, lr, gra): strengths (1-3 short English notes with a short quote), gaps (0-3 short English notes), band, summary (ONE Vietnamese sentence: what the answer needs for the next band), issues (1-4 places in THIS answer: n = sentence number, quote = a few words copied exactly, problem in Vietnamese ≤ 20 words, better = the improved English; for tr and cc briefly what to add or restructure). tr issues are about the overview, the choice of key features, missing comparisons, figures, or a conclusion with opinions — never grammar.

4. TASK 1 CHECKS:
- overview: clear (states the main trends/comparisons, usually starting “Overall”), unclear (there, but vague or only details), or missing. note in Vietnamese.
- keyFeatures: from the chart reading and the pictures, which key features the answer reports and which it misses (Vietnamese, short).
- dataErrors: each figure, trend or ranking reported wrongly against the chart (only with a picture). Hold EVERY figure in the answer against the chart reading, one by one: a figure that differs from the reading by more than the reading's precision is a data error, even when the learner wrote "about" or "around" (e.g. 230 for a bar read as ≈220 is wrong). A figure within that precision is NOT an error: a bar read as ≈315 may be reported as 310 or 320, because "≈" means the reading itself is an estimate. Check every "always", "throughout", "in every year", "the highest / lowest" claim against each year or category of the chart, not only the first one. A claim about the size of a change or a ranking ("the biggest increase", "grew the most", "the largest share") that does not say whether it means the absolute amount or the percentage is a data error when the two measures name different categories: in "correct", give both, e.g. “the biggest rise in absolute terms was social welfare (+10,000); environment rose the most only in percentage terms (≈ +47%)”.
- ideaCheck: hold the learner's Vietnamese plan against the chart: what it reads right, what key features it misses, what it gets wrong (all Vietnamese). Apply the same rule as dataErrors: a planned comparison of changes that is true only in percentage terms, or only in absolute terms, without saying which, goes under "wrong" with both figures. Empty strings and lists when no plan is given.

5. The learner studies the guide below (DOL's 3 steps: paraphrase, overview + body plan with STUCP, proofread; outlines for charts with and without a trend). Use its terms and frames when you write "better" and the summaries, so the advice matches what they learn; never treat the guide's wording as the only correct answer.`

export function buildTask1Prompt({
  text,
  prompt,
  vietnameseText,
  chart,
  hasPictures,
  skill,
}: {
  text: string
  prompt?: string
  vietnameseText?: string
  chart?: WritingTask1Chart
  hasPictures: boolean
  skill: string
}): { scorePrompt: string; sentences: string[]; words: number } {
  const { sentences, paragraphStarts } = splitParagraphs(text)
  const answer = sentences.map((s, i) => `${paragraphStarts.indexOf(i) >= 0 ? `P${paragraphStarts.indexOf(i) + 1}\n` : ''}${i + 1}. ${s}`).join('\n')
  const words = countWords(text)
  const chartBlock = chart
    ? [
        `Chart reading (from the attached picture${hasPictures ? 's' : ''}):`,
        `- ${chart.kind}: ${chart.subject}${chart.unit ? ` (${chart.unit})` : ''}${chart.period ? `, ${chart.period}` : ''}`,
        chart.categories.length ? `- Categories: ${chart.categories.join(', ')}` : '',
        ...chart.overview.map((o) => `- Overview: ${o}`),
        ...chart.keyFeatures.map((k) => `- Key feature: ${k}`),
        chart.figures.length ? `- Figures: ${chart.figures.map((f) => `${f.label} = ${f.value}`).join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : 'No chart picture was given: rate TA from the question text only, and leave dataErrors empty.'

  const scorePrompt = [
    `IELTS Academic Writing Task 1 question:\n“${prompt?.trim() || '(not given)'}”\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant. Write at least 150 words.`,
    chartBlock,
    `Word count: ${words} (Task 1 asks for at least 150)`,
    `Answer, by paragraph (P…) and sentence (numbers run on across paragraphs):\n${answer}`,
    vietnameseText?.trim()
      ? `The learner's plan in Vietnamese, written before the answer:\n“${vietnameseText.trim()}”`
      : 'The learner wrote no Vietnamese plan: leave ideaCheck empty.',
    skill ? `The Task 1 guide the learner studies:\n<guide>\n${skill}\n</guide>` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  return { scorePrompt, sentences, words }
}

const clean = (list: string[], max: number) => list.map((s) => s.trim()).filter(Boolean).slice(0, max)

export async function scoreTask1(
  llm: LlmProvider,
  input: { text: string; prompt?: string; vietnameseText?: string; chart?: WritingTask1Chart; images: Base64Image[]; skill: string },
): Promise<{ score: WritingScore; task1: WritingTask1Review }> {
  const hasPictures = input.images.length > 0
  const { scorePrompt, sentences, words } = buildTask1Prompt({ ...input, hasPictures })
  const { value, model } = await llm.json({
    label: 'task1 score',
    system: TASK1_SCORE_SYSTEM,
    prompt: scorePrompt,
    schema: Task1ScoreSchema,
    effort: writingScoreEffort(),
    images: hasPictures ? input.images : undefined,
  })

  const criteria = cleanCriteria(value.criteria, sentences)
  const score: WritingScore = {
    criteria,
    overall: overallBand([criteria.tr.band, criteria.cc.band, criteria.lr.band, criteria.gra.band]),
    words,
    questionGiven: Boolean(input.prompt?.trim()),
    reviewer: model,
  }

  // Figures can be checked only against a picture; a reported error must quote its own sentence.
  const dataErrors = hasPictures
    ? value.dataErrors
        .filter((e) => e.n >= 1 && e.n <= sentences.length && quoteInSentence(e.quote, sentences[e.n - 1]))
        .slice(0, 6)
        .map((e) => ({ sentence: e.n - 1, quote: e.quote.trim(), wrote: e.wrote.trim(), correct: e.correct.trim() }))
    : []
  const idea = value.ideaCheck
  const task1: WritingTask1Review = {
    noChart: !hasPictures,
    ...(input.chart ? { chart: input.chart } : {}),
    overview: { status: value.overview.status, note: value.overview.note.trim() },
    keyFeatures: { covered: clean(value.keyFeatures.covered, 6), missed: clean(value.keyFeatures.missed, 6) },
    dataErrors,
    ...(input.vietnameseText?.trim() && (idea.summary.trim() || idea.matched.length || idea.missing.length || idea.wrong.length)
      ? { ideaCheck: { summary: idea.summary.trim(), matched: clean(idea.matched, 6), missing: clean(idea.missing, 6), wrong: clean(idea.wrong, 6) } }
      : {}),
  }
  return { score, task1 }
}

// One chart reading at a time per question: a review started while the reading made at "Bắt đầu" is still running waits
// for it instead of reading the same pictures again. Kept on globalThis like the review jobs (dev server reloads).
const chartReads = ((globalThis as { __task1ChartReads?: Map<string, Promise<WritingTask1Chart>> }).__task1ChartReads ??= new Map())

/**
 * The question's chart reading: from the store, or read now (shared with a reading already running) and saved.
 * Undefined when the question has no picture.
 */
export async function chartReading(
  ctx: Task1Context,
  llm: LlmProvider,
  promptId: string,
  prompt?: string,
  images?: Base64Image[],
): Promise<WritingTask1Chart | undefined> {
  const pictures = images ?? (await chartImages(ctx, promptId))
  if (!pictures.length) return undefined
  const cached = await cachedChartRead(ctx, promptId)
  if (cached) return cached
  const key = `${ctx.rootDir}|${promptId}|${pictures.length}`
  let reading = chartReads.get(key)
  if (!reading) {
    reading = readChart(llm, pictures, prompt)
      .then(async (chart) => {
        await saveChartRead(ctx, promptId, chart, pictures.length).catch(() => {})
        return chart
      })
      .finally(() => chartReads.delete(key))
    chartReads.set(key, reading)
  }
  return reading
}

/** The whole Task 1 lane of a review: pictures from the store, the chart reading (cached), the score. */
export async function reviewTask1(
  ctx: Task1Context,
  llm: LlmProvider,
  input: { promptId: string; text: string; prompt?: string; vietnameseText?: string },
  onStep?: (step: string) => void,
): Promise<{ score: WritingScore; task1: WritingTask1Review }> {
  const images = await chartImages(ctx, input.promptId)
  if (images.length && !(await cachedChartRead(ctx, input.promptId))) onStep?.('chart')
  const chart = await chartReading(ctx, llm, input.promptId, input.prompt, images)
  onStep?.('task1_score')
  const skill = await task1Skill(ctx.rootDir)
  // The figures are also checked one by one in code, alongside the score (no extra wait).
  const [scored, figureErrors] = await Promise.all([
    scoreTask1(llm, { ...input, chart, images, skill }),
    chart && images.length
      ? checkFigures(llm, { sentences: splitParagraphs(input.text).sentences, chart }).catch((error: Error) => {
          console.warn(`[writing-review] task 1 figure check failed: ${error.message}`)
          return []
        })
      : Promise.resolve([]),
  ])
  return { ...scored, task1: { ...scored.task1, dataErrors: mergeDataErrors(scored.task1.dataErrors, figureErrors) } }
}
