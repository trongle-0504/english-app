// Writing review jobs. A review makes 1–2 Claude calls plus Longman/OZDIC lookups (~1–3 min), so it runs in the background: the page starts a job,
// polls it (live step + token count) and can reopen it later. Finished reviews are saved in progress/writing-reviews/
// (outside content/, so saving never triggers a content rebuild).
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  WritingFix,
  WritingReviewJob,
  WritingReviewPending,
  WritingReviewSource,
  WritingScore,
  WritingScoreSkipped,
  WritingTask1ModelLesson,
  WritingTask1Review,
  WritingReviewResult,
  WritingReviewSummary,
  WritingReviewTimings,
  WritingUsage,
} from '../../src/types/writingReview.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { writingReviewEffort, writingReviewModelName, writingReviewModel } from './llm.ts'
import {
  proofOf,
  prepare,
  reviewDraft,
  retryUnconfirmed,
  applyAllEdits,
  type IssueKind,
  type RewriteReport,
  type PreparedReview,
} from './rewrite.ts'
import { creditInBackground } from '../practice/real-use.ts'
import { analyzeUserEditedWriting, resetUserEditedWriting, type EssayReviewEdit, type generateWritingModelEssay } from './writing-essay.ts'

type WrittenEssay = Awaited<ReturnType<typeof generateWritingModelEssay>>
import { chosenHints } from './dol.ts'
import { styleFixesKeptInEssay } from './copied-errors.ts'
import { countWords, MIN_WORDS_FOR_SCORING, scoreEssay } from './score.ts'
import { reviewTask1 } from './task1.ts'
import { stripHeadingLines } from '../../src/features/practice/writing-review/headings.ts'
import { task1ModelLesson } from './task1-model.ts'
import { WRITING_REVIEW_TOPICS, WRITING_REVIEW_TYPES, type WritingReviewTopic, type WritingReviewType } from '../../src/features/practice/writing-review/categories.ts'
import { z } from 'zod'

export const MIN_LENGTH = 30
export const MAX_LENGTH = 5000
const MAX_RUNNING = 2

const dir = (ctx: ApiContext) => path.join(ctx.rootDir, 'progress', 'writing-reviews')
const fileOf = (ctx: ApiContext, id: string) => path.join(dir(ctx), `${id}.json`)
const validId = (id: string) => /^[a-z0-9-]{6,40}$/.test(id)

// Kept on globalThis: the dev server reloads server modules in-process when they change, while running jobs carry on in
// the old instance — the page must still find them, and MAX_RUNNING must still count them.
const jobs = ((globalThis as { __writingReviewJobs?: Map<string, WritingReviewJob> }).__writingReviewJobs ??= new Map())

function emptyUsage(): WritingUsage {
  return { model: writingReviewModelName(), thinkingLevel: writingReviewEffort(), calls: [], input: 0, output: 0, thinking: 0, total: 0 }
}

const FIX_TYPE: Record<IssueKind, WritingFix['type']> = {
  spelling: 'spelling',
  grammar: 'grammar',
  word_form: 'word form',
  collocation: 'collocation',
  word_choice: 'word choice',
  naturalness: 'naturalness',
}

export { proofOf } from './rewrite.ts'

