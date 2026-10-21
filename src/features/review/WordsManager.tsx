import * as Popover from '@radix-ui/react-popover'
import { ArrowLeftRight, CheckCheck, Info, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button, EmptyState, SearchInput, SegmentedControl, type Tone } from '@/components/ui'
import { cn } from '@/lib/cn'
import { matchesQuery } from '@/lib/text'
import { useQueryParam } from '@/lib/useQueryParam'
import type { ReviewCard, ReviewSource } from '@/types/content'
import type { ReviewHistoryEntry, ReviewSettings, StoredCard, UsageStage } from '@/types/review'
import { reviewApi } from './api'
import { effectiveStage, ladderStage, STAGE_LABEL, STAGES } from './ladder'
import { LadderToggle } from './LadderToggle'
import { addDays, formatInterval, studyDay } from './schedule'
import { REVIEW_SOURCES } from './sources'
import { setCardsDone, useReviewStore } from './store'
import { abilitiesOf } from './usageTasks'

type Status = 'learning' | 'done'
type Period = 'all' | 'today' | 'yesterday' | 'week' | 'lastweek' | 'month' | 'day'
type DateField = 'added' | 'reviewed' | 'done'
type Sort = 'recent' | 'oldest' | 'az' | 'due'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' },
  { value: 'lastweek', label: 'Last week' },
  { value: 'month', label: 'This month' },
]

const SOURCE_OPTIONS: { value: ReviewSource | ''; label: string }[] = [{ value: '', label: 'All sources' }, ...REVIEW_SOURCES]

/** Usage-ladder stage badges (see ladder.ts). */
const STAGE_TONE: Record<UsageStage, Tone> = { recognize: 'slate', recall: 'sky', collocate: 'violet', paraphrase: 'indigo', produce: 'emerald' }
const STAGE_HINT: Record<UsageStage, string> = {
  recognize: 'Thấy từ tiếng Anh → nhớ nghĩa (hoặc nghe → gõ lại).',
  recall: 'Thấy nghĩa → gõ ra từ tiếng Anh.',
  collocate: 'Điền từ đi kèm cho đúng cụm collocation trong câu ví dụ.',
  paraphrase: 'Viết lại một câu cho sẵn, giữ nguyên nghĩa, dùng từ/cụm này; Gemini chấm.',
  produce: 'Tự viết 1 câu IELTS với từ hoặc một collocation của nó; Gemini chấm.',
}

const STATE: Record<number, { label: string; tone: Tone; hint: string }> = {
  0: { label: 'New', tone: 'sky', hint: 'Added but not studied yet. It is introduced as a new card, within your daily limit of new cards.' },
  1: {
    label: 'Learning',
    tone: 'amber',
    hint: 'Studied for the first time. It comes back after short steps (minutes) until you know it, then moves to Review.',
  },
  2: {
    label: 'Review',
    tone: 'emerald',
    hint: 'Learned. Each time you remember it, the gap before it comes back grows: days, then weeks, then months.',
  },
  3: {
    label: 'Relearning',
    tone: 'rose',
    hint: 'A Review card you forgot (you pressed Again). It goes through short steps again, then returns to Review.',
  },
}
const DONE_STATE = {
  label: 'Done',
  tone: 'violet' as Tone,
  hint: 'You marked it as known. It is off the schedule; “Back to learning” puts it in today’s session.',
}

const PAGE = 100

export const selectClass =
  'h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'

/** "26 Sep", with Today / Yesterday / Tomorrow for nearby days. */
export function shortDay(day: string, today: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  if (day === today) return 'Today'
  if (day === addDays(today, -1)) return 'Yesterday'
  if (day === addDays(today, 1)) return 'Tomorrow'
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' })
}

/** Monday of the study week containing `day`. */
function weekStart(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay()
  return addDays(day, -((dow + 6) % 7))
}

