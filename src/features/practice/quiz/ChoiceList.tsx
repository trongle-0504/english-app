import { Check, X } from 'lucide-react'
import { Kbd } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { QuizQuestion } from '@/types/content'

interface ChoiceListProps {
  question: QuizQuestion
  /** Chosen option id once the question is locked. */
  chosen?: string
  onChoose: (optionId: string) => void
}

export function ChoiceList({ question, chosen, onChoose }: ChoiceListProps) {
  const locked = chosen != null
  return (
    <div role="group" aria-label="Answer options" className="grid gap-2.5 sm:grid-cols-2">
      {question.options.map((option, index) => {
        const isCorrect = option.id === question.correct_answer
        const isChosen = option.id === chosen
        const state = !locked ? 'open' : isCorrect ? 'correct' : isChosen ? 'wrong' : 'dimmed'
        return (
          <button
            key={option.id}
            type="button"
            aria-disabled={locked}
            aria-pressed={isChosen}
            onClick={() => !locked && onChoose(option.id)}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-[15px] font-medium transition-all',
              state === 'open' &&
                'border-slate-200 bg-white text-slate-800 hover:-translate-y-px hover:border-brand-400 hover:bg-brand-50/50 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-brand-500 dark:hover:bg-brand-950/30',
              state === 'correct' && 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
              state === 'wrong' && 'border-rose-500 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
              state === 'dimmed' && 'cursor-default border-slate-200 bg-white text-slate-400 opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500',
              locked && 'cursor-default',
            )}
          >
            <Kbd className="size-6 shrink-0 text-xs uppercase">{option.id || index + 1}</Kbd>
            <span className="min-w-0 flex-1">{option.text}</span>
            {state === 'correct' ? <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Correct answer" /> : null}
            {state === 'wrong' ? <X className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-label="Your answer" /> : null}
          </button>
        )
      })}
    </div>
  )
}
