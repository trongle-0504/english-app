import { useCallback, useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import type { ReviewStats } from '@/types/review'
import { addDays } from './schedule'

const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' })

/* Sequential single-hue ramp (brand), light → dark in light mode and dark → light in dark mode. */
const HEAT_LEVELS = [
  'fill-slate-100 dark:fill-slate-800/80',
  'fill-brand-200 dark:fill-brand-900',
  'fill-brand-400 dark:fill-brand-700',
  'fill-brand-600 dark:fill-brand-500',
  'fill-brand-800 dark:fill-brand-300',
]
const HEAT_SWATCHES = [
  'bg-slate-100 dark:bg-slate-800/80',
  'bg-brand-200 dark:bg-brand-900',
  'bg-brand-400 dark:bg-brand-700',
  'bg-brand-600 dark:bg-brand-500',
  'bg-brand-800 dark:bg-brand-300',
]

/** How many weeks the heatmap shows: the whole year once you have studied that long, else from your first study week. */
function weeksToShow(heatmap: ReviewStats['heatmap'], today: string): number {
  const first = Object.keys(heatmap)
    .filter((d) => heatmap[d] > 0)
    .sort()[0]
  if (!first) return 13
  const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86_400_000)
  // A little room before the first week, at least three months, at most a year.
  return Math.min(53, Math.max(13, Math.ceil(days / 7) + 3))
}

