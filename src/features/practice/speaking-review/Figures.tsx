// The fluency figures of a Speaking review, grouped by the IELTS criterion they bear on. Each one has a verdict in words
// ("A bit slow", "Good length") and a scale: red / amber / green zones with a marker at your value and the target, so it
// is plain whether it is fine yet.
import {
  Check,
  ChevronDown,
  Clock,
  Gauge,
  Info,
  PauseCircle,
  Repeat,
  ScrollText,
  Shapes,
  Target,
  TextQuote,
  TriangleAlert,
  AudioLines,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ANSWER_WORDS } from '@/types/speaking'
import { TALK_CRITERIA, TALK_TARGET, type TalkCriterionId, type TalkFluency, type TalkPart } from '@/types/speakingReview'

type Level = 'good' | 'ok' | 'work'

/** A zone of a scale: up to `upTo`, this level and verdict. */
interface Zone {
  upTo: number
  level: Level
  verdict: string
}

interface Metric {
  icon: LucideIcon
  label: string
  value: string
  unit?: string
  detail?: string
  /** No scale: shown as information only (free talk has no target length). */
  scale?: { min: number; max: number; at: number; zones: Zone[]; target: string; ends: [string, string] }
  /** Vietnamese: what it measures and what is natural. */
  hint: string
}

const LEVEL: Record<Level, { pill: string; zone: string; marker: string; icon: LucideIcon }> = {
  good: {
    pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900',
    zone: 'bg-emerald-200 dark:bg-emerald-900/70',
    marker: 'border-emerald-600 bg-emerald-500',
    icon: Check,
  },
  ok: {
    pill: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900',
    zone: 'bg-amber-200 dark:bg-amber-900/60',
    marker: 'border-amber-600 bg-amber-400',
    icon: TriangleAlert,
  },
  work: {
    pill: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900',
    zone: 'bg-rose-200 dark:bg-rose-900/60',
    marker: 'border-rose-600 bg-rose-500',
    icon: TriangleAlert,
  },
}

const zoneOf = (scale: NonNullable<Metric['scale']>) => scale.zones.find((z) => scale.at <= z.upTo) ?? scale.zones[scale.zones.length - 1]

