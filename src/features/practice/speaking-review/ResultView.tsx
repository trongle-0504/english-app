// A Speaking review: the estimated band and the four IELTS criteria, the fluency figures (each against what is natural),
// your words as heard (with the recording), the corrections, your script against what you said,
// and the model answer Speaking ideas wrote from your ideas.
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ExternalLink,
  Info,
  ListChecks,
  Loader2,
  MessageSquareQuote,
  RotateCcw,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Badge, Button, Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { SpeakingJob } from '@/types/speaking'
import { TALK_CRITERIA, talkPartLabel, type TalkReviewResult } from '@/types/speakingReview'
import { speakingApi } from '../speaking-ideas/api'
import { Segments } from '../speaking-ideas/SuggestionResult'
import { audioUrl, talkApi } from './api'
import { useTalkAudio } from './audio'
import { FluencyFigures } from './Figures'
import { Pronunciation } from './Pronunciation'
import { ScriptComparison } from './ScriptComparison'
import { Transcript } from './Transcript'

/* ───────────── Bands ───────────── */

const bandTone = (band: number) =>
  band >= 7
    ? 'text-emerald-600 dark:text-emerald-400'
    : band >= 6
      ? 'text-brand-600 dark:text-brand-400'
      : band >= 5
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400'

function BandRing({ band }: { band: number }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative size-32 shrink-0">
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
          strokeDashoffset={circumference * (1 - band / 9)}
          className={cn('transition-[stroke-dashoffset] duration-1000 ease-out', bandTone(band))}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] font-bold tracking-wide text-slate-500 uppercase">Band</span>
        <span className="text-4xl leading-none font-extrabold text-slate-900 tabular-nums dark:text-white">{band.toFixed(1)}</span>
      </span>
    </div>
  )
}

/* ───────────── Sections ───────────── */

