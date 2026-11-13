import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Loader2, PenLine, RotateCcw, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Badge, Button, Card, PageHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useData } from '@/lib/data'
import { useLocalStorage } from '@/lib/storage'
import type { WritingTask1Extras, WritingTask1ExtrasMap, WritingTask1Index, WritingTask1Prompt } from '@/types/writingMock'
import { WRITING_TASK1_CRITERIA, type WritingReviewJob, type WritingReviewSummary } from '@/types/writingReview'
import { writingReviewApi } from '../writing-review/api'
import { WritingReviewProgress } from '../writing-review/WritingReviewProgress'
import { countWords, examDate, task1Api, TASK1_ENGLISH_SECONDS, TASK1_IDEA_SECONDS, TASK1_MIN_WORDS, timerLabel } from './api'
import { ChartImageBox, ChartImages } from './ChartImages'
import { MOCK_HISTORY_LIMIT } from './DoneStatus'
import { ModelEssayBox } from './ModelEssayBox'
import { SplitPane } from './SplitPane'
import { Task1Select } from './Task1Select'

type Stage = 'select' | 'prepare' | 'ideas' | 'english' | 'review'

/** A Task 1 attempt in progress, kept across reloads and page changes. */
export const TASK1_ATTEMPT_KEY = 'practice:writing-mock:task1:attempt'
interface Attempt {
  promptId: string
  stage: 'ideas' | 'english'
  startedAt: number
}

export function readTask1Attempt(): Attempt | null {
  try {
    const raw = JSON.parse(localStorage.getItem(TASK1_ATTEMPT_KEY) ?? 'null') as Attempt | null
    return raw && typeof raw.promptId === 'string' && (raw.stage === 'ideas' || raw.stage === 'english') && Number.isFinite(raw.startedAt) ? raw : null
  } catch {
    return null
  }
}

function writeTask1Attempt(attempt: Attempt | null) {
  try {
    if (attempt) localStorage.setItem(TASK1_ATTEMPT_KEY, JSON.stringify(attempt))
    else localStorage.removeItem(TASK1_ATTEMPT_KEY)
  } catch {
    // Storage blocked: the attempt is not kept across reloads.
  }
}

const TASK1_INSTRUCTION =
  'Summarise the information by selecting and reporting the main features, and make comparisons where relevant. Write at least 150 words.'

function QuestionCard({ prompt, children }: { prompt: WritingTask1Prompt; children?: ReactNode }) {
  const date = examDate(prompt.title)
  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap gap-2">
        <Badge tone="violet">{prompt.chart_type}</Badge>
        {prompt.type_name ? <Badge tone="slate">{prompt.type_name}</Badge> : null}
        {date ? <Badge tone="slate">Đề {date}</Badge> : null}
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">You should spend about 20 minutes on this task.</p>
      <p className="leading-relaxed text-slate-800 dark:text-slate-100">{prompt.prompt}</p>
      <p className="text-sm italic text-slate-600 dark:text-slate-300">{TASK1_INSTRUCTION}</p>
      {children}
    </Card>
  )
}

