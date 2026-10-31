import { useState } from 'react'
import {
  AlertCircle,
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Mic,
  PlayCircle,
  RotateCcw,
  Send,
  Sparkles,
} from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { TalkReviewResult } from '@/types/speakingReview'
import { audioUrl as serverAudioUrl } from '../speaking-review/api'
import { ResultView } from '../speaking-review/ResultView'
import type {
  BuiltMockSession,
  MockPartNumber,
  MockQuestionEvaluation,
  MockQuestionItem,
  MockQuestionRecording,
} from './types'

const STEP_LABELS: Record<string, string> = {
  transcribe: 'Chuyển giọng nói thành văn bản (Whisper)…',
  analyze: 'Chấm 4 tiêu chí IELTS & sửa diễn đạt (AI)…',
  dictionary: 'Đối chiếu Longman & OZDIC…',
}

function roundHalfBand(values: number[]): number {
  if (!values.length) return 0
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  return Math.round(avg * 2) / 2
}

export function MockReviewAndResults({
  session,
  recordings,
  evaluations,
  isEvaluatingAll,
  onSubmitAll,
  onEvaluateSingle,
  onUpdateResult,
  onRerecordQuestion,
  onRetakeFullTest,
  onNewTest,
}: {
  session: BuiltMockSession
  recordings: Record<string, MockQuestionRecording>
  evaluations: Record<string, MockQuestionEvaluation>
  isEvaluatingAll: boolean
  onSubmitAll: () => void
  onEvaluateSingle: (questionId: string) => void
  onUpdateResult: (questionId: string, updated: TalkReviewResult) => void
  onRerecordQuestion: (questionIndex: number) => void
  onRetakeFullTest?: () => void
  onNewTest: () => void
}) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const expandAll = () => {
    const next: Record<string, boolean> = {}
    session.questions.forEach((q) => {
      next[q.id] = true
    })
    setExpandedIds(next)
  }

  const collapseAll = () => {
    setExpandedIds({})
  }

  const recordedQuestions = session.questions.filter(
    (q) => Boolean(recordings[q.id]) || Boolean(evaluations[q.id]?.result),
  )
  const doneEvaluations = session.questions
    .map((q) => evaluations[q.id]?.result)
    .filter((r): r is TalkReviewResult => Boolean(r))

  const pendingOrErrorCount = session.questions.filter((q) => {
    if (!recordings[q.id]) return false
    const st = evaluations[q.id]?.status
    return !st || st === 'idle' || st === 'error'
  }).length

  const runningQuestion = session.questions.find((q) => {
    const st = evaluations[q.id]?.status
    return st === 'submitting' || st === 'running'
  })

  const overallBand = roundHalfBand(doneEvaluations.map((r) => r.overall))

  // Group questions by Part (1, 2, 3)
  const partsPresent = ([1, 2, 3] as MockPartNumber[]).filter((p) =>
    session.questions.some((q) => q.part === p),
  )

  return (
    <div className="space-y-6">
      {/* Top Summary & Submission Control Card */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-center gap-3.5">
            {doneEvaluations.length > 0 ? (
              <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                <span className="text-[10px] font-bold tracking-wider uppercase opacity-85">Band</span>
                <span className="text-base leading-none font-extrabold tabular-nums">
                  {overallBand.toFixed(1)}
                </span>
              </div>
            ) : (
              <span className="flex size-12 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-sm">
                <Award className="size-6" />
              </span>
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                  {doneEvaluations.length > 0
                    ? `Kết quả Speaking Mock Test (${doneEvaluations.length}/${recordedQuestions.length || session.questions.length} câu đã chấm)`
                    : 'Kiểm tra bản ghi & Nộp bài chấm AI'}
                </h2>
                <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-800 dark:bg-sky-950/70 dark:text-sky-300">
                  Parts: {session.parts.map((p) => `Part ${p}`).join(' + ')}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Đã thu âm {recordedQuestions.length}/{session.questions.length} câu hỏi • Bạn có thể nghe lại từng câu, thu âm lại hoặc làm lại toàn bộ đề.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {pendingOrErrorCount > 0 ? (
              <Button onClick={onSubmitAll} disabled={isEvaluatingAll}>
                {isEvaluatingAll ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Đang chấm bài ({doneEvaluations.length}/{recordedQuestions.length})…</span>
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    <span>
                      {doneEvaluations.length > 0
                        ? `Chấm tiếp ${pendingOrErrorCount} câu còn lại`
                        : `Nộp & Chấm điểm AI (${pendingOrErrorCount} câu)`}
                    </span>
                  </>
                )}
              </Button>
            ) : null}

            {onRetakeFullTest ? (
              <Button variant="outline" onClick={onRetakeFullTest} disabled={isEvaluatingAll}>
                <Mic className="size-4" />
                <span>Làm lại đề này</span>
              </Button>
            ) : null}

            <Button variant="outline" onClick={onNewTest} disabled={isEvaluatingAll}>
              <RotateCcw className="size-4" />
              <span>Danh sách đề</span>
            </Button>
          </div>
        </div>

        {/* Live Progress Banner while evaluating */}
        {isEvaluatingAll && runningQuestion ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-100 bg-sky-50/70 px-5 py-3.5 text-xs text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-200">
            <div className="flex items-center gap-2.5">
              <Loader2 className="size-4 shrink-0 animate-spin text-sky-600 dark:text-sky-400" />
              <div>
                <span className="font-bold">
                  Đang chấm Part {runningQuestion.part} • Câu {runningQuestion.indexInPart}:
                </span>{' '}
                <span>
                  {STEP_LABELS[evaluations[runningQuestion.id]?.step ?? 'transcribe'] ??
                    'Đang gửi bản ghi tới hệ thống chấm Speaking Review…'}
                </span>
              </div>
            </div>
            <span className="rounded-full bg-white/80 px-2.5 py-1 font-bold text-sky-800 tabular-nums dark:bg-slate-900 dark:text-sky-300">
              Hoàn thành {doneEvaluations.length} / {recordedQuestions.length}
            </span>
          </div>
        ) : null}

        {/* Expand / Collapse all controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs text-slate-500 sm:px-6 dark:text-slate-400">
          <span>
            Nhấn vào từng câu hỏi bên dưới để mở rộng hoặc thu gọn chi tiết đánh giá IELTS.
          </span>
          <div className="flex items-center gap-3 font-semibold">
            <button
              type="button"
              onClick={expandAll}
              className="text-sky-600 hover:underline dark:text-sky-400"
            >
              Mở rộng tất cả
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={collapseAll}
              className="text-slate-600 hover:underline dark:text-slate-300"
            >
              Thu gọn tất cả
            </button>
          </div>
        </div>
      </Card>

      {/* Grouped by IELTS Speaking Part: Part 1, Part 2, Part 3 */}
      {partsPresent.map((partNum) => {
        const partQuestions = session.questions.filter((q) => q.part === partNum)
        const partResults = partQuestions
          .map((q) => evaluations[q.id]?.result)
          .filter((r): r is TalkReviewResult => Boolean(r))
        const partBand = roundHalfBand(partResults.map((r) => r.overall))
        const partTopic = partQuestions[0]?.topic ?? ''

        return (
          <section key={partNum} className="space-y-3">
            {/* Part Section Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-3 py-1 text-xs font-extrabold tracking-wider text-white uppercase">
                  Part {partNum}
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 sm:text-base dark:text-white">
                    {partNum === 1
                      ? 'Part 1: Introduction & Interview'
                      : partNum === 2
                        ? 'Part 2: Individual Long Turn (Cue Card)'
                        : 'Part 3: Two-Way Discussion'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Chủ đề: <span className="font-semibold text-slate-700 dark:text-slate-300">{partTopic}</span> •{' '}
                    {partQuestions.length} câu hỏi
                  </p>
                </div>
              </div>

              {partResults.length > 0 ? (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-1.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <Sparkles className="size-3.5" />
                  <span>Part {partNum} Band: {partBand.toFixed(1)}</span>
                </div>
              ) : null}
            </div>

            {/* Individual Collapsible Question Cards within this Part */}
            <div className="space-y-3">
              {partQuestions.map((q) => {
                const globalIndex = session.questions.findIndex((item) => item.id === q.id)
                const rec = recordings[q.id]
                const ev = evaluations[q.id]
                const isExpanded = Boolean(expandedIds[q.id])

                return (
                  <QuestionResultAccordion
                    key={q.id}
                    question={q}
                    recording={rec}
                    evaluation={ev}
                    expanded={isExpanded}
                    isEvaluatingAll={isEvaluatingAll}
                    onToggle={() => toggleExpand(q.id)}
                    onEvaluate={() => {
                      setExpandedIds((prev) => ({ ...prev, [q.id]: true }))
                      onEvaluateSingle(q.id)
                    }}
                    onRerecord={() => onRerecordQuestion(globalIndex)}
                    onUpdateResult={(updated) => onUpdateResult(q.id, updated)}
                  />
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function QuestionResultAccordion({
  question,
  recording,
  evaluation,
  expanded,
  isEvaluatingAll,
  onToggle,
  onEvaluate,
  onRerecord,
  onUpdateResult,
}: {
  question: MockQuestionItem
  recording?: MockQuestionRecording
  evaluation?: MockQuestionEvaluation
  expanded: boolean
  isEvaluatingAll: boolean
  onToggle: () => void
  onEvaluate: () => void
  onRerecord: () => void
  onUpdateResult: (updated: TalkReviewResult) => void
}) {
  const status = evaluation?.status ?? 'idle'
  const result = evaluation?.result
  const playbackUrl = recording?.audioUrl ?? (result?.audio ? serverAudioUrl(result.id) : undefined)
  const durationSec = recording?.durationSeconds ?? (result?.fluency?.duration ? Math.round(result.fluency.duration) : undefined)

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs transition dark:border-slate-800 dark:bg-slate-900">
      {/* Accordion Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold',
              result
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                : recording
                  ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
            )}
          >
            {question.part}.{question.indexInPart}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-900 dark:text-white">
              {question.part === 2 ? question.topic : question.questionText}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400">
              {playbackUrl ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" />
                  Đã ghi âm {durationSec ? `(${durationSec}s)` : ''}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Clock className="size-3.5" />
                  Chưa có bản ghi âm
                </span>
              )}

              {status === 'submitting' || status === 'running' ? (
                <span className="inline-flex items-center gap-1 font-semibold text-sky-600 dark:text-sky-400">
                  <Loader2 className="size-3.5 animate-spin" />
                  Đang chấm điểm…
                </span>
              ) : null}

              {status === 'error' ? (
                <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                  <AlertCircle className="size-3.5" />
                  Lỗi chấm điểm
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {result ? (
            <span className="rounded-xl bg-emerald-600 px-3 py-1 text-xs font-extrabold text-white shadow-2xs">
              Band {result.overall.toFixed(1)}
            </span>
          ) : null}

          <span className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
            {expanded ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
          </span>
        </div>
      </div>

      {/* Accordion Body */}
      {expanded ? (
        <div className="border-t border-slate-100 bg-slate-50/40 p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-950/30">
          {/* Cue card bullets if Part 2 */}
          {question.part === 2 && question.cueCardBullets && question.cueCardBullets.length > 0 ? (
            <div className="mb-4 rounded-xl border border-slate-200/80 bg-white p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <p className="mb-1.5 font-bold text-slate-800 dark:text-slate-200">Cue Card Prompts:</p>
              <ul className="list-disc space-y-1 pl-5">
                {question.cueCardBullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Audio Player + Re-record / Evaluate Controls */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
            {playbackUrl ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                  <PlayCircle className="size-4 text-sky-600 dark:text-sky-400" />
                  Bản thu của bạn {durationSec ? `(${durationSec}s)` : ''}:
                </span>
                <audio controls src={playbackUrl} className="h-9 max-w-full flex-1" preload="metadata" />
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Bạn chưa ghi âm câu hỏi này. Hãy bấm &ldquo;Ghi âm câu này&rdquo; để trả lời bổ sung.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onRerecord}
                disabled={isEvaluatingAll || status === 'submitting' || status === 'running'}
              >
                <Mic className="size-3.5" />
                <span>{playbackUrl ? 'Ghi âm lại câu này' : 'Ghi âm câu này'}</span>
              </Button>

              {recording && (!result || status === 'error') ? (
                <Button
                  size="sm"
                  onClick={onEvaluate}
                  disabled={isEvaluatingAll || status === 'submitting' || status === 'running'}
                >
                  {status === 'submitting' || status === 'running' ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Đang chấm…</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-3.5" />
                      <span>{status === 'error' ? 'Chấm lại câu này' : 'Chấm câu này'}</span>
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          </div>

          {/* Running Step Indicator */}
          {(status === 'submitting' || status === 'running') && !result ? (
            <div className="flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50/70 p-4 text-sm text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
              <Loader2 className="size-5 shrink-0 animate-spin text-sky-600 dark:text-sky-400" />
              <div>
                <p className="font-bold">Đang chấm điểm câu trả lời…</p>
                <p className="text-xs opacity-80">
                  {STEP_LABELS[evaluation?.step ?? 'transcribe'] ?? 'Vui lòng đợi trong giây lát…'}
                </p>
              </div>
            </div>
          ) : null}

          {/* Error State */}
          {status === 'error' && evaluation?.error ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="size-5 shrink-0 text-rose-600 dark:text-rose-400" />
                <span>{evaluation.error}</span>
              </div>
              <Button size="sm" variant="outline" onClick={onEvaluate} disabled={isEvaluatingAll}>
                <RotateCcw className="size-3.5" /> Thử chấm lại
              </Button>
            </div>
          ) : null}

          {/* Evaluated ResultView (Skipping Speaking Figures & Script Comparison as required!) */}
          {result ? (
            <ResultView
              result={result}
              onUpdate={onUpdateResult}
              hideFigures
              hideScriptComparison
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
