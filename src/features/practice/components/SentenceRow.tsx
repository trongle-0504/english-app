import { Check, Minus, Plus, X, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge, type Tone } from '@/components/ui'
import { cn } from '@/lib/cn'
import { SpeakButton } from '@/components/SpeakButton'

export type Verdict = 'correct' | 'wrong' | 'missing' | 'extra' | 'unchecked'

/** `badge` verdicts are also spelled out next to the number. */
const VERDICTS: Record<Verdict, { icon: LucideIcon; label: string; tone: Tone; className: string; badge?: boolean }> = {
  correct: { icon: Check, label: 'Correct', tone: 'emerald', className: 'bg-emerald-500 text-white' },
  wrong: { icon: X, label: 'Needs work', tone: 'rose', className: 'bg-rose-500 text-white' },
  missing: { icon: Minus, label: 'Missing sentence', tone: 'amber', className: 'bg-amber-400 text-amber-950', badge: true },
  extra: { icon: Plus, label: 'Extra sentence', tone: 'slate', className: 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-100', badge: true },
  unchecked: { icon: Minus, label: 'Not checked', tone: 'slate', className: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200', badge: true },
}

interface SentenceRowProps {
  verdict: Verdict
  number?: number
  /** Model sentence to read aloud. */
  speakText?: string
  children: ReactNode
}

/** One graded sentence in a review list: verdict icon, number, content and a listen button. */
export function SentenceRow({ verdict, number, speakText, children }: SentenceRowProps) {
  const { icon: Icon, label, tone, className, badge } = VERDICTS[verdict]
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full', className)} title={label}>
        <Icon className="size-3.5" strokeWidth={3} aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
      <div className="min-w-0 flex-1">
        {number != null || badge ? (
          <div className="mb-1 flex items-center gap-2">
            {number != null ? <span className="text-xs font-semibold text-slate-400 tabular-nums">#{number}</span> : null}
            {badge ? <Badge tone={tone}>{label}</Badge> : null}
          </div>
        ) : null}
        <div className="text-[15px] text-slate-700 dark:text-slate-200">{children}</div>
      </div>
      {speakText ? <SpeakButton text={speakText} label="Listen to the model sentence" /> : null}
    </li>
  )
}
