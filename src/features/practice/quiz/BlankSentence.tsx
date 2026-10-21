import { Fragment } from 'react'
import { cn } from '@/lib/cn'
import { splitAtBlank } from '../lib/quiz'

export type BlankTone = 'idle' | 'correct' | 'wrong'

const toneClasses: Record<BlankTone, string> = {
  idle: 'border-brand-400 bg-brand-50/70 text-brand-700 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-200',
  correct: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  wrong: 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
}

/** Leftover blanks (sentences with more than one) are shown muted; only the first is answered. */
function WithMutedBlanks({ text }: { text: string }) {
  return text.split(/_{2,}/).map((chunk, i) => (
    <Fragment key={i}>
      {i > 0 ? (
        <span className="mx-0.5 inline-block w-12 border-b-2 border-dashed border-slate-300 dark:border-slate-600">
          <span className="sr-only">blank</span>
        </span>
      ) : null}
      {chunk}
    </Fragment>
  ))
}

/** A quiz sentence with its first blank filled by `fill` (the chosen option or typed text). */
export function BlankSentence({ sentence, fill, tone = 'idle', className }: { sentence: string; fill?: string; tone?: BlankTone; className?: string }) {
  const parts = splitAtBlank(sentence)
  if (!parts) return <p className={className}>{sentence}</p>
  return (
    <p className={className}>
      {parts.before}
      <span
        className={cn(
          'mx-0.5 inline-block min-w-20 rounded-md border-b-2 px-1.5 text-center font-semibold transition-colors',
          fill ? toneClasses[tone] : 'border-slate-300 text-slate-400 dark:border-slate-600',
        )}
      >
        {fill || ' '}
        {fill ? null : <span className="sr-only">blank</span>}
      </span>
      <WithMutedBlanks text={parts.after} />
    </p>
  )
}
