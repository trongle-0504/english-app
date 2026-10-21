import * as Tabs from '@radix-ui/react-tabs'
import {
  ArrowRight,
  BookOpenCheck,
  Brain,
  CalendarCheck,
  CalendarClock,
  Check,
  PenLine,
  CalendarDays,
  Flame,
  Layers,
  ListChecks,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Sparkles,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { startTransition, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Card, EmptyState, PageHeader, SectionTitle, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import { onDataInvalidated, useData } from '@/lib/data'
import { InfoTip } from './InfoTip'
import { StartSessionButton } from './StartSessionButton'
import { useQueryParam } from '@/lib/useQueryParam'
import type { ReviewIndex, ReviewSource } from '@/types/content'
import { useLocalStorage } from '@/lib/storage'
import type { BasicReviewMode, ReviewSettings, ReviewStats } from '@/types/review'
import { reviewApi } from './api'
import { ForecastChart, LadderBar, StateBar, StudyHeatmap } from './charts'
import { STAGE_LABEL_EN } from './ladder'
import { DaySchedule } from './DaySchedule'
import { DeckBrowser } from './DeckBrowser'
import { MyCards } from './MyCards'
import { buildQueue } from './queue'
import { formatInterval } from './schedule'
import { REVIEW_SOURCES, SOURCES_KEY, sourceScope, sourcesLabel, withSources } from './sources'
import { updateReviewSettings, useReviewStore } from './store'
import { DEFAULT_USAGE_COUNT, USAGE_COUNT_KEY, USAGE_COUNTS, usageCandidates } from './usagePlan'
import { WordsManager } from './WordsManager'
import { ActionTileBody, actionTileClass, InfoStat, HeroBackdrop, PillChoice, PrimaryActionBody, primaryActionClass, StudyCardsArt } from './HeroParts'
import { RecentWorkTab } from './RecentWorkTab'

const tabClass = cn(
  'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-500 transition-colors outline-none hover:text-slate-900',
  'data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm',
  'dark:text-slate-400 dark:hover:text-white dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-white',
)

const MODE_OPTIONS: { value: BasicReviewMode; label: string; hint: string }[] = [
  { value: 'recognize', label: 'Recognise', hint: 'See the English, recall the meaning' },
  { value: 'recall', label: 'Recall', hint: 'See the meaning, type the English' },
  { value: 'listen', label: 'Dictation', hint: 'Nghe một câu ngắn có từ/cụm, gõ lại cả câu' },
]

function StatTile({
  icon,
  label,
  value,
  detail,
  to,
  tip,
  delta,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  detail?: ReactNode
  to?: string
  tip?: ReactNode
  /** A comparison next to the number (vs yesterday, vs the 30 days before). */
  delta?: { text: string; tone: 'up' | 'down' | 'flat' }
}) {
  const card = (
    <Card className={cn('h-full p-4', to && 'transition-colors hover:border-brand-300 dark:hover:border-brand-700')}>
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
        <span className="text-brand-600 dark:text-brand-400">{icon}</span>
        {label}
        {tip ? <InfoTip>{tip}</InfoTip> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums dark:text-white">{value}</p>
        {delta ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
              delta.tone === 'up'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                : delta.tone === 'down'
                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
            )}
          >
            {delta.tone === 'up' ? <TrendingUp className="size-3" /> : delta.tone === 'down' ? <TrendingDown className="size-3" /> : null}
            {delta.text}
          </span>
        ) : null}
      </div>
      {detail ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{detail}</p> : null}
    </Card>
  )
  return to ? (
    <Link to={to} className="block rounded-2xl" title="See these words">
      {card}
    </Link>
  ) : (
    card
  )
}

