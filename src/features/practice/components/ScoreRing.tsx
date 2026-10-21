import { cn } from '@/lib/cn'

/** Circular percentage gauge for result screens. */
export function ScoreRing({ value }: { value: number }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const color = value >= 80 ? 'text-emerald-500' : value >= 50 ? 'text-brand-500' : 'text-amber-500'
  return (
    <div className="relative size-36 shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="10" className="stroke-slate-100 dark:stroke-slate-800" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
          className={cn('transition-[stroke-dashoffset] duration-1000 ease-out', color)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-3xl font-extrabold text-slate-900 tabular-nums dark:text-white">
        {value}%
      </span>
    </div>
  )
}
