// Writing review jobs. A review makes 1–2 Claude calls plus Longman/OZDIC lookups (~1–3 min), so it runs in the background: the page starts a job,
// polls it (live step + token count) and can reopen it later. Finished reviews are saved in progress/writing-reviews/
// (outside content/, so saving never triggers a content rebuild).
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WritingFix, WritingReviewJob, WritingReviewResult, WritingReviewSummary, WritingUsage } from '../../src/types/writingReview.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { writingReviewEffort, writingReviewModelName, writingReviewModel } from './llm.ts'
import { proofOf, rewriteReview, type IssueKind, type RewriteReport } from './rewrite.ts'
import { creditInBackground } from '../practice/real-use.ts'
import { analyzeUserEditedWriting, resetUserEditedWriting } from './writing-essay.ts'

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
function buildResult(
  id: string,
  createdAt: string,
  text: string,
  report: RewriteReport,
  usage: WritingUsage,
  durationMs: number,
  vietnameseText?: string,
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
    usage,
  }
}

async function run(ctx: ApiContext, job: WritingReviewJob, text: string, vietnameseText?: string) {
  const started = Date.now()
  // The step shown comes from rewriteReview's onStep only: call labels ("writing: model essay") are not step ids the
  // page knows.
  const llm = writingReviewModel({
    onCall: (call) => {
      job.usage.model = call.model
      job.usage.calls.push({ step: call.label, input: call.input, output: call.output, thinking: call.thinking })
      job.usage.input += call.input
      job.usage.output += call.output
      job.usage.thinking += call.thinking
      job.usage.total = job.usage.input + job.usage.output + job.usage.thinking
    },
  })
  try {
    const report = await rewriteReview(text, llm, {
      vietnameseText,
      rootDir: ctx.rootDir,
      onStep: (step) => (job.step = step),
    })
    job.result = buildResult(job.id, job.startedAt, text, report, job.usage, Date.now() - started, vietnameseText)
    job.status = 'done'
    job.step = undefined
    await mkdir(dir(ctx), { recursive: true })
    await writeFile(fileOf(ctx, job.id), JSON.stringify(job.result, null, 1))
    // Review cards you used yourself in the essay (right: up to "Tự dùng"; wrong: back to practise).
    creditInBackground(ctx, 'writing', job.id)
  } catch (error) {
    job.status = 'error'
    job.error = (error as Error).message
    console.error('[writing-review]', error)
  } finally {
    // Finished jobs are served from disk; keep failed ones briefly so the page can show the error.
    setTimeout(() => jobs.delete(job.id), job.status === 'error' ? 10 * 60_000 : 60_000).unref()
  }
}

export function normalizeVietnameseOutline(raw?: string): string | undefined {
  if (!raw) return undefined
  const SECTION_REGEX = /(?<=[^\n])\s*(?=(?:Mở bài|Thân bài(?:\s*\d+)?|Body(?:\s*\d+)?|Kết bài|Kết luận|Conclusion|Introduction|Luận điểm(?:\s*\d+)?|Ưu điểm|Nhược điểm|Lợi ích|Bất lợi|Mặt lợi|Mặt hại|Nguyên nhân|Hậu quả|Hệ quả|Giải pháp|Ý(?:\s*\d+)?|Idea(?:\s*\d+)?)\s*[:\-–])/gi
  const LIST_REGEX = /(?<=[^\n])\s*(?=(?:[-*•]\s+|\d+[.)]\s+))/g
  return raw.replace(SECTION_REGEX, '\n\n').replace(LIST_REGEX, '\n\n').trim()
}

export function startReview(ctx: ApiContext, text: string, vietnameseText?: string): WritingReviewJob {
  if ([...jobs.values()].filter((j) => j.status === 'running').length >= MAX_RUNNING) {
    throw new ApiError(429, 'Another review is still running — please wait for it to finish.')
  }
  const cleanVietnamese = normalizeVietnameseOutline(vietnameseText)
  const job: WritingReviewJob = {
    id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
    status: 'running',
    startedAt: new Date().toISOString(),
    vietnameseText: cleanVietnamese,
    step: 'diagnose',
    usage: emptyUsage(),
  }
  jobs.set(job.id, job)
  void run(ctx, job, text, cleanVietnamese)
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
