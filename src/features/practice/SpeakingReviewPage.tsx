// Practice → Speaking review: pick an IELTS part (or free talk), add the question and — if you like — the script you plan
// to say, then answer out loud. The recording is turned into text on this machine, measured (speed, pauses, fillers…)
// and reviewed like an examiner: the four criteria with estimated bands, corrections, your script against what you said,
// or — with no script — a model answer that Speaking ideas writes from your own ideas, when you ask for it.
import {
  BookOpen,
  Check,
  ChevronRight,
  FileAudio,
  History,
  Loader2,
  Mic,
  Plus,
  RotateCcw,
  ScrollText,
  ServerOff,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Badge, Button, ButtonLink, Card, PageHeader, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useLocalStorage } from '@/lib/storage'
import { AskCoachButton } from '@/features/coach/AskCoachButton'
import { useQueryParam } from '@/lib/useQueryParam'
import type { SpeakingHistoryItem } from '@/types/speaking'
import {
  TALK_MAX_SECONDS,
  TALK_STEPS,
  TALK_TARGET,
  talkPartLabel,
  type TalkHistoryItem,
  type TalkPart,
  type TalkReviewJob,
} from '@/types/speakingReview'
import { speakingApi } from './speaking-ideas/api'
import { groupByTopic, normalize } from './speaking-ideas/topicGroups'
import { OfflineError, talkApi, type TalkStatus } from './speaking-review/api'
import { IdeasPicker } from './speaking-review/IdeasPicker'
import { LinkedQuestion } from './speaking-review/LinkedQuestion'
import { base64Of, useRecorder } from './speaking-review/recorder'
import { ResultView } from './speaking-review/ResultView'
import { useLinkedQuestion } from './speaking-review/useLinkedQuestion'

const POLL_MS = 1500
const SOURCES: { value: 'manual' | 'ideas'; label: string }[] = [
  { value: 'manual', label: 'New question' },
  { value: 'ideas', label: 'From Speaking ideas' },
]
const PARTS: { value: string; label: string }[] = [
  { value: '1', label: 'Part 1' },
  { value: '2', label: 'Part 2' },
  { value: '3', label: 'Part 3' },
  { value: 'free', label: 'Free talk' },
]
const QUESTION_PLACEHOLDER: Record<string, string> = {
  1: 'Do you enjoy cooking at home?',
  2: 'Describe a place you visited that you would like to go back to.\nYou should say:\nwhere it is\nwhen you went there\nwhat you did there\nand explain why you would like to go back.',
  3: 'Why do some people prefer to travel alone?',
  free: 'My weekend, a film I watched, my job… (optional)',
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const partOf = (value: string): TalkPart => (value === '1' ? 1 : value === '2' ? 2 : value === '3' ? 3 : 'free')

/** The time bar while recording: the target range shaded, the elapsed time filling it. */
function TimeBar({ elapsed, part }: { elapsed: number; part: TalkPart }) {
  const target = TALK_TARGET[part]
  const span = target ? target.max * 1.3 : TALK_MAX_SECONDS
  const at = (s: number) => `${Math.min(100, (s / span) * 100)}%`
  const inRange = target && elapsed >= target.min && elapsed <= target.max
  return (
    <div className="w-full max-w-md">
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {target ? (
          <div
            className="absolute inset-y-0 bg-emerald-200/80 dark:bg-emerald-900/60"
            style={{ left: at(target.min), width: `calc(${at(target.max)} - ${at(target.min)})` }}
          />
        ) : null}
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-200', inRange ? 'bg-emerald-500' : 'bg-brand-500')}
          style={{ width: at(elapsed) }}
        />
      </div>
      {target ? (
        <p className="mt-1.5 text-center text-xs text-slate-500 dark:text-slate-400">
          Target {target.label}
          {elapsed > target.max ? ' · time to wrap up' : inRange ? ' · good length' : ''}
        </p>
      ) : null}
    </div>
  )
}

function LevelMeter({ level }: { level: number }) {
  return (
    <div className="flex h-8 items-end gap-1" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => {
        const on = level * 12 > i
        return (
          <span
            key={i}
            className={cn('w-1.5 rounded-full transition-all duration-75', on ? 'bg-rose-500' : 'bg-slate-200 dark:bg-slate-700')}
            style={{ height: `${30 + Math.sin((i / 11) * Math.PI) * 70}%` }}
          />
        )
      })}
    </div>
  )
}