/** [from, to] study days (inclusive) for a period; null = no limit. */
function periodRange(period: Period, today: string, pickedDay: string): [string, string] | null {
  switch (period) {
    case 'today':
      return [today, today]
    case 'yesterday':
      return [addDays(today, -1), addDays(today, -1)]
    case 'week':
      return [weekStart(today), today]
    case 'lastweek': {
      const start = addDays(weekStart(today), -7)
      return [start, addDays(start, 6)]
    }
    case 'month':
      return [`${today.slice(0, 7)}-01`, today]
    case 'day':
      return pickedDay ? [pickedDay, pickedDay] : null
    default:
      return null
  }
}

const RATING: Record<number, { label: string; className: string }> = {
  1: { label: 'Again', className: 'text-rose-600 dark:text-rose-400' },
  2: { label: 'Hard', className: 'text-amber-600 dark:text-amber-400' },
  3: { label: 'Good', className: 'text-emerald-600 dark:text-emerald-400' },
  4: { label: 'Easy', className: 'text-sky-600 dark:text-sky-400' },
}

/** Saved reviews per card id (oldest first), re-read whenever `version` changes. */
function useHistory(version: unknown): ReadonlyMap<string, ReviewHistoryEntry[]> | null {
  const [history, setHistory] = useState<ReadonlyMap<string, ReviewHistoryEntry[]> | null>(null)
  useEffect(() => {
    let live = true
    reviewApi.history().then(
      ({ entries }) => {
        const byId = new Map<string, ReviewHistoryEntry[]>()
        for (const e of entries) byId.set(e.id, [...(byId.get(e.id) ?? []), e])
        if (live) setHistory(byId)
      },
      () => live && setHistory(new Map()),
    )
    return () => {
      live = false
    }
  }, [version])
  return history
}

interface Row {
  id: string
  card: ReviewCard
  stored: StoredCard
  /** Study day of the chosen date field. */
  day?: string
  /** Sort key: time of the chosen date field. */
  time: number
  /** Usage-ladder stage it is practised at (see effectiveStage). */
  stage: UsageStage
  /** "Reviewed" filter: reviews inside the chosen period. */
  reviews?: { count: number; last: ReviewHistoryEntry }
}