/** Turns the Claude report into what the page shows (the result shape is shared with older reviews). */
export function buildResult(
  id: string,
  createdAt: string,
  text: string,
  report: RewriteReport,
  usage: WritingUsage,
  durationMs: number,
  title?: string,
  prompt?: string,
  vietnameseText?: string,
  classification?: { topic: WritingReviewTopic; questionType: WritingReviewType },
  timings?: WritingReviewTimings,
  pending?: WritingReviewPending[],
): WritingReviewResult {
  const fixes: WritingFix[] = report.fixed
    .map((issue, n): WritingFix => ({
      id: `f${n + 1}`,
      sentenceIndex: issue.sentenceIndex,
      original: issue.original,
      replacement: issue.replacement,
      type: FIX_TYPE[issue.kind],
      severity: issue.severity,
      explanation: issue.why,
      ...proofOf(issue),
    }))
    .sort((a, b) => a.sentenceIndex - b.sentenceIndex)
  const allChecks = [...report.fixed, ...report.unconfirmed].flatMap((i) => i.checks)
  return {
    id,
    createdAt,
    durationMs,
    ...(title?.trim() ? { title: title.trim() } : {}),
    ...(prompt?.trim() ? { prompt: prompt.trim() } : {}),
    ...(classification ? { topic: classification.topic, questionType: classification.questionType } : {}),
    text,
    vietnameseText,
    ...(report.vietnameseFormatted?.blocks.length ? { vietnameseFormatted: report.vietnameseFormatted } : {}),
    sentences: report.sentences,
    paragraphStarts: report.paragraphStarts,
    correctedSentences: report.correctedSentences,
    corrected: report.correctedSentences.map((s, i) => (i && report.paragraphStarts.includes(i) ? `\n\n${s}` : i ? ` ${s}` : s)).join(''),
    fixes,
    warnings: report.unconfirmed.map((issue) => ({
      phrase: issue.original,
      suggestion: issue.replacement || undefined,
      explanation: `${issue.why} (Claude đề xuất; Longman/OZDIC chưa xác nhận cách sửa nên không tự sửa vào bài.)`,
      word: issue.checks[0]?.check.base ?? '',
    })),
    natural: [],
    upgrades: [],
    protected: [],
    recheck: [],
    checked: { total: allChecks.length, confirmed: allChecks.filter((c) => c.ok).length },
    suggestedPhrases: report.suggestedPhrases,
    ...(report.dolHints?.length ? { dolHints: report.dolHints } : {}),
    modelEssay: report.modelEssay,
    ...(timings ? { timings } : {}),
    ...(pending?.length ? { pending } : {}),
    usage,
  }
}

const ClassificationSchema = z.object({
  topic: z.enum(WRITING_REVIEW_TOPICS),
  questionType: z.enum(WRITING_REVIEW_TYPES),
})

export async function classifyWritingReview(
  llm: ReturnType<typeof writingReviewModel>,
  text: string,
  prompt?: string,
): Promise<{ topic: WritingReviewTopic; questionType: WritingReviewType }> {
  const result = await llm.json({
    label: 'classify',
    system: 'Classify an IELTS Writing Task 2 question into exactly one topic and one question type. Use Other only when no listed label fits.',
    prompt: `Question:\n${prompt?.trim() || '(No question supplied)'}\n\nEssay:\n${text}`,
    schema: ClassificationSchema,
    effort: 'low',
  })
  return result.value
}

export function attachEssay(
  result: WritingReviewResult,
  written: WrittenEssay | undefined,
  prepared: PreparedReview,
  onReviewEdits?: (edits: EssayReviewEdit[]) => void,
): void {
  if (!written) return
  const { dolRefs, unlistedFixes, reviewEdits, plan: _plan, ...modelEssay } = written
  for (const edit of reviewEdits ?? []) {
    console.info(`[writing-review] essay review (${edit.kind}): "${edit.original}" → "${edit.replacement}"`)
  }
  for (const fix of unlistedFixes ?? []) {
    console.info(`[writing-review] not in Longman / OZDIC: "${fix.original}" → "${fix.replacement}" (${fix.source})`)
  }
  onReviewEdits?.(reviewEdits ?? [])
  result.modelEssay = modelEssay
  result.dolHints = chosenHints(prepared.dolHints, dolRefs)
}

export interface ReviewWritingInput extends WritingReviewSource {
  text: string
  prompt?: string
  vietnameseText?: string
  title?: string
}

export interface ReviewWritingOpts {
  id?: string
  startedAt?: string
  onStep?: (step: string) => void
  onPartial?: (result: WritingReviewResult) => void
  onUsage?: (usage: WritingUsage) => void
  onCall?: (call: { step: string; input: number; output: number; thinking: number; ms?: number }) => void
  onReviewEdits?: (edits: EssayReviewEdit[]) => void
}