/** A difference as a chip: +3 so với hôm qua (up), −2 (down), 0 (flat). */
function compare(diff: number, what: string): { text: string; tone: 'up' | 'down' | 'flat' } {
  return { text: `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff)} ${what}`, tone: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' }
}

function useStats(version: number) {
  const [stats, setStats] = useState<ReviewStats | null>(null)
  useEffect(() => {
    reviewApi.stats().then(setStats, () => setStats(null))
  }, [version])
  return stats
}

const RETENTION_PRESETS = [
  {
    value: 0.85,
    label: '85% · Light',
    title: '85% · Nhẹ nhàng',
    hint: 'Khi bị quá tải (quá nhiều thẻ đến hạn mỗi ngày). Ôn thưa hơn, chấp nhận quên nhiều hơn.',
  },
  {
    value: 0.9,
    label: '90% · Recommended',
    title: '90% · Khuyên dùng',
    hint: 'Mặc định của FSRS / Anki: cân bằng giữa thời gian ôn và độ nhớ. Hợp với đa số người học.',
  },
  {
    value: 0.95,
    label: '95% · Exam prep',
    title: '95% · Trước kỳ thi',
    hint: 'Tạm dùng vài tuần trước khi thi để từ vựng thật chắc. Số lượt ôn tăng mạnh.',
  },
]

/** FSRS-6 forgetting curve (default decay): how long intervals are at retention `r`, relative to 90%. */
function intervalRatio(r: number): number {
  const decay = 0.1542
  return (r ** (-1 / decay) - 1) / (0.9 ** (-1 / decay) - 1)
}

function RetentionSetting({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const ratio = intervalRatio(value)
  const pct = Math.round(value * 100)
  const fmt = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ''))
  return (
    <SettingRow
      stacked
      title="Target retention"
      tip={
        <>
          <p>
            Xác suất bạn còn nhớ một thẻ vào lúc nó quay lại: ở {pct}%, cứ 100 thẻ đến hạn bạn nhớ khoảng {pct} thẻ. Càng cao thì ôn càng dày.
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            {RETENTION_PRESETS.map((p) => (
              <li key={p.value}>
                <strong>{p.title}:</strong> {p.hint}
              </li>
            ))}
          </ul>
          <p className="mt-1.5">
            Không nên vượt 95% (lượt ôn tăng vọt) hay dưới 80% (quên quá nhiều). Giữ một mức ít nhất vài tuần. Nếu ô Retention (30 days) ở Overview
            thấp hơn mục tiêu nhiều, hãy chấm thật hơn thay vì tăng mức.
          </p>
        </>
      }
      value={<span className="text-sm font-bold text-brand-700 tabular-nums dark:text-brand-300">{pct}%</span>}
    >
      <input
        type="range"
        min={0.8}
        max={0.95}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Target retention"
        className="w-full accent-brand-600"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {RETENTION_PRESETS.map((p) => (
          <Chip key={p.value} on={Math.abs(value - p.value) < 0.005} onClick={() => onChange(p.value)} title={p.hint}>
            {p.label}
          </Chip>
        ))}
      </div>
      {Math.abs(value - 0.9) < 0.005 ? null : (
        <p className="mt-2 text-xs text-slate-500 tabular-nums">
          Compared with 90%: gaps between reviews ≈ {fmt(ratio)}×, reviews per day ≈ {fmt(1 / ratio)}× (estimate).
        </p>
      )}
    </SettingRow>
  )
}

/* ───────────── Settings tab ───────────── */

/** One setting: its name with an ⓘ explanation, and the control (beside it, or below when `stacked`). */
function SettingRow({
  title,
  tip,
  value,
  stacked = false,
  children,
}: {
  title: string
  tip: ReactNode
  /** Shown next to the title (e.g. the current percentage). */
  value?: ReactNode
  stacked?: boolean
  children: ReactNode
}) {
  const head = (
    <div className="flex min-w-0 items-center gap-2">
      {/* The ⓘ stays right after the last word when a long title wraps. */}
      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        {title}
        <span className="ml-1.5 inline-block align-[-2px]">
          <InfoTip wide>{tip}</InfoTip>
        </span>
      </span>
      {value ? <span className="ml-auto pl-2">{value}</span> : null}
    </div>
  )
  return stacked ? (
    <div className="py-4">
      {head}
      <div className="mt-2.5">{children}</div>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-4 py-4">
      {head}
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-bold tracking-[0.08em] text-slate-400 uppercase">{title}</h3>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">{children}</div>
    </section>
  )
}

/** A pill that is on or off (review modes, retention presets). */
function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
        on
          ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-300'
          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/50',
      )}
    >
      {on ? <Check className="size-3.5" /> : null}
      {children}
    </button>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span
        aria-hidden
        className="relative h-5 w-9 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/20 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4 dark:bg-slate-700 dark:peer-checked:bg-brand-500"
      />
    </label>
  )
}

