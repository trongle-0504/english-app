// Writing review jobs. A review makes 1–2 Claude calls plus Longman/OZDIC lookups (~1–3 min), so it runs in the background: the page starts a job,
// polls it (live step + token count) and can reopen it later. Finished reviews are saved in progress/writing-reviews/
// (outside content/, so saving never triggers a content rebuild).
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  WritingFix,
  WritingReviewJob,
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
  pending?: ('retry' | 'modelEssay' | 'score')[],
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

export interface ReviewWritingInput {
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
  let scoreResult: any = undefined
  let scoreTopic: WritingReviewTopic | undefined
  let scoreType: WritingReviewType | undefined
  let scoreSkippedReason: 'short' | 'error' | undefined

  const state: { result: WritingReviewResult | null } = { result: null }

  const scoreLane = (async () => {
    if (wordsCount < MIN_WORDS_FOR_SCORING) {
      scoreSkippedReason = 'short'
      scoreDone = true
      return
    }
    const tScore = Date.now()
    try {
      const res = await scoreEssay(llm, { text: input.text, prompt: input.prompt, vietnameseText: input.vietnameseText })
      timings.steps['score'] = Date.now() - tScore
      scoreResult = res.score
      scoreTopic = res.topic
      scoreType = res.questionType
    } catch (err) {
      console.warn(`[writing-review] score call failed: ${(err as Error).message}`)
      scoreSkippedReason = 'error'
    } finally {
      scoreDone = true
      if (state.result) {
        if (scoreResult) state.result.score = scoreResult
        if (scoreSkippedReason) state.result.scoreSkipped = scoreSkippedReason
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
    rootDir: ctx.rootDir,
    onStep: opts.onStep,
  })
  timings.steps['prepare'] = Date.now() - tPrep

  let hasPartial = false
  let essayDone = false
  let writtenEssay: WrittenEssay | undefined

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

    const pending: ('retry' | 'modelEssay' | 'score')[] = []
    if (draft.failed.length) pending.push('retry')
    if (!essayDone) pending.push('modelEssay')
    if (!scoreDone) pending.push('score')

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
    if (scoreResult) state.result.score = scoreResult
    if (scoreSkippedReason) state.result.scoreSkipped = scoreSkippedReason
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

  await Promise.all([correctionsLane, essayLane, scoreLane])

  // Fall back to separate classify only if score did not provide topic/questionType
  let finalTopic = scoreTopic
  let finalType = scoreType
  if (!finalTopic || !finalType) {
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
  finalResult.topic = finalTopic
  finalResult.questionType = finalType
  finalResult.durationMs = timings.total
  finalResult.timings = timings
  if (scoreResult) finalResult.score = scoreResult
  if (scoreSkippedReason) finalResult.scoreSkipped = scoreSkippedReason
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

async function run(ctx: ApiContext, job: WritingReviewJob, text: string, prompt?: string, vietnameseText?: string, title?: string) {
  try {
    const result = await reviewWriting(
      ctx,
      { text, prompt, vietnameseText, title },
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
  const LIST_REGEX = /(?<=[^\n])\s*(?=(?:[-*•]\s+|\d+[.)]\s+))/g
  return raw.replace(SECTION_REGEX, '\n\n').replace(LIST_REGEX, '\n\n').trim()
}

export function startReview(ctx: ApiContext, text: string, prompt?: string, vietnameseText?: string, title?: string): WritingReviewJob {
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
  }
  jobs.set(job.id, job)
  void run(ctx, job, text, prompt, cleanVietnamese, title)
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
