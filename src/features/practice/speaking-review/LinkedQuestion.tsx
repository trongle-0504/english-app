import { ChevronDown, ChevronLeft, ChevronRight, Copy, Languages, Lightbulb, ListFilter, UserCheck } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { SpeakingAnswer } from '@/types/speaking'
import type { LinkedQuestionState } from './useLinkedQuestion'

export function LinkedQuestion({
  linked,
  compareWithModel,
  onToggleCompare,
  onChangeQuestion,
  prevQuestion,
  nextQuestion,
  onNavigateQuestion,
  onCopyToManual,
}: {
  linked: LinkedQuestionState
  compareWithModel: boolean
  onToggleCompare: (checked: boolean) => void
  onChangeQuestion: () => void
  prevQuestion: { id: string; index: number } | null
  nextQuestion: { id: string; index: number } | null
  onNavigateQuestion: (target: { id: string; index: number }) => void
  onCopyToManual: (question: string, script: string) => void
}) {
  const [showFullScript, setShowFullScript] = useState(false)
  const [showIdea, setShowIdea] = useState(false)

  if (linked.status === 'loading') {
    return (
      <div className="space-y-3 py-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  if (linked.status === 'missing' || linked.status === 'error' || !linked.result || !linked.answer) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          {linked.error || 'Câu hỏi hoặc lần gợi ý này đã bị xoá trong Speaking ideas.'}
        </p>
        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={onChangeQuestion}>
            <ListFilter className="size-4" /> Change question
          </Button>
        </div>
      </div>
    )
  }

  const { result, answer, script } = linked
  const hasModel = Boolean(script)
  const isCustomized = Boolean(answer.userEdited || answer.originalAnswer)
  const hasHints = Boolean(answer.idea?.trim() || answer.meaning?.trim())

  return (
    <div className="space-y-4">
      {/* Header: topic + Part badge + navigation + Change question */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 sm:p-4 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-xs font-bold tracking-wide text-brand-700 uppercase dark:text-brand-300">
              From Speaking ideas · {result.topic}
            </span>
            <Badge tone="brand">Part {result.part}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {prevQuestion || nextQuestion ? (
              <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  disabled={!prevQuestion}
                  onClick={() => prevQuestion && onNavigateQuestion(prevQuestion)}
                  className="inline-flex items-center gap-0.5 rounded-l-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
                  title="Câu trước trong chủ đề"
                >
                  <ChevronLeft className="size-3.5" /> Prev
                </button>
                <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
                <button
                  type="button"
                  disabled={!nextQuestion}
                  onClick={() => nextQuestion && onNavigateQuestion(nextQuestion)}
                  className="inline-flex items-center gap-0.5 rounded-r-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
                  title="Câu tiếp theo trong chủ đề"
                >
                  Next <ChevronRight className="size-3.5" />
                </button>
              </div>
            ) : null}
            <Button size="sm" variant="outline" onClick={onChangeQuestion}>
              Change question
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onCopyToManual(answer.question, script)}
              title="Sao chép câu hỏi và bài mẫu sang chế độ nhập tay để tự chỉnh sửa"
            >
              <Copy className="size-3.5" /> Copy to manual
            </Button>
          </div>
        </div>

        <p className="mt-2.5 text-base font-bold leading-relaxed whitespace-pre-line text-slate-900 sm:text-lg dark:text-white">
          {answer.question}
        </p>
      </div>

      {/* Idea / Think in English collapsible hint */}
      {hasHints ? (
        <div className="rounded-xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900/40">
          <button
            type="button"
            onClick={() => setShowIdea((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
          >
            <span className="inline-flex items-center gap-1.5">
              <Lightbulb className="size-3.5 text-amber-500" />
              Ý của bạn / Think in English
            </span>
            <ChevronDown className={cn('size-4 text-slate-400 transition-transform', showIdea && 'rotate-180')} />
          </button>
          {showIdea ? (
            <div className="space-y-2.5 border-t border-slate-100 px-3.5 py-3 text-sm dark:border-slate-800">
              {answer.idea?.trim() ? (
                <IdeaPreview answer={answer} />
              ) : null}
              {answer.meaning?.trim() ? (
                <div className="rounded-lg bg-sky-50/70 p-2.5 text-slate-700 dark:bg-sky-950/30 dark:text-slate-200">
                  <p className="mb-1 flex items-center gap-1 text-xs font-bold text-sky-800 dark:text-sky-300">
                    <Languages className="size-3.5" /> Think in English
                  </p>
                  <p className="whitespace-pre-line text-xs leading-relaxed">{answer.meaning}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Script comparison checkbox + read-only model answer */}
      {hasModel ? (
        <div className="space-y-2.5">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={compareWithModel}
              onChange={(e) => onToggleCompare(e.target.checked)}
              className="mt-1 size-4 rounded border-slate-300 accent-brand-600"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
                Compare with the Speaking ideas model answer
                {isCustomized ? (
                  <Badge tone="emerald">
                    <UserCheck className="size-3" /> Bài theo ý của bạn
                  </Badge>
                ) : null}
              </span>
              <span className="block text-sm text-slate-600 dark:text-slate-400">
                {compareWithModel
                  ? 'Bài nói sẽ được đối chiếu từng câu với bài mẫu bên dưới.'
                  : 'Không đối chiếu bài mẫu: bạn tự trả lời theo ý mình.'}
              </span>
            </span>
          </label>

          {compareWithModel ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
              <p
                className={cn(
                  'text-[15px] leading-relaxed whitespace-pre-line text-slate-800 dark:text-slate-200',
                  !showFullScript && 'line-clamp-3',
                )}
              >
                {script}
              </p>
              <button
                type="button"
                onClick={() => setShowFullScript((v) => !v)}
                className="mt-1.5 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
              >
                {showFullScript ? 'Show less' : 'Show all'}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          Câu này chưa có bài mẫu (chế độ Phrases only) — bài nói được chấm không so script.
        </p>
      )}
    </div>
  )
}

function IdeaPreview({ answer }: { answer: SpeakingAnswer }) {
  return (
    <div className="rounded-lg bg-amber-50/70 p-2.5 text-xs leading-relaxed text-slate-700 whitespace-pre-line dark:bg-amber-950/30 dark:text-slate-200">
      <p className="mb-1 font-bold text-amber-800 dark:text-amber-300">Ý của bạn</p>
      {answer.idea}
    </div>
  )
}