/** Runs the full writing review pipeline (score lane, corrections lane, essay lane) without writing job files. */
export async function reviewWriting(
  ctx: Pick<ApiContext, 'rootDir'>,
  input: ReviewWritingInput,
  opts: ReviewWritingOpts = {},
): Promise<WritingReviewResult> {
  const started = Date.now()
  const timings: WritingReviewTimings = {
    total: 0,
    steps: {},
  }
  const id = opts.id ?? 'review'
  const startedAt = opts.startedAt ?? new Date().toISOString()
  const usage: WritingUsage = emptyUsage()
  // Heading lines of a pasted essay ("**Introduction**", "Body Paragraph 1") are not sentences: never review or count them.
  input = { ...input, text: stripHeadingLines(input.text) || input.text }
  // Task 1 (a Writing Mock Test chart question): Task 1 score and model-essay lanes; no topic retrieve, no upgraded essay.
  const task1 = input.task === 1 && Boolean(input.promptId)
  const task1Ctx = { rootDir: ctx.rootDir, contentDir: path.join(ctx.rootDir, 'content') }
  const source: WritingReviewSource = task1 ? { task: 1, promptId: input.promptId } : {}

  const llm = writingReviewModel({
    onCall: (call) => {
      opts.onCall?.({ step: call.label, input: call.input, output: call.output, thinking: call.thinking, ms: call.ms })
      usage.model = call.model
      usage.calls.push({ step: call.label, input: call.input, output: call.output, thinking: call.thinking, ms: call.ms })
      usage.input += call.input
      usage.output += call.output
      usage.thinking += call.thinking
      usage.total = usage.input + usage.output + usage.thinking
      opts.onUsage?.(usage)
    },
  })

  // 0. Format idea runs independently in parallel at the start
  const ideaPromise = input.vietnameseText?.trim()
    ? import('../format-idea.ts').then((m) => m.formatIdea(input.vietnameseText!, llm, 'writing')).catch(() => undefined)
    : Promise.resolve(undefined)

  // Score call lane: runs in parallel from the start, replaces separate classify
  const wordsCount = countWords(input.text)
  let scoreDone = false
  let scoreResult: WritingScore | undefined
  let scoreTopic: WritingReviewTopic | undefined
  let scoreType: WritingReviewType | undefined
  let scoreSkippedReason: WritingScoreSkipped | undefined
  let task1Review: WritingTask1Review | undefined

  const state: { result: WritingReviewResult | null } = { result: null }

  const scoreLane = (async () => {
    if (wordsCount < MIN_WORDS_FOR_SCORING) {
      scoreSkippedReason = 'short'
      scoreDone = true
      return
    }
    const tScore = Date.now()
    try {
      if (task1) {
        const res = await reviewTask1(task1Ctx, llm, {
          promptId: input.promptId!,
          text: input.text,
          prompt: input.prompt,
          vietnameseText: input.vietnameseText,
        })
        timings.steps['score'] = Date.now() - tScore
        scoreResult = res.score
        task1Review = res.task1
      } else {
        const res = await scoreEssay(llm, { text: input.text, prompt: input.prompt, vietnameseText: input.vietnameseText })
        timings.steps['score'] = Date.now() - tScore
        scoreResult = res.score
        scoreTopic = res.topic
        scoreType = res.questionType
      }
    } catch (err) {
      console.warn(`[writing-review] score call failed: ${(err as Error).message}`)
      scoreSkippedReason = 'error'
    } finally {
      scoreDone = true
      if (state.result) {
        if (scoreResult) state.result.score = scoreResult
        if (scoreSkippedReason) state.result.scoreSkipped = scoreSkippedReason
        if (task1Review) state.result.task1 = task1Review
        if (scoreTopic) state.result.topic = scoreTopic
        if (scoreType) state.result.questionType = scoreType
        state.result.pending = state.result.pending?.filter((p) => p !== 'score')
        if (!state.result.pending?.length) delete state.result.pending
        opts.onPartial?.(state.result)
      }
    }
  })()

  // 1. Shared prepare step: collocations retrieve + chunk & DOL lookups
  const tPrep = Date.now()
  const prepared = await prepare(input.text, llm, {
    vietnameseText: input.vietnameseText,
    rootDir: task1 ? undefined : ctx.rootDir,
    onStep: opts.onStep,
  })
  timings.steps['prepare'] = Date.now() - tPrep

  let hasPartial = false
  let essayDone = task1
  let writtenEssay: WrittenEssay | undefined
  let compareDone = !task1
  let task1Model: WritingTask1ModelLesson | undefined

  // 2. Parallel lanes: Corrections lane & Model Essay lane
  const correctionsLane = (async () => {
    const tDraft = Date.now()
    const draft = await reviewDraft(prepared, llm, {
      prompt: input.prompt,
      vietnameseText: input.vietnameseText,
      onStep: (step) => {
        if (!hasPartial) opts.onStep?.(step)
      },
    })
    timings.steps['diagnose_dict'] = Date.now() - tDraft

    // Build partial result
    const formattedIdea = await ideaPromise
    const partialReport: RewriteReport = {
      sentences: draft.sentences,
      paragraphStarts: draft.paragraphStarts,
      correctedSentences: draft.correctedSentences,
      fixed: draft.fixed,
      unconfirmed: draft.unconfirmed,
      suggestedPhrases: prepared.suggestedPhrases,
      dolHints: prepared.dolHints,
      vietnameseFormatted: formattedIdea,
    }

    const pending: WritingReviewPending[] = []
    if (draft.failed.length) pending.push('retry')
    if (!essayDone) pending.push('modelEssay')
    if (!scoreDone) pending.push('score')
    if (!compareDone) pending.push('compare')

    timings.firstResult = Date.now() - started
    state.result = buildResult(
      id,
      startedAt,
      input.text,
      partialReport,
      usage,
      timings.firstResult,
      input.title,
      input.prompt,
      input.vietnameseText,
      scoreTopic && scoreType ? { topic: scoreTopic, questionType: scoreType } : undefined,
      timings,
      pending.length ? pending : undefined,
    )
    Object.assign(state.result, source)
    if (scoreResult) state.result.score = scoreResult
    if (scoreSkippedReason) state.result.scoreSkipped = scoreSkippedReason
    if (task1Review) state.result.task1 = task1Review
    if (task1Model) state.result.task1Model = task1Model
    hasPartial = true

    // If essay finished before corrections, attach it now
    if (essayDone && writtenEssay && state.result) {
      attachEssay(state.result, writtenEssay, prepared, opts.onReviewEdits)
    }
    opts.onPartial?.(state.result)

    // Retry step for unconfirmed edits
    if (draft.failed.length) {
      const tRetry = Date.now()
      await retryUnconfirmed(draft.failed, prepared.sentences, draft.dict, llm, (step) => {
        if (hasPartial && essayDone) opts.onStep?.(step)
      })
      timings.steps['retry'] = Date.now() - tRetry

      const updated = applyAllEdits(prepared.sentences, draft.issues)
      if (state.result) {
        const updatedReport: RewriteReport = {
          ...partialReport,
          correctedSentences: updated.correctedSentences,
          fixed: updated.fixed,
          unconfirmed: updated.unconfirmed,
        }
        const rebuilt = buildResult(
          id,
          startedAt,
          input.text,
          updatedReport,
          usage,
          Date.now() - started,
          input.title,
          input.prompt,
          input.vietnameseText,
          state.result.topic && state.result.questionType
            ? { topic: state.result.topic, questionType: state.result.questionType }
            : undefined,
          timings,
          state.result.pending?.filter((p) => p !== 'retry'),
        )
        state.result.fixes = rebuilt.fixes
        state.result.warnings = rebuilt.warnings
        state.result.correctedSentences = rebuilt.correctedSentences
        state.result.corrected = rebuilt.corrected
        state.result.pending = state.result.pending?.filter((p) => p !== 'retry')
        if (!state.result.pending?.length) delete state.result.pending
        opts.onPartial?.(state.result)
      }
    }
  })()

  const essayLane = (async () => {
    if (task1) return
    const { writingLinearGuide, generateWritingModelEssay } = await import('./writing-essay.ts')
    const tEssay = Date.now()
    const written = await generateWritingModelEssay(
      {
        text: input.text,
        vietnameseText: input.vietnameseText,
        candidates: prepared.suggestedPhrases.map((c) => ({
          id: c.cardId,
          term: c.term,
          meaning_vi: c.meaning_vi,
          origin: c.origin,
          example: c.example,
          isTopicCollocation: true,
        })),
        guide: await writingLinearGuide({ rootDir: ctx.rootDir || process.cwd() }),
        dolHints: prepared.dolHints,
        onStep: (step) => {
          if (hasPartial) opts.onStep?.(step)
        },
      },
      llm,
    ).catch((err) => {
      console.error('Failed to generate writing model essay:', err)
      return undefined
    })
    timings.steps['essay'] = Date.now() - tEssay
    essayDone = true
    writtenEssay = written

    if (state.result) {
      if (written) {
        attachEssay(state.result, written, prepared, opts.onReviewEdits)
      }
      state.result.pending = state.result.pending?.filter((p) => p !== 'modelEssay')
      if (!state.result.pending?.length) delete state.result.pending
      opts.onPartial?.(state.result)
    }
  })()

  // Task 1: what the answer can learn from the learner's own model essay (none when the question has no model essay).
  const compareLane = (async () => {
    if (!task1) return
    const tCompare = Date.now()
    try {
      task1Model = await task1ModelLesson(task1Ctx, llm, { promptId: input.promptId!, text: input.text, prompt: input.prompt })
      timings.steps['compare'] = Date.now() - tCompare
    } catch (err) {
      console.warn(`[writing-review] task 1 model comparison failed: ${(err as Error).message}`)
    } finally {
      compareDone = true
      if (state.result) {
        if (task1Model) state.result.task1Model = task1Model
        state.result.pending = state.result.pending?.filter((p) => p !== 'compare')
        if (!state.result.pending?.length) delete state.result.pending
        opts.onPartial?.(state.result)
      }
    }
  })()

  await Promise.all([correctionsLane, essayLane, scoreLane, compareLane])

  // Fall back to separate classify only if score did not provide topic/questionType (Task 2 only)
  let finalTopic = scoreTopic
  let finalType = scoreType
  if (!task1 && (!finalTopic || !finalType)) {
    opts.onStep?.('classify')
    const classification = await classifyWritingReview(llm, input.text, input.prompt).catch((error: Error) => {
      console.warn(`[writing-review] classification fallback skipped: ${error.message}`)
      return { topic: 'Other' as const, questionType: 'Other' as const }
    })
    finalTopic ??= classification.topic
    finalType ??= classification.questionType
  }

  timings.total = Date.now() - started
  const finalResult = state.result!
  Object.assign(finalResult, source)
  if (finalTopic) finalResult.topic = finalTopic
  if (finalType) finalResult.questionType = finalType
  finalResult.durationMs = timings.total
  finalResult.timings = timings
  if (scoreResult) finalResult.score = scoreResult
  if (scoreSkippedReason) finalResult.scoreSkipped = scoreSkippedReason
  if (task1Review) finalResult.task1 = task1Review
  if (task1Model) finalResult.task1Model = task1Model
  delete finalResult.pending

  // The essay lane never saw the corrections: label upgrades the essay itself does not make, so the two tabs agree.
  if (finalResult.modelEssay) {
    const essaySentences = finalResult.modelEssay.sentences.map((s) => s.segments.map((seg) => seg.text).join(''))
    const kept = styleFixesKeptInEssay(finalResult.fixes, essaySentences)
    for (const fix of finalResult.fixes) {
      if (kept.has(fix.id)) fix.keptInEssay = true
    }
  }

  return finalResult
}

