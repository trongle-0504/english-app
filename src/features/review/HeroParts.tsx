// The look of the Review page's cover cards (Overview "Today" and "Bài gần đây"). One strong colour only — the main
// call to action (a gradient card): the numbers are quiet pastel info cards (no shadow, nothing to click), and the other
// actions are white tiles that say they lead somewhere (an arrow in the corner, a border that takes the icon's colour on
// hover). Plus a small drawing of study cards. Pure presentation: the pages give the numbers and the links.
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type Tint = 'sky' | 'violet' | 'emerald' | 'amber' | 'rose' | 'brand'

/** Info card: pastel face, thin border of the same colour, the number in the colour's dark shade. */
const INFO: Record<Tint, { card: string; icon: string; value: string; line: string }> = {
  sky: {
    card: 'border-sky-100 bg-sky-50/70 dark:border-sky-900/60 dark:bg-sky-950/30',
    icon: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
    value: 'text-sky-700 dark:text-sky-300',
    line: 'text-sky-300 dark:text-sky-700',
  },
  violet: {
    card: 'border-violet-100 bg-violet-50/70 dark:border-violet-900/60 dark:bg-violet-950/30',
    icon: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
    value: 'text-violet-700 dark:text-violet-300',
    line: 'text-violet-300 dark:text-violet-700',
  },
  emerald: {
    card: 'border-emerald-100 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30',
    icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    value: 'text-emerald-700 dark:text-emerald-300',
    line: 'text-emerald-300 dark:text-emerald-700',
  },
  amber: {
    card: 'border-amber-100 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30',
    icon: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    value: 'text-amber-700 dark:text-amber-300',
    line: 'text-amber-300 dark:text-amber-700',
  },
  rose: {
    card: 'border-rose-100 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/30',
    icon: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
    value: 'text-rose-700 dark:text-rose-300',
    line: 'text-rose-300 dark:text-rose-700',
  },
  brand: {
    card: 'border-brand-100 bg-brand-50/70 dark:border-brand-900/60 dark:bg-brand-950/30',
    icon: 'bg-brand-100 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
    value: 'text-brand-700 dark:text-brand-300',
    line: 'text-brand-300 dark:text-brand-700',
  },
}

/** An action tile's border on hover: the colour of its icon. */
const HOVER: Record<Tint, string> = {
  sky: 'hover:border-sky-300 dark:hover:border-sky-700',
  violet: 'hover:border-violet-300 dark:hover:border-violet-700',
  emerald: 'hover:border-emerald-300 dark:hover:border-emerald-700',
  amber: 'hover:border-amber-300 dark:hover:border-amber-700',
  rose: 'hover:border-rose-300 dark:hover:border-rose-700',
  brand: 'hover:border-brand-300 dark:hover:border-brand-700',
}

/** A soft hand-drawn wave (the info cards' decoration). */
function Wave({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 40" fill="none" className={className} aria-hidden>
      <path d="M2 28c12 0 14-18 28-18s16 22 30 22 16-26 30-26 14 14 28 14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** A small line of real numbers (e.g. cards due on the next days), drawn like the wave. */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 1)
  const step = 116 / Math.max(1, values.length - 1)
  const points = values.map((v, i) => `${(2 + i * step).toFixed(1)},${(36 - (v / max) * 30).toFixed(1)}`)
  return (
    <svg viewBox="0 0 120 40" fill="none" className={className} aria-hidden>
      <polyline points={points.join(' ')} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points.at(-1)?.split(',')[0]} cy={points.at(-1)?.split(',')[1]} r="3" fill="currentColor" />
    </svg>
  )
}

/**
 * A number on a pastel info card (not clickable: no shadow, no strong colour): tinted icon, the number in the dark
 * shade, label (and its ⓘ), a small note in the corner. `spark`: a line of real numbers drawn in place of the wave.
 */
export function InfoStat({
  tint,
  icon,
  value,
  label,
  chip,
  tip,
  spark,
}: {
  tint: Tint
  icon: ReactNode
  value: ReactNode
  label: ReactNode
  chip?: ReactNode
  tip?: ReactNode
  spark?: number[]
}) {
  const t = INFO[tint]
  return (
    <div className={cn('relative min-w-0 overflow-hidden rounded-2xl border p-3.5 sm:p-4', t.card)}>
      {spark && spark.length > 1 ? (
        <Sparkline values={spark} className={cn('pointer-events-none absolute top-4 right-3 hidden w-20 sm:block', t.line)} />
      ) : (
        <Wave className={cn('pointer-events-none absolute top-4 right-3 hidden w-16 sm:block', t.line)} />
      )}
      <span className={cn('relative flex size-9 items-center justify-center rounded-xl', t.icon)}>{icon}</span>
      <p className={cn('relative mt-4 text-2xl leading-none font-extrabold tabular-nums sm:text-[2rem]', t.value)}>{value}</p>
      <p className="relative mt-1.5 flex items-center gap-1 text-[13px] font-medium text-slate-600 dark:text-slate-300">
        <span className="truncate">{label}</span>
        {tip}
      </p>
      {chip ? <p className="relative mt-1 hidden text-[11px] font-medium text-slate-500 tabular-nums sm:block dark:text-slate-400">{chip}</p> : null}
    </div>
  )
}

