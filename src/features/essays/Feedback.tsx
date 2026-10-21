import { Check, CircleDashed, X } from 'lucide-react'
import { Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { EssayFeedback, EssayItem } from '@/types/essays'
import { DiffLegend, DiffText } from '../practice/components/DiffText'
import { compareSentence } from '../practice/lib/compare'
import { mentions } from './lib'

const STATUS = {
  correct: { icon: Check, label: 'Dùng đúng', className: 'text-emerald-600 dark:text-emerald-400' },
  incorrect: { icon: X, label: 'Dùng chưa đúng', className: 'text-rose-600 dark:text-rose-400' },
  missing: { icon: CircleDashed, label: 'Chưa dùng', className: 'text-slate-400' },
} as const

/** Target phrases as chips; while writing, a light code check shows which ones already appear. */
export function TargetChips({ targets, text, onRemove }: { targets: EssayItem[]; text: string; onRemove?: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {targets.map((t) => {
        const seen = text.trim() ? mentions(text, t) : false
        return (
          <span
            key={t.id}
            title={t.meaning_vi}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
              seen ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
            )}
          >
            {seen ? <Check className="size-3" /> : null}
            {t.frame ?? t.key}
            {onRemove ? (
              <button type="button" onClick={() => onRemove(t.id)} className="ml-0.5 text-slate-400 hover:text-rose-500" aria-label={`Remove ${t.key}`}>
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}

export function FeedbackView({ feedback, targets, text }: { feedback: EssayFeedback; targets: EssayItem[]; text: string }) {
  const diff = feedback.corrected ? compareSentence(text, feedback.corrected) : null
  const tone = feedback.score >= 8 ? 'text-emerald-600' : feedback.score >= 5 ? 'text-brand-600' : 'text-amber-600'
  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex items-start gap-4">
        <div className={cn('text-4xl font-extrabold tabular-nums', tone)}>
          {feedback.score}
          <span className="text-lg text-slate-400">/10</span>
        </div>
        <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">{feedback.summary_vi}</p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">Cụm mục tiêu</p>
        <ul className="space-y-1.5">
          {feedback.targets.map((t) => {
            const item = targets.find((i) => i.id === t.itemId)
            const meta = STATUS[t.status]
            return (
              <li key={t.itemId} className="flex items-start gap-2 text-sm">
                <meta.icon className={cn('mt-0.5 size-4 shrink-0', meta.className)} />
                <span>
                  <strong className="text-slate-800 dark:text-slate-100">{item?.frame ?? item?.key ?? t.itemId}</strong>{' '}
                  <span className={cn('text-xs font-semibold', meta.className)}>{meta.label}</span>
                  {t.note_vi ? <span className="block text-slate-500 dark:text-slate-400">{t.note_vi}</span> : null}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      {feedback.corrections.length ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">Lỗi cần sửa</p>
          <ul className="space-y-1.5 text-sm">
            {feedback.corrections.map((c, i) => (
              <li key={i}>
                <span className="text-rose-600 line-through dark:text-rose-400">{c.wrong}</span> → <strong className="text-emerald-700 dark:text-emerald-400">{c.right}</strong>
                <span className="block text-slate-500 dark:text-slate-400">{c.why_vi}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {diff && !diff.correct ? (
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
          <p className="mb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">Bản đã sửa</p>
          <DiffText parts={diff.parts} className="text-[15px]" />
          <DiffLegend className="mt-2" />
        </div>
      ) : null}
      <p className="text-right text-[11px] text-slate-400 tabular-nums">
        {feedback.usage.model} · {feedback.usage.total.toLocaleString('en-US')} token
      </p>
    </Card>
  )
}