/** Every card in reviews, split into "learning" and "done", with date filters and moving between the two. */
export function WordsManager({ cardsById }: { cardsById: ReadonlyMap<string, ReviewCard> }) {
  const { cards, settings, today: todayCounts } = useReviewStore()
  // ?when=today&by=reviewed (from the Overview's "Reviewed today") sets the starting filters.
  const [initialWhen] = useQueryParam('when')
  const [initialBy] = useQueryParam('by')
  const [status, setStatus] = useState<Status>('learning')
  const [period, setPeriod] = useState<Period>(() => (PERIODS.some((p) => p.value === initialWhen) ? (initialWhen as Period) : 'all'))
  const [pickedDay, setPickedDay] = useState('')
  const [field, setField] = useState<DateField>(initialBy === 'reviewed' ? 'reviewed' : 'added')
  const history = useHistory(`${todayCounts?.day}:${todayCounts?.reviewed}`)
  const [source, setSource] = useState<ReviewSource | ''>('')
  // A stage, or "off" = cards whose usage ladder is switched off.
  const [stage, setStage] = useState<UsageStage | 'off' | ''>('')
  const [sort, setSort] = useState<Sort>('recent')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [limit, setLimit] = useState(PAGE)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const today = settings ? studyDay(new Date(), settings) : ''

  const all = useMemo(() => {
    const rows: Row[] = []
    for (const [id, stored] of Object.entries(cards)) {
      const card = cardsById.get(id)
      if (card) rows.push({ id, card, stored, time: 0, stage: effectiveStage(ladderStage(stored), abilitiesOf(card)) })
    }
    return rows
  }, [cards, cardsById])

  const counts = { learning: all.filter((r) => !r.stored.done).length, done: all.filter((r) => r.stored.done).length }

  const rows = useMemo(() => {
    if (!settings) return []
    const range = periodRange(period, today, pickedDay)
    const now = Date.now()
    const list = all
      .filter((r) => (status === 'done') === Boolean(r.stored.done))
      .filter((r) => !source || r.card.source === source)
      .filter((r) => !stage || (stage === 'off' ? r.stored.ladder === false : r.stored.ladder !== false && r.stage === stage))
      .filter((r) => !query || matchesQuery(r.card.term, query) || matchesQuery(r.card.meaning_vi, query))
      .flatMap((r): Row[] => {
        const inRange = (day: string) => !range || (day >= range[0] && day <= range[1])
        if (field === 'reviewed') {
          // Every saved review counts, not just the latest, so "Yesterday" still lists words reviewed again today.
          const matching = (history?.get(r.id) ?? []).filter((e) => inRange(e.day))
          const last = matching.at(-1)
          return last ? [{ ...r, day: last.day, time: Date.parse(last.review), reviews: { count: matching.length, last } }] : []
        }
        const date = field === 'added' ? r.stored.added : r.stored.done
        const day = date ? studyDay(new Date(date), settings) : undefined
        return !range || (day && inRange(day)) ? [{ ...r, day, time: Date.parse(date ?? '') || 0 }] : []
      })
    const time = (r: Row) => r.time
    const due = (r: Row) => (r.stored.fsrs.state === 0 ? now + 1e13 : Date.parse(r.stored.fsrs.due))
    const compare: Record<Sort, (a: Row, b: Row) => number> = {
      recent: (a, b) => time(b) - time(a),
      oldest: (a, b) => time(a) - time(b),
      az: (a, b) => a.card.term.localeCompare(b.card.term),
      due: (a, b) => due(a) - due(b),
    }
    return list.sort(compare[sort])
  }, [all, settings, status, source, stage, query, field, period, pickedDay, today, sort, history])

  if (!settings) return null

  const changeStatus = (next: Status) => {
    setStatus(next)
    setSelected(new Set())
    setLimit(PAGE)
    // "Marked done" only exists in the Done list.
    if (next === 'done' && field === 'added') setField('done')
    if (next === 'learning' && field === 'done') setField('added')
  }

  const move = async (ids: string[], key: string) => {
    setBusy(key)
    setError('')
    try {
      await setCardsDone(ids, status === 'learning')
      setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const visibleIds = rows.map((r) => r.id)
  const selectedVisible = visibleIds.filter((id) => selected.has(id))
  const allChecked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const moveLabel = status === 'learning' ? 'Mark done' : 'Back to learning'
  const moveHint = status === 'learning' ? 'Stop reviewing (progress is kept)' : 'Review it again today (progress is kept)'
  const MoveIcon = status === 'learning' ? CheckCheck : Undo2
  const fieldOptions: { value: DateField; label: string }[] =
    status === 'learning'
      ? [
          { value: 'added', label: 'Added' },
          { value: 'reviewed', label: 'Reviewed' },
        ]
      : [
          { value: 'done', label: 'Marked done' },
          { value: 'added', label: 'Added' },
          { value: 'reviewed', label: 'Reviewed' },
        ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={status}
          onChange={changeStatus}
          options={[
            {
              value: 'learning',
              label: (
                <>
                  Learning <Count n={counts.learning} />
                </>
              ),
            },
            {
              value: 'done',
              label: (
                <>
                  Done <Count n={counts.done} />
                </>
              ),
            },
          ]}
        />
        <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search words or meanings…" className="w-full sm:w-64" />
      </div>

      <div className="space-y-2.5 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/40">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 shrink-0 text-xs font-semibold text-slate-500">When</span>
          <div className="scrollbar-thin -mx-1 overflow-x-auto px-1">
            <SegmentedControl
              size="sm"
              value={period === 'day' ? ('' as Period) : period}
              onChange={(p) => {
                setPeriod(p)
                setPickedDay('')
              }}
              options={PERIODS}
              className="bg-white dark:bg-slate-900"
            />
          </div>
          <input
            type="date"
            value={pickedDay}
            max={today}
            onChange={(e) => {
              setPickedDay(e.target.value)
              setPeriod(e.target.value ? 'day' : 'all')
            }}
            aria-label="Pick a day"
            className={cn(selectClass, 'h-8 text-xs', period === 'day' && 'border-brand-400 ring-2 ring-brand-100 dark:ring-brand-900')}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 shrink-0 text-xs font-semibold text-slate-500">Date of</span>
          <SegmentedControl size="sm" value={field} onChange={setField} options={fieldOptions} className="bg-white dark:bg-slate-900" />
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as ReviewSource | '')}
            className={cn(selectClass, 'h-8 text-xs sm:ml-auto')}
            aria-label="Source"
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {settings.ladder ? (
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as UsageStage | 'off' | '')}
              className={cn(selectClass, 'h-8 text-xs')}
              aria-label="Stage"
            >
              <option value="">All stages</option>
              {STAGES.map((s, i) => (
                <option key={s} value={s}>
                  {i + 1} · {STAGE_LABEL[s]}
                </option>
              ))}
              <option value="off">Chỉ nhận dạng (đã bỏ tick)</option>
            </select>
          ) : null}
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={cn(selectClass, 'h-8 text-xs')} aria-label="Sort">
            <option value="recent">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="az">A–Z</option>
            {status === 'learning' ? <option value="due">Next review</option> : null}
          </select>
        </div>
      </div>

      <div className="flex min-h-9 flex-wrap items-center gap-3 px-1">
        <span className="text-sm text-slate-600 dark:text-slate-300">
          {selectedVisible.length ? (
            <>
              <strong className="text-slate-900 dark:text-white">{selectedVisible.length}</strong> selected
            </>
          ) : (
            <>
              <strong className="text-slate-900 dark:text-white">{rows.length}</strong> {rows.length === 1 ? 'word' : 'words'}
            </>
          )}
        </span>
        {selectedVisible.length ? (
          <>
            <Button size="sm" loading={busy === 'bulk'} onClick={() => move(selectedVisible, 'bulk')}>
              <ArrowLeftRight className="size-3.5" /> {moveLabel} ({selectedVisible.length})
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </>
        ) : null}
        {error ? <span className="text-sm text-rose-600">{error}</span> : null}
        <StatusGuide
          className="ml-auto"
          trigger={
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-600 dark:text-slate-400"
            >
              <Info className="size-3.5" /> What do the statuses mean?
            </button>
          }
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={all.length ? 'No words match' : 'No words in your reviews yet'}
          description={
            all.length
              ? status === 'done' && !counts.done
                ? 'Words you mark as done appear here. They stop coming up in reviews; moving one back puts it in today’s session.'
                : 'Try another day, week or source.'
              : 'Add words from the Decks tab.'
          }
        />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold tracking-[0.08em] text-slate-500 uppercase dark:text-slate-400">
                <th className={cn(TH, 'w-10 rounded-l-lg pl-3')}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedVisible.length > 0 && !allChecked
                    }}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(visibleIds))}
                    aria-label="Select all"
                    className="size-4 rounded align-middle accent-brand-600 pointer-coarse:size-5"
                  />
                </th>
                <th className={TH}>Word</th>
                <th className={cn(TH, 'hidden sm:table-cell')}>
                  <StatusGuide
                    trigger={
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 uppercase hover:text-brand-600"
                        title="What do the statuses mean?"
                      >
                        Status <Info className="size-3.5" />
                      </button>
                    }
                  />
                </th>
                {settings.ladder ? <th className={cn(TH, 'hidden sm:table-cell')}>Bậc</th> : null}
                <th className={cn(TH, 'hidden md:table-cell')}>Next review</th>
                <th className={cn(TH, 'hidden text-right lg:table-cell')}>Reviews</th>
                <th className={cn(TH, 'text-right')}>{DATE_HEADER[field]}</th>
                {field === 'reviewed' ? <th className={cn(TH, 'text-right')}>Last answer</th> : null}
                <th className={cn(TH, 'rounded-r-lg pr-3')}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r) => (
                <WordRow
                  key={r.id}
                  row={r}
                  today={today}
                  settings={settings}
                  field={field}
                  ladder={settings.ladder}
                  checked={selected.has(r.id)}
                  onToggle={() => toggle(r.id)}
                  action={
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === r.id}
                      onClick={() => move([r.id], r.id)}
                      title={moveHint}
                      aria-label={`${moveLabel}: ${r.card.term}`}
                    >
                      <MoveIcon className="size-3.5" />
                      <span className="hidden sm:inline">{moveLabel}</span>
                    </Button>
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit ? (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE * 5)}>
            Show more ({rows.length - limit} left)
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function Count({ n }: { n: number }) {
  return <span className="ml-1 rounded-full bg-slate-200/70 px-1.5 text-[11px] tabular-nums dark:bg-slate-600/60">{n}</span>
}

