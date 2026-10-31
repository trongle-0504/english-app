// Practice → Speaking review → History: every recorded answer, your bands over time (overall and per criterion), how
// you are doing lately against before, and any answer reviewed again in full — recording, figures, corrections.
import { ArrowLeft, Award, CalendarDays, ExternalLink, History, Loader2, Mic, Search, Target, Trash2, TrendingDown, TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ButtonLink, Card, EmptyState, PageHeader, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useQueryParam } from '@/lib/useQueryParam'
import { TALK_CRITERIA, talkPartLabel, type TalkHistoryItem, type TalkReviewResult } from '@/types/speakingReview'
import { talkApi } from './speaking-review/api'
import { ProgressChart } from './speaking-review/ProgressChart'
import { ResultView } from './speaking-review/ResultView'

type Range = 'all' | 'today' | '7d' | '30d'
const RANGES: { value: Range; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]
const PARTS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '1', label: 'Part 1' },
  { value: '2', label: 'Part 2' },
  { value: '3', label: 'Part 3' },
  { value: 'free', label: 'Free' },
]
/** How many answers count as "lately" (against the same number before them). */
const RECENT = 5

const midnight = (days = 0) => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days).getTime()
}
const since: Record<Range, () => number> = { all: () => 0, today: () => midnight(), '7d': () => midnight(-6), '30d': () => midnight(-29) }

const dayLabel = (iso: string) => {
  const t = new Date(iso)
  const day = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()
  if (day === midnight()) return 'Today'
  if (day === midnight(-1)) return 'Yesterday'
  return t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

const bandTone = (band: number) =>
  band >= 7
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
    : band >= 6
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
      : band >= 5
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
        : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'

function Stat({ icon: Icon, label, value, note, tone }: { icon: typeof Award; label: string; value: ReactNode; note?: ReactNode; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
        <span className={cn('flex size-7 items-center justify-center rounded-lg', tone)}>
          <Icon className="size-4" />
        </span>
        {label}
      </p>
      <p className="mt-2 text-2xl leading-none font-extrabold text-slate-900 tabular-nums dark:text-white">{value}</p>
      {note ? <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{note}</p> : null}
    </div>
  )
}

/** Lately against before, the best answer, the weakest criterion lately. */
function Summary({ items }: { items: TalkHistoryItem[] }) {
  const newest = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const recent = newest.slice(0, RECENT)
  const before = newest.slice(RECENT, RECENT * 2)
  const now = mean(recent.map((i) => i.overall))
  const delta = before.length ? now - mean(before.map((i) => i.overall)) : null
  const best = newest.reduce((a, b) => (b.overall > a.overall ? b : a), newest[0])
  const weakest = TALK_CRITERIA.map((c) => ({ ...c, avg: mean(recent.map((i) => i.bands[c.id])) })).sort((a, b) => a.avg - b.avg)[0]
  const minutes = Math.round(items.reduce((s, i) => s + i.speech, 0) / 60)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        icon={Mic}
        label="Answers"
        value={items.length}
        note={`${minutes ? `${minutes} min` : 'under a minute'} of speaking`}
        tone="bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300"
      />
      <Stat
        icon={delta !== null && delta < 0 ? TrendingDown : TrendingUp}
        label={`Average band · last ${recent.length}`}
        value={now.toFixed(1)}
        note={
          delta === null ? (
            'Keep going to see the trend'
          ) : (
            <span className={cn('font-semibold', delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-600' : '')}>
              {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {Math.abs(delta).toFixed(1)} vs the {before.length} before
            </span>
          )
        }
        tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"
      />
      <Stat
        icon={Award}
        label="Best answer"
        value={best.overall.toFixed(1)}
        note={`${dayLabel(best.createdAt)} · ${talkPartLabel(best.part)}`}
        tone="bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300"
      />
      <Stat
        icon={Target}
        label="Focus on"
        value={`${weakest.short} ${weakest.avg.toFixed(1)}`}
        note={`${weakest.label} — your lowest lately`}
        tone="bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300"
      />
    </div>
  )
}

/** A trash icon that asks once ("Delete?") before deleting; the question goes away by itself after 4 s. */
function DeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])
  if (busy) return <Loader2 className="size-3.5 animate-spin text-slate-400" />
  return armed ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setBusy(true)
        void onDelete().finally(() => setBusy(false))
      }}
      className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-rose-700"
    >
      Delete?
    </button>
  ) : (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setArmed(true)
      }}
      title="Xoá bài này (cả bản ghi âm)"
      aria-label="Delete this answer"
      className="relative hit-area rounded p-1 text-slate-400 opacity-40 transition group-hover/item:opacity-100 hover:bg-rose-50 hover:text-rose-600 hover:opacity-100 dark:hover:bg-rose-950/40"
    >
      <Trash2 className="size-3.5" />
    </button>
  )
}

function Item({ item, active, onOpen, onDelete }: { item: TalkHistoryItem; active: boolean; onOpen: () => void; onDelete: () => Promise<void> }) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
        className={cn(
          'group/item flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors',
          active
            ? 'border-brand-300 bg-brand-50/60 ring-2 ring-brand-500/15 dark:border-brand-700 dark:bg-brand-950/30'
            : 'border-transparent hover:border-slate-200 hover:bg-white dark:hover:border-slate-800 dark:hover:bg-slate-900',
        )}
      >
        <span className={cn('flex size-11 shrink-0 flex-col items-center justify-center rounded-xl', bandTone(item.overall))}>
          <span className="text-[9px] font-bold uppercase">Band</span>
          <span className="text-[15px] leading-none font-extrabold tabular-nums">{item.overall.toFixed(1)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm leading-snug font-semibold text-slate-900 dark:text-white">
            {item.question || item.topic || 'Free talk'}
          </span>
          <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
            {talkPartLabel(item.part)} · {timeLabel(item.createdAt)} · {clock(item.speech)} · {item.words} words{item.script ? ' · script' : ''}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            {TALK_CRITERIA.map((c) => (
              <span
                key={c.id}
                title={c.label}
                className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-600 tabular-nums dark:bg-slate-800 dark:text-slate-300"
              >
                {c.short} {item.bands[c.id].toFixed(1)}
              </span>
            ))}
          </span>
        </span>
        <span className="self-start">
          <DeleteButton onDelete={onDelete} />
        </span>
      </div>
    </li>
  )
}

