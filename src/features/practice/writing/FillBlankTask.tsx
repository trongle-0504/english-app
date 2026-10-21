import { CheckCheck, RotateCcw } from 'lucide-react'
import { createContext, use, useMemo, useState, type ComponentProps } from 'react'
import type { Components, ExtraProps } from 'react-markdown'
import { Button, Card, Progress } from '@/components/ui'
import { Markdown } from '@/components/Markdown'
import { cn } from '@/lib/cn'
import { shuffle } from '@/lib/text'
import type { FillBlankTask as FillBlankTaskData } from '@/types/content'
import { normalizeAnswer } from '../lib/compare'

const TOKEN = /^blank:(\d+)$/

/** Rewrites `[n]` markers as inline-code tokens, which survive markdown parsing anywhere inline. */
function withBlankTokens(passage: string, answers: Record<string, string>): string {
  return passage.replace(/\[(\d+)\]/g, (marker, n: string) => (Object.hasOwn(answers, n) ? `\`blank:${n}\`` : marker))
}

interface BlankState {
  options: string[]
  values: Record<string, string>
  answers: Record<string, string>
  checked: boolean
  onChange: (key: string, value: string) => void
}

const BlankContext = createContext<BlankState | null>(null)

const isCorrect = (value: string | undefined, answer: string) => value != null && normalizeAnswer(value) === normalizeAnswer(answer)

function BlankSelect({ id }: { id: string }) {
  const state = use(BlankContext)
  if (!state) throw new Error('BlankSelect must be rendered inside BlankContext')
  const { options, values, answers, checked, onChange } = state
  const value = values[id] ?? ''
  const correct = isCorrect(value, answers[id])

  return (
    <span className="inline-flex flex-wrap items-baseline gap-1">
      <select
        aria-label={`Blank ${id}`}
        value={value}
        disabled={checked}
        onChange={(event) => onChange(id, event.target.value)}
        className={cn(
          'my-0.5 max-w-full cursor-pointer rounded-lg border px-2 py-0.5 text-[0.95em] font-semibold transition-colors focus:ring-4 focus:outline-none disabled:cursor-default',
          !checked &&
            (value
              ? 'border-brand-400 bg-brand-50 text-brand-800 focus:ring-brand-500/15 dark:border-brand-600 dark:bg-brand-950/50 dark:text-brand-200'
              : 'border-dashed border-slate-300 bg-white text-slate-400 focus:ring-brand-500/15 dark:border-slate-600 dark:bg-slate-900'),
          checked && correct && 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
          checked && !correct && 'border-rose-500 bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
        )}
      >
        <option value="">— {id} —</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {checked && !correct ? (
        <span className="text-[0.9em] font-semibold text-emerald-700 dark:text-emerald-400">({answers[id]})</span>
      ) : null}
    </span>
  )
}

function CodeOrBlank({ node: _node, children, ...props }: ComponentProps<'code'> & ExtraProps) {
  const match = typeof children === 'string' ? TOKEN.exec(children) : null
  return match ? <BlankSelect id={match[1]} /> : <code {...props}>{children}</code>
}

const components: Components = { code: CodeOrBlank }

export function FillBlankTask({ task }: { task: FillBlankTaskData }) {
  const { passage, options, correctAnswers } = task.content
  const keys = Object.keys(correctAnswers)
  const markdown = useMemo(() => withBlankTokens(passage, correctAnswers), [passage, correctAnswers])
  // The source lists options in answer order; shuffle once per visit.
  const [shuffled] = useState(() => shuffle(options))
  const [values, setValues] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState(false)

  const filled = keys.filter((key) => values[key]).length
  const score = keys.filter((key) => isCorrect(values[key], correctAnswers[key])).length

  const state: BlankState = {
    options: shuffled,
    values,
    answers: correctAnswers,
    checked,
    onChange: (key, value) => setValues((prev) => ({ ...prev, [key]: value })),
  }

  return (
    <Card className="overflow-hidden">
      <div className="p-4 sm:p-8">
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Choose the best option for each numbered blank.</p>
        <BlankContext value={state}>
          <Markdown className="text-slate-700 dark:text-slate-200 [&_li]:leading-9 [&_p]:text-base [&_p]:leading-9" components={components}>
            {markdown}
          </Markdown>
        </BlankContext>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-8 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="min-w-48 flex-1" aria-live="polite">
          {checked ? (
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {score === keys.length ? 'All correct — well done!' : `${score} of ${keys.length} correct`}
            </p>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {filled} of {keys.length} blanks filled
            </p>
          )}
          <Progress value={((checked ? score : filled) / keys.length) * 100} className="mt-2 max-w-xs" />
        </div>
        {checked ? (
          <Button
            variant="outline"
            onClick={() => {
              setValues({})
              setChecked(false)
            }}
          >
            <RotateCcw className="size-4" />
            Try again
          </Button>
        ) : (
          <Button onClick={() => setChecked(true)} disabled={filled === 0}>
            <CheckCheck className="size-4" />
            Check answers
          </Button>
        )}
      </div>
    </Card>
  )
}