function SettingsPanel({ settings }: { settings: ReviewSettings }) {
  const [draft, setDraft] = useState(settings)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const toggleMode = (mode: BasicReviewMode) => {
    const modes = draft.modes.includes(mode) ? draft.modes.filter((m) => m !== mode) : [...draft.modes, mode]
    if (modes.length) setDraft({ ...draft, modes })
  }
  const save = async () => {
    setBusy(true)
    try {
      await updateReviewSettings({
        newPerDay: draft.newPerDay,
        retention: draft.retention,
        modes: draft.modes,
        ladder: draft.ladder,
        autoAddFromAdmin: draft.autoAddFromAdmin,
      })
      setMessage({ ok: true, text: 'Settings saved.' })
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  return (
    <Card className="p-4 sm:p-6">
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
        <SettingGroup title="Schedule">
          <SettingRow
            title="New cards per day"
            tip="Số thẻ MỚI được giới thiệu mỗi ngày. Thẻ đã đến hạn ôn luôn hiện đủ, không bị giới hạn bởi số này."
          >
            <input
              type="number"
              min={0}
              max={500}
              value={draft.newPerDay}
              onChange={(e) => setDraft({ ...draft, newPerDay: Number(e.target.value) })}
              aria-label="New cards per day"
              className="h-9 w-24 rounded-xl border border-slate-200 bg-white px-3 text-right tabular-nums dark:border-slate-700 dark:bg-slate-900"
            />
          </SettingRow>
          <RetentionSetting value={draft.retention} onChange={(retention) => setDraft({ ...draft, retention })} />
        </SettingGroup>

        <SettingGroup title="Practice">
          <SettingRow
            stacked
            title="Review modes"
            tip={
              <>
                <ul className="list-disc space-y-0.5 pl-4">
                  {MODE_OPTIONS.map((m) => (
                    <li key={m.value}>
                      <strong>{m.label}:</strong> {m.hint}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5">
                  Bật nhiều chế độ thì mỗi thẻ được chọn ngẫu nhiên một. Khi Usage ladder bật, các chế độ này dùng cho bậc Nhận ra.
                </p>
              </>
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {MODE_OPTIONS.map((m) => (
                <Chip key={m.value} on={draft.modes.includes(m.value)} onClick={() => toggleMode(m.value)} title={m.hint}>
                  {m.label}
                </Chip>
              ))}
            </div>
          </SettingRow>
          <SettingRow
            title="Usage ladder"
            tip={
              <>
                <p>Mỗi thẻ leo 5 bậc, từ biết đến dùng được:</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                  <li>Nhận ra — thấy từ, nhớ nghĩa (hoặc nghe chép)</li>
                  <li>Nhớ ra từ — thấy nghĩa, gõ từ</li>
                  <li>Dùng đúng cụm — điền từ đi kèm của collocation</li>
                  <li>Viết lại câu — paraphrase một câu cho sẵn (Gemini chấm)</li>
                  <li>Tự dùng — tự viết câu IELTS (Gemini chấm)</li>
                </ol>
                <p className="mt-1.5">
                  Trả lời tốt lên một bậc, sai thì lùi lại. Từ ít dùng có thể bỏ tick “Usage ladder” ngay trên thẻ khi ôn để chỉ ôn ở mức Nhận ra. Tắt
                  ở đây = chỉ dùng các Review modes.
                </p>
              </>
            }
          >
            <Switch checked={draft.ladder} onChange={(ladder) => setDraft({ ...draft, ladder })} label="Usage ladder" />
          </SettingRow>
          <SettingRow
            title="Add new Admin entries automatically"
            tip="Từ và note mới tạo trong Admin tự vào phiên ôn hôm nay, kể cả khi đã vượt giới hạn thẻ mới mỗi ngày."
          >
            <Switch
              checked={draft.autoAddFromAdmin}
              onChange={(autoAddFromAdmin) => setDraft({ ...draft, autoAddFromAdmin })}
              label="Add new Admin entries automatically"
            />
          </SettingRow>
        </SettingGroup>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5 dark:border-slate-800">
        <Button onClick={save} loading={busy} disabled={!dirty && !busy}>
          Save settings
        </Button>
        {message ? <span className={cn('text-sm', message.ok ? 'text-emerald-600' : 'text-rose-600')}>{message.text}</span> : null}
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-400">
          Storage
          <InfoTip wide>
            Tiến độ lưu ở progress/review.json và progress/review-log.jsonl. Ngày học bắt đầu lúc {settings.dayStartHour}:00 ({settings.timeZone}).
          </InfoTip>
        </span>
      </div>
    </Card>
  )
}

export default function ReviewPage() {
  // Re-read the card index when content changes (new cards saved from this page).
  const [version, setVersion] = useState(0)
  useEffect(() => onDataInvalidated(() => startTransition(() => setVersion((v) => v + 1))), [])
  const index = useData<ReviewIndex>('review/index.json')
  const review = useReviewStore()
  const stats = useStats(version + Object.keys(review.cards).length + (review.today?.reviewed ?? 0))
  const [tab, setTab] = useQueryParam('tab')
  const [scheduleDay, setScheduleDay] = useQueryParam('day')
  const [wordsView, setWordsView] = useQueryParam('view')
  const navigate = useNavigate()

  const cardsById = useMemo(() => new Map(index.cards.map((c) => [c.id, c])), [index])
  const known = useMemo(() => new Set(cardsById.keys()), [cardsById])
  // Sources to review (remembered per browser); every number and session button below follows the choice.
  const [sources, setSources] = useLocalStorage<ReviewSource[]>(SOURCES_KEY, [])
  const scope = useMemo(() => sourceScope(cardsById, sources), [cardsById, sources])
  const inScope = useCallback((id: string) => known.has(id) && (!scope || scope.has(id)), [known, scope])
  const queue = useMemo(
    () => (review.settings ? buildQueue(review.cards, review.settings, review.today, known, { only: scope }) : null),
    [review, known, scope],
  )
  // Cards due + new today per source, as if only that source were chosen (the chips' counts).
  const perSource = useMemo(() => {
    if (!review.settings) return []
    return REVIEW_SOURCES.flatMap((s) => {
      const ids = sourceScope(cardsById, [s.value])
      if (!Object.keys(review.cards).some((id) => ids?.has(id))) return []
      const q = buildQueue(review.cards, review.settings!, review.today, known, { only: ids })
      return [{ ...s, count: q.order.length }]
    })
  }, [review, known, cardsById])
  // Learned cards that can practise their usage stage today ("Luyện dùng từ").
  const usageCount = useMemo(
    () => (review.settings ? usageCandidates(review.cards, cardsById, review.settings).filter((p) => !scope || scope.has(p.id)).length : 0),
    [review, cardsById, scope],
  )
  // The cards you forget most that still exist (a deleted word's progress stays in the file).
  const forgotten = useMemo(
    () =>
      (stats?.hardest ?? []).flatMap((h) => {
        const card = cardsById.get(h.id)
        return card ? [{ ...h, card }] : []
      }).slice(0, 8),
    [stats, cardsById],
  )

  if (review.status === 'offline') {
    return (
      <>
        <PageHeader eyebrow="Spaced repetition" title="Review" />
        <EmptyState
          icon={<Brain className="size-8" />}
          title="Reviews need the local server"
          description="Progress is saved by the app's own server. Start it with npm run dev (or npm start) and reload."
        />
      </>
    )
  }

  const total = queue ? queue.order.length : 0
  const nextDue = Object.entries(review.cards)
    .filter(([id, c]) => c.fsrs.state !== 0 && !c.done && inScope(id))
    .map(([, c]) => Date.parse(c.fsrs.due))
    .filter((t) => t > Date.now())
    .sort((a, b) => a - b)[0]
  const inReview = Object.keys(review.cards).filter(inScope).length
  const toggleSource = (value: ReviewSource) => setSources(sources.includes(value) ? sources.filter((s) => s !== value) : [...sources, value])

  return (
    <div className="readable-xs">
      <PageHeader eyebrow="Spaced repetition · FSRS" title="Review" hideTitle className="pb-4" />

      <Tabs.Root
        value={tab || 'overview'}
        onValueChange={(v) => navigate({ search: v === 'overview' ? '' : `?tab=${v}` }, { replace: true, preventScrollReset: true })}
      >
        <Tabs.List aria-label="Review sections" className="mb-6 inline-flex flex-wrap rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
          <Tabs.Trigger value="overview" className={tabClass}>
            Overview
          </Tabs.Trigger>
          <Tabs.Trigger value="recent" className={tabClass}>
            Recent work
          </Tabs.Trigger>
          <Tabs.Trigger value="words" className={tabClass}>
            Words
          </Tabs.Trigger>
          <Tabs.Trigger value="decks" className={tabClass}>
            Decks
          </Tabs.Trigger>
          <Tabs.Trigger value="mine" className={tabClass}>
            My cards
          </Tabs.Trigger>
          <Tabs.Trigger value="settings" className={tabClass}>
            Settings
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview" className="animate-fade-in space-y-6 outline-none">
          <Card className="relative overflow-hidden p-4 sm:p-7">
            <HeroBackdrop />
            <div className="relative flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold tracking-[0.14em] text-brand-600 uppercase dark:text-brand-400">
                  Today{sources.length ? ` · ${sourcesLabel(sources)}` : ''}
                </p>
                <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-balance text-slate-900 sm:text-3xl dark:text-white">
                  {total ? `${total} cards are waiting for you` : inReview ? 'All caught up for now 🎉' : 'Pick a deck to start'}
                </h2>
                <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-slate-500 dark:text-slate-400">
                  {!total && inReview && nextDue ? `Next card in ${formatInterval(nextDue - Date.now())} · ` : ''}
                  {inReview ? 'Due cards first, then today’s new ones — the session stops when your time is up.' : 'Add decks to start.'}
                  {inReview ? (
                    <InfoTip>
                      Tổng số thẻ bạn đã thêm vào Review, kể cả thẻ đã đánh dấu “done”. “New waiting” = thẻ mới vượt hạn mức hôm nay, sẽ được giới thiệu
                      những ngày sau (hoặc bấm Learn more new).
                    </InfoTip>
                  ) : null}
                </p>
                {perSource.length > 1 ? (
                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                      Sources
                      <InfoTip>
                        Chọn nguồn muốn ôn (chọn được nhiều): mỗi nguồn ôn một kiểu riêng, tách ra cho đỡ rối. Số trên mỗi nút = thẻ đến hạn + thẻ mới
                        hôm nay của nguồn đó. Start review, Practice again và Luyện dùng từ đều chỉ dùng các nguồn đã chọn. Lựa chọn được nhớ cho lần
                        sau.
                      </InfoTip>
                    </span>
                    <PillChoice on={!sources.length} onClick={() => setSources([])}>
                      All
                    </PillChoice>
                    {perSource.map((s) => (
                      <PillChoice key={s.value} on={sources.includes(s.value)} onClick={() => toggleSource(s.value)}>
                        {s.label} <span className="font-medium opacity-60 tabular-nums">{s.count}</span>
                      </PillChoice>
                    ))}
                  </div>
                ) : null}
              </div>
              <StudyCardsArt className="hidden w-36 shrink-0 sm:block lg:w-44" />
            </div>

            <div className="relative mt-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
              <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                <InfoStat
                  tint="sky"
                  icon={<CalendarClock className="size-5" />}
                  value={queue ? queue.counts.due + queue.counts.learning : '—'}
                  label="due"
                  spark={stats?.forecast.slice(1).map((f) => f.count)}
                  chip="next 2 weeks"
                  tip={
                    <InfoTip>
                      Số thẻ đến hạn <strong>ngay lúc này</strong> (kể cả thẻ đang học dở). Đường nhỏ trong ô: số thẻ đến hạn mỗi ngày trong 14 ngày tới.
                    </InfoTip>
                  }
                />
                <InfoStat
                  tint="violet"
                  icon={<Sparkles className="size-5" />}
                  value={queue ? queue.counts.newToday : '—'}
                  label="new"
                  chip={`/${review.settings?.newPerDay ?? 20} a day`}
                  tip={
                    <InfoTip>
                      Số thẻ mới (chưa học lần nào) còn được giới thiệu hôm nay — tối đa {review.settings?.newPerDay ?? 20} thẻ/ngày (đổi trong Settings). 0 =
                      đã học đủ thẻ mới hôm nay hoặc không còn thẻ mới.
                    </InfoTip>
                  }
                />
                <InfoStat
                  tint="emerald"
                  icon={<Layers className="size-5" />}
                  value={inReview}
                  label="in reviews"
                  chip={queue && queue.counts.newAvailable > queue.counts.newToday ? `${queue.counts.newAvailable - queue.counts.newToday} waiting` : undefined}
                />
              </div>

              <div className="flex flex-col gap-3">
                {total ? (
                  <StartSessionButton to={withSources('/review/session', sources)} className={primaryActionClass}>
                    <PrimaryActionBody
                      icon={<Play className="size-5 fill-current" />}
                      title="Start review"
                      hint={queue ? `${queue.counts.due + queue.counts.learning} due · ${queue.counts.newToday} new — due cards first` : undefined}
                    />
                  </StartSessionButton>
                ) : !inReview ? (
                  <Button className={primaryActionClass} onClick={() => setTab('decks')}>
                    <PrimaryActionBody icon={<Layers className="size-5" />} title="Choose decks" hint="Vocabulary, collocations, notes, your own cards" />
                  </Button>
                ) : null}
                {inReview ? (
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2.5">
                    {/* Only once today's new cards are all learned: then it adds 10 more beyond the daily limit. */}
                    {queue && queue.counts.newToday === 0 && queue.counts.newAvailable > 0 ? (
                      <StartSessionButton
                        to={withSources(`/review/session?extraNew=${Math.min(10, queue.counts.newAvailable - queue.counts.newToday)}`, sources)}
                        variant="outline"
                        className={actionTileClass('sky')}
                      >
                        <ActionTileBody tint="sky"
                          icon={<Plus className="size-4" />}
                          title={`Learn ${Math.min(10, queue.counts.newAvailable - queue.counts.newToday)} more`}
                          hint="new cards beyond today's limit"
                        />
                      </StartSessionButton>
                    ) : null}
                    <StartSessionButton
                      to={withSources('/review/session?practice=1', sources)}
                      heading="Practise again for how long?"
                      variant="outline"
                      className={actionTileClass('violet')}
                      title="Go through studied cards again; your schedule is not changed"
                    >
                      <ActionTileBody tint="violet" icon={<Repeat className="size-4" />} title="Practice again" hint="studied cards, schedule unchanged" />
                    </StartSessionButton>
                    {usageCount ? (
                      <StartSessionButton
                        to={withSources('/review/usage', sources)}
                        heading="Usage practice"
                        variant="outline"
                        className={actionTileClass('amber')}
                        title="Practise using learned words (collocation, rewrite, own sentence); your schedule is not changed"
                        counts={{ label: 'Cards', values: USAGE_COUNTS, initial: DEFAULT_USAGE_COUNT, storageKey: USAGE_COUNT_KEY, param: 'count' }}
                      >
                        <ActionTileBody tint="amber" icon={<PenLine className="size-4" />} title={`Usage practice · ${usageCount}`} hint="collocation, rewrite, own sentence" />
                      </StartSessionButton>
                    ) : null}
                    <Button variant="outline" className={actionTileClass('emerald')} onClick={() => setTab('decks')}>
                      <ActionTileBody tint="emerald" icon={<Layers className="size-4" />} title="Add more cards" hint="browse the decks" />
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </Card>

          <button
            type="button"
            onClick={() => setTab('recent')}
            className="group flex w-full items-center gap-4 rounded-2xl border border-slate-200/90 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-[2px] hover:border-amber-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-amber-700"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
              <BookOpenCheck className="size-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-slate-900 dark:text-white">Review words from your recent Speaking & Writing</span>
              <span className="block text-sm text-slate-500 dark:text-slate-400">
                Only the phrases from the work you just did — same cards, same progress as the rest of Review.
              </span>
            </span>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 transition-transform group-hover:translate-x-0.5 dark:bg-amber-500/15 dark:text-amber-300">
              <ArrowRight className="size-4" />
            </span>
          </button>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              icon={<Flame className="size-4" />}
              label="Streak"
              value={stats ? `${stats.streak.current}d` : '—'}
              detail={stats ? `Best ${stats.streak.best} days` : undefined}
              delta={
                !stats
                  ? undefined
                  : stats.streak.current > 0 && stats.today.reviewed === 0
                    ? { text: 'study today to keep it', tone: 'down' }
                    : stats.streak.current > 1 && stats.streak.current >= stats.streak.best
                      ? { text: 'record', tone: 'up' }
                      : undefined
              }
              tip={`Số ngày học liên tiếp tính tới hôm nay (ngày học bắt đầu lúc ${review.settings?.dayStartHour ?? 4}:00). Chuỗi vẫn giữ nếu hôm nay bạn học trước khi hết ngày. Best = chuỗi dài nhất từng đạt.`}
            />
            <StatTile
              icon={<CalendarCheck className="size-4" />}
              label="Reviewed today"
              value={stats?.today.reviewed ?? '—'}
              to={stats?.today.reviewed ? '/review?tab=words&when=today&by=reviewed' : undefined}
              detail={stats ? `${stats.today.newStudied} new · ${stats.today.minutes} min · yesterday ${stats.yesterday.reviewed}` : undefined}
              delta={stats ? compare(stats.today.reviewed - stats.yesterday.reviewed, 'vs yesterday') : undefined}
              tip="Số lượt chấm thẻ hôm nay (một thẻ quên rồi ôn lại được tính nhiều lượt). “new” = lượt học thẻ mới; phút = thời gian trên thẻ, mỗi thẻ tối đa 5 phút. Mũi tên: hơn / kém hôm qua bao nhiêu lượt. Bấm ô để xem các từ đã ôn."
            />
            <StatTile
              icon={<Target className="size-4" />}
              label="Retention (30 days)"
              value={stats?.retention30 != null ? `${Math.round(stats.retention30 * 100)}%` : '—'}
              detail={
                stats?.retentionPrev30 != null ? `Previous 30 days: ${Math.round(stats.retentionPrev30 * 100)}%` : 'Mature cards remembered'
              }
              delta={
                stats?.retention30 != null && stats.retentionPrev30 != null
                  ? compare(Math.round((stats.retention30 - stats.retentionPrev30) * 100), 'pts')
                  : undefined
              }
              tip={`Trong 30 ngày qua, khi ôn thẻ đã ở trạng thái Review, bạn nhớ bao nhiêu % lần (bấm Hard/Good/Easy; Again = quên); mũi tên so với 30 ngày trước đó. Mục tiêu trong Settings: ${Math.round((review.settings?.retention ?? 0.9) * 100)}% — thấp hơn nhiều thì nên ôn đều hơn hoặc học ít thẻ mới hơn.`}
            />
            <StatTile
              icon={<Timer className="size-4" />}
              label="Total reviews"
              value={stats?.totalReviews ?? '—'}
              detail={stats ? `${stats.byState.review} cards mature` : undefined}
              delta={stats?.today.reviewed ? { text: `+${stats.today.reviewed} today`, tone: 'up' } : undefined}
              tip="Tổng số lượt chấm thẻ từ trước tới nay. “Cards mature” = số thẻ đã qua giai đoạn học ban đầu và đang được ôn giãn cách (trạng thái Review)."
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Card className="min-w-0 p-4 sm:p-5">
              <SectionTitle>
                Study days
                <InfoTip>
                  Mỗi ô là một ngày học. Màu càng đậm = hôm đó ôn càng nhiều lượt; ô có viền là hôm nay. Khi bạn mới học vài tuần, lưới chỉ hiện vài tháng
                  gần nhất (đủ một năm thì hiện cả năm). Học đều mỗi ngày quan trọng hơn học dồn một ngày.
                </InfoTip>
              </SectionTitle>
              {stats ? <StudyHeatmap heatmap={stats.heatmap} today={stats.today.day} /> : <div className="h-28" />}
            </Card>
            <Card className="p-4 sm:p-5">
              <SectionTitle>
                Due · next 2 weeks
                <InfoTip>
                  Số lớn: thẻ đến hạn hôm nay, gồm thẻ quá hạn và cả thẻ đến hạn muộn hơn trong hôm nay (tới {review.settings?.dayStartHour ?? 4}:00 sáng
                  mai), nên có thể lớn hơn số “due” ngay lúc này. Cột: 13 ngày tới, theo thang riêng để thấy ngày nào nhiều. Bấm số hoặc một cột để xem
                  các từ của ngày đó.
                </InfoTip>
              </SectionTitle>
              {stats ? (
                <ForecastChart
                  forecast={stats.forecast}
                  onSelectDay={(day) => navigate({ search: `?tab=words&view=schedule&day=${day}` }, { replace: true, preventScrollReset: false })}
                />
              ) : (
                <div className="h-28" />
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-4 sm:p-5">
              <SectionTitle>
                Cards by state
                <InfoTip>
                  <strong>New</strong>: đã thêm, chưa học · <strong>Learning</strong>: đang ở các bước học đầu (gặp lại sau vài phút) ·{' '}
                  <strong>Review</strong>: đã thuộc bước đầu, ôn giãn cách dần · <strong>Relearning</strong>: thẻ đã thuộc nhưng bạn bấm Again, đang
                  học lại. “Marked done” = đánh dấu đã thuộc hẳn, không còn lên lịch.
                </InfoTip>
              </SectionTitle>
              {stats ? <StateBar byState={stats.byState} newPerDay={review.settings?.newPerDay} /> : null}
              {stats?.done ? (
                <button type="button" onClick={() => setTab('words')} className="mt-2 text-xs text-slate-500 hover:text-brand-600">
                  + {stats.done} marked done (not scheduled)
                </button>
              ) : null}
            </Card>
            <Card className="p-4 sm:p-5">
              <SectionTitle>
                Usage ladder
                <InfoTip>
                  Các thẻ đã học đang ở bậc nào: biết từ (Nhận ra, Nhớ ra từ) hay đã dùng được (Dùng đúng cụm, Viết lại câu, Tự dùng). Thẻ lên bậc khi bạn
                  trả lời đúng ở phiên ôn, ở Luyện dùng từ, hoặc khi bạn tự dùng đúng cụm trong bài Writing / Speaking.
                </InfoTip>
              </SectionTitle>
              {stats ? <LadderBar ladder={stats.ladder} labels={STAGE_LABEL_EN} /> : null}
            </Card>
          </div>

          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <SectionTitle>
                Most forgotten
                <InfoTip>
                  Những thẻ bạn quên nhiều nhất: số lần bấm Again khi thẻ đã ở trạng thái Review. Bấm “Ôn các thẻ hay quên” để ôn riêng chúng (lịch ôn
                  không đổi), hoặc bấm từ để mở mục đầy đủ.
                </InfoTip>
              </SectionTitle>
              {forgotten.length ? (
                <StartSessionButton
                  to={`/review/session?practice=1&ids=${encodeURIComponent(forgotten.map((f) => f.id).join(','))}`}
                  heading="Review your most forgotten cards for how long?"
                  variant="outline"
                  size="sm"
                  className="border-rose-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  title="Ôn riêng các thẻ hay quên; lịch ôn không đổi"
                >
                  <RotateCcw className="size-4" /> Review most forgotten ({forgotten.length})
                </StartSessionButton>
              ) : null}
            </div>
            {forgotten.length ? (
              <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                {forgotten.map(({ id, lapses, card }) => (
                  <li key={id} className="flex min-w-0 items-center gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0 dark:border-slate-800">
                    <span className="min-w-0 flex-1">
                      {card.href ? (
                        <Link to={card.href} className="font-semibold text-slate-800 hover:text-brand-600 dark:text-slate-100">
                          {card.term}
                        </Link>
                      ) : (
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{card.term}</span>
                      )}
                      {card.meaning_vi ? (
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                          {card.meaning_vi
                            .split('\n')[0]
                            .replace(/^\d+[.)]\s*/, '')
                            .replace(/\*\*/g, '')}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 tabular-nums dark:bg-rose-950/50 dark:text-rose-300">
                      forgotten {lapses}×
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">Nothing yet — cards you forget show up here.</p>
            )}
          </Card>
        </Tabs.Content>

        <Tabs.Content value="recent" className="animate-fade-in outline-none">
          <RecentWorkTab index={index} />
        </Tabs.Content>

        <Tabs.Content value="words" className="animate-fade-in outline-none">
          <SegmentedControl
            value={wordsView === 'schedule' ? 'schedule' : 'list'}
            onChange={(v) => setWordsView(v === 'list' ? '' : v)}
            options={[
              { value: 'list', label: 'Word list', icon: <ListChecks className="size-4" /> },
              { value: 'schedule', label: 'Schedule', icon: <CalendarDays className="size-4" /> },
            ]}
            className="mb-4"
          />
          <Card className="p-4 sm:p-5">
            {wordsView === 'schedule' ? (
              <DaySchedule cardsById={cardsById} day={scheduleDay} onDayChange={setScheduleDay} />
            ) : (
              <WordsManager cardsById={cardsById} />
            )}
          </Card>
        </Tabs.Content>

        <Tabs.Content value="decks" className="animate-fade-in outline-none">
          <Card className="p-4 sm:p-5">
            <DeckBrowser decks={index.decks} cardsById={cardsById} />
          </Card>
        </Tabs.Content>

        <Tabs.Content value="mine" className="animate-fade-in outline-none">
          <MyCards decks={index.decks} cardsById={cardsById} />
        </Tabs.Content>

        <Tabs.Content value="settings" className="animate-fade-in outline-none">
          {review.settings ? <SettingsPanel key={JSON.stringify(review.settings)} settings={review.settings} /> : null}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