function Section({
  icon: Icon,
  title,
  aside,
  children,
  className,
}: {
  icon: LucideIcon
  title: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('p-4 sm:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
            <Icon className="size-4.5" />
          </span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </Card>
  )
}

function Criteria({ result }: { result: TalkReviewResult }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {TALK_CRITERIA.map((c) => {
        const r = result.criteria[c.id]
        return (
          <Card key={c.id} className="p-4 sm:p-5">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-wide text-slate-400 uppercase">{c.short}</p>
                <h3 className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                  {c.label}
                  <span title={c.hint} className="text-slate-400">
                    <Info className="size-3.5" />
                  </span>
                </h3>
              </div>
              <span className={cn('text-3xl leading-none font-extrabold tabular-nums', bandTone(r.band))}>{r.band.toFixed(1)}</span>
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={cn('h-full rounded-full bg-current transition-[width] duration-700', bandTone(r.band))}
                style={{ width: `${(r.band / 9) * 100}%` }}
              />
            </div>
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{r.summary}</p>
            {r.good.length ? (
              <ul className="mt-3 space-y-1.5">
                {r.good.map((g, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> {g}
                  </li>
                ))}
              </ul>
            ) : null}
            {r.improve.length ? (
              <ul className="mt-2 space-y-1.5">
                {r.improve.map((g, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <ArrowRight className="mt-0.5 size-4 shrink-0 text-amber-500" /> {g}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        )
      })}
    </div>
  )
}

const FIX_TONE: Record<string, 'rose' | 'amber' | 'violet' | 'sky' | 'teal' | 'slate'> = {
  grammar: 'rose',
  spelling: 'rose',
  'word form': 'amber',
  collocation: 'violet',
  'word choice': 'sky',
  naturalness: 'teal',
}

function Corrections({ result }: { result: TalkReviewResult }) {
  if (!result.fixes.length && !result.warnings.length)
    return <p className="text-sm text-slate-600 dark:text-slate-400">Không có lỗi nào cần sửa trong những gì bạn nói.</p>
  return (
    <div className="space-y-3">
      {result.fixes.map((f) => (
        <div key={f.id} className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={FIX_TONE[f.type] ?? 'slate'}>{f.type}</Badge>
            <Badge tone={f.severity === 'improve' ? 'emerald' : 'rose'}>{f.severity === 'improve' ? 'upgrade' : 'error'}</Badge>
          </div>
          <p className="text-[15px]">
            <del className="text-rose-600 decoration-rose-400 dark:text-rose-300">{f.original}</del>
            <ArrowRight className="mx-1.5 inline size-3.5 text-slate-400" />
            <ins className="font-semibold text-emerald-700 no-underline dark:text-emerald-300">{f.replacement}</ins>
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{f.explanation}</p>
          {f.dictionary.length ? (
            <p className="mt-1 text-xs text-slate-400">
              {f.dictionary.join(' · ')}
              {f.sources?.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 hover:text-brand-600">
                  {s.name} <ExternalLink className="size-3" />
                </a>
              ))}
            </p>
          ) : null}
        </div>
      ))}
      {result.warnings.length ? (
        <div className="rounded-xl bg-amber-50/70 p-3.5 dark:bg-amber-950/30">
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4" /> To double-check
          </p>
          <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
            {result.warnings.map((w, i) => (
              <li key={i}>
                <span className="font-semibold">“{w.phrase}”</span>
                {w.suggestion ? <> → {w.suggestion}</> : null} — <span className="text-slate-500 dark:text-slate-400">{w.explanation}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function ModelAnswer({ result, onUpdate }: { result: TalkReviewResult; onUpdate: (r: TalkReviewResult) => void }) {
  const model = result.model
  const [job, setJob] = useState<SpeakingJob | null>(null)
  const [error, setError] = useState('')
  const [restarting, setRestarting] = useState(false)
  const jobId = model?.jobId

  useEffect(() => {
    if (!jobId) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const { job: next } = await speakingApi.get(jobId)
        if (!active) return
        setJob(next)
        if (next.status === 'running') timer = setTimeout(tick, 2500)
      } catch (err) {
        if (active) setError((err as Error).message)
      }
    }
    void tick()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [jobId])

  if (!model) return null
  const restart = async () => {
    setRestarting(true)
    setError('')
    try {
      onUpdate((await talkApi.restartModel(result.id)).result)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRestarting(false)
    }
  }
  const answer = job?.result?.answers[0]
  return (
    <Section
      icon={MessageSquareQuote}
      title="Model answer from your ideas"
      aside={
        jobId && job?.status === 'done' ? (
          <Link
            to={`/practice/speaking-ideas?id=${jobId}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
          >
            Open in Speaking ideas <ExternalLink className="size-3.5" />
          </Link>
        ) : null
      }
    >
      <div className="mb-4 rounded-xl bg-slate-50 p-3.5 text-sm dark:bg-slate-900/60">
        <p className="font-semibold text-slate-900 dark:text-white">{model.question}</p>
        <p className="mt-1 whitespace-pre-line text-slate-600 dark:text-slate-400">
          <span className="font-semibold text-slate-500">Your ideas, as understood: </span>
          {model.idea}
        </p>
      </div>
      {!jobId && !model.error && !error ? (
        // Not written yet: only when asked (Speaking ideas makes six AI calls).
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-5 text-center dark:border-slate-700">
          <Button onClick={() => void restart()} loading={restarting}>
            <Sparkles className="size-4" /> Write a model answer
          </Button>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Speaking ideas viết bài mẫu từ ý của bạn, dùng cụm từ trong thư viện — mất khoảng 1 phút.
          </p>
        </div>
      ) : model.error || error || job?.status === 'error' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span>{error || model.error || job?.error}</span>
          <Button size="sm" variant="outline" onClick={() => void restart()} loading={restarting}>
            <RotateCcw className="size-4" /> Try again
          </Button>
        </div>
      ) : !job || job.status === 'running' ? (
        <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <Loader2 className="size-4 animate-spin text-brand-600" /> Speaking ideas is writing a model answer from your ideas (usually about a
          minute)…
        </p>
      ) : answer ? (
        <div className="space-y-3 text-[16px] leading-relaxed text-slate-800 dark:text-slate-100">
          {answer.sentences?.length ? (
            <p>
              {answer.sentences.map((s, i) => (
                <span key={i}>
                  <Segments segments={s.segments} />{' '}
                </span>
              ))}
            </p>
          ) : (
            <p>
              <Segments segments={answer.answer} />
            </p>
          )}
          {answer.picks.length ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <BookOpenCheck className="mr-1 inline size-4 text-emerald-500" />
              From your library: {answer.picks.map((p) => p.term).join(' · ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </Section>
  )
}

/* ───────────── The page ───────────── */

export function ResultView({ result, onUpdate }: { result: TalkReviewResult; onUpdate: (r: TalkReviewResult) => void }) {
  // One recording for the player, the words "as heard" and the misheard phrases.
  const { audio, bind } = useTalkAudio()
  const audioSrc = result.audio ? audioUrl(result.id) : undefined
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:p-6">
          <BandRing band={result.overall} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{talkPartLabel(result.part)}</Badge>
              {result.topic ? <Badge tone="slate">{result.topic}</Badge> : null}
              <span className="text-xs text-slate-500">
                {new Date(result.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </div>
            <p className="text-lg leading-snug font-bold text-slate-900 dark:text-white">{result.question}</p>
            <div className="flex flex-wrap gap-2">
              {TALK_CRITERIA.map((c) => (
                <span
                  key={c.id}
                  title={c.label}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  {c.short}
                  <span className={cn('font-extrabold tabular-nums', bandTone(result.criteria[c.id].band))}>
                    {result.criteria[c.id].band.toFixed(1)}
                  </span>
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Estimated band — AI reads your transcript; Pronunciation is estimated from how clearly the recognizer heard you.
            </p>
          </div>
        </div>
      </Card>

      <FluencyFigures fluency={result.fluency} part={result.part} />

      <Criteria result={result} />

      {/* The recording on its own; then your words with the AI's corrections, the list explaining each change marked. */}
      <Transcript result={result} audioSrc={audioSrc} audio={audio} bind={bind}>
        <div className="mt-2 border-t border-slate-100 pt-5 dark:border-slate-800">
          <h3 className="mb-3 flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <ListChecks className="size-4.5 text-brand-600 dark:text-brand-400" /> Corrections
            <Badge tone="slate">{result.fixes.length}</Badge>
          </h3>
          <Corrections result={result} />
        </div>
      </Transcript>

      <Pronunciation result={result} audio={audioSrc ? audio : null} />

      <ScriptComparison result={result} />
      <ModelAnswer result={result} onUpdate={onUpdate} />
    </div>
  )
}
