import { CornerDownLeft } from 'lucide-react'
import { useId, type Ref } from 'react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { Outcome } from '../lib/quiz'

interface ShortAnswerFieldProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /** Set once the answer is graded; the field becomes read-only. */
  outcome?: Exclude<Outcome, 'skipped'>
  inputRef?: Ref<HTMLInputElement>
}

export function ShortAnswerField({ value, onChange, onSubmit, outcome, inputRef }: ShortAnswerFieldProps) {
  const id = useId()
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault()
        if (!outcome && value.trim()) onSubmit()
      }}
    >
      <label htmlFor={id} className="sr-only">
        Your answer
      </label>
      <input
        id={id}
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={outcome != null}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="Type the missing words…"
        className={cn(
          'h-12 min-w-0 flex-1 rounded-xl border bg-white px-4 text-base text-slate-900 transition-colors placeholder:text-slate-400 focus:ring-4 focus:outline-none dark:bg-slate-900 dark:text-white',
          !outcome && 'border-slate-200 focus:border-brand-400 focus:ring-brand-500/10 dark:border-slate-700',
          outcome === 'correct' && 'border-emerald-500 bg-emerald-50/60 focus:ring-emerald-500/10 dark:bg-emerald-950/30',
          outcome === 'wrong' && 'border-rose-500 bg-rose-50/60 focus:ring-rose-500/10 dark:bg-rose-950/30',
        )}
      />
      {outcome ? null : (
        <Button type="submit" size="lg" className="h-12 rounded-xl" disabled={!value.trim()}>
          Check
          <CornerDownLeft className="size-4 opacity-70" />
        </Button>
      )}
    </form>
  )
}
