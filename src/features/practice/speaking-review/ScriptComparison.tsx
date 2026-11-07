// Your script against what you said, idea by idea: the three match criteria (Idea, Details, Wording) over the whole
// script and for each point, and the phrases that differ — what you said well, what to upgrade or fix, what you left
// out — in a few words each. The AI groups the script into points (the whole answer when it is short) and grades them;
// reviews made before that show code's pairing by shared words, one script sentence per point.
import { ArrowRight, ArrowUpRight, Check, ChevronDown, CircleDashed, ListChecks, Loader2, X, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge, Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { SCRIPT_CRITERIA, type ScriptCriterion, type ScriptDiffKind, type TalkReviewResult, type TalkScriptPoint } from '@/types/speakingReview'
import { checkScript, wordCheck } from './scriptCheck'

const CRITERION_COLOR: Record<ScriptCriterion, { fill: string; track: string; text: string }> = {
  idea: { fill: 'bg-brand-500', track: 'bg-brand-100 dark:bg-brand-950/70', text: 'text-brand-600 dark:text-brand-400' },
  details: { fill: 'bg-violet-500', track: 'bg-violet-100 dark:bg-violet-950/70', text: 'text-violet-600 dark:text-violet-400' },
  wording: { fill: 'bg-teal-500', track: 'bg-teal-100 dark:bg-teal-950/70', text: 'text-teal-600 dark:text-teal-400' },
}

const matchTone = (n: number) =>
  n >= 80 ? 'text-emerald-600 dark:text-emerald-400' : n >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'

const DIFF: Record<ScriptDiffKind, { label: string; icon: LucideIcon; pill: string }> = {
  good: {
    label: 'Good',
    icon: Check,
    pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900',
  },
  weaker: {
    label: 'Upgrade',
    icon: ArrowUpRight,
    pill: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900',
  },
  wrong: { label: 'Fix', icon: X, pill: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900' },
  missing: {
    label: 'Missing',
    icon: CircleDashed,
    pill: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  },
}

/** One criterion as its own meter: name, weight, score and bar. */
function Meter({ id, value, size = 'sm' }: { id: ScriptCriterion; value: number; size?: 'sm' | 'lg' }) {
  const k = SCRIPT_CRITERIA.find((c) => c.id === id)!
  return (
    <div title={k.hint} className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
          <span className={cn('size-2 shrink-0 rounded-full', CRITERION_COLOR[id].fill)} />
          <span className="truncate">{k.label}</span>
          <span className="font-semibold text-slate-400">{k.weight * 100}%</span>
        </span>
        <span className={cn('font-extrabold tabular-nums', size === 'lg' ? 'text-2xl' : 'text-sm', CRITERION_COLOR[id].text)}>{value}</span>
      </div>
      <div className={cn('mt-1.5 overflow-hidden rounded-full', size === 'lg' ? 'h-2.5' : 'h-1.5', CRITERION_COLOR[id].track)}>
        <div className={cn('h-full rounded-full transition-[width] duration-700', CRITERION_COLOR[id].fill)} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

/** A difference in a few words: your phrase → the script's, with a short note. */
function Diff({ kind, script, said, note }: TalkScriptPoint['diffs'][number]) {
  const d = DIFF[kind]
  const Icon = d.icon
  return (
    <li className="flex flex-col gap-1 py-1.5 sm:flex-row sm:items-start sm:gap-2.5">
      <span
        className={cn(
          'inline-flex w-fit shrink-0 sm:mt-0.5 sm:w-[5.5rem] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1',
          d.pill,
        )}
      >
        <Icon className="size-3" /> {d.label}
      </span>
      <span className="min-w-0 text-sm leading-relaxed">
        {kind === 'missing' ? (
          <span className="font-semibold text-slate-800 dark:text-slate-100">“{script}”</span>
        ) : kind === 'good' ? (
          <span className="font-semibold text-emerald-700 dark:text-emerald-300">“{said || script}”</span>
        ) : (
          <>
            <span className={cn('font-semibold', kind === 'wrong' ? 'text-rose-600 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300')}>
              “{said}”
            </span>
            {script ? (
              <>
                <ArrowRight className="mx-1 inline size-3.5 text-slate-400" />
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">“{script}”</span>
              </>
            ) : null}
          </>
        )}
        {note ? <span className="text-slate-500 dark:text-slate-400"> — {note}</span> : null}
      </span>
    </li>
  )
}

/** Same length as the text, so a match's place is the same in both: case and curly quotes do not matter. */
const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')

/**
 * What you said with the differences marked in place: a phrase to upgrade or fix struck through and the script's
 * wording right after it; a good phrase underlined. A phrase not found word for word in your text is left unmarked
 * (it is still listed above).
 */
function MarkedSaid({ said, diffs }: { said: string; diffs: TalkScriptPoint['diffs'] }) {
  const text = fold(said)
  const marks: { start: number; end: number; kind: ScriptDiffKind; script: string }[] = []
  for (const d of diffs) {
    const phrase = fold(d.said)
      .replace(/[\s.,!?;:]+$/, '')
      .trim()
    if (d.kind === 'missing' || phrase.length < 2) continue
    const start = text.indexOf(phrase)
    const end = start + phrase.length
    // The first place it is said, and not over another mark.
    if (start < 0 || marks.some((m) => start < m.end && end > m.start)) continue
    marks.push({ start, end, kind: d.kind, script: d.script })
  }
  marks.sort((a, b) => a.start - b.start)
  const parts: ReactNode[] = []
  let at = 0
  marks.forEach((m, i) => {
    if (m.start > at) parts.push(said.slice(at, m.start))
    const phrase = said.slice(m.start, m.end)
    if (m.kind === 'good')
      parts.push(
        <span
          key={i}
          title="Good"
          className="font-medium text-emerald-700 underline decoration-emerald-400 decoration-2 underline-offset-4 dark:text-emerald-300"
        >
          {phrase}
        </span>,
      )
    else
      parts.push(
        <span key={i}>
          <del
            className={cn(
              'decoration-2',
              m.kind === 'wrong' ? 'text-rose-600 decoration-rose-400 dark:text-rose-300' : 'text-amber-700 decoration-amber-400 dark:text-amber-300',
            )}
          >
            {phrase}
          </del>
          {m.script ? (
            <ins className="ml-1 rounded bg-emerald-50 px-1 font-semibold text-emerald-700 no-underline dark:bg-emerald-950/50 dark:text-emerald-300">
              {m.script}
            </ins>
          ) : null}
        </span>,
      )
    at = m.end
  })
  if (at < said.length) parts.push(said.slice(at))
  return <>{parts}</>
}

function PointCard({ point, index }: { point: TalkScriptPoint; index: number }) {
  const [open, setOpen] = useState(false)
  const check = wordCheck(point.script, point.said)
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-2 sm:p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-900 dark:text-white">{point.title}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {point.heard.length ? `Your sentence${point.heard.length > 1 ? 's' : ''} ${point.heard.map((n) => n + 1).join(', ')}` : 'Not said'}
            {point.byCode ? <span className="text-amber-600 dark:text-amber-400"> · matched by words only</span> : null}
          </p>
        </div>
        <span className={cn('text-2xl leading-none font-extrabold tabular-nums', matchTone(point.match))}>
          {point.match}
          <span className="text-xs font-bold">%</span>
        </span>
      </div>

      <div className="mt-3.5 grid gap-2.5 sm:grid-cols-3 sm:gap-5">
        {SCRIPT_CRITERIA.map((k) => (
          <Meter key={k.id} id={k.id} value={point.scores[k.id]} />
        ))}
      </div>

      {point.diffs.length ? (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
          {point.diffs.map((d, i) => (
            <Diff key={i} {...d} />
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-brand-700 dark:text-slate-400 dark:hover:text-brand-300"
      >
        {open ? 'Hide the text' : 'Show the script and what you said'}
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 text-sm leading-relaxed dark:bg-slate-950/60">
          <p>
            <span className="font-semibold text-slate-500">Script: </span>
            {check.words.map((w, j) =>
              w.missing ? (
                <mark key={j} className="rounded bg-amber-100 px-0.5 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">
                  {w.text}
                </mark>
              ) : (
                <span key={j}>{w.text}</span>
              ),
            )}
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-500">You said: </span>
            {point.said ? <MarkedSaid said={point.said} diffs={point.diffs} /> : <span className="text-rose-600 dark:text-rose-400">—</span>}
          </p>
          <p className="border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <mark className="rounded bg-amber-100 px-0.5 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">Highlighted</mark> = a word of the
            script not found in what you said (matched word by word, not by meaning): a word you said differently, left out, or the recognizer
            misheard. The differences above are judged on meaning.
          </p>
        </div>
      ) : null}
    </li>
  )
}

/**
 * The whole script at a glance, set apart from the white point cards below by a soft brand tint and border: the
 * overall match as a ring, and each criterion as its own meter.
 */
function Summary({ match, points, overall }: { match: number; points: number; overall: Record<ScriptCriterion, number> }) {
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const ring = match >= 80 ? 'stroke-emerald-500' : match >= 50 ? 'stroke-amber-500' : 'stroke-rose-500'
  return (
    <div className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-50 via-white to-violet-50 p-4 shadow-sm ring-1 ring-brand-200/80 sm:p-6 dark:from-brand-950/50 dark:via-slate-900 dark:to-violet-950/30 dark:ring-brand-800/60">
      <div
        className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-brand-200/40 blur-3xl dark:bg-brand-500/10"
        aria-hidden
      />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
        <div className="flex items-center gap-4 sm:w-44 sm:shrink-0 sm:flex-col sm:items-start sm:gap-2">
          <div className="relative size-20 shrink-0 rounded-full bg-white shadow-sm dark:bg-slate-900">
            <svg viewBox="0 0 80 80" className="size-full -rotate-90" aria-hidden>
              <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="7" className="stroke-slate-100 dark:stroke-slate-800" />
              <circle
                cx="40"
                cy="40"
                r={radius}
                fill="none"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - match / 100)}
                className={cn('transition-[stroke-dashoffset] duration-1000', ring)}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xl font-extrabold text-slate-900 tabular-nums dark:text-white">
              {match}
              <span className="text-xs font-bold text-slate-400">%</span>
            </span>
          </div>
          <div>
            <p className="font-bold text-slate-900 dark:text-white">Script match</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {points} {points === 1 ? 'point' : 'points'} · graded on meaning
            </p>
          </div>
        </div>
        <div className="grid flex-1 gap-4 sm:grid-cols-3 sm:gap-5 sm:border-l sm:border-brand-200/70 sm:pl-7 dark:sm:border-brand-800/60">
          {SCRIPT_CRITERIA.map((k) => (
            <div key={k.id} title={k.hint}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                  <span className={cn('size-2 rounded-full', CRITERION_COLOR[k.id].fill)} />
                  {k.label}
                  <span className="font-semibold text-slate-400">{k.weight * 100}%</span>
                </span>
                <span className={cn('text-2xl font-extrabold tabular-nums', CRITERION_COLOR[k.id].text)}>{overall[k.id]}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-200/70 dark:bg-slate-800 dark:ring-slate-700">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-700', CRITERION_COLOR[k.id].fill)}
                  style={{ width: `${overall[k.id]}%` }}
                />
              </div>
              <p className="mt-2 text-xs leading-snug text-slate-500 dark:text-slate-400">{k.hint}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ScriptComparison({ result }: { result: TalkReviewResult }) {
  // Open at first; the header folds it away (the match stays in the header).
  const [open, setOpen] = useState(true)
  if (!result.script) return null
  if (result.pending?.includes('comparison')) {
    return (
      <Card className="flex items-center gap-3 px-5 py-4 sm:px-6">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
          <Loader2 className="size-4.5 animate-spin" />
        </span>
        <div>
          <p className="font-bold text-slate-900 dark:text-white">Script vs what you said</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Đang so bài nói với script…</p>
        </div>
      </Card>
    )
  }
  const c = result.comparison
  const graded = Boolean(c?.points?.length)
  // Reviews made before the AI graded the script: code's pairing, one script sentence per point.
  const points: TalkScriptPoint[] = graded
    ? c!.points!
    : checkScript(result.script, result.sentences).lines.map((l, i) => {
        const v = Math.round(l.share * 100)
        return {
          title: `Sentence ${i + 1}`,
          from: i,
          to: i,
          script: l.sentence,
          heard: l.heard,
          said: l.said,
          scores: { idea: v, details: v, wording: v },
          match: v,
          diffs: [],
          byCode: true,
        }
      })
  const match = graded ? (c?.match ?? 0) : Math.round(points.reduce((s, p) => s + p.match, 0) / Math.max(1, points.length))
  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left sm:px-6"
      >
        <span className="flex flex-wrap items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
            <ListChecks className="size-4.5" />
          </span>
          Script vs what you said
          <Badge tone={match >= 80 ? 'emerald' : match >= 50 ? 'sky' : 'amber'}>{match}% match</Badge>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          {open ? 'Hide' : 'Show'}
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {open ? (
        <div className="border-t border-slate-100 px-5 pt-5 pb-5 sm:px-6 sm:pb-6 dark:border-slate-800">
          {graded && c?.overall ? (
            <Summary match={match} points={points.length} overall={c.overall} />
          ) : (
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              This review was made before AI grading: each sentence is matched by the share of its words you said.
            </p>
          )}

          <ol className="space-y-3">
            {points.map((p, i) => (
              <PointCard key={i} point={p} index={i} />
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  )
}
