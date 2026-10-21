import { cn } from '@/lib/cn'
import type { DiffPart } from '../lib/compare'

/** Word diff from the learner's text to the target: missing words in green, extra/wrong words struck through. */
export function DiffText({ parts, className }: { parts: DiffPart[]; className?: string }) {
  return (
    <p className={cn('leading-relaxed', className)}>
      {parts.map((part, i) => {
        if (part.added)
          return (
            <ins
              key={i}
              title="Missing"
              className="rounded bg-emerald-50 px-0.5 font-medium text-emerald-700 underline decoration-emerald-400 decoration-2 underline-offset-4 dark:bg-emerald-950/50 dark:text-emerald-300"
            >
              {part.value}
            </ins>
          )
        if (part.removed)
          return (
            <del
              key={i}
              title="Extra or wrong"
              className="rounded bg-rose-50 px-0.5 text-rose-600 line-through decoration-rose-400 decoration-2 dark:bg-rose-950/50 dark:text-rose-300"
            >
              {part.value}
            </del>
          )
        return <span key={i}>{part.value}</span>
      })}
    </p>
  )
}

export function DiffLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500 dark:text-slate-400', className)}>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
        Missing
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-rose-500" aria-hidden />
        Extra / wrong
      </span>
    </div>
  )
}