function Attempts({ attempts }: { attempts: WritingReviewSummary[] }) {
  if (!attempts.length) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
      <h2 className="font-semibold text-slate-900 dark:text-white">Các lần làm đề này</h2>
      <ul className="mt-2 space-y-2 text-sm">
        {attempts.slice(0, 5).map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              {new Date(item.createdAt).toLocaleString('vi-VN')}
              {item.overall !== undefined ? <Badge tone="brand">Band {item.overall.toFixed(1)}</Badge> : null}
            </span>
            <Button size="sm" variant="outline" onClick={() => (window.location.href = `/practice/writing-review?id=${item.id}`)}>
              Xem kết quả
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Writing Mock Test, Task 1 (charts): list → prepare (pictures, model essay) → plan 5′ → answer 20′ → grading. */
export default function Task1Mock({ taskSwitch }: { taskSwitch?: ReactNode }) {
  const index = useData<WritingTask1Index>('practice/writing-mock/task1-prompts.json')
  // Read once on mount: a reload or another page and back resumes the attempt, the timer on real time.
  const [resumed] = useState(readTask1Attempt)
  const resumable = resumed && index.prompts.some((p) => p.id === resumed.promptId) ? resumed : null
  const [stage, setStage] = useState<Stage>(resumable?.stage ?? 'select')
  const [selectedId, setSelectedId] = useState<string | null>(resumable?.promptId ?? null)
  const [startedAt, setStartedAt] = useState<number | null>(resumable?.startedAt ?? null)
  const [secondsLeft, setSecondsLeft] = useState(TASK1_IDEA_SECONDS)
  const [extrasMap, setExtrasMap] = useState<WritingTask1ExtrasMap>({})
  const [extras, setExtras] = useState<WritingTask1Extras | null>(null)
  const [history, setHistory] = useState<WritingReviewSummary[]>([])
  const [idea, setIdea] = useLocalStorage('practice:writing-mock:task1:idea', '')
  const [english, setEnglish] = useLocalStorage('practice:writing-mock:task1:english', '')
  const [editingIdea, setEditingIdea] = useState(false)
  const [warnedNoChart, setWarnedNoChart] = useState(false)
  const [job, setJob] = useState<WritingReviewJob | null>(null)
  const [error, setError] = useState('')
  const submitRef = useRef<() => Promise<void>>(async () => {})

  const selected = index.prompts.find((p) => p.id === selectedId)

  const loadLists = useCallback(() => {
    void task1Api.extras().then(({ extras: map }) => setExtrasMap(map)).catch(() => {})
    void writingReviewApi
      .history(MOCK_HISTORY_LIMIT)
      .then(({ items }) => setHistory(items.filter((item) => item.task === 1 && item.promptId)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (stage === 'select') loadLists()
  }, [stage, loadLists])

  useEffect(() => {
    if (job?.status === 'done') loadLists()
  }, [job?.status, loadLists])

  // The pictures and model essay of the open question.
  useEffect(() => {
    if (!selectedId) {
      setExtras(null)
      return
    }
    let live = true
    setExtras((current) => (current?.promptId === selectedId ? current : null))
    task1Api
      .prompt(selectedId)
      .then(({ extras: next }) => live && setExtras(next))
      .catch((cause) => live && setError((cause as Error).message))
    return () => {
      live = false
    }
  }, [selectedId])

  // A resumed attempt: start the background chart reading again (a no-op when it is already stored).
  useEffect(() => {
    if (resumable) void task1Api.prepare(resumable.promptId).catch(() => {})
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateExtras = useCallback((next: WritingTask1Extras) => {
    setExtras(next)
    setExtrasMap((map) => {
      const copy = { ...map }
      if (next.images.length || next.modelEssay) copy[next.promptId] = { images: next.images.length, hasModel: Boolean(next.modelEssay) }
      else delete copy[next.promptId]
      return copy
    })
  }, [])

  // The attempt in localStorage follows the screen; any other screen clears it.
  useEffect(() => {
    writeTask1Attempt((stage === 'ideas' || stage === 'english') && selectedId && startedAt ? { promptId: selectedId, stage, startedAt } : null)
  }, [stage, selectedId, startedAt])

  const attemptsByPrompt = useMemo(() => {
    const map = new Map<string, WritingReviewSummary[]>()
    for (const item of [...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      if (!item.promptId) continue
      if (!map.has(item.promptId)) map.set(item.promptId, [])
      map.get(item.promptId)!.push(item)
    }
    return map
  }, [history])

  // Timer on real time: step 1 running out moves to step 2; step 2 running out submits.
  useEffect(() => {
    if (!startedAt || (stage !== 'ideas' && stage !== 'english')) return
    const tick = () => {
      const limit = stage === 'ideas' ? TASK1_IDEA_SECONDS : TASK1_ENGLISH_SECONDS
      const remaining = limit - (Date.now() - startedAt) / 1000
      if (remaining > 0) {
        setSecondsLeft(remaining)
        return
      }
      window.clearInterval(timer)
      if (stage === 'ideas') {
        // Step 2 starts when step 1 ran out (also after a reload long after).
        const englishStart = startedAt + TASK1_IDEA_SECONDS * 1000
        setStage('english')
        setStartedAt(englishStart)
        setSecondsLeft(TASK1_ENGLISH_SECONDS - (Date.now() - englishStart) / 1000)
      } else {
        setSecondsLeft(0)
        void submitRef.current()
      }
    }
    const timer = window.setInterval(tick, 250)
    tick()
    return () => window.clearInterval(timer)
  }, [stage, startedAt])

  const open = (prompt: WritingTask1Prompt) => {
    setSelectedId(prompt.id)
    setStage('prepare')
    setJob(null)
    setError('')
    setWarnedNoChart(false)
  }

  const begin = () => {
    if (!extras?.images.length && !warnedNoChart) {
      setWarnedNoChart(true)
      return
    }
    setIdea('')
    setEnglish('')
    setEditingIdea(false)
    setError('')
    setJob(null)
    setStartedAt(Date.now())
    setSecondsLeft(TASK1_IDEA_SECONDS)
    setStage('ideas')
    // The chart is read (and the model essay's vocabulary picked) while the learner writes, so grading only scores.
    if (selectedId) void task1Api.prepare(selectedId).catch(() => {})
  }

  const startEnglish = () => {
    setStartedAt(Date.now())
    setSecondsLeft(TASK1_ENGLISH_SECONDS)
    setStage('english')
  }

  const submit = async () => {
    if (!selected) return
    if (english.trim().length < 30) {
      setError('Bài tiếng Anh cần có ít nhất 30 ký tự trước khi gửi chấm.')
      return
    }
    setError('')
    try {
      const { job: created } = await writingReviewApi.start(english.trim(), idea.trim() || undefined, selected.prompt, selected.prompt, {
        task: 1,
        promptId: selected.id,
      })
      setJob(created)
      setStage('review')
    } catch (cause) {
      setError((cause as Error).message)
    }
  }
  submitRef.current = submit

  useEffect(() => {
    if (stage !== 'review' || !job || job.status !== 'running') return
    const timer = window.setTimeout(async () => {
      try {
        const { job: next } = await writingReviewApi.get(job.id)
        setJob(next)
        if (next.status === 'error') setError(next.error || 'Không thể chấm bài.')
      } catch (cause) {
        setError((cause as Error).message)
      }
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [job, stage])

  const backToList = () => {
    setStage('select')
    setSelectedId(null)
    setStartedAt(null)
    setJob(null)
    setError('')
    setEditingIdea(false)
  }

  const quit = () => {
    if ((idea.trim() || english.trim()) && !window.confirm('Thoát bài đang làm? Ý tưởng và bài viết sẽ không được gửi chấm.')) return
    setIdea('')
    setEnglish('')
    backToList()
  }

  if (stage === 'select' || !selected) {
    return <Task1Select index={index} extras={extrasMap} attemptsByPrompt={attemptsByPrompt} onOpen={open} taskSwitch={taskSwitch} />
  }

  const attempts = attemptsByPrompt.get(selected.id) ?? []

  if (stage === 'prepare') {
    const noChart = !extras?.images.length
    return (
      <div className="readable-xs mx-auto max-w-4xl space-y-4 pb-16">
        <PageHeader eyebrow="Writing Mock Test · Task 1" title="Chuẩn bị đề" />
        <QuestionCard prompt={selected}>
          <ChartImageBox promptId={selected.id} extras={extras} onChange={updateExtras} />
        </QuestionCard>
        <ModelEssayBox key={selected.id} promptId={selected.id} extras={extras} onSaved={updateExtras} />
        {warnedNoChart && noChart ? (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Đề này chưa có hình biểu đồ. Không có hình, AI chỉ chấm Task Achievement theo nội dung đề và không kiểm tra được số liệu. Bạn vẫn có thể dán hình trong lúc làm bài.
          </p>
        ) : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={backToList}>
            <ArrowLeft className="size-4" /> Chọn đề khác
          </Button>
          <Button onClick={begin}>
            <Clock3 className="size-4" /> {warnedNoChart && noChart ? 'Vẫn bắt đầu' : 'Bắt đầu lập ý (5 phút)'}
          </Button>
        </div>
        <Attempts attempts={attempts} />
      </div>
    )
  }

  if (stage === 'review') {
    const done = job?.status === 'done'
    const result = job?.result
    const score = result?.score
    return (
      <div className="readable-xs mx-auto max-w-4xl space-y-4 pb-16">
        <PageHeader eyebrow="Writing Mock Test · Task 1" title={done ? 'Đã có kết quả chấm' : 'AI đang chấm bài…'} description={selected.prompt} />
        <Card className="space-y-4 p-5 sm:p-6">
          <Badge tone={done ? 'emerald' : 'brand'}>{done ? 'Hoàn tất' : 'Đang xử lý'}</Badge>
          <p className="text-sm text-slate-600 dark:text-slate-300">Ý tưởng tiếng Việt và bài tiếng Anh đã được gửi cùng đề bài và hình biểu đồ vào Writing Review.</p>
          {score ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-800/60 dark:bg-brand-950/30">
              <p className="text-2xl font-bold text-brand-700 dark:text-brand-300">Band {score.overall.toFixed(1)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {WRITING_TASK1_CRITERIA.map((c) => (
                  <Badge key={c.id} tone="slate" title={c.label}>
                    {c.short} {score.criteria[c.id].band}
                  </Badge>
                ))}
              </div>
            </div>
          ) : result?.scoreSkipped === 'short' ? (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              Bài dưới {TASK1_MIN_WORDS} từ nên không ước lượng band; phần sửa lỗi vẫn có trong bản chấm chi tiết.
            </p>
          ) : result?.scoreSkipped === 'error' ? (
            <p className="text-sm text-amber-700">Chưa ước lượng được band lần này; phần sửa lỗi vẫn có trong bản chấm chi tiết.</p>
          ) : null}
          {job?.status === 'running' && !result ? <WritingReviewProgress job={job} /> : null}
          {job?.status === 'running' && result ? (
            <ul className="space-y-1.5 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700">
              {(
                [
                  ['Sửa lỗi câu chữ', !result.pending?.includes('retry')],
                  ['Đọc biểu đồ và chấm band Task 1', !result.pending?.includes('score')],
                  ['So sánh với bài mẫu', !result.pending?.includes('compare')],
                ] as const
              ).map(([label, finished]) => (
                <li key={label} className={cn('flex items-center gap-2', finished ? 'text-slate-700 dark:text-slate-200' : 'text-slate-500')}>
                  {finished ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Loader2 className="size-4 animate-spin text-brand-600" />}
                  {label}
                </li>
              ))}
            </ul>
          ) : null}
          {job?.status === 'error' || error ? <p className="text-sm text-rose-600">{error || job?.error}</p> : null}
          <div className="flex flex-wrap gap-2">
            {job && (done || result) ? (
              <Button onClick={() => (window.location.href = `/practice/writing-review?id=${job.id}`)}>
                {done ? 'Mở bản chấm chi tiết' : 'Xem phần đã chấm xong'}
              </Button>
            ) : null}
            <Button variant="outline" onClick={backToList}>
              <RotateCcw className="size-4" /> Làm đề khác
            </Button>
          </div>
        </Card>
        {extras ? (
          <ModelEssayBox key={selected.id} promptId={selected.id} extras={extras} onSaved={updateExtras} />
        ) : null}
        <Attempts attempts={attempts.filter((a) => a.id !== job?.id)} />
      </div>
    )
  }

  // Step 1 (ideas) and step 2 (english).
  const isIdeas = stage === 'ideas'
  const words = countWords(english)
  return (
    <div className="readable-xs mx-auto max-w-7xl pb-16">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand-600">Writing Mock Test · Task 1</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{isIdeas ? 'Bước 1 · Lập ý tiếng Việt' : 'Bước 2 · Viết bài tiếng Anh'}</h1>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full border bg-white px-3 py-1.5 font-mono text-base font-bold shadow-sm dark:bg-slate-900',
            secondsLeft < 60 && 'border-rose-300 text-rose-600',
          )}
        >
          <Clock3 className="size-4" />
          {timerLabel(secondsLeft)}
        </span>
      </div>
      <SplitPane
        storageKey="practice:writing-mock:task1:split"
        left={
          <div className="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
            <QuestionCard prompt={selected}>
              {extras?.images.length ? (
                <ChartImages images={extras.images} />
              ) : (
                <ChartImageBox
                  promptId={selected.id}
                  extras={extras}
                  onChange={(next) => {
                    updateExtras(next)
                    void task1Api.prepare(selected.id).catch(() => {})
                  }}
                  compact
                />
              )}
            </QuestionCard>
          </div>
        }
        right={
          <Card className="space-y-4 p-4 sm:p-5">
            {!isIdeas ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="task1-idea" className="block text-sm font-semibold">Ý tưởng tiếng Việt của bạn</label>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditingIdea((v) => !v)}>
                    {editingIdea ? 'Lưu ý tưởng' : 'Sửa ý tưởng'}
                  </Button>
                </div>
                <textarea
                  id="task1-idea"
                  value={idea}
                  readOnly={!editingIdea}
                  onChange={(e) => setIdea(e.target.value)}
                  className="min-h-[140px] w-full resize-y rounded-xl border bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  placeholder="Bạn chưa ghi ý tưởng tiếng Việt."
                />
              </div>
            ) : null}
            <textarea
              value={isIdeas ? idea : english}
              onChange={(e) => (isIdeas ? setIdea(e.target.value) : setEnglish(e.target.value))}
              className="min-h-[360px] w-full rounded-xl border p-4 leading-relaxed"
              placeholder={
                isIdeas
                  ? 'Mở bài: …\nOverview: xu hướng / so sánh chính …\nThân bài 1: …\nThân bài 2: …'
                  : 'The bar chart illustrates… (mỗi đoạn một dòng)'
              }
              aria-label={isIdeas ? 'Ý tưởng tiếng Việt' : 'Bài viết tiếng Anh'}
              autoFocus
            />
            {!isIdeas ? (
              <p className={cn('text-sm font-medium tabular-nums', words >= TASK1_MIN_WORDS ? 'text-emerald-600' : 'text-amber-600')}>
                {words} từ {words >= TASK1_MIN_WORDS ? '· đủ độ dài' : `· cần ít nhất ${TASK1_MIN_WORDS} từ để có band`}
              </p>
            ) : null}
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={quit}>
                Thoát
              </Button>
              {isIdeas ? (
                <Button onClick={startEnglish}>
                  <PenLine className="size-4" /> Bắt đầu viết tiếng Anh <CheckCircle2 className="size-4" />
                </Button>
              ) : (
                <Button onClick={() => void submit()}>
                  <Send className="size-4" /> Gửi AI chấm
                </Button>
              )}
            </div>
          </Card>
        }
      />
    </div>
  )
}
