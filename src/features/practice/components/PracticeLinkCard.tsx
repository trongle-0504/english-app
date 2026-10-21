import { ArrowRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { prefetchData } from '@/lib/data'

interface PracticeLinkCardProps {
  to: string
  title: string
  icon: LucideIcon
  /** Data key warmed on hover/focus. */
  prefetch?: string
  description?: ReactNode
  footer?: ReactNode
  className?: string
}

/** Card-shaped link used by the practice listings. */
export function PracticeLinkCard({ to, title, icon: Icon, prefetch, description, footer, className }: PracticeLinkCardProps) {
  const warm = prefetch ? () => prefetchData(prefetch) : undefined
  return (
    <Link
      to={to}
      onMouseEnter={warm}
      onFocus={warm}
      className={cn(
        'group flex flex-col rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-sm shadow-slate-900/[0.03] transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md hover:shadow-brand-900/5 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-brand-700',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-950/60 dark:text-brand-300 dark:group-hover:bg-brand-500 dark:group-hover:text-slate-950">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-300">{title}</h3>
          {description ? <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</div> : null}
        </div>
        <ArrowRight className="mt-1 size-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500 dark:text-slate-600" />
      </div>
      {footer ? <div className="mt-4 flex flex-wrap items-center gap-1.5">{footer}</div> : null}
    </Link>
  )
}
