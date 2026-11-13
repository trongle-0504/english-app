import { Check, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { WritingReviewJob } from '@/types/writingReview'
import { STEPS, TASK1_STEP_IDS } from './api'

export function WritingReviewProgress({ job }: { job: WritingReviewJob }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const steps = job.task === 1 ? STEPS.filter((step) => TASK1_STEP_IDS.includes(step.id)) : STEPS
  const current = steps.findIndex((step) => step.id === job.step)
  const elapsed = Math.max(0, Math.round((now - Date.parse(job.startedAt)) / 1000))

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <Loader2 className="size-4 animate-spin text-brand-600" /> Đang review…{' '}
          <span className="text-sm font-normal text-slate-500 tabular-nums">{elapsed}s</span>
        </h2>
      </div>
      <ol className="mt-4 grid gap-1.5 sm:grid-cols-3">
        {steps.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'active' : 'todo'
          return (
            <li
              key={step.id}
              className={cn('flex items-center gap-2 text-sm', state === 'todo' ? 'text-slate-400' : 'text-slate-700 dark:text-slate-200')}
            >
              {state === 'done' ? (
                <Check className="size-4 text-emerald-600" />
              ) : state === 'active' ? (
                <Loader2 className="size-4 animate-spin text-brand-600" />
              ) : (
                <span className="size-4 rounded-full border border-slate-300 dark:border-slate-600" />
              )}
              <span className={cn(state === 'active' && 'font-semibold')}>{step.label}</span>
            </li>
          )
        })}
      </ol>
      <p className="mt-4 text-xs text-slate-500">Thường mất 1–2 phút. Bạn có thể rời trang — quay lại đây sẽ thấy kết quả.</p>
    </Card>
  )
}
