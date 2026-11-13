import { CheckCircle2 } from 'lucide-react'
import type { WritingReviewSummary } from '@/types/writingReview'

/** How many reviews the Mock Test lists read: the whole history, so an old question keeps its "done" status. */
export const MOCK_HISTORY_LIMIT = 5000

/** A question already done: green border and tint. */
export const doneCardClass =
  'border-emerald-300 bg-emerald-50/60 dark:border-emerald-700/70 dark:bg-emerald-950/25'

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('vi-VN')

/** "✓ Đã làm n lần · gần nhất <date> · Band x.x (cao nhất y.y)". `attempts` newest first. */
export function DoneStatus({ attempts }: { attempts: WritingReviewSummary[] }) {
  const latest = attempts[0]
  if (!latest) return null
  const bands = attempts.map((a) => a.overall).filter((b): b is number => typeof b === 'number')
  const best = bands.length ? Math.max(...bands) : undefined
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
      <CheckCircle2 className="size-4 shrink-0" aria-hidden />
      <span>Đã làm {attempts.length} lần</span>
      <span aria-hidden>·</span>
      <span>gần nhất {dateLabel(latest.createdAt)}</span>
      {latest.overall !== undefined ? (
        <>
          <span aria-hidden>·</span>
          <span>
            Band {latest.overall.toFixed(1)}
            {best !== undefined && bands.length > 1 && best !== latest.overall ? ` (cao nhất ${best.toFixed(1)})` : ''}
          </span>
        </>
      ) : best !== undefined ? (
        <>
          <span aria-hidden>·</span>
          <span>cao nhất Band {best.toFixed(1)}</span>
        </>
      ) : null}
    </p>
  )
}