/** Classes of the main call to action (a StartSessionButton / Button): the one strong colour of the cover. */
export const primaryActionClass = cn(
  'group h-auto w-full justify-start gap-3.5 rounded-2xl bg-gradient-to-r from-brand-500 via-sky-500 to-blue-500 px-4 py-3.5 text-left whitespace-normal text-white',
  'shadow-lg shadow-sky-500/30 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-sky-500/35 active:translate-y-0',
  'dark:from-brand-500 dark:via-sky-600 dark:to-blue-600 dark:text-white',
)

/** What goes inside the main call to action: icon disc, title and a line under it, an arrow. */
export function PrimaryActionBody({ icon, title, hint }: { icon: ReactNode; title: ReactNode; hint?: ReactNode }) {
  return (
    <>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base leading-tight font-bold">{title}</span>
        {hint ? <span className="mt-0.5 block text-xs font-medium text-white/85">{hint}</span> : null}
      </span>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/20 transition-transform group-hover:translate-x-0.5">
        <ArrowRight className="size-4" />
      </span>
    </>
  )
}

/**
 * Classes of a secondary action (a StartSessionButton / Button / Link): a white tile with a clear border that lifts and
 * takes its icon's colour on hover.
 */
export function actionTileClass(tint: Tint): string {
  return cn(
    'group relative h-auto w-full flex-col items-start justify-start gap-2 rounded-2xl border border-slate-200/90 bg-white p-3 pr-8 text-left whitespace-normal shadow-sm',
    'transition-all hover:-translate-y-[2px] hover:bg-white hover:shadow-md',
    'dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800',
    HOVER[tint],
  )
}

/** What goes inside an action tile: tinted icon, title, a short hint, and an arrow in the corner (it leads somewhere). */
export function ActionTileBody({ tint, icon, title, hint }: { tint: Tint; icon: ReactNode; title: ReactNode; hint?: ReactNode }) {
  return (
    <>
      <ArrowUpRight
        className="absolute top-3 right-3 size-4 text-slate-400 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-slate-700 dark:group-hover:text-slate-200"
        aria-hidden
      />
      <span className={cn('flex size-8 items-center justify-center rounded-lg transition-transform group-hover:scale-105', INFO[tint].icon)}>
        {icon}
      </span>
      <span className="block min-w-0">
        <span className="block text-[13px] leading-tight font-bold text-slate-800 dark:text-slate-100">{title}</span>
        {hint ? <span className="mt-0.5 block text-[11px] leading-snug font-medium text-slate-500 dark:text-slate-400">{hint}</span> : null}
      </span>
    </>
  )
}

/** The cover's backdrop: two soft colour blobs behind the content. */
export function HeroBackdrop({ from = 'bg-brand-200/50', to = 'bg-violet-200/40' }: { from?: string; to?: string }) {
  return (
    <>
      <span className={cn('pointer-events-none absolute -top-24 -right-16 size-72 rounded-full blur-3xl dark:opacity-30', from)} aria-hidden />
      <span className={cn('pointer-events-none absolute -bottom-28 left-1/3 size-72 rounded-full blur-3xl dark:opacity-20', to)} aria-hidden />
    </>
  )
}

/** A small drawing: three study cards fanned out, the front one ticked, a few sparkles. */
export function StudyCardsArt({ className, accent = '#0d9fd2' }: { className?: string; accent?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden>
      <defs>
        <linearGradient id="art-front" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#eef6ff" />
        </linearGradient>
      </defs>
      <ellipse cx="82" cy="110" rx="52" ry="6" fill="#0f172a" opacity="0.07" />
      <g transform="rotate(-14 70 64)">
        <rect x="34" y="22" width="64" height="80" rx="12" fill="#c4b5fd" />
      </g>
      <g transform="rotate(8 96 62)">
        <rect x="62" y="20" width="64" height="80" rx="12" fill="#6ee7b7" />
      </g>
      <rect x="46" y="18" width="66" height="84" rx="13" fill="url(#art-front)" stroke="#e2e8f0" strokeWidth="1.5" />
      <rect x="58" y="34" width="34" height="6" rx="3" fill={accent} opacity="0.85" />
      <rect x="58" y="47" width="42" height="4" rx="2" fill="#cbd5e1" />
      <rect x="58" y="56" width="30" height="4" rx="2" fill="#cbd5e1" />
      <circle cx="98" cy="86" r="11" fill="#10b981" />
      <path d="M93 86l3.5 3.5L103 83" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M134 18l2.2 5.8L142 26l-5.8 2.2L134 34l-2.2-5.8L126 26l5.8-2.2z" fill="#fbbf24" />
      <path d="M26 30l1.4 3.6L31 35l-3.6 1.4L26 40l-1.4-3.6L21 35l3.6-1.4z" fill={accent} opacity="0.7" />
      <circle cx="140" cy="62" r="3" fill="#a78bfa" />
      <circle cx="20" cy="78" r="2.5" fill="#34d399" />
    </svg>
  )
}

/** A pill in a row of choices (sources, number of days). */
export function PillChoice({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      className={cn(
        'relative inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold hit-area transition-all',
        on
          ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
          : 'bg-white/70 text-slate-600 ring-1 ring-slate-200 hover:bg-white hover:text-slate-900 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800',
      )}
    >
      {children}
    </button>
  )
}
