import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { prefetchData } from '@/lib/data'

const accents = [
  'from-sky-400 to-brand-600',
  'from-violet-400 to-indigo-600',
  'from-emerald-400 to-teal-600',
  'from-amber-400 to-orange-500',
  'from-rose-400 to-pink-600',
  'from-cyan-400 to-sky-600',
]

interface LessonCardProps {
  to: string
  /** /data key to prefetch when the card is hovered. */
  dataKey: string
  eyebrow: string
  title: string
  description?: string
  meta: ReactNode
  chips?: string[]
  accentIndex: number
  cta: string
}

/** Card for a lesson in a library grid; the whole card is clickable. */
export function LessonCard({ to, dataKey, eyebrow, title, description, meta, chips, accentIndex, cta }: LessonCardProps) {
  const warm = () => prefetchData(dataKey)
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-sm shadow-slate-900/[0.03] transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700">
      <div className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r opacity-80', accents[accentIndex % accents.length])} />
      <p className="text-[11px] font-bold tracking-[0.14em] text-slate-400 uppercase">{eyebrow}</p>
      <h3 className="mt-1 text-lg leading-snug font-bold text-slate-900 dark:text-white">
        <Link to={to} onMouseEnter={warm} onFocus={warm} className="outline-none after:absolute after:inset-0 after:content-['']">
          {title}
        </Link>
      </h3>
      {description ? <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{description}</p> : null}
      {chips?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span key={chip} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {chip}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <span className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{meta}</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-600 transition-transform group-hover:translate-x-0.5 dark:text-brand-400">
          {cta}
          <ArrowRight className="size-4" />
        </span>
      </div>
    </article>
  )
}