const perMinute = (n: number, f: TalkFluency) => (f.speech > 0 ? (n / f.speech) * 60 : 0)
const seconds = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`)
const one = (n: number) => (Math.round(n * 10) / 10).toString()

/** Short / good / long against a target range. */
const lengthZones = (min: number, max: number): Zone[] => [
  { upTo: min * 0.75, level: 'work', verdict: 'Too short' },
  { upTo: min, level: 'ok', verdict: 'A bit short' },
  { upTo: max, level: 'good', verdict: 'Good length' },
  { upTo: max * 1.3, level: 'ok', verdict: 'A bit long' },
  { upTo: Infinity, level: 'work', verdict: 'Too long' },
]

function metricsOf(f: TalkFluency, part: TalkPart): Record<TalkCriterionId, Metric[]> {
  const target = TALK_TARGET[part]
  const words = part === 'free' ? null : ANSWER_WORDS[part]
  // Reviews since mid-sentence pauses were measured count only those (hesitations); older ones, every pause ≥ 1 s.
  const hesitating = f.hesitations !== undefined
  const pauseCount = hesitating ? (f.hesitations ?? 0) : f.pauses
  const pausesPm = perMinute(pauseCount, f)
  const fillersPm = perMinute(f.fillerCount, f)
  const repeatsPm = perMinute(f.repeats, f)
  const unclear = f.words ? (f.unclear / f.words) * 100 : 0
  return {
    fc: [
      {
        icon: Clock,
        label: 'Speaking time',
        value: seconds(f.speech),
        detail: `recording ${seconds(f.duration)}`,
        scale: target
          ? { min: 0, max: target.max * 1.5, at: f.speech, zones: lengthZones(target.min, target.max), target: target.label, ends: ['Short', 'Long'] }
          : undefined,
        hint: target
          ? `Thời gian từ từ đầu tiên đến từ cuối cùng. Phần này nên nói khoảng ${target.label}: ngắn quá thì ý chưa được phát triển, dài quá thì giám khảo sẽ ngắt lời.`
          : 'Thời gian từ từ đầu tiên đến từ cuối cùng (nói tự do: không có độ dài mục tiêu).',
      },
      {
        icon: TextQuote,
        label: 'Words',
        value: String(f.words),
        detail: `${f.sentences} sentences`,
        scale: words
          ? {
              min: 0,
              max: words.max * 1.5,
              at: f.words,
              zones: lengthZones(words.min, words.max),
              target: `${words.min}–${words.max} words`,
              ends: ['Short', 'Long'],
            }
          : undefined,
        hint: 'Số từ bạn nói (không tính um/uh). Part 1 thường 45–75 từ, Part 2 khoảng 220–320 từ, Part 3 khoảng 60–100 từ.',
      },
      {
        icon: Gauge,
        label: 'Speed',
        value: String(f.wpm),
        unit: 'wpm',
        detail: 'words per minute',
        scale: {
          min: 60,
          max: 220,
          at: f.wpm,
          zones: [
            { upTo: 90, level: 'work', verdict: 'Too slow' },
            { upTo: 110, level: 'ok', verdict: 'A bit slow' },
            { upTo: 170, level: 'good', verdict: 'Natural pace' },
            { upTo: 195, level: 'ok', verdict: 'A bit fast' },
            { upTo: Infinity, level: 'work', verdict: 'Too fast' },
          ],
          target: '110–170 wpm',
          ends: ['Slow', 'Fast'],
        },
        hint: 'Số từ mỗi phút (tính cả quãng ngừng). Người bản xứ nói chuyện thường 120–160 từ/phút; chậm quá nghe ngập ngừng, nhanh quá dễ nuốt âm và khó nghe.',
      },
      {
        icon: PauseCircle,
        label: hesitating ? 'Pauses mid-sentence' : 'Pauses ≥ 1 s',
        value: String(pauseCount),
        detail: pauseCount
          ? `${one(pausesPm)}/min · longest ${hesitating ? f.longestHesitation : f.longestPause}s${hesitating ? ` · ${f.sentencePauses ?? 0} between sentences (fine)` : ''}`
          : hesitating
            ? `none · ${f.sentencePauses ?? 0} between sentences (fine)`
            : 'none',
        scale: {
          min: 0,
          max: 10,
          at: pausesPm,
          zones: [
            { upTo: 3, level: 'good', verdict: 'Few pauses' },
            { upTo: 6, level: 'ok', verdict: 'Some hesitation' },
            { upTo: Infinity, level: 'work', verdict: 'Frequent pauses' },
          ],
          target: '≤ 3 per minute',
          ends: ['Few', 'Many'],
        },
        hint: hesitating
          ? 'Những chỗ im lặng từ 0,8 giây trở lên GIỮA câu (tính trên mỗi phút) — dấu hiệu ngập ngừng tìm từ, làm giảm điểm Fluency. Ngừng giữa hai câu là tự nhiên nên không tính. Quãng ngừng được đánh dấu ⏸ trong “As heard” (vàng/đỏ: giữa câu, xám: giữa hai câu).'
          : 'Những chỗ im lặng từ 1 giây trở lên giữa hai từ (tính trên mỗi phút). Ngừng ở cuối ý là tự nhiên; ngừng giữa câu để tìm từ làm giảm điểm Fluency. Quãng ngừng được đánh dấu ⏸ trong phần What you said.',
      },
      {
        icon: AudioLines,
        label: 'Fillers',
        value: String(f.fillerCount),
        detail: f.fillers.length ? f.fillers.map((x) => `${x.word} ×${x.count}`).join(', ') : 'none heard',
        scale: {
          min: 0,
          max: 8,
          at: fillersPm,
          zones: [
            { upTo: 2, level: 'good', verdict: 'Natural' },
            { upTo: 5, level: 'ok', verdict: 'Noticeable' },
            { upTo: Infinity, level: 'work', verdict: 'Too many' },
          ],
          target: '≤ 2 per minute',
          ends: ['Few', 'Many'],
        },
        hint: 'Từ đệm: um, uh, er, “you know”, “I mean”, “like”. Một vài từ đệm là bình thường; nhiều quá nghe như đang bí ý. Máy nhận dạng đôi khi bỏ qua um/uh nên con số có thể thấp hơn thực tế.',
      },
      {
        icon: Repeat,
        label: 'Repeats',
        value: String(f.repeats),
        detail: 'a word said twice in a row',
        scale: {
          min: 0,
          max: 5,
          at: repeatsPm,
          zones: [
            { upTo: 1, level: 'good', verdict: 'Smooth' },
            { upTo: 3, level: 'ok', verdict: 'Some self-correction' },
            { upTo: Infinity, level: 'work', verdict: 'Frequent restarts' },
          ],
          target: '≤ 1 per minute',
          ends: ['Few', 'Many'],
        },
        hint: 'Số lần lặp lại một từ liền nhau (“I I think”, “the the”) — dấu hiệu tự sửa hoặc ngập ngừng.',
      },
    ],
    lr: [
      {
        icon: Shapes,
        label: 'Word variety',
        value: `${Math.round(f.variety * 100)}`,
        unit: '%',
        detail: 'different words',
        scale: {
          min: 40,
          max: 100,
          at: f.variety * 100,
          zones: [
            { upTo: 55, level: 'work', verdict: 'Repetitive' },
            { upTo: 65, level: 'ok', verdict: 'Some repetition' },
            { upTo: Infinity, level: 'good', verdict: 'Varied' },
          ],
          target: '≥ 65%',
          ends: ['Repetitive', 'Varied'],
        },
        hint: 'Tỉ lệ từ khác nhau trên tổng số từ (tính trên từng đoạn 50 từ). Càng cao càng ít lặp từ — một dấu hiệu của Lexical Resource. Câu trả lời rất ngắn thường có tỉ lệ cao.',
      },
    ],
    gra: [
      {
        icon: ScrollText,
        label: 'Sentence length',
        value: one(f.avgSentenceWords),
        unit: 'words',
        detail: 'per sentence on average',
        scale: {
          min: 0,
          max: 35,
          at: f.avgSentenceWords,
          zones: [
            { upTo: 7, level: 'work', verdict: 'Very short sentences' },
            { upTo: 10, level: 'ok', verdict: 'Short sentences' },
            { upTo: 22, level: 'good', verdict: 'Good mix' },
            { upTo: 28, level: 'ok', verdict: 'Long sentences' },
            { upTo: Infinity, level: 'work', verdict: 'Run-on sentences' },
          ],
          target: '10–22 words',
          ends: ['Short', 'Long'],
        },
        hint: 'Số từ trung bình mỗi câu. Câu quá ngắn thường là câu đơn; band 6.5+ cần câu ghép, câu phức. Câu quá dài (trên ~25 từ) thường là nhiều ý nối liền bằng “and”, thiếu cấu trúc rõ ràng.',
      },
    ],
    pron: [
      {
        icon: Target,
        label: 'Unclear words',
        value: String(f.unclear),
        detail: `${Math.round(unclear)}% of words`,
        scale: {
          min: 0,
          max: 20,
          at: unclear,
          zones: [
            { upTo: 4, level: 'good', verdict: 'Clear' },
            { upTo: 10, level: 'ok', verdict: 'Some unclear words' },
            { upTo: Infinity, level: 'work', verdict: 'Often unclear' },
          ],
          target: '≤ 4% of words',
          ends: ['Clear', 'Unclear'],
        },
        hint: 'Từ mà máy nhận dạng không chắc chắn — thường do phát âm chưa rõ (âm cuối, trọng âm) hoặc nói quá nhanh. Chỉ là ước lượng, không thay được giám khảo. Các từ này được gạch chân chấm trong What you said.',
      },
    ],
  }
}

function Scale({ scale }: { scale: NonNullable<Metric['scale']> }) {
  const span = scale.max - scale.min
  const pos = (v: number) => Math.min(100, Math.max(0, ((Math.min(v, scale.max) - scale.min) / span) * 100))
  const level = zoneOf(scale).level
  // Each zone's share of the bar: from the previous zone's end to its own.
  const ends = scale.zones.map((z) => pos(z.upTo))
  const startOf = (i: number) => (i ? Math.max(...ends.slice(0, i)) : 0)
  // The target (green) zone, marked under the bar: centred on it, or held at its outer edge near an end of the bar.
  const good = scale.zones.findIndex((z) => z.level === 'good')
  const from = startOf(good)
  const to = ends[good]
  const mid = (from + to) / 2
  const targetStyle =
    mid < 30
      ? { left: `${from}%` }
      : mid > 70
        ? { left: `${to}%`, transform: 'translateX(-100%)' }
        : { left: `${mid}%`, transform: 'translateX(-50%)' }
  // Same width at both ends on every row, so the bars line up.
  const end = 'shrink-0 text-[10px] font-semibold tracking-wide text-slate-400 uppercase sm:w-[4.75rem]'
  return (
    <div className="mb-5 flex items-center gap-3 pt-1">
      <span className={cn(end, 'sm:text-right')}>{scale.ends[0]}</span>
      <div className="relative h-2.5 flex-1">
        <div className="absolute inset-0 flex overflow-hidden rounded-full">
          {scale.zones.map((z, i) => {
            const width = Math.max(0, ends[i] - startOf(i))
            return width > 0 ? <span key={i} className={cn('h-full', LEVEL[z.level].zone)} style={{ width: `${width}%` }} /> : null
          })}
        </div>
        {good >= 0 ? (
          <>
            <span
              className="absolute -top-1 -bottom-1 rounded-sm border-x-2 border-emerald-500/70 dark:border-emerald-400/70"
              style={{ left: `${from}%`, width: `${to - from}%` }}
              aria-hidden
            />
            <span
              className="absolute top-[calc(100%+5px)] text-[11px] font-semibold whitespace-nowrap text-emerald-700 dark:text-emerald-400"
              style={targetStyle}
            >
              ✓ Target {scale.target}
            </span>
          </>
        ) : null}
        <span
          className={cn(
            'absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-md ring-2 ring-white dark:ring-slate-900',
            LEVEL[level].marker,
          )}
          style={{ left: `${pos(scale.at)}%` }}
          aria-hidden
        />
      </div>
      <span className={end}>{scale.ends[1]}</span>
    </div>
  )
}

/** One figure as a row: what it is, your value, where it sits on the scale, the verdict. */
function MetricRow({ metric, criterion }: { metric: Metric; criterion?: TalkCriterionId }) {
  const Icon = metric.icon
  const zone = metric.scale ? zoneOf(metric.scale) : null
  const Mark = zone ? LEVEL[zone.level].icon : null
  return (
    <li
      title={metric.hint}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5 lg:grid-cols-[11rem_8.5rem_minmax(0,1fr)_9.5rem]"
    >
      <span className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate">{metric.label}</span>
          {criterion ? (
            <span
              title={TALK_CRITERIA.find((c) => c.id === criterion)!.label}
              className={cn(
                'mt-0.5 inline-block rounded px-1 text-[9px] leading-4 font-extrabold tracking-wide text-white',
                CRITERION_TONE[criterion],
              )}
            >
              {TALK_CRITERIA.find((c) => c.id === criterion)!.short}
            </span>
          ) : null}
        </span>
      </span>
      <span className="justify-self-end lg:order-last">
        {zone && Mark ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ring-1',
              LEVEL[zone.level].pill,
            )}
          >
            <Mark className="size-3.5" /> {zone.verdict}
          </span>
        ) : null}
      </span>
      <span className="col-span-2 min-w-0 lg:col-span-1">
        <span className="flex items-baseline gap-1">
          <span className="text-2xl leading-none font-extrabold text-slate-900 tabular-nums dark:text-white">{metric.value}</span>
          {metric.unit ? <span className="text-sm font-semibold text-slate-500">{metric.unit}</span> : null}
        </span>
        {metric.detail ? <span className="mt-1 block text-xs leading-snug text-slate-500 dark:text-slate-400">{metric.detail}</span> : null}
      </span>
      <span className="col-span-2 min-w-0 lg:col-span-1">
        {metric.scale ? <Scale scale={metric.scale} /> : <span className="text-xs text-slate-400">No target for free talk</span>}
      </span>
    </li>
  )
}

const CRITERION_TONE: Record<TalkCriterionId, string> = {
  fc: 'bg-brand-600 dark:bg-brand-500',
  lr: 'bg-violet-600 dark:bg-violet-500',
  gra: 'bg-teal-600 dark:bg-teal-500',
  pron: 'bg-orange-500 dark:bg-orange-500',
}

/** A criterion's heading and its figures. */
function Group({ id, metrics }: { id: TalkCriterionId; metrics: Metric[] }) {
  const criterion = TALK_CRITERIA.find((c) => c.id === id)!
  const levels = metrics.flatMap((m) => (m.scale ? [zoneOf(m.scale).level] : []))
  const good = levels.filter((l) => l === 'good').length
  return (
    <section>
      <h3 className="flex flex-wrap items-center justify-between gap-2 border-y border-slate-100 bg-slate-50/80 px-4 py-2 sm:px-5 dark:border-slate-800 dark:bg-slate-900/60">
        <span className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-extrabold tracking-wide text-white', CRITERION_TONE[id])}>
            {criterion.short}
          </span>
          {criterion.label}
        </span>
        {levels.length ? (
          <span className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span className="flex gap-1">
              {levels.map((l, i) => (
                <span key={i} className={cn('size-2 rounded-full', LEVEL[l].marker.split(' ')[1])} />
              ))}
            </span>
            {good}/{levels.length} on target
          </span>
        ) : null}
      </h3>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {metrics.map((m) => (
          <MetricRow key={m.label} metric={m} />
        ))}
      </ul>
    </section>
  )
}

/** Which figures matter most when they are off: what an examiner hears first. */
const PRIORITY = [
  'Speed',
  'Pauses mid-sentence',
  'Pauses ≥ 1 s',
  'Unclear words',
  'Speaking time',
  'Sentence length',
  'Fillers',
  'Word variety',
  'Words',
  'Repeats',
]
const LEVEL_RANK: Record<Level, number> = { work: 0, ok: 1, good: 2 }
const SHOWN = 3

/** The figures to show first: furthest from the target, then the most important. */
function firstOf(metrics: Record<TalkCriterionId, Metric[]>) {
  return (Object.entries(metrics) as [TalkCriterionId, Metric[]][])
    .flatMap(([criterion, list]) => list.map((metric) => ({ criterion, metric })))
    .sort(
      (a, b) =>
        (a.metric.scale ? LEVEL_RANK[zoneOf(a.metric.scale).level] : 3) - (b.metric.scale ? LEVEL_RANK[zoneOf(b.metric.scale).level] : 3) ||
        PRIORITY.indexOf(a.metric.label) - PRIORITY.indexOf(b.metric.label),
    )
}

export function FluencyFigures({ fluency, part }: { fluency: TalkFluency; part: TalkPart }) {
  const [open, setOpen] = useState(false)
  const metrics = metricsOf(fluency, part)
  const ranked = firstOf(metrics)
  const scaled = ranked.filter((r) => r.metric.scale)
  const onTarget = scaled.filter((r) => zoneOf(r.metric.scale!).level === 'good').length
  const top = ranked.slice(0, SHOWN)
  const allGood = top.every((r) => r.metric.scale && zoneOf(r.metric.scale).level === 'good')
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="font-bold text-slate-900 dark:text-white">Speaking figures</h2>
          {!open ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {allGood ? 'All on target — the most important ones:' : `The ${SHOWN} that need the most attention`} · {onTarget}/{scaled.length} on
              target
            </p>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-emerald-500" /> On target
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-amber-400" /> Close
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-rose-500" /> Work on it
          </span>
          <span className="inline-flex items-center gap-1 text-slate-400" title="Đo từ bản ghi âm của bạn · rê chuột vào từng dòng để xem giải thích">
            <Info className="size-3.5" /> Hover a row for details
          </span>
        </p>
      </div>
      {open ? (
        (['fc', 'lr', 'gra', 'pron'] as const).map((id) => <Group key={id} id={id} metrics={metrics[id]} />)
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
          {top.map(({ criterion, metric }) => (
            <MetricRow key={metric.label} metric={metric} criterion={criterion} />
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/40 dark:text-brand-300 dark:hover:bg-slate-800/60"
      >
        {open ? 'Show less' : `Show all ${ranked.length} figures by criterion`}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
    </Card>
  )
}