const TH = 'bg-slate-50 px-3 py-2.5 font-bold whitespace-nowrap dark:bg-slate-800/60'
const TD = 'border-b border-slate-100 px-3 py-2.5 align-middle dark:border-slate-800/70'
const DATE_HEADER: Record<DateField, string> = { added: 'Added', reviewed: 'Reviewed', done: 'Marked done' }

/** Explains each status (and the columns) in a popover. */
function StatusGuide({ trigger, className }: { trigger: React.ReactNode; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <span className={cn('inline-flex', className)}>{trigger}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={{ top: 76, right: 12, bottom: 12, left: 12 }}
          className="animate-scale-in z-50 max-h-[var(--radix-popover-content-available-height)] w-[34rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm normal-case shadow-xl tracking-normal dark:border-slate-700 dark:bg-slate-900"
        >
          <p className="mb-3 font-semibold text-slate-900 dark:text-white">Statuses</p>
          <ul className="space-y-2.5">
            {[STATE[0], STATE[1], STATE[2], STATE[3], DONE_STATE].map((st) => (
              <li key={st.label} className="grid grid-cols-[5.5rem_1fr] items-start gap-2">
                <Badge tone={st.tone} className="justify-self-start">
                  {st.label}
                </Badge>
                <span className="text-[13px] leading-snug font-normal text-slate-600 dark:text-slate-300">{st.hint}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 mb-2 font-semibold text-slate-900 dark:text-white">Columns</p>
          <dl className="space-y-1.5 text-[13px] leading-snug font-normal text-slate-600 dark:text-slate-300">
            <div>
              <dt className="inline font-semibold text-slate-800 dark:text-slate-100">Bậc</dt> — bài tập thẻ sẽ gặp ở lần ôn tới (Usage ladder): 1
              Nhận ra → 2 Nhớ ra từ → 3 Dùng đúng cụm → 4 Viết lại câu → 5 Tự dùng. Good/Easy lên một bậc, Again lùi lại. Bậc thẻ không có dữ liệu (ví
              dụ không có collocation) được bỏ qua. Bỏ tick “Usage ladder” ở một từ (ít dùng khi nói/viết) thì từ đó chỉ ôn ở mức Nhận ra; tick lại
              thì học tiếp từ bậc cũ.
            </div>
            <div>
              <dt className="inline font-semibold text-slate-800 dark:text-slate-100">Next review</dt> — when it comes back. “Due now” means it is
              waiting in today’s session.
            </div>
            <div>
              <dt className="inline font-semibold text-slate-800 dark:text-slate-100">Reviews</dt> — how many times you have answered it in total.
            </div>
            <div>
              <dt className="inline font-semibold text-slate-800 dark:text-slate-100">Last answer</dt> — your last grade (Again · Hard · Good · Easy)
              in the chosen period, and how many times you reviewed it then.
            </div>
          </dl>
          <Popover.Arrow className="fill-white dark:fill-slate-900" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function WordRow({
  row,
  today,
  settings,
  field,
  ladder,
  checked,
  onToggle,
  action,
}: {
  row: Row
  today: string
  settings: ReviewSettings
  field: DateField
  ladder: boolean
  checked: boolean
  onToggle: () => void
  action: React.ReactNode
}) {
  const { card, stored } = row
  const fsrs = stored.fsrs
  const state = stored.done ? DONE_STATE : STATE[fsrs.state]
  const dueAt = Date.parse(fsrs.due)
  const next = stored.done
    ? { text: '—', warn: false }
    : fsrs.state === 0
      ? { text: 'Not started', warn: false }
      : dueAt <= Date.now()
        ? { text: 'Due now', warn: true }
        : { text: `in ${formatInterval(dueAt - Date.now())}`, warn: false }
  const rating = row.reviews ? RATING[row.reviews.last.rating] : null
  const cell = cn(TD, checked && 'bg-brand-50/70 dark:bg-brand-950/30')

  return (
    <tr className="group [&>td]:transition-colors hover:[&>td]:bg-slate-50/80 dark:hover:[&>td]:bg-slate-800/30">
      <td className={cn(cell, 'pl-3')}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select ${card.term}`}
          className="size-4 rounded align-middle accent-brand-600 pointer-coarse:size-5"
        />
      </td>
      <td className={cn(cell, 'max-w-0 w-full')}>
        {card.href ? (
          <Link
            to={card.href}
            className="block truncate font-semibold text-slate-800 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-400"
          >
            {card.term}
          </Link>
        ) : (
          <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{card.term}</span>
        )}
        <span className="block truncate text-xs text-slate-500">{card.origin}</span>
      </td>
      <td className={cn(cell, 'hidden sm:table-cell')}>
        <Badge tone={state.tone} title={state.hint}>
          {state.label}
        </Badge>
      </td>
      {ladder ? (
        <td className={cn(cell, 'hidden whitespace-nowrap sm:table-cell')}>
          <div className="flex flex-col items-start gap-1">
            <Badge tone={STAGE_TONE[row.stage]} title={STAGE_HINT[row.stage]}>
              {STAGES.indexOf(row.stage) + 1} · {STAGE_LABEL[row.stage]}
            </Badge>
            <LadderToggle id={row.id} />
          </div>
        </td>
      ) : null}
      <td
        className={cn(
          cell,
          'hidden text-xs whitespace-nowrap tabular-nums md:table-cell',
          next.warn ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300',
        )}
        title={
          fsrs.state === 0 || stored.done
            ? undefined
            : new Date(fsrs.due).toLocaleString('en-GB', { timeZone: settings.timeZone, dateStyle: 'medium', timeStyle: 'short' })
        }
      >
        {next.text}
      </td>
      <td className={cn(cell, 'hidden text-right text-xs text-slate-600 tabular-nums lg:table-cell dark:text-slate-300')}>{fsrs.reps}</td>
      <td className={cn(cell, 'text-right text-xs whitespace-nowrap text-slate-600 tabular-nums dark:text-slate-300')}>
        {row.day ? shortDay(row.day, today) : '—'}
      </td>
      {field === 'reviewed' ? (
        <td className={cn(cell, 'text-right text-xs whitespace-nowrap tabular-nums')}>
          {row.reviews && rating ? (
            <>
              <span className={cn('font-semibold', rating.className)}>{rating.label}</span>
              <span className="text-slate-400" title={`Reviewed ${row.reviews.count}× in this period`}>
                {' '}
                · {row.reviews.count}×
              </span>
            </>
          ) : null}
        </td>
      ) : null}
      <td className={cn(cell, 'pr-3 text-right whitespace-nowrap')}>{action}</td>
    </tr>
  )
}
