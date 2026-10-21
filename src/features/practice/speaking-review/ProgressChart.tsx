// Your bands over time (Speaking review history): the overall band as a bold line, the four criteria as thin ones you
// can switch on and off; a point opens that answer.
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { TALK_CRITERIA, type TalkCriterionId, type TalkHistoryItem } from '@/types/speakingReview'

type Line = 'overall' | TalkCriterionId

const LINE_COLOR: Record<Line, string> = {
  overall: 'stroke-slate-900 dark:stroke-white',
  fc: 'stroke-brand-500',
  lr: 'stroke-violet-500',
  gra: 'stroke-teal-500',
  pron: 'stroke-orange-500',
}
const DOT_COLOR: Record<Line, string> = {
  overall: 'bg-slate-900 dark:bg-white',
  fc: 'bg-brand-500',
  lr: 'bg-violet-500',
  gra: 'bg-teal-500',
  pron: 'bg-orange-500',
}

const W = 1000
const H = 230
const PAD = { left: 30, right: 12, top: 12, bottom: 26 }
const MAX_POINTS = 30

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

export function ProgressChart({ items, selected, onSelect }: { items: TalkHistoryItem[]; selected?: string; onSelect: (id: string) => void }) {
  const [shown, setShown] = useState<Set<Line>>(() => new Set<Line>(['overall']))
  // Oldest first, the latest MAX_POINTS.
  const points = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-MAX_POINTS)
  const valueOf = (item: TalkHistoryItem, line: Line) => (line === 'overall' ? item.overall : item.bands[line])
  const all = points.flatMap((p) => [p.overall, ...Object.values(p.bands)])
  const lo = Math.max(0, Math.min(4, Math.floor((Math.min(...all) - 0.5) * 2) / 2))
  const hi = 9
  const x = (i: number) => PAD.left + (points.length === 1 ? (W - PAD.left - PAD.right) / 2 : (i / (points.length - 1)) * (W - PAD.left - PAD.right))
  const y = (band: number) => PAD.top + ((hi - band) / (hi - lo)) * (H - PAD.top - PAD.bottom)
  const ticks = Array.from({ length: Math.floor(hi - lo) + 1 }, (_, i) => Math.ceil(lo) + i).filter((t) => t <= hi)
  const labelEvery = Math.max(1, Math.ceil(points.length / 7))
  const toggle = (line: Line) =>
    setShown((prev) => {
      const next = new Set(prev)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next.size ? next : prev
    })
  const lines: Line[] = ['overall', 'fc', 'lr', 'gra', 'pron']

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {lines.map((line) => {
          const label = line === 'overall' ? 'Overall' : TALK_CRITERIA.find((c) => c.id === line)!.short
          const on = shown.has(line)
          return (
            <button
              key={line}
              type="button"
              onClick={() => toggle(line)}
              aria-pressed={on}
              title={line === 'overall' ? 'Band tổng' : TALK_CRITERIA.find((c) => c.id === line)!.label}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition-colors',
                on
                  ? 'bg-white text-slate-800 ring-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600'
                  : 'text-slate-400 ring-slate-200 hover:text-slate-600 dark:ring-slate-800',
              )}
            >
              <span className={cn('size-2 rounded-full', on ? DOT_COLOR[line] : 'bg-slate-300 dark:bg-slate-700')} />
              {label}
            </button>
          )
        })}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Band over time">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-slate-100 dark:stroke-slate-800" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-400 text-[11px] tabular-nums">
              {t}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text
              key={p.id}
              x={x(i)}
              y={H - 6}
              textAnchor={points.length > 1 && i === 0 ? 'start' : points.length > 1 && i === points.length - 1 ? 'end' : 'middle'}
              className="fill-slate-400 text-[10px]"
            >
              {dateLabel(p.createdAt)}
            </text>
          ) : null,
        )}
        {lines
          .filter((line) => shown.has(line))
          .map((line) => (
            <g key={line}>
              {points.length > 1 ? (
                <polyline
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeWidth={line === 'overall' ? 3 : 1.75}
                  className={LINE_COLOR[line]}
                  points={points.map((p, i) => `${x(i)},${y(valueOf(p, line))}`).join(' ')}
                />
              ) : null}
              {points.map((p, i) => (
                <circle
                  key={p.id}
                  cx={x(i)}
                  cy={y(valueOf(p, line))}
                  r={line === 'overall' ? (p.id === selected ? 6.5 : 4.5) : 3}
                  onClick={() => onSelect(p.id)}
                  className={cn(
                    'cursor-pointer fill-white stroke-[2.5px] dark:fill-slate-900',
                    LINE_COLOR[line],
                    p.id === selected && line === 'overall' && 'fill-brand-500 dark:fill-brand-400',
                  )}
                >
                  <title>{`${dateLabel(p.createdAt)} · ${line === 'overall' ? 'Overall' : line.toUpperCase()} ${valueOf(p, line).toFixed(1)} · ${p.question || 'Free talk'}`}</title>
                </circle>
              ))}
            </g>
          ))}
      </svg>
    </div>
  )
}
