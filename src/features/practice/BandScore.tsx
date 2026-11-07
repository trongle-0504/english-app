import { cn } from '@/lib/cn'

export const bandTone = (band: number) =>
  band >= 7
    ? 'text-emerald-600 dark:text-emerald-400'
    : band >= 6
      ? 'text-brand-600 dark:text-brand-400'
      : band >= 5
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400'

export const bandBadgeTone = (band: number) =>
  band >= 7
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
    : band >= 6
      ? 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-950/40 dark:text-brand-300 dark:border-brand-800'
      : band >= 5
        ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
        : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'

export function BandRing({ band, size = 'md' }: { band: number; size?: 'sm' | 'md' }) {
  const isSm = size === 'sm'
  const radius = isSm ? 38 : 52
  const strokeWidth = isSm ? 8 : 10
  const circumference = 2 * Math.PI * radius
  return (
    <div className={cn('relative shrink-0', isSm ? 'size-24' : 'size-32')}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-slate-100 dark:stroke-slate-800" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - band / 9)}
          className={cn('transition-[stroke-dashoffset] duration-1000 ease-out', bandTone(band))}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('font-bold tracking-wide text-slate-500 uppercase', isSm ? 'text-[9px]' : 'text-[11px]')}>Band</span>
        <span className={cn('leading-none font-extrabold text-slate-900 tabular-nums dark:text-white', isSm ? 'text-2xl' : 'text-4xl')}>
          {band.toFixed(1)}
        </span>
      </span>
    </div>
  )
}