/** Study days, as many weeks as you have history for (three months at least, a year at most); hover a day for its count. */
export function StudyHeatmap({ heatmap, today }: { heatmap: ReviewStats['heatmap']; today: string }) {
  const [hover, setHover] = useState<{ day: string; count: number; x: number; y: number } | null>(null)
  // The grid fills the width it has: the weeks you have history for, as big as they fit (22 px at most); room left over
  // shows earlier weeks (a year at most). Narrow screens keep small days and scroll.
  const [box, setBox] = useState(0)
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setBox(Math.floor(entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const needed = weeksToShow(heatmap, today)
  const room = Math.max(0, box - 28)
  const GAP = 3
  const CELL = room ? Math.max(11, Math.min(22, Math.floor(room / needed) - GAP)) : 18
  const STEP = CELL + GAP
  const shown = room ? Math.min(53, Math.max(needed, Math.floor(room / STEP))) : needed

  const { weeks, max, months, summary } = useMemo(() => {
    // Start on the Monday `shown - 1` weeks before this week's Monday.
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7
    const start = addDays(today, -weekday - (shown - 1) * 7)
    const weeks: { day: string; count: number; future: boolean }[][] = []
    const months: { label: string; week: number }[] = []
    for (let w = 0; w < shown; w++) {
      const week = []
      for (let d = 0; d < 7; d++) {
        const day = addDays(start, w * 7 + d)
        week.push({ day, count: heatmap[day] ?? 0, future: day > today })
        if (d === 0 && (day.slice(8) <= '07' || (w === 0 && day.slice(8) <= '21'))) months.push({ label: dayLabel(day, { month: 'short' }), week: w })
      }
      weeks.push(week)
    }
    const studied = Object.entries(heatmap).filter(([, n]) => n > 0)
    const best = studied.sort((a, b) => b[1] - a[1])[0]
    const total = studied.reduce((s, [, n]) => s + n, 0)
    return {
      weeks,
      max: Math.max(0, ...Object.values(heatmap)),
      months,
      summary: { days: studied.length, average: studied.length ? Math.round(total / studied.length) : 0, best },
    }
  }, [heatmap, today, shown])

  const level = (count: number) => (count === 0 ? 0 : max <= 4 ? Math.min(4, count) : Math.min(4, Math.ceil((count / max) * 4)))
  const width = shown * STEP + 28
  const height = 7 * STEP + 18
  const period = shown >= 53 ? 'last 12 months' : `last ${Math.round(shown / 4.35)} months`

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
      <div ref={measure} className="relative min-w-0 flex-1">
        <div className="scrollbar-thin overflow-x-auto">
          <svg width={width} height={height} role="img" aria-label={`Reviews per day, ${period}`} className="block">
            {months.map((m) => (
              <text key={`${m.label}-${m.week}`} x={28 + m.week * STEP} y={10} className="fill-slate-400 text-[10px]">
                {m.label}
              </text>
            ))}
            {['Mon', 'Wed', 'Fri'].map((d, i) => (
              <text key={d} x={0} y={18 + i * 2 * STEP + CELL - 3} className="fill-slate-400 text-[9px]">
                {d}
              </text>
            ))}
            {weeks.map((week, w) =>
              week.map((cell, d) =>
                cell.future ? null : (
                  <rect
                    key={cell.day}
                    x={28 + w * STEP}
                    y={18 + d * STEP}
                    width={CELL}
                    height={CELL}
                    rx={CELL > 12 ? 4 : 2.5}
                    className={cn(
                      HEAT_LEVELS[level(cell.count)],
                      cell.day === today && 'stroke-slate-900 dark:stroke-white',
                      'transition-opacity hover:opacity-80',
                    )}
                    strokeWidth={cell.day === today ? 1.4 : 0}
                    onMouseEnter={() => setHover({ ...cell, x: 28 + w * STEP, y: 18 + d * STEP })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>{`${dayLabel(cell.day, { weekday: 'short', day: 'numeric', month: 'short' })}: ${cell.count} reviews`}</title>
                  </rect>
                ),
              ),
            )}
          </svg>
        </div>
        {hover ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg dark:bg-white dark:text-slate-900"
            style={{ left: hover.x + CELL / 2, top: hover.y - 6 }}
          >
            <span className="font-semibold">{hover.count} reviews</span> · {dayLabel(hover.day, { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-400">
          <span>{period}</span>
          <span className="flex items-center gap-1">
            Less
            {HEAT_SWATCHES.map((s) => (
              <span key={s} className={cn('size-2.5 rounded-[3px]', s)} />
            ))}
            More
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-3 sm:w-40 sm:shrink-0 sm:grid-cols-1 sm:gap-4">
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Days studied</dt>
          <dd className="text-xl font-extrabold text-slate-900 tabular-nums dark:text-white">{summary.days}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Avg per study day</dt>
          <dd className="text-xl font-extrabold text-slate-900 tabular-nums dark:text-white">
            {summary.average} <span className="text-xs font-medium text-slate-500">reviews</span>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Busiest day</dt>
          <dd className="text-xl font-extrabold text-slate-900 tabular-nums dark:text-white">
            {summary.best ? summary.best[1] : 0}{' '}
            <span className="text-xs font-medium text-slate-500">
              {summary.best ? dayLabel(summary.best[0], { day: 'numeric', month: 'short' }) : ''}
            </span>
          </dd>
        </div>
      </dl>
    </div>
  )
}

/**
 * Cards due: today (overdue included) as a number of its own — it would flatten every other bar — and the next 13 days
 * as bars on their own scale. A day can be clicked to see its words.
 */
export function ForecastChart({ forecast, onSelectDay }: { forecast: ReviewStats['forecast']; onSelectDay?: (day: string) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const [today, ...rest] = forecast
  const max = Math.max(1, ...rest.map((f) => f.count))
  const empty = rest.every((f) => f.count === 0)
  const busiest = rest.reduce((a, b) => (b.count > a.count ? b : a), rest[0])
  const total = rest.reduce((s, f) => s + f.count, 0)

  return (
    <div className="relative">
      <div className="mb-4 flex items-end justify-between gap-3">
        <button
          type="button"
          onClick={onSelectDay && today ? () => onSelectDay(today.day) : undefined}
          className="text-left"
          title={onSelectDay ? 'See the words due today' : undefined}
        >
          <span className="block text-3xl leading-none font-extrabold text-slate-900 tabular-nums dark:text-white">{today?.count ?? 0}</span>
          <span className="mt-1 block text-xs font-medium text-slate-500 dark:text-slate-400">due today · overdue included</span>
        </button>
        <span className="text-right text-xs text-slate-500 dark:text-slate-400">
          <strong className="text-slate-800 tabular-nums dark:text-slate-100">{total}</strong> in the next 13 days
          {busiest && busiest.count ? <span className="block">busiest: {dayLabel(busiest.day, { weekday: 'short', day: 'numeric' })}</span> : null}
        </span>
      </div>
      {empty ? <p className="absolute inset-x-0 bottom-10 text-center text-sm text-slate-400">No cards due in the next two weeks.</p> : null}
      <div
        className="flex h-24 items-end gap-[3px] border-b border-slate-200 dark:border-slate-700"
        role="img"
        aria-label="Cards due over the next 13 days"
      >
        {rest.map((f, i) => (
          <div
            key={f.day}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={onSelectDay ? () => onSelectDay(f.day) : undefined}
            style={onSelectDay ? { cursor: 'pointer' } : undefined}
            title={onSelectDay ? 'See the words for this day' : undefined}
          >
            {f.count ? <span className="mb-0.5 text-[10px] font-semibold text-slate-600 tabular-nums dark:text-slate-300">{f.count}</span> : null}
            <div
              className={cn(
                'w-full max-w-5 rounded-t-[4px] transition-colors',
                hover === i ? 'bg-brand-700 dark:bg-brand-300' : 'bg-brand-400 dark:bg-brand-500',
              )}
              style={{ height: f.count ? `${Math.max(6, (f.count / max) * 78)}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px]">
        {rest.map((f, i) => (
          <span key={f.day} className="min-w-0 flex-1 text-center text-[10px] leading-tight text-slate-400">
            {Number(f.day.slice(8))}
            {/* Month under the first day shown and under each 1st. */}
            {i === 0 || f.day.endsWith('-01') ? <span className="block">{dayLabel(f.day, { month: 'short' })}</span> : null}
          </span>
        ))}
      </div>
      {hover !== null ? (
        <div className="pointer-events-none absolute top-0 right-0 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white dark:bg-white dark:text-slate-900">
          <span className="font-semibold">{rest[hover].count} due</span> ·{' '}
          {dayLabel(rest[hover].day, { weekday: 'short', day: 'numeric', month: 'short' })}
        </div>
      ) : null}
    </div>
  )
}

/* Categorical slots 1–4 of the validated reference palette (light / dark steps). */
const STATE_SLOTS = [
  { key: 'new', label: 'New', color: 'bg-[#2a78d6] dark:bg-[#3987e5]' },
  { key: 'learning', label: 'Learning', color: 'bg-[#eb6834] dark:bg-[#d95926]' },
  { key: 'review', label: 'Review', color: 'bg-[#1baf7a] dark:bg-[#199e70]' },
  { key: 'relearning', label: 'Relearning', color: 'bg-[#eda100] dark:bg-[#c98500]' },
] as const

const percent = (n: number, total: number) => (total ? (n / total) * 100 : 0)
const percentLabel = (n: number, total: number) => {
  const p = percent(n, total)
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`
}

/**
 * Cards by FSRS state: one stacked bar (a tiny share keeps a visible sliver) with a legend that carries the numbers and
 * shares, and how long the new cards last at today's pace.
 */
export function StateBar({ byState, newPerDay }: { byState: ReviewStats['byState']; newPerDay?: number }) {
  const total = Object.values(byState).reduce((a, b) => a + b, 0)
  if (!total) return <p className="text-sm text-slate-400">No cards in review yet.</p>
  const days = newPerDay ? Math.ceil(byState.new / newPerDay) : 0
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Cards by state">
        {STATE_SLOTS.map((s) =>
          byState[s.key] ? (
            <div
              key={s.key}
              className={cn(s.color, 'h-full min-w-1.5 first:rounded-l-full last:rounded-r-full')}
              style={{ width: `${percent(byState[s.key], total)}%` }}
              title={`${s.label}: ${byState[s.key]}`}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1.5 text-sm sm:grid-cols-4">
        {STATE_SLOTS.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <span className={cn('size-2.5 shrink-0 rounded-full', s.color)} />
            {s.label}
            <span className="font-semibold text-slate-900 tabular-nums dark:text-white">{byState[s.key]}</span>
            <span className="text-xs text-slate-400 tabular-nums">{percentLabel(byState[s.key], total)}</span>
          </li>
        ))}
      </ul>
      {byState.new && newPerDay ? (
        <p
          className={cn(
            'mt-3 rounded-xl px-3 py-2 text-xs leading-relaxed',
            newPerDay > 50
              ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
              : 'bg-slate-50 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300',
          )}
        >
          At <strong>{newPerDay}</strong> new cards a day, your {byState.new} new cards last about <strong>{days} days</strong>.
          {newPerDay > 50
            ? ' That many new cards a day makes the cards due in the coming weeks pile up fast; 15–30 a day is usual (change it in Settings).'
            : ''}
        </p>
      ) : null}
    </div>
  )
}

/** The usage ladder's stages, light to dark: knowing a word → using it. */
const LADDER_SLOTS = [
  { key: 'recognize', color: 'bg-emerald-100 dark:bg-emerald-950' },
  { key: 'recall', color: 'bg-emerald-200 dark:bg-emerald-900' },
  { key: 'collocate', color: 'bg-emerald-400 dark:bg-emerald-700' },
  { key: 'paraphrase', color: 'bg-emerald-600 dark:bg-emerald-500' },
  { key: 'produce', color: 'bg-emerald-800 dark:bg-emerald-300' },
] as const

/**
 * Cards you have studied by usage stage: how many you only recognise, recall, or can already use (collocation, rewrite,
 * own sentence). Cards whose ladder is off are counted apart.
 */
export function LadderBar({ ladder, labels }: { ladder: ReviewStats['ladder']; labels: Record<(typeof LADDER_SLOTS)[number]['key'], string> }) {
  const total = LADDER_SLOTS.reduce((s, x) => s + ladder[x.key], 0)
  if (!total) return <p className="text-sm text-slate-400">Study a few cards to see them climb the usage ladder.</p>
  const using = ladder.collocate + ladder.paraphrase + ladder.produce
  return (
    <div>
      <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
        <strong className="text-slate-900 tabular-nums dark:text-white">{percentLabel(using, total)}</strong> of your studied cards are at a <em>using</em> stage (Collocation and up)
      </p>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Cards by usage stage">
        {LADDER_SLOTS.map((s) =>
          ladder[s.key] ? (
            <div
              key={s.key}
              className={cn(s.color, 'h-full min-w-1.5 first:rounded-l-full last:rounded-r-full')}
              style={{ width: `${percent(ladder[s.key], total)}%` }}
              title={`${labels[s.key]}: ${ladder[s.key]}`}
            />
          ) : null,
        )}
      </div>
      <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        {LADDER_SLOTS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <span className={cn('size-2.5 shrink-0 rounded-full', s.color)} />
            <span className="text-xs text-slate-400 tabular-nums">{i + 1}.</span>
            {labels[s.key]}
            <span className="font-semibold text-slate-900 tabular-nums dark:text-white">{ladder[s.key]}</span>
          </li>
        ))}
      </ol>
      {ladder.off ? <p className="mt-2 text-xs text-slate-500">+ {ladder.off} cards recognise-only (ladder off)</p> : null}
    </div>
  )
}
