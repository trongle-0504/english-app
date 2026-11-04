// /review/usage — "Luyện dùng từ": learned cards practise the usage stages (fill in the collocation, rewrite a sentence,
// write your own) without waiting for their next review. Only the stage moves; the FSRS schedule is untouched.
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Coffee, Minus, PartyPopper, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { ButtonLink, Button, Card, EmptyState, Progress } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useData } from '@/lib/data'
import { useLocalStorage } from '@/lib/storage'
import type { ReviewIndex } from '@/types/content'
import type { ProduceVerdict, UsageStage } from '@/types/review'
import { AnswerView, SourceTag } from './CardView'
import { InfoTip } from './InfoTip'
import { STAGE_LABEL, STAGES, usageStageOf } from './ladder'
import { LadderToggle } from './LadderToggle'
import { pickMode } from './queue'
import { SessionTimer, useStudyTime } from './SessionTimer'
import { intersect, recentDaysParam, useRecentScope } from './recent-scope'
import { parseSources, sourceScope } from './sources'
import { TIME_LIMIT_KEY } from './StartSessionButton'
import { practiseUsage, useReviewStore } from './store'
import { CollocateExercise, CollocateResult, ProduceRound, type ProduceGrade, type ProduceRoundItem } from './UsageExercises'
import { DEFAULT_USAGE_COUNT, usageCandidates, usagePlan, USAGE_COUNTS, type UsagePick } from './usagePlan'
import { cardCollocateTasks, collocateRating, recentTopics, rememberTopics, writingTask, type CollocateAnswer } from './usageTasks'

type Rating = 1 | 2 | 3 | 4

/** Sentences checked together (one Gemini call). */
const ROUND_SIZE = 3

type Step = { kind: 'collocate'; pick: UsagePick } | { kind: 'write'; picks: UsagePick[] }

function buildSteps(plan: UsagePick[]): Step[] {
  const steps: Step[] = plan.filter((p) => p.mode === 'collocate').map((pick) => ({ kind: 'collocate', pick }))
  const writing = plan.filter((p) => p.mode !== 'collocate')
  for (let i = 0; i < writing.length; i += ROUND_SIZE) steps.push({ kind: 'write', picks: writing.slice(i, i + ROUND_SIZE) })
  return steps
}

interface Outcome {
  id: string
  term: string
  from: UsageStage
  to: UsageStage
  verdict?: ProduceVerdict
}