async function run(ctx: ApiContext, job: WritingReviewJob, input: ReviewWritingInput) {
  try {
    const result = await reviewWriting(
      ctx,
      input,
      {
        id: job.id,
        startedAt: job.startedAt,
        onStep: (step) => {
          job.step = step
        },
        onPartial: (r) => {
          job.result = r
        },
        onUsage: (u) => {
          job.usage = u
        },
      },
    )
    job.result = result
    job.usage = result.usage
    job.topic = result.topic
    job.questionType = result.questionType
    await mkdir(dir(ctx), { recursive: true })
    await writeFile(fileOf(ctx, job.id), JSON.stringify(result, null, 1))
    job.status = 'done'
    job.step = undefined
    console.log(`[writing-review] ${job.id} timings: total=${result.timings?.total}ms, firstResult=${result.timings?.firstResult ?? 0}ms`)
    creditInBackground(ctx, 'writing', job.id)
  } catch (error) {
    job.status = 'error'
    job.error = (error as Error).message
    console.error('[writing-review]', error)
  } finally {
    setTimeout(() => jobs.delete(job.id), job.status === 'error' ? 10 * 60_000 : 60_000).unref()
  }
}

export function normalizeVietnameseOutline(raw?: string): string | undefined {
  if (!raw) return undefined
  const SECTION_REGEX = /(?<=[^\n])\s*(?=(?:Mở bài|Thân bài(?:\s*\d+)?|Body(?:\s*\d+)?|Kết bài|Kết luận|Conclusion|Introduction|Luận điểm(?:\s*\d+)?|Ưu điểm|Nhược điểm|Lợi ích|Bất lợi|Mặt lợi|Mặt hại|Nguyên nhân|Hậu quả|Hệ quả|Giải pháp|Ý(?:\s*\d+)?|Idea(?:\s*\d+)?)\s*[:\-–])/gi
  // A list marker starts after a space: "- ", "• ", "* " or "1. ", "2) " (one or two digits). Without the space a year at
  // the end of a sentence ("năm 2010.") was split into "2 / 0 / 1 / 0." and "**Mở bài**" lost its closing "*".
  const LIST_REGEX = /(?<=\S)\s+(?=(?:[-*•]\s+|\d{1,2}[.)]\s+))/g
  return raw.replace(SECTION_REGEX, '\n\n').replace(LIST_REGEX, '\n\n').trim()
}

