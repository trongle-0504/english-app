import { ListChecks, Play, Shuffle, TextCursorInput, Trophy, type LucideIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Button, Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { plural } from '@/lib/text'
import { MODE_LABELS, type QuizMode } from '../lib/quiz'
import { percent } from '../lib/score'
import type { BestScore } from './bestScores'

const MODES: { mode: QuizMode; icon: LucideIcon; description: string }[] = [
  { mode: 'multiple_choice', icon: ListChecks, description: 'Pick the right word from four options.' },
  { mode: 'short_answer', icon: TextCursorInput, description: 'Type the missing collocation, with a Vietnamese hint.' },
]

interface QuizSetupProps {
  counts: Record<QuizMode, number>
  best: (mode: QuizMode) => BestScore | undefined
  shuffled: boolean
  onShuffledChange: (value: boolean) => void
  onStart: (mode: QuizMode) => void
  initialMode?: QuizMode
}

export function QuizSetup({ counts, best, shuffled, onShuffledChange, onStart, initialMode }: QuizSetupProps) {
  const available = MODES.filter((m) => counts[m.mode] > 0)
  const [mode, setMode] = useState<QuizMode | undefined>(() =>
    initialMode && counts[initialMode] > 0 ? initialMode : available[0]?.mode,
  )
  const shuffleId = useId()

  return (
    <Card className="animate-slide-up p-4 sm:p-8">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">Choose a mode</h2>
      <div role="radiogroup" aria-label="Quiz mode" className="mt-4 grid gap-3 sm:grid-cols-2">
        {MODES.map(({ mode: value, icon: Icon, description }) => {
          const count = counts[value]
          const selected = mode === value
          const score = best(value)
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={count === 0}
              onClick={() => setMode(value)}
              className={cn(
                'flex flex-col items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'border-brand-500 bg-brand-50/60 shadow-sm shadow-brand-600/10 dark:bg-brand-950/30'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span
                  className={cn(
                    'flex size-10 items-center justify-center rounded-xl',
                    selected ? 'bg-brand-600 text-white dark:bg-brand-500 dark:text-slate-950' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="text-sm font-semibold text-slate-500 tabular-nums dark:text-slate-400">{plural(count, 'question')}</span>
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white">{MODE_LABELS[value]}</p>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
              </div>
              {score ? (
                <p className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  <Trophy className="size-3.5" aria-hidden />
                  Best {score.correct}/{score.total} ({percent(score.correct, score.total)}%)
                </p>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-6 dark:border-slate-800">
        <label htmlFor={shuffleId} className="flex cursor-pointer items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-200">
          <button
            id={shuffleId}
            type="button"
            role="switch"
            aria-checked={shuffled}
            onClick={() => onShuffledChange(!shuffled)}
            className={cn(
              'relative h-6 w-11 shrink-0 rounded-full transition-colors',
              shuffled ? 'bg-brand-600 dark:bg-brand-500' : 'bg-slate-300 dark:bg-slate-700',
            )}
          >
            <span className={cn('absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform', shuffled && 'translate-x-5')} />
          </button>
          <Shuffle className="size-4 text-slate-400" aria-hidden />
          Shuffle questions
        </label>
        <Button size="lg" disabled={!mode} onClick={() => mode && onStart(mode)}>
          <Play className="size-4" />
          Start quiz
        </Button>
      </div>
    </Card>
  )
}
