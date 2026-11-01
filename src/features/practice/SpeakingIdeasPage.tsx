// Practice → Speaking ideas: paste an IELTS Speaking topic and its questions, add your own idea for each (optional),
// and Claude suggests phrases from the app's library (tagged by the Library sync), example sentences, a few
// dictionary-checked phrases from outside the library, and a model answer that uses them.
import { Check, Database, History, Lightbulb, ListChecks, Loader2, MessageSquareQuote, Plus, ServerOff, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button, Card, PageHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useLocalStorage } from '@/lib/storage'
import { useQueryParam } from '@/lib/useQueryParam'
import type { SpeakingJob, SpeakingMode, SpeakingPart } from '@/types/speaking'
import { OfflineError, speakingApi, STEPS } from './speaking-ideas/api'
import { parseTopic } from './speaking-ideas/parse'
import { SuggestionResult } from './speaking-ideas/SuggestionResult'
import { SyncPanel } from './speaking-ideas/SyncPanel'
import { useSyncStatus } from './speaking-ideas/useSyncStatus'
import { DolStatusBanner } from './DolStatusBanner'

const POLL_MS = 2000
const MAX_QUESTIONS = 8
const PLACEHOLDER = `Art
* Are you good at art?
* Did you learn art at school when you were a child?
* What kind of art do you like?`

/** What the learner wants: a model answer, or only the phrases to write their own answer. */
const MODES: { value: SpeakingMode; title: string; icon: LucideIcon }[] = [
  { value: 'answer', title: 'Model answer', icon: MessageSquareQuote },
  { value: 'phrases', title: 'Phrases only', icon: ListChecks },
]

function ModeSwitch({ value, onChange }: { value: SpeakingMode; onChange: (mode: SpeakingMode) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Mode"
      className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={value === m.value}
          onClick={() => onChange(m.value)}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors',
            value === m.value
              ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          )}
        >
          <m.icon className="size-[18px]" />
          {m.title}
        </button>
      ))}
    </div>
  )
}

function PartPicker({ value, onChange }: { value: SpeakingPart; onChange: (part: SpeakingPart) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="IELTS part"
      className="inline-flex rounded-xl border border-slate-300 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      {([1, 2, 3] as const).map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => onChange(p)}
          className={cn(
            'rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors',
            value === p
              ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          )}
        >
          Part {p}
        </button>
      ))}
    </div>
  )
}

type ToolTone = 'brand' | 'emerald' | 'amber'
const TOOL_TONE: Record<ToolTone, string> = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300',
}
const STATUS_TONE: Record<ToolTone, string> = {
  brand: 'text-slate-500 dark:text-slate-400',
  emerald: 'text-emerald-700 dark:text-emerald-400',
  amber: 'text-amber-700 dark:text-amber-400',
}

/** A toolbar button with an icon, a title and a one-line status (Library, History). */
function ToolButton({
  icon: Icon,
  title,
  status,
  tone,
  to,
  onClick,
  active,
  spin,
}: {
  icon: LucideIcon
  title: string
  status: string
  tone: ToolTone
  to?: string
  onClick?: () => void
  active?: boolean
  spin?: boolean
}) {
  const className = cn(
    'group inline-flex items-center gap-2.5 rounded-xl border bg-white py-1.5 pr-3.5 pl-1.5 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md dark:bg-slate-900',
    active
      ? 'border-brand-400 ring-2 ring-brand-500/15 dark:border-brand-500'
      : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
  )
  const body = (
    <>
      <span className={cn('flex size-9 items-center justify-center rounded-lg', TOOL_TONE[tone])}>
        <Icon className={cn('size-[18px]', spin && 'animate-spin')} />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-bold text-slate-900 dark:text-white">{title}</span>
        <span className={cn('block text-xs font-medium', STATUS_TONE[tone])}>{status}</span>
      </span>
    </>
  )
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className} aria-expanded={active}>
      {body}
    </button>
  )
}