export function startReview(
  ctx: ApiContext,
  text: string,
  prompt?: string,
  vietnameseText?: string,
  title?: string,
  source: WritingReviewSource = {},
): WritingReviewJob {
  if ([...jobs.values()].filter((j) => j.status === 'running').length >= MAX_RUNNING) {
    throw new ApiError(429, 'Another review is still running — please wait for it to finish.')
  }
  const cleanVietnamese = normalizeVietnameseOutline(vietnameseText)
  const job: WritingReviewJob = {
    id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
    status: 'running',
    startedAt: new Date().toISOString(),
    title: title?.trim() || undefined,
    prompt: prompt?.trim() || undefined,
    vietnameseText: cleanVietnamese,
    step: 'diagnose',
    usage: emptyUsage(),
    ...(source.task === 1 && source.promptId ? { task: 1 as const, promptId: source.promptId } : {}),
  }
  jobs.set(job.id, job)
  void run(ctx, job, { text, prompt, vietnameseText: cleanVietnamese, title, ...source })
  return job
}

export async function getReview(ctx: ApiContext, id: string): Promise<WritingReviewJob | null> {
  if (!validId(id)) return null
  const live = jobs.get(id)
  if (live) return live
  try {
    const result = JSON.parse(await readFile(fileOf(ctx, id), 'utf8')) as WritingReviewResult
    return { id, status: 'done', startedAt: result.createdAt, usage: result.usage, result }
  } catch {
    return null
  }
}