/** Part 2's minute of preparation. */
function PrepTimer() {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (left <= 0) return
    const timer = setTimeout(() => setLeft((l) => l - 1), 1000)
    return () => clearTimeout(timer)
  }, [left])
  return left > 0 ? (
    <button
      type="button"
      onClick={() => setLeft(0)}
      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-800 tabular-nums dark:bg-amber-950/40 dark:text-amber-300"
    >
      <Timer className="size-4" /> Preparing {clock(left)} · skip
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setLeft(60)}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      title="IELTS Part 2 cho 1 phút chuẩn bị trước khi nói"
    >
      <Timer className="size-4" /> 1-minute preparation
    </button>
  )
}

function Progress({ job }: { job: TalkReviewJob }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const current = TALK_STEPS.findIndex((s) => s.id === job.step)
  const elapsed = Math.max(0, Math.round((now - Date.parse(job.startedAt)) / 1000))
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
          <Loader2 className="size-5 animate-spin" />
        </span>
        <div className="flex-1">
          <h2 className="font-bold text-slate-900 dark:text-white">Reviewing your answer…</h2>
          <p className="text-xs text-slate-500">Usually 20–60 seconds. You can leave this page and come back.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-700 tabular-nums dark:bg-slate-800 dark:text-slate-200">
          {elapsed}s
        </span>
      </div>
      <ol className="grid gap-2 p-4 sm:p-5 sm:grid-cols-2">
        {TALK_STEPS.map((step, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'todo'
          return (
            <li
              key={step.id}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
                state === 'active' && 'bg-brand-50/70 font-semibold text-slate-900 dark:bg-brand-950/40 dark:text-white',
                state === 'done' && 'text-slate-700 dark:text-slate-200',
                state === 'todo' && 'text-slate-400',
              )}
            >
              {state === 'done' ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <Check className="size-3.5" />
                </span>
              ) : state === 'active' ? (
                <Loader2 className="size-5 animate-spin text-brand-600" />
              ) : (
                <span className="flex size-5 items-center justify-center rounded-full border border-slate-300 text-[11px] dark:border-slate-600">
                  {i + 1}
                </span>
              )}
              {step.label}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

function HistoryList({ items, onOpen, onDelete }: { items: TalkHistoryItem[]; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  if (!items.length) return null
  return (
    <Card className="p-2 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <History className="size-4.5 text-brand-600" /> Your recent answers
        </h2>
        <Link to="/practice/speaking-review/history" className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
          See all & your progress →
        </Link>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.slice(0, 12).map((item) => (
          <li key={item.id} className="group flex items-center gap-3 py-2.5">
            <button type="button" onClick={() => onOpen(item.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                <span className="text-[9px] font-bold uppercase">Band</span>
                <span className="text-sm leading-none font-extrabold tabular-nums">{item.overall.toFixed(1)}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-semibold text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-300">
                    {item.question || 'Free talk'}
                  </span>
                  {item.source ? <Badge tone="indigo">Ideas</Badge> : null}
                </span>
                <span className="text-xs text-slate-500">
                  {talkPartLabel(item.part)} · {clock(item.duration)} · {item.words} words ·{' '}
                  {new Date(item.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              title="Xoá bài này (cả bản ghi âm)"
              className="relative hit-area rounded-lg p-1.5 text-slate-400 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default function SpeakingReviewPage() {
  const [partValue, setPartValue] = useLocalStorage('practice:speaking-review-part', '1')
  const [source, setSource] = useLocalStorage<'manual' | 'ideas'>('practice:speaking-review-source', 'manual')
  // The question and script start empty on every visit (only the part is remembered); they stay while you are on the page.
  const [question, setQuestion] = useState('')
  const [withScript, setWithScript] = useState(false)
  const [script, setScript] = useState('')
  const [uncheckedKey, setUncheckedKey] = useState<string | null>(null)
  // What earlier versions of this page saved in the browser.
  useEffect(() => {
    try {
      for (const key of ['question', 'with-script', 'script']) localStorage.removeItem(`practice:speaking-review-${key}`)
    } catch {
      // Storage blocked: nothing was saved either.
    }
  }, [])
  const [showScript, setShowScript] = useState(false)
  const [id, setId] = useQueryParam('id')
  const [searchParams, setSearchParams] = useSearchParams()
  const from = searchParams.get('from') || null
  const rawQ = searchParams.get('q')
  const q = rawQ !== null && /^\d+$/.test(rawQ) ? Number(rawQ) : null

  const setLink = useCallback(
    (next: { from?: string; q?: number; clearId?: boolean } | null) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next?.clearId) p.delete('id')
          if (!next || !next.from) {
            p.delete('from')
            p.delete('q')
          } else {
            p.set('from', next.from)
            if (next.q !== undefined) p.set('q', String(next.q))
            else p.delete('q')
          }
          return p
        },
        { replace: true, preventScrollReset: true },
      )
    },
    [setSearchParams],
  )

  // `from` present in the URL forces `source = 'ideas'`.
  const activeSource: 'manual' | 'ideas' = from ? 'ideas' : source
  useEffect(() => {
    if (from && source !== 'ideas') setSource('ideas')
  }, [from, source, setSource])

  const [expectedQuestion, setExpectedQuestion] = useState<string | undefined>(undefined)

  const handleIndexShift = useCallback(
    (newIndex: number) => {
      if (from) setLink({ from, q: newIndex })
    },
    [from, setLink],
  )
  const linked = useLinkedQuestion(from, q, expectedQuestion, handleIndexShift)

  // Default `compareWithModel` back to true whenever the picked question changes.
  const linkedKey = `${from ?? ''}:${q ?? ''}`
  const compareWithModel = uncheckedKey !== linkedKey
  const setCompareWithModel = useCallback(
    (checked: boolean) => setUncheckedKey(checked ? null : linkedKey),
    [linkedKey],
  )

  const [loaded, setJob] = useState<TalkReviewJob | null>(null)
  const [status, setStatus] = useState<TalkStatus | null>(null)
  const [history, setHistory] = useState<TalkHistoryItem[]>([])
  const [speakingItems, setSpeakingItems] = useState<SpeakingHistoryItem[] | null>(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [retrying, setRetrying] = useState(false)
  // Bumped by a retry: the same id is followed again.
  const [round, setRound] = useState(0)
  const [offline, setOffline] = useState(false)
  const recorder = useRecorder(TALK_MAX_SECONDS)
  const fileInput = useRef<HTMLInputElement>(null)

  const manualPart = partOf(partValue)
  const effectivePart: TalkPart =
    activeSource === 'ideas' && linked.result ? linked.result.part : manualPart
  const displayedPartValue =
    activeSource === 'ideas' && linked.result ? String(linked.result.part) : partValue
  const target = TALK_TARGET[effectivePart]

  const effectiveScript =
    activeSource === 'ideas'
      ? linked.status === 'ready' && compareWithModel
        ? linked.script.trim()
        : ''
      : withScript
        ? script.trim()
        : ''

  const loadHistory = useCallback(() => {
    talkApi
      .history()
      .then((r) => setHistory(r.items))
      .catch(() => {})
  }, [])
  useEffect(() => {
    talkApi
      .status()
      .then(setStatus)
      .catch((err) => err instanceof OfflineError && setOffline(true))
    loadHistory()
  }, [loadHistory])

  // Load Speaking ideas history when in `ideas` mode or when viewing a result linked to Speaking ideas.
  const needsSpeakingHistory = activeSource === 'ideas' || Boolean(loaded?.result?.source)
  useEffect(() => {
    if (!needsSpeakingHistory || speakingItems !== null) return
    speakingApi
      .history()
      .then((r) => setSpeakingItems(r.items))
      .catch(() => setSpeakingItems([]))
  }, [needsSpeakingHistory, speakingItems])

  const allGroups = useMemo(() => (speakingItems ? groupByTopic(speakingItems) : []), [speakingItems])

  // Find Prev / Next question within the same topic group for a given (suggestionId, answerIndex, question).
  const neighborsOf = useCallback(
    (suggestionId: string, answerIndex: number, questionText?: string) => {
      const group = allGroups.find((g) => g.sessions.some((s) => s.id === suggestionId))
      if (!group) return { prev: null, next: null }
      const unique = group.questions.filter((item) => !item.isDuplicate)
      let pos = unique.findIndex((item) => item.id === suggestionId && item.index === answerIndex)
      if (pos < 0 && questionText) {
        const norm = normalize(questionText)
        pos = unique.findIndex((item) => normalize(item.question) === norm)
      }
      if (pos < 0) return { prev: null, next: null }
      const prev = pos > 0 ? { id: unique[pos - 1]!.id, index: unique[pos - 1]!.index } : null
      const next = pos + 1 < unique.length ? { id: unique[pos + 1]!.id, index: unique[pos + 1]!.index } : null
      return { prev, next }
    },
    [allGroups],
  )

  const composeNeighbors = useMemo(() => {
    if (!from || linked.status !== 'ready' || !linked.answer) return { prev: null, next: null }
    return neighborsOf(from, linked.index, linked.answer.question)
  }, [from, linked.status, linked.index, linked.answer, neighborsOf])

  // Follow the review on screen: poll while it runs.
  useEffect(() => {
    if (!id) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const { job: next } = await talkApi.get(id)
        if (!active) return
        setJob(next)
        if (next.status === 'running') timer = setTimeout(tick, POLL_MS)
        else loadHistory()
      } catch (err) {
        if (!active) return
        setError((err as Error).message)
        setJob(null)
      }
    }
    void tick()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [id, round, loadHistory])

  const submit = async () => {
    if (!recorder.take) return
    setError('')
    setSending(true)
    try {
      const audio = await base64Of(recorder.take.wav)
      const body =
        activeSource === 'ideas' && linked.status === 'ready' && from && linked.result && linked.answer
          ? {
              part: linked.result.part,
              question: linked.answer.question,
              topic: linked.result.topic,
              script: compareWithModel ? linked.script : '',
              source: {
                suggestionId: from,
                answerIndex: linked.index,
                question: linked.answer.question,
                withModel: compareWithModel && Boolean(linked.script),
              },
              audio,
            }
          : {
              part: manualPart,
              question: question.trim(),
              script: withScript ? script.trim() : '',
              audio,
            }
      const { job: created } = await talkApi.start(body)
      setJob(created)
      setId(created.id)
      recorder.reset()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  const retry = async () => {
    setError('')
    setRetrying(true)
    try {
      setJob((await talkApi.retry(id)).job)
      setRound((r) => r + 1)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRetrying(false)
    }
  }

  const newAnswer = () => {
    setId('')
    setJob(null)
    setError('')
  }
  const remove = async (target: string) => {
    if (!window.confirm('Xoá bài nói này và bản ghi âm của nó?')) return
    await talkApi.remove(target).catch(() => {})
    if (target === id) newAnswer()
    loadHistory()
  }

  const composing = !id
  // The review of another id (just left) is not shown.
  const job = id && loaded?.id === id ? loaded : null
  const recording = recorder.state === 'recording'
  const notReady = status && !status.stt ? 'stt' : status && !status.reviewer ? 'reviewer' : null
  const waitingForQuestion = activeSource === 'ideas' && linked.status !== 'ready'

  const reviewSource = job?.status === 'done' ? job.result?.source : undefined
  const resolvedReviewIndex = useMemo(() => {
    if (!reviewSource) return 0
    const sess = speakingItems?.find((s) => s.id === reviewSource.suggestionId)
    if (!sess) return reviewSource.answerIndex
    const atIdx = sess.questions[reviewSource.answerIndex]
    if (atIdx && normalize(atIdx) === normalize(reviewSource.question)) return reviewSource.answerIndex
    const found = sess.questions.findIndex((qt) => normalize(qt) === normalize(reviewSource.question))
    return found >= 0 ? found : reviewSource.answerIndex
  }, [reviewSource, speakingItems])
  const reviewNext = useMemo(() => {
    if (!reviewSource) return null
    return neighborsOf(reviewSource.suggestionId, resolvedReviewIndex, reviewSource.question).next
  }, [reviewSource, resolvedReviewIndex, neighborsOf])

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Speaking"
        title="Speaking review"
        description="Answer an IELTS Speaking question out loud. Your recording is transcribed on this computer, measured for fluency and reviewed like an examiner — with estimated bands, corrections and, when you want one, a model answer built from your own ideas."
        actions={
          <div className="flex flex-wrap gap-2">
            {!composing ? (
              <Button onClick={newAnswer}>
                <Plus className="size-4" /> New answer
              </Button>
            ) : null}
            <ButtonLink to="/practice/speaking-review/history" variant="outline">
              <History className="size-4" /> History
            </ButtonLink>
          </div>
        }
      />

      {offline ? (
        <p className="mb-5 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <ServerOff className="size-4 shrink-0" /> Speaking review cần server của app (npm run dev / npm start).
        </p>
      ) : null}
      {notReady === 'stt' ? (
        <p className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Chưa có model chuyển giọng nói thành chữ trong <code className="text-xs">{status?.modelDir}</code>. Tải{' '}
          <code className="text-xs">sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8.tar.bz2</code> (108 MB, release “asr-models” của
          k2-fsa/sherpa-onnx) và giải nén vào thư mục <code className="text-xs">models/</code>.
        </p>
      ) : notReady === 'reviewer' ? (
        <p className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Cần Antigravity CLI (<code className="text-xs">agy</code>) để AI chấm bài.
        </p>
      ) : null}

      <div className="space-y-6">
        {composing ? (
          <Card className="overflow-hidden p-0">
            <div className="space-y-5 p-2 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SegmentedControl
                  value={activeSource}
                  onChange={(next) => {
                    setSource(next)
                    if (next === 'manual') setLink(null)
                  }}
                  options={SOURCES}
                  size="sm"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <SegmentedControl
                    value={displayedPartValue}
                    onChange={setPartValue}
                    options={PARTS}
                    disabled={activeSource === 'ideas'}
                    title={activeSource === 'ideas' ? 'Part theo câu hỏi trong Speaking ideas' : undefined}
                  />
                  {target ? (
                    <span className="text-sm text-slate-500 dark:text-slate-400" title="Độ dài câu trả lời giám khảo mong đợi">
                      Answer length: <span className="font-semibold text-slate-700 dark:text-slate-200">{target.label}</span>
                    </span>
                  ) : null}
                </div>
              </div>

              {activeSource === 'manual' ? (
                <>
                  <div className="space-y-1.5">
                    <label htmlFor="talk-question" className="text-[15px] font-bold text-slate-900 dark:text-white">
                      {manualPart === 2 ? 'Cue card' : manualPart === 'free' ? 'Topic' : 'Question'}{' '}
                      <span className="font-normal text-slate-400">(optional)</span>
                    </label>
                    <textarea
                      id="talk-question"
                      rows={manualPart === 2 ? 5 : 2}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder={QUESTION_PLACEHOLDER[partValue]}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] leading-relaxed text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>

                  <div className="space-y-2.5">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={withScript}
                        onChange={(e) => setWithScript(e.target.checked)}
                        className="mt-1 size-4 rounded border-slate-300 accent-brand-600"
                      />
                      <span>
                        <span className="block text-[15px] font-bold text-slate-900 dark:text-white">I have a script I plan to say</span>
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                          {withScript
                            ? 'Bài nói sẽ được so với script: ý đã nói, ý bỏ sót, chỗ script diễn đạt hay hơn.'
                            : 'Không có script: AI lấy ý từ chính những gì bạn nói; bấm “Write a model answer” trong kết quả nếu muốn Speaking ideas viết bài mẫu.'}
                        </span>
                      </span>
                    </label>
                    {withScript ? (
                      <textarea
                        rows={6}
                        value={script}
                        onChange={(e) => setScript(e.target.value)}
                        placeholder="Paste or type the answer you prepared…"
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    ) : null}
                  </div>
                </>
              ) : q === null ? (
                <IdeasPicker
                  speakingItems={speakingItems}
                  talkHistory={history}
                  defaultPart={partValue}
                  initialResultId={from}
                  onPick={(sid, idx) => {
                    setExpectedQuestion(undefined)
                    setLink({ from: sid, q: idx })
                  }}
                />
              ) : (
                <LinkedQuestion
                  linked={linked}
                  compareWithModel={compareWithModel}
                  onToggleCompare={setCompareWithModel}
                  onChangeQuestion={() => {
                    setExpectedQuestion(undefined)
                    setLink(from ? { from } : null)
                  }}
                  prevQuestion={composeNeighbors.prev}
                  nextQuestion={composeNeighbors.next}
                  onNavigateQuestion={(t) => {
                    setExpectedQuestion(undefined)
                    setLink({ from: t.id, q: t.index })
                  }}
                  onCopyToManual={(copiedQuestion, copiedScript) => {
                    setQuestion(copiedQuestion)
                    setScript(copiedScript)
                    setWithScript(Boolean(copiedScript))
                    setSource('manual')
                    setLink(null)
                  }}
                />
              )}
            </div>

            {/* The recorder */}
            <div className="border-t border-slate-200 bg-gradient-to-b from-slate-50 to-white px-2 py-7 sm:px-6 dark:border-slate-800 dark:from-slate-900/70 dark:to-slate-900">
              {waitingForQuestion ? (
                <p className="text-center text-sm font-medium text-slate-500 dark:text-slate-400">
                  Chọn một câu hỏi để bắt đầu
                </p>
              ) : recorder.state === 'ready' && recorder.take ? (
                <div className="mx-auto flex max-w-lg flex-col items-center gap-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    <FileAudio className="size-4 text-brand-600" /> Your answer · {clock(recorder.take.seconds)}
                  </p>
                  <audio src={recorder.take.url} controls className="w-full" />
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="outline" onClick={recorder.reset} disabled={sending}>
                      <RotateCcw className="size-4" /> Record again
                    </Button>
                    <Button size="lg" onClick={() => void submit()} loading={sending} disabled={sending || Boolean(notReady) || offline}>
                      <Sparkles className="size-5" /> Review my answer
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  {effectivePart === 2 && !recording ? <PrepTimer /> : null}
                  <button
                    type="button"
                    onClick={() => (recording ? recorder.stop() : void recorder.start())}
                    disabled={recorder.state === 'converting'}
                    className={cn(
                      'relative flex size-24 items-center justify-center rounded-full text-white shadow-lg transition-all focus:ring-4 focus:outline-none disabled:opacity-60',
                      recording
                        ? 'bg-rose-600 shadow-rose-500/30 hover:bg-rose-700 focus:ring-rose-500/30'
                        : 'bg-brand-600 shadow-brand-500/30 hover:scale-105 hover:bg-brand-700 focus:ring-brand-500/30',
                    )}
                    aria-label={recording ? 'Stop recording' : 'Start recording'}
                  >
                    {recording ? <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/30" /> : null}
                    {recorder.state === 'converting' ? (
                      <Loader2 className="size-9 animate-spin" />
                    ) : recording ? (
                      <Square className="size-8 fill-current" />
                    ) : (
                      <Mic className="size-10" />
                    )}
                  </button>
                  {recording ? (
                    <>
                      <div className="flex items-center gap-4">
                        <span className="text-3xl font-extrabold text-slate-900 tabular-nums dark:text-white">{clock(recorder.elapsed)}</span>
                        <LevelMeter level={recorder.level} />
                      </div>
                      <TimeBar elapsed={recorder.elapsed} part={effectivePart} />
                      {effectiveScript ? (
                        <button
                          type="button"
                          onClick={() => setShowScript((v) => !v)}
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-brand-700"
                        >
                          <ScrollText className="size-4" /> {showScript ? 'Hide my script' : 'Show my script'}
                        </button>
                      ) : null}
                      {showScript && effectiveScript ? (
                        <p className="max-w-2xl rounded-xl bg-white p-2 text-[15px] leading-relaxed whitespace-pre-line text-slate-700 shadow-sm sm:p-4 dark:bg-slate-950 dark:text-slate-200">
                          {effectiveScript}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <div className="text-center">
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {recorder.state === 'converting' ? 'Preparing the recording…' : 'Press to start speaking'}
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Press again to stop · up to {TALK_MAX_SECONDS / 60} minutes ·{' '}
                        <button
                          type="button"
                          onClick={() => fileInput.current?.click()}
                          className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline dark:text-brand-300"
                        >
                          <Upload className="size-3.5" /> or upload an audio file
                        </button>
                      </p>
                      <input
                        ref={fileInput}
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) recorder.upload(file)
                          e.target.value = ''
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              {recorder.error || error ? (
                <p className="mx-auto mt-4 max-w-lg rounded-xl bg-rose-50 px-3 py-2 text-center text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  {recorder.error || error}
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {!composing && !job && error ? (
          <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="font-semibold text-slate-900 dark:text-white">Could not open this review</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">{error}</p>
            <Button size="sm" onClick={newAnswer}>
              <Plus className="size-4" /> New answer
            </Button>
          </Card>
        ) : null}
        {job?.status === 'running' && !job.result ? <Progress job={job} /> : null}
        {job?.status === 'running' && job.result ? (
          <div className="space-y-4">
            <Card className="flex items-center gap-2.5 border-brand-200 bg-brand-50/70 px-4 py-2.5 text-sm font-medium text-brand-900 dark:border-brand-800/60 dark:bg-brand-950/40 dark:text-brand-200">
              <Loader2 className="size-4 shrink-0 animate-spin text-brand-600 dark:text-brand-400" />
              <span>
                {job.result.pending?.includes('fixes') && job.result.pending?.includes('comparison')
                  ? 'Đang kiểm tra lỗi sai và so với script…'
                  : job.result.pending?.includes('comparison')
                    ? 'Đang so với script…'
                    : 'Đang kiểm tra lỗi sai…'}
              </span>
            </Card>
            <ResultView result={job.result} onUpdate={(result) => setJob((prev) => (prev ? { ...prev, result } : prev))} />
          </div>
        ) : null}
        {job?.status === 'error' ? (
          <Card className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <p className="text-sm text-rose-700 dark:text-rose-300">Lỗi: {job.error}</p>
            {error ? <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p> : null}
            {job.retryable ? (
              <p className="text-xs text-slate-500">Bản ghi âm vẫn được giữ — bấm “Try again” để chấm lại mà không cần nói lại.</p>
            ) : null}
            <div className="flex flex-wrap justify-center gap-2">
              {job.retryable ? (
                <Button size="sm" onClick={() => void retry()} loading={retrying}>
                  <RotateCcw className="size-4" /> Try again
                </Button>
              ) : null}
              <Button size="sm" variant={job.retryable ? 'outline' : 'primary'} onClick={newAnswer}>
                <Mic className="size-4" /> Record a new answer
              </Button>
            </div>
          </Card>
        ) : null}
        {job?.status === 'done' && job.result ? (
          <div className="space-y-4">
            {reviewSource ? (
              <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold tracking-wide text-brand-700 uppercase dark:text-brand-300">
                    From Speaking ideas · {job.result.topic || 'Speaking ideas'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ButtonLink
                    to={`/practice/speaking-ideas/history?id=${encodeURIComponent(reviewSource.suggestionId)}&q=${resolvedReviewIndex}`}
                    variant="outline"
                    size="sm"
                  >
                    <BookOpen className="size-3.5" /> Open model answer
                  </ButtonLink>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSource('ideas')
                      setExpectedQuestion(reviewSource.question)
                      setJob(null)
                      setError('')
                      setLink({ from: reviewSource.suggestionId, q: resolvedReviewIndex, clearId: true })
                    }}
                  >
                    <RotateCcw className="size-3.5" /> Practice again
                  </Button>
                  {reviewNext ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setSource('ideas')
                        setExpectedQuestion(undefined)
                        setJob(null)
                        setError('')
                        setLink({ from: reviewNext.id, q: reviewNext.index, clearId: true })
                      }}
                    >
                      Next question in topic <ChevronRight className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </Card>
            ) : null}
            <div className="flex justify-end">
              <AskCoachButton question={`About my Speaking review ${job.result.id}: what are the 3 most important things to fix (grammar, wording, pronunciation)?`} />
            </div>
            <ResultView result={job.result} onUpdate={(result) => setJob((prev) => (prev ? { ...prev, result } : prev))} />
          </div>
        ) : null}

        {composing ? (
          <HistoryList items={history} onOpen={setId} onDelete={(target) => void remove(target)} />
        ) : (
          <p className="text-center text-sm text-slate-500">
            <Link to="/review?tab=recent" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
              Review the words from your recent work →
            </Link>{' '}
            <Badge tone="slate" className="ml-1">
              corrections also go to Mistake Log
            </Badge>
          </p>
        )}
      </div>
    </div>
  )
}