const GRADES: { rating: Rating; label: string; className: string }[] = [
  {
    rating: 1,
    label: 'Again',
    className: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
  },
  {
    rating: 2,
    label: 'Hard',
    className: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  },
  {
    rating: 3,
    label: 'Good',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  {
    rating: 4,
    label: 'Easy',
    className: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  },
]

/** One "Dùng đúng cụm" card: fill in, see the answer, confirm the suggested grade. */
function CollocateStep({
  pick,
  busy,
  onGrade,
  onAnswered,
}: {
  pick: UsagePick
  busy: boolean
  onGrade: (r: Rating) => void
  onAnswered: () => void
}) {
  const [task] = useState(() => pickMode(cardCollocateTasks(pick.card).slice(0, 3)))
  const [answer, setAnswer] = useState<CollocateAnswer | null>(null)
  const suggested = answer ? collocateRating(answer) : null

  useEffect(() => {
    if (!answer) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (['1', '2', '3', '4'].includes(e.key)) onGrade(Number(e.key) as Rating)
      else if ((e.key === 'Enter' || e.key === ' ') && suggested) {
        e.preventDefault()
        onGrade(suggested)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answer, suggested, onGrade])

  return (
    <>
      <Card className="animate-slide-up overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <SourceTag card={pick.card} />
          <span className="inline-flex items-center gap-3 text-[13px] font-semibold text-slate-500">
            <LadderToggle id={pick.id} className="text-[13px]" />
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 whitespace-nowrap text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
              3/5 · {STAGE_LABEL.collocate}
            </span>
          </span>
        </div>
        {answer ? (
          <div className="space-y-5 px-5 py-6 sm:px-8">
            <CollocateResult task={task} answer={answer} />
            <AnswerView card={pick.card} />
          </div>
        ) : (
          <div className="flex min-h-[16rem] flex-col items-center justify-center px-5 py-8 sm:px-10">
            <CollocateExercise
              task={task}
              onSubmit={(a) => {
                setAnswer(a)
                onAnswered()
              }}
            />
          </div>
        )}
      </Card>
      {answer ? (
        <div className="animate-slide-up sticky bottom-3 mt-4 rounded-2xl bg-slate-50/90 p-2 backdrop-blur dark:bg-slate-950/90">
          <p className="mb-2 px-1 text-xs font-semibold text-slate-500">Good/Easy lên bậc, Hard giữ nguyên, Again lùi bậc — lịch ôn không đổi.</p>
          <div className="grid grid-cols-4 gap-2">
            {GRADES.map((g) => (
              <button
                key={g.rating}
                type="button"
                disabled={busy}
                onClick={() => onGrade(g.rating)}
                className={cn(
                  'rounded-xl border px-2 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50',
                  g.className,
                  suggested === g.rating && 'ring-2 ring-current ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-950',
                )}
              >
                {g.label} <kbd className="ml-1 font-sans text-[11px] opacity-60">{g.rating}</kbd>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}

/** A round of "Viết lại câu" / "Tự dùng" sentences, checked together. */
function WriteStep({
  picks,
  saving,
  onStart,
  onChecked,
  onDone,
}: {
  picks: UsagePick[]
  saving: boolean
  onStart: () => void
  onChecked: (tokens: number) => void
  onDone: (grades: ProduceGrade[], items: ProduceRoundItem[]) => void
}) {
  const [items] = useState<ProduceRoundItem[]>(() => {
    const recent = recentTopics()
    return picks.map((p) => {
      const task = writingTask(p.card, p.mode === 'collocate' ? null : p.mode, recent, pickMode)
      if (task.topic) recent.unshift(task.topic)
      return { id: p.id, card: p.card, task }
    })
  })
  return <ProduceRound items={items} practice={false} saving={saving} onStart={onStart} onChecked={onChecked} onDone={(g) => onDone(g, items)} />
}

function Summary({ outcomes, minutes, tokens, left }: { outcomes: Outcome[]; minutes: number; tokens: number; left: number }) {
  const up = outcomes.filter((o) => STAGES.indexOf(o.to) > STAGES.indexOf(o.from))
  const down = outcomes.filter((o) => STAGES.indexOf(o.to) < STAGES.indexOf(o.from))
  const errors = new Map<string, number>()
  const ERROR_LABEL: Partial<Record<ProduceVerdict, string>> = {
    wrong_collocation: 'Sai cụm từ',
    wrong_form: 'Sai dạng từ',
    wrong_meaning: 'Sai nghĩa',
    missing: 'Chưa dùng từ',
    changed_meaning: 'Đổi nghĩa câu gốc',
  }
  for (const o of outcomes) {
    const label = o.verdict && ERROR_LABEL[o.verdict]
    if (label) errors.set(label, (errors.get(label) ?? 0) + 1)
  }
  return (
    <div className="animate-fade-in mx-auto max-w-lg pt-12 text-center">
      <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300">
        {left ? <Coffee className="size-8" /> : <PartyPopper className="size-8" />}
      </div>
      <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">{left ? 'Hết giờ — nghỉ một chút nhé!' : 'Xong phiên luyện dùng từ'}</h1>
      <p className="mt-2 text-slate-500 dark:text-slate-400">
        {outcomes.length} thẻ trong {Math.max(1, minutes)} phút{tokens ? ` · Gemini ${tokens.toLocaleString()} tokens` : ''}. Lịch ôn không thay đổi.
      </p>
      <div className="mt-6 grid grid-cols-3 gap-2 text-left">
        {[
          { icon: <ArrowUpRight className="size-4" />, label: 'Lên bậc', n: up.length, tone: 'text-emerald-600' },
          { icon: <Minus className="size-4" />, label: 'Giữ nguyên', n: outcomes.length - up.length - down.length, tone: 'text-slate-500' },
          { icon: <ArrowDownRight className="size-4" />, label: 'Lùi bậc', n: down.length, tone: 'text-rose-600' },
        ].map((t) => (
          <Card key={t.label} className="p-3">
            <p className={cn('flex items-center gap-1 text-xs font-semibold', t.tone)}>
              {t.icon}
              {t.label}
            </p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900 tabular-nums dark:text-white">{t.n}</p>
          </Card>
        ))}
      </div>
      {up.length ? (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Lên bậc: {up.map((o) => `${o.term} (→ ${STAGE_LABEL[o.to]})`).join(' · ')}</p>
      ) : null}
      {errors.size ? (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Lỗi gặp: {[...errors].map(([label, n]) => `${label} ×${n}`).join(' · ')}</p>
      ) : null}
      {left ? <p className="mt-2 text-xs text-slate-400">Còn {left} thẻ chưa làm — chúng vẫn chờ ở lần luyện sau.</p> : null}
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <ButtonLink to="/review">Back to dashboard</ButtonLink>
      </div>
    </div>
  )
}

function UsageSession() {
  const index = useData<ReviewIndex>('review/index.json')
  const review = useReviewStore()
  const [params] = useSearchParams()
  const count = USAGE_COUNTS.includes(Number(params.get('count'))) ? Number(params.get('count')) : DEFAULT_USAGE_COUNT
  const byId = useMemo(() => new Map(index.cards.map((c) => [c.id, c])), [index])
  // ?recent=N: only the phrases of your Speaking / Writing of the last N days.
  const recentDays = recentDaysParam(params.get('recent'))
  const recent = useRecentScope(recentDays)
  const scope = useMemo(() => intersect(sourceScope(byId, parseSources(params.get('src'))), recent.ids ?? undefined), [byId, params, recent.ids])

  // The plan is fixed when the session starts (the store keeps changing as stages move).
  const [steps, setSteps] = useState<Step[] | null>(null)
  if (!steps && review.status === 'ready' && review.settings && recent.ids !== null)
    setSteps(
      buildSteps(
        usagePlan(
          usageCandidates(review.cards, byId, review.settings).filter((p) => !scope || scope.has(p.id)),
          count,
        ),
      ),
    )

  const [position, setPosition] = useState(0)
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [tokens, setTokens] = useState(0)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saved = useRef(new Set<string>())
  const [startedAt] = useState(() => Date.now())

  const step = steps?.[position]
  const [limitMin, setLimitMin] = useLocalStorage<number>(TIME_LIMIT_KEY, 0)
  const [extraMin, setExtraMin] = useState(0)
  const budgetMs = limitMin > 0 ? (limitMin + extraMin) * 60_000 : 0
  const elapsed = useStudyTime({ idle: !step, holding: open || busy, budgetMs })
  const timeUp = limitMin > 0 && elapsed >= budgetMs && !open && !busy

  /** Saves the answers of the step on screen (skipping any already saved after an error), then moves on. */
  const finish = async (answers: { pick: UsagePick; mode: UsagePick['mode']; rating: Rating; verdict?: ProduceVerdict }[]) => {
    setBusy(true)
    setError(null)
    try {
      for (const a of answers) {
        if (saved.current.has(a.pick.id)) continue
        const stored = review.cards[a.pick.id]
        const from = stored ? usageStageOf(stored) : 'collocate'
        const card = await practiseUsage(a.pick.id, a.mode, a.rating, a.verdict)
        saved.current.add(a.pick.id)
        setOutcomes((o) => [...o, { id: a.pick.id, term: a.pick.card.term, from, to: card.stage ?? from, verdict: a.verdict }])
      }
      setOpen(false)
      setPosition((p) => p + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (review.status === 'offline') {
    return (
      <div className="pt-10">
        <EmptyState title="Reviews need the local server" description="Start the app with npm run dev (or npm start) so progress can be saved." />
      </div>
    )
  }
  if (!steps) return <div className="pt-24 text-center text-sm text-slate-400">Preparing your session…</div>

  const totalCards = steps.reduce((n, s) => n + (s.kind === 'write' ? s.picks.length : 1), 0)
  const cardsLeft = steps.slice(position).reduce((n, s) => n + (s.kind === 'write' ? s.picks.length : 1), 0)

  if (!totalCards) {
    return (
      <div className="pt-10">
        <EmptyState
          title="Chưa có thẻ để luyện dùng từ"
          description="Phiên này dùng các thẻ đã thuộc (trạng thái Review), đang bật Usage ladder và chưa luyện hôm nay. Ôn thêm ở Start review, hoặc quay lại ngày mai."
          action={<ButtonLink to="/review">Back to dashboard</ButtonLink>}
        />
      </div>
    )
  }
  if (!step || timeUp) {
    if (timeUp && step) {
      // Time is up between two steps: offer five more minutes before closing.
      return (
        <div className="mx-auto max-w-lg pt-12 text-center">
          <Summary outcomes={outcomes} minutes={Math.round(elapsed / 60000)} tokens={tokens} left={cardsLeft} />
          <Button variant="outline" className="mt-2" onClick={() => setExtraMin((m) => m + 5)}>
            <Plus className="size-4" /> Học thêm 5 phút
          </Button>
        </div>
      )
    }
    return <Summary outcomes={outcomes} minutes={Math.round((Date.now() - startedAt) / 60000)} tokens={tokens} left={step ? cardsLeft : 0} />
  }

  return (
    <div className="mx-auto max-w-3xl pt-6">
      <title>{`Luyện dùng từ (${cardsLeft}) · NeuralSymbolic`}</title>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          to={recentDays ? '/review?tab=recent' : '/review'}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft className="size-4" /> Review
        </Link>
        {recentDays ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            Bài gần đây · {recentDays} ngày
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          Luyện dùng từ · lịch ôn không đổi
          <InfoTip>
            Thẻ đã thuộc luyện các bậc dùng từ (Dùng đúng cụm → Viết lại câu → Tự dùng) mà không phải chờ tới lần ôn sau. Chỉ bậc thay đổi; ngày đến
            hạn và thống kê ôn giữ nguyên. Mỗi thẻ luyện tối đa 1 lần mỗi ngày.
          </InfoTip>
        </span>
        <div className="flex items-center gap-3 text-sm">
          <SessionTimer limitMin={limitMin} onLimit={setLimitMin} elapsed={elapsed} budgetMs={budgetMs} />
          <span className="font-semibold text-slate-600 tabular-nums dark:text-slate-300">{cardsLeft} left</span>
        </div>
      </div>
      <Progress value={((totalCards - cardsLeft) / totalCards) * 100} className="mb-6" />

      {step.kind === 'collocate' ? (
        <CollocateStep
          key={step.pick.id}
          pick={step.pick}
          busy={busy}
          onAnswered={() => setOpen(true)}
          onGrade={(rating) => void finish([{ pick: step.pick, mode: 'collocate', rating }])}
        />
      ) : (
        <WriteStep
          key={step.picks.map((p) => p.id).join()}
          picks={step.picks}
          saving={busy}
          onStart={() => setOpen(true)}
          onChecked={(n) => setTokens((t) => t + n)}
          onDone={(grades, items) => {
            rememberTopics(items.map((it) => it.task.topic).filter(Boolean))
            void finish(
              grades.map((g) => ({ pick: step.picks.find((p) => p.id === g.id) as UsagePick, mode: g.mode, rating: g.rating, verdict: g.verdict })),
            )
          }}
        />
      )}
      {error ? (
        <p className="mt-3 flex items-center justify-center gap-2 text-sm text-rose-600">
          {error}
          <button type="button" onClick={() => setError(null)} className="underline">
            <RotateCcw className="inline size-3.5" /> dismiss
          </button>
        </p>
      ) : null}
    </div>
  )
}

/** Remount per query (?count) so each link starts a fresh session. */
export default function UsageSessionPage() {
  const { search } = useLocation()
  return <UsageSession key={search} />
}