export async function listReviews(ctx: ApiContext, limit = 100): Promise<WritingReviewSummary[]> {
  let files: string[] = []
  try {
    files = (await readdir(dir(ctx))).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const items: WritingReviewSummary[] = []
  for (const file of files) {
    try {
      const r = JSON.parse(await readFile(path.join(dir(ctx), file), 'utf8')) as WritingReviewResult
      items.push({
        id: r.id,
        createdAt: r.createdAt,
        title: r.title,
        prompt: r.prompt,
        ...(r.task ? { task: r.task } : {}),
        ...(r.promptId ? { promptId: r.promptId } : {}),
        topic: r.topic,
        questionType: r.questionType,
        overall: r.score?.overall,
        excerpt: (r.text || '').slice(0, 140),
        vietnameseExcerpt: r.vietnameseText ? r.vietnameseText.slice(0, 140) : undefined,
        fixes: r.fixes?.length ?? 0,
        tokens: r.usage?.total ?? 0,
      })
    } catch {
      // A half-written or foreign file is skipped.
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
}

export async function deleteReview(ctx: ApiContext, id: string): Promise<void> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  await rm(fileOf(ctx, id), { force: true })
  jobs.delete(id)
}

export async function analyzeReviewEdit(ctx: ApiContext, id: string, userEdited: string): Promise<WritingReviewResult> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  const llm = writingReviewModel()
  const result = await analyzeUserEditedWriting(ctx, { id, userEdited }, llm)
  creditInBackground(ctx, 'writing', id)
  return result
}

export async function resetReviewEdit(ctx: ApiContext, id: string): Promise<WritingReviewResult> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  return resetUserEditedWriting(ctx, id)
}

/**
 * Task 1: runs the model-essay comparison again for a saved review (a model essay added or edited after grading).
 * No model essay any more → the comparison is removed.
 */
export async function rerunTask1Model(ctx: ApiContext, id: string): Promise<WritingReviewResult> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  if (jobs.get(id)?.status === 'running') throw new ApiError(409, 'The review is still running.')
  let result: WritingReviewResult
  try {
    result = JSON.parse(await readFile(fileOf(ctx, id), 'utf8')) as WritingReviewResult
  } catch {
    throw new ApiError(404, 'Review not found.')
  }
  if (result.task !== 1 || !result.promptId) throw new ApiError(400, 'Not a Task 1 review.')
  const llm = writingReviewModel({
    onCall: (call) => {
      result.usage.calls.push({ step: call.label, input: call.input, output: call.output, thinking: call.thinking, ms: call.ms })
      result.usage.input += call.input
      result.usage.output += call.output
      result.usage.thinking += call.thinking
      result.usage.total = result.usage.input + result.usage.output + result.usage.thinking
    },
  })
  const lesson = await task1ModelLesson(ctx, llm, { promptId: result.promptId, text: result.text, prompt: result.prompt })
  if (lesson) result.task1Model = lesson
  else delete result.task1Model
  await writeFile(fileOf(ctx, id), JSON.stringify(result, null, 1))
  return result
}