function Progress({ job, onCancel }: { job: SpeakingJob; onCancel?: () => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  // "Phrases only" stops after matching the library.
  // A model answer looks up alternatives during the editing pass, so that step has no row of its own there.
  const steps = job.mode === 'phrases' ? STEPS.filter((s) => s.id !== 'suggest' && s.id !== 'polish') : STEPS.filter((s) => s.id !== 'alternatives')
  const current = steps.findIndex((s) => s.id === job.step)
  const elapsed = Math.max(0, Math.round((now - Date.parse(job.startedAt)) / 1000))
  const percent = Math.round(((Math.max(0, current) + 0.5) / steps.length) * 100)
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
          <Loader2 className="size-5 animate-spin" />
        </span>
        <div className="flex-1">
          <h2 className="font-bold text-slate-900 dark:text-white">{job.mode === 'phrases' ? 'Đang tìm cụm từ…' : 'Đang viết gợi ý…'}</h2>
          <p className="text-xs text-slate-500">
            Quá trình có thể mất vài phút. Bạn có thể rời trang — quay lại đây sẽ thấy kết quả.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              Hủy
            </button>
          )}
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-700 tabular-nums dark:bg-slate-800 dark:text-slate-200">
            {elapsed}s
          </span>
        </div>
      </div>
      <div className="h-1 bg-slate-100 dark:bg-slate-800">
        <div className="h-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-700" style={{ width: `${percent}%` }} />
      </div>
      <ol className="grid gap-2 p-4 sm:p-5 sm:grid-cols-2">
        {steps.map((step, i) => {
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

export default function SpeakingIdeasPage() {
  const [text, setText] = useLocalStorage('practice:speaking-ideas-draft', '')
  const [part, setPart] = useLocalStorage<SpeakingPart>('practice:speaking-ideas-part', 1)
  const [mode, setMode] = useLocalStorage<SpeakingMode>('practice:speaking-ideas-mode', 'answer')
  // The learner's idea per question, keyed by the question text so editing the list keeps them.
  const [ideas, setIdeas] = useLocalStorage<Record<string, string>>('practice:speaking-ideas-ideas', {})
  const [id, setId] = useQueryParam('id')
  const [lastId, setLastId] = useLocalStorage('practice:speaking-ideas-last', '')
  const shownId = id || lastId
  const [job, setJob] = useState<SpeakingJob | null>(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const sync = useSyncStatus()
  const [showSync, setShowSync] = useState(false)
  const offline = sync.error.includes('local server') || error.includes('local server')

  // Follow the suggestion on screen: poll while it runs.
  useEffect(() => {
    if (!shownId) {
      setJob(null)
      return
    }
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const { job: next } = await speakingApi.get(shownId)
        if (!active) return
        setJob(next)
        if (next.status === 'running') timer = setTimeout(tick, POLL_MS)
      } catch (err) {
        if (!active) return
        const msg = err instanceof OfflineError ? err.message : (err as Error).message
        setError(msg)
        // If the server restarted or the job is gone, clear job so user is not stuck in infinite spinner
        setJob(null)
        if (!id && shownId === lastId) setLastId('')
      }
    }
    void tick()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [shownId, id, lastId, setLastId])

  const { topic, questions } = parseTopic(text, part)
  const tagged = sync.status?.tagged ?? 0
  const running = job?.status === 'running'
  const composing = !shownId

  const start = async () => {
    setError('')
    setStarting(true)
    try {
      const { job: created } = await speakingApi.start({
        topic,
        part,
        questions: questions.map((question) => ({ question, idea: ideas[question] ?? '' })),
        mode,
      })
      setJob(created)
      setLastId(created.id)
      setId(created.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const blocked = !questions.length
    ? 'Dán chủ đề và ít nhất một câu hỏi để bắt đầu.'
    : questions.length > MAX_QUESTIONS
      ? `Tối đa ${MAX_QUESTIONS} câu hỏi một lần.`
      : sync.status && !tagged
        ? 'Thư viện chưa được gắn nhãn: bấm Library sync trước.'
        : sync.status && !sync.status.ready
          ? 'Cần cài Claude Code hoặc Antigravity CLI và đăng nhập một lần.'
          : null

  // The library's state for its toolbar button: synced, items waiting, or a sync running.
  const waiting = sync.status
    ? sync.status.pending + sync.status.changed + (sync.status.topic ? sync.status.topic.pending + sync.status.topic.changed : 0)
    : 0
  const syncJob = sync.status?.job?.status === 'running' ? sync.status.job : undefined
  const libraryTone: ToolTone = syncJob ? 'brand' : waiting ? 'amber' : 'emerald'
  const libraryStatus = !sync.status
    ? 'Đang kiểm tra…'
    : syncJob
      ? `Đang đồng bộ ${syncJob.done.toLocaleString('en-US')}/${syncJob.total.toLocaleString('en-US')}`
      : waiting
        ? `${waiting.toLocaleString('en-US')} mục chờ đồng bộ`
        : `Đã đồng bộ · ${sync.status.tagged.toLocaleString('en-US')} mục`

  const newTopic = () => {
    setLastId('')
    setId('')
    setJob(null)
    setError('')
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Speaking"
        title="Speaking ideas"
        description="Paste an IELTS Speaking topic and its questions, add your own ideas, and AI suggests phrases from your Collocations, Vocabulary and Notes, example sentences, a few dictionary-checked new phrases, and a model answer that uses them."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {composing ? <ModeSwitch value={mode} onChange={setMode} /> : null}
            {!composing ? (
              <Button onClick={newTopic} variant={running ? 'outline' : 'primary'}>
                <Plus className="size-4" /> {running ? 'Hủy / Tạo mới' : 'New topic'}
              </Button>
            ) : null}
            <ToolButton
              onClick={() => setShowSync((v) => !v)}
              active={showSync}
              icon={sync.status?.job?.status === 'running' ? Loader2 : Database}
              spin={sync.status?.job?.status === 'running'}
              tone={libraryTone}
              title="Library"
              status={libraryStatus}
            />
            <ToolButton to="/practice/speaking-ideas/history" icon={History} tone="brand" title="History" status="Xem lại các lần gợi ý" />
          </div>
        }
      />
      <DolStatusBanner className="mb-5" />


      {offline ? (
        <p className="mb-5 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <ServerOff className="size-4 shrink-0" /> Speaking ideas cần server của app (npm run dev / npm start).
        </p>
      ) : null}

      <div className="space-y-6">
        {showSync || (sync.status && !tagged) ? <SyncPanel {...sync} /> : null}

        {composing ? (
          <Card className="overflow-hidden p-0">
            <div className="space-y-6 p-2 sm:p-6">
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <label htmlFor="speaking-topic" className="text-[15px] font-bold text-slate-900 dark:text-white">
                      Topic &amp; questions
                    </label>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {part === 2 ? 'Dán cả cue card: dòng đầu là đề, các dòng sau là gợi ý.' : 'Dòng đầu là chủ đề, mỗi dòng sau là một câu hỏi.'}
                    </p>
                  </div>
                  <PartPicker value={part} onChange={setPart} />
                </div>
                <textarea
                  id="speaking-topic"
                  rows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={part === 2 ? 'Describe a piece of art you like.\nYou should say:\nwhat it is\nwhere you saw it\n…' : PLACEHOLDER}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] leading-relaxed text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {questions.length ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-[15px] font-bold text-slate-900 dark:text-white">
                      Your ideas{' '}
                      {topic ? (
                        <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 align-middle text-xs font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                          {topic}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Không bắt buộc, tiếng Việt hay tiếng Anh đều được — ý càng cụ thể, gợi ý càng sát.
                    </p>
                  </div>
                  <ol className="space-y-2.5">
                    {questions.map((q, i) => (
                      <li key={q} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                        <div className="flex items-start gap-3">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white dark:bg-brand-500">
                            {i + 1}
                          </span>
                          <p className="pt-0.5 font-semibold whitespace-pre-line text-slate-900 dark:text-white">{q}</p>
                        </div>
                        <div className="relative mt-2.5 sm:ml-10">
                          <Lightbulb className="pointer-events-none absolute top-3 left-3 size-4 text-amber-500" />
                          <textarea
                            rows={part === 2 ? 5 : 2}
                            value={ideas[q] ?? ''}
                            onChange={(e) => setIdeas({ ...ideas, [q]: e.target.value })}
                            placeholder={
                              part === 2
                                ? "Nhập hoặc dán toàn bộ dàn ý/bài văn của bạn (các đoạn mở bài, thân bài, lý do, kết quả...)"
                                : "Ý chính bạn muốn nói, ví dụ: không giỏi lắm, hồi nhỏ chỉ học ở trường…"
                            }
                            className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2.5 pr-3 pl-9 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-900"
                          />
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-2 py-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900/60">
              <p className={cn('text-sm', blocked ? 'text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400')}>
                {blocked ?? (
                  <>
                    <span className="font-semibold text-slate-900 dark:text-white">{questions.length}</span> câu hỏi · Part {part} ·{' '}
                    {MODES.find((m) => m.value === mode)?.title}
                  </>
                )}
              </p>
              <Button size="lg" onClick={() => void start()} loading={starting} disabled={Boolean(blocked) || starting || running || offline}>
                {mode === 'phrases' ? <ListChecks className="size-5" /> : <MessageSquareQuote className="size-5" />}
                {mode === 'phrases' ? 'Find phrases' : 'Suggest'}
              </Button>
            </div>
          </Card>
        ) : null}

        {!composing && !job && error ? (
          <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="font-semibold text-slate-900 dark:text-white">Không mở được lần gợi ý này</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">{error.includes('not found') ? 'Có thể nó đã bị xoá trong History.' : error}</p>
            <Button size="sm" onClick={newTopic}>
              <Plus className="size-4" /> New topic
            </Button>
          </Card>
        ) : null}
        {job?.status === 'running' ? <Progress job={job} onCancel={newTopic} /> : null}
        {job?.status === 'error' ? (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">Lỗi: {job.error}</p>
        ) : null}
        {job?.status === 'done' && job.result ? (
          <SuggestionResult
            result={job.result}
            onResultUpdate={(updated) => setJob((prev) => (prev ? { ...prev, result: updated } : prev))}
          />
        ) : null}
      </div>
    </div>
  )
}
