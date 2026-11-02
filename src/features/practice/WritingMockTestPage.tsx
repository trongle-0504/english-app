import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Clock3, FileText, RotateCcw, Send, Shuffle } from 'lucide-react'
import { Badge, Button, Card, PageHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useData } from '@/lib/data'
import { useLocalStorage } from '@/lib/storage'
import type { WritingReviewJob } from '@/types/writingReview'
import type { WritingMockPrompt, WritingMockTopics } from '@/types/writingMock'
import { writingReviewApi } from './writing-review/api'

type Stage = 'select' | 'ideas' | 'english' | 'review'
const IDEA_SECONDS = 15 * 60
const ENGLISH_SECONDS = 40 * 60

function timerLabel(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

export default function WritingMockTestPage() {
  const prompts = useData<WritingMockPrompt[]>('practice/writing-mock/prompts.json')
  const topicData = useData<WritingMockTopics>('practice/writing-mock/topics.json')
  const [stage, setStage] = useState<Stage>('select')
  const [topic, setTopic] = useState('all')
  const [type, setType] = useState('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [idea, setIdea] = useLocalStorage('practice:writing-mock:idea', '')
  const [english, setEnglish] = useLocalStorage('practice:writing-mock:english', '')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(IDEA_SECONDS)
  const [job, setJob] = useState<WritingReviewJob | null>(null)
  const [error, setError] = useState('')
  const submitRef = useRef<() => Promise<void>>(async () => {})

  const selected = prompts.find((item) => item.id === selectedId)
  const filtered = useMemo(
    () => prompts.filter((item) => (topic === 'all' || item.topics.includes(topic)) && (type === 'all' || item.type === type)),
    [prompts, topic, type],
  )

  const choosePrompt = useCallback(
    (random: boolean) => {
      const pool = filtered.length ? filtered : prompts
      const item = random ? pool[Math.floor(Math.random() * pool.length)] : pool[0]
      if (!item) return
      setSelectedId(item.id)
      setIdea('')
      setEnglish('')
      setError('')
      setJob(null)
      setStage('ideas')
      setStartedAt(Date.now())
      setSecondsLeft(IDEA_SECONDS)
    },
    [filtered, prompts, setEnglish, setIdea],
  )

  useEffect(() => {
    if (!startedAt || stage === 'select' || stage === 'review') return
    const timer = window.setInterval(() => {
      const limit = stage === 'ideas' ? IDEA_SECONDS : ENGLISH_SECONDS
      const remaining = limit - (Date.now() - startedAt) / 1000
      if (remaining <= 0) {
        window.clearInterval(timer)
        if (stage === 'ideas') {
          setStage('english')
          setStartedAt(Date.now())
          setSecondsLeft(ENGLISH_SECONDS)
        } else {
          void submitRef.current()
        }
      } else setSecondsLeft(remaining)
    }, 250)
    return () => window.clearInterval(timer)
  }, [stage, startedAt])

  const submit = async () => {
    if (!selected || english.trim().length < 30) {
      setError('Bài tiếng Anh cần có ít nhất 30 ký tự trước khi gửi chấm.')
      return
    }
    submitRef.current = submit
    setError('')
    try {
      const { job: created } = await writingReviewApi.start(english.trim(), idea.trim() || undefined, selected.prompt)
      setJob(created)
      setStage('review')
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

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

  const startEnglish = () => {
    setStage('english')
    setStartedAt(Date.now())
    setSecondsLeft(ENGLISH_SECONDS)
  }

  const reset = () => {
    setStage('select')
    setSelectedId(null)
    setIdea('')
    setEnglish('')
    setJob(null)
    setError('')
    setStartedAt(null)
  }

  if (stage === 'select') {
    return (
      <div className="readable-xs mx-auto max-w-5xl pb-16">
        <PageHeader eyebrow="Writing" title="Writing Mock Test" description="15 phút lập ý tưởng tiếng Việt + 40 phút viết bài tiếng Anh, sau đó AI chấm theo đề bài và ý tưởng của bạn." />
        <Card className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">Chủ đề<select className="mt-1 w-full rounded-lg border p-2.5" value={topic} onChange={(e) => setTopic(e.target.value)}><option value="all">Tất cả chủ đề</option>{topicData.topics.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="text-sm font-semibold">Dạng đề<select className="mt-1 w-full rounded-lg border p-2.5" value={type} onChange={(e) => setType(e.target.value)}><option value="all">Tất cả dạng đề</option>{topicData.types.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => choosePrompt(true)}><Shuffle className="size-4" /> Đề ngẫu nhiên</Button>
            <Button variant="outline" onClick={() => choosePrompt(false)} disabled={!filtered.length}><FileText className="size-4" /> Chọn đề đầu tiên</Button>
          </div>
          <p className="text-sm text-slate-500">{filtered.length} đề phù hợp · tổng cộng {prompts.length} đề</p>
        </Card>
      </div>
    )
  }

  if (stage === 'review' && selected) {
    const done = job?.status === 'done'
    return (
      <div className="readable-xs mx-auto max-w-4xl pb-16">
        <PageHeader eyebrow="Writing Mock Test" title={done ? 'Đã có kết quả chấm' : 'AI đang chấm bài…'} description={selected.prompt} />
        <Card className="space-y-4 p-5 sm:p-6">
          <Badge tone={done ? 'emerald' : 'brand'}>{done ? 'Hoàn tất' : 'Đang xử lý'}</Badge>
          <p className="text-sm text-slate-600 dark:text-slate-300">Ý tưởng tiếng Việt và bài tiếng Anh đã được gửi cùng đề bài vào Writing Review.</p>
          {job?.status === 'error' || error ? <p className="text-sm text-rose-600">{error || job?.error}</p> : null}
          <div className="flex flex-wrap gap-2">
            {done ? <Button onClick={() => (window.location.href = `/practice/writing-review?id=${job.id}`)}>Mở bản chấm chi tiết</Button> : null}
            <Button variant="outline" onClick={reset}><RotateCcw className="size-4" /> Làm đề khác</Button>
          </div>
        </Card>
      </div>
    )
  }

  if (!selected) return null
  const isIdeas = stage === 'ideas'
  return (
    <div className="readable-xs mx-auto max-w-5xl pb-16">
      <PageHeader eyebrow="Writing Mock Test" title={isIdeas ? 'Part 1 — Lập ý tưởng' : 'Part 2 — Viết bài tiếng Anh'} description={selected.prompt} />
      <div className="mb-4 flex items-center justify-between rounded-xl border bg-white p-3 shadow-sm dark:bg-slate-900">
        <span className="text-sm font-semibold">{isIdeas ? 'Ý tưởng tiếng Việt' : 'Bài viết tiếng Anh'}</span>
        <span className={cn('inline-flex items-center gap-1 font-mono text-lg font-bold', secondsLeft < 60 && 'text-rose-600')}><Clock3 className="size-4" />{timerLabel(secondsLeft)}</span>
      </div>
      <Card className="space-y-4 p-5 sm:p-6">
        <textarea value={isIdeas ? idea : english} onChange={(e) => (isIdeas ? setIdea(e.target.value) : setEnglish(e.target.value))} className="min-h-[360px] w-full rounded-xl border p-4 leading-relaxed" placeholder={isIdeas ? 'Viết dàn ý, luận điểm và ví dụ bằng tiếng Việt…' : 'Write your IELTS Writing Task 2 essay here…'} autoFocus />
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={reset}>Thoát</Button>
          {isIdeas ? <Button onClick={startEnglish}>Bắt đầu viết tiếng Anh <CheckCircle2 className="size-4" /></Button> : <Button onClick={() => void submit()}><Send className="size-4" /> Gửi AI chấm</Button>}
        </div>
      </Card>
    </div>
  )
}
