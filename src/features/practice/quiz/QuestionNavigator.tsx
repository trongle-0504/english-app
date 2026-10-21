import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/lib/cn'
import type { Outcome, QuizAnswer } from '../lib/quiz'

const outcomeClasses: Record<Outcome, string> = {
  correct: 'border-emerald-500 bg-emerald-500 text-white dark:border-emerald-500 dark:bg-emerald-600',
  wrong: 'border-rose-500 bg-rose-500 text-white dark:border-rose-500 dark:bg-rose-600',
  skipped: 'border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-500 dark:bg-amber-950/60 dark:text-amber-200',
}

const LEGEND: { outcome: Outcome; label: string; dot: string }[] = [
  { outcome: 'correct', label: 'Correct', dot: 'bg-emerald-500' },
  { outcome: 'wrong', label: 'Wrong', dot: 'bg-rose-500' },
  { outcome: 'skipped', label: 'Skipped', dot: 'bg-amber-400' },
]

interface QuestionNavigatorProps {
  answers: readonly (QuizAnswer | undefined)[]
  current: number
  onSelect: (index: number) => void
}

/** Collapsible grid of numbered question circles, coloured by outcome. */
export function QuestionNavigator({ answers, current, onSelect }: QuestionNavigatorProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        All questions
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div id={panelId} className="animate-fade-in mt-3 space-y-3">
          <ol className="flex flex-wrap gap-1.5">
            {answers.map((answer, index) => (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  aria-current={index === current ? 'step' : undefined}
                  aria-label={`Question ${index + 1}${answer ? `, ${answer.outcome}` : ''}`}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-all hover:scale-110',
                    answer
                      ? outcomeClasses[answer.outcome]
                      : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                    index === current && 'ring-2 ring-brand-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900',
                  )}
                >
                  {index + 1}
                </button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-3 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {LEGEND.map((item) => (
              <span key={item.outcome} className="inline-flex items-center gap-1.5">
                <span className={cn('size-2 rounded-full', item.dot)} aria-hidden />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