export default function SpeakingReviewHistoryPage() {
  const [range, setRange] = useState<Range>('all')
  const [part, setPart] = useState('all')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<TalkHistoryItem[] | null>(null)
  const [error, setError] = useState('')
  const [id, setId] = useQueryParam('id')
  const [results, setResults] = useState<Record<string, TalkReviewResult>>({})

  useEffect(() => {
    let active = true
    talkApi.history().then(
      ({ items: next }) => active && setItems(next),
      (err: Error) => active && setError(err.message),
    )
    return () => {
      active = false
    }
  }, [])

  // Date and part filter the chart and the summary too; the search only narrows the list.
  const scoped = useMemo(
    () => (items ?? []).filter((i) => Date.parse(i.createdAt) >= since[range]() && (part === 'all' || String(i.part) === part)),
    [items, range, part],
  )
  const listed = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? scoped.filter((i) => `${i.question} ${i.topic ?? ''}`.toLowerCase().includes(q)) : scoped
  }, [scoped, search])
  const days = useMemo(() => {
    const groups: { day: string; items: TalkHistoryItem[] }[] = []
    for (const item of listed) {
      const day = dayLabel(item.createdAt)
      const last = groups[groups.length - 1]
      if (last?.day === day) last.items.push(item)
      else groups.push({ day, items: [item] })
    }
    return groups
  }, [listed])

  // The answer on screen: the one asked for, else the newest listed.
  const shownId = id && listed.some((i) => i.id === id) ? id : listed[0]?.id
  useEffect(() => {
    if (!shownId || results[shownId]) return
    let active = true
    talkApi.get(shownId).then(
      ({ job }) => active && job.result && setResults((prev) => ({ ...prev, [shownId]: job.result! })),
      (err: Error) => active && setError(err.message),
    )
    return () => {
      active = false
    }
  }, [shownId, results])

  const remove = async (target: string) => {
    try {
      await talkApi.remove(target)
      setItems((prev) => (prev ?? []).filter((i) => i.id !== target))
      if (target === id) setId('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const shown = shownId ? results[shownId] : undefined

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Speaking review"
        title="History"
        description="Every answer you recorded: your bands over time, how you are doing lately, and each review in full — recording, figures and corrections."
        actions={
          <ButtonLink to="/practice/speaking-review" variant="outline">
            <ArrowLeft className="size-4" /> Back to Speaking review
          </ButtonLink>
        }
      />
      {error ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}

      {items === null ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      ) : !items.length ? (
        <EmptyState
          icon={<History className="size-6" />}
          title="No answers yet"
          description="Record an answer on Speaking review — it shows up here with its bands."
          action={
            <ButtonLink to="/practice/speaking-review">
              <Mic className="size-4" /> Record an answer
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl value={range} onChange={setRange} options={RANGES} />
            <SegmentedControl value={part} onChange={setPart} options={PARTS} />
            <label className="relative min-w-44 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search questions…"
                className="w-full rounded-xl border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
          </div>

          {scoped.length ? (
            <>
              <Summary items={scoped} />
              <Card className="p-2 sm:p-5">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-bold text-slate-900 dark:text-white">Your band over time</h2>
                  <span className="text-xs text-slate-500">Click a point to open that answer</span>
                </div>
                {scoped.length > 1 ? (
                  <ProgressChart items={scoped} selected={shownId} onSelect={setId} />
                ) : (
                  <p className="py-6 text-center text-sm text-slate-500">Record one more answer to see how your band changes.</p>
                )}
              </Card>
            </>
          ) : null}

          <div className="grid gap-6 md:grid-cols-[20rem_minmax(0,1fr)] lg:grid-cols-[22rem_minmax(0,1fr)]">
            <aside className="md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:self-start md:overflow-y-auto md:pr-1">
              {days.length ? (
                <div className="space-y-4">
                  {days.map((g) => (
                    <section key={g.day}>
                      <h3 className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-bold tracking-wide text-slate-500 uppercase">
                        <CalendarDays className="size-3.5" /> {g.day}
                      </h3>
                      <ul className="space-y-1">
                        {g.items.map((item) => (
                          <Item
                            key={item.id}
                            item={item}
                            active={item.id === shownId}
                            onOpen={() => setId(item.id)}
                            onDelete={() => remove(item.id)}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <p className="px-1 py-6 text-sm text-slate-500">No answers match these filters.</p>
              )}
            </aside>

            <section className="min-w-0">
              {shown ? (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <Link
                      to={`/practice/speaking-review?id=${shown.id}`}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
                    >
                      Open on Speaking review <ExternalLink className="size-3.5" />
                    </Link>
                  </div>
                  <ResultView key={shown.id} result={shown} onUpdate={(r) => setResults((prev) => ({ ...prev, [r.id]: r }))} />
                </div>
              ) : shownId ? (
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="size-4 animate-spin" /> Loading the review…
                </p>
              ) : null}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
