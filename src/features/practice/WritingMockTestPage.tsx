import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Clock3, FileText, RotateCcw, Send, Shuffle } from 'lucide-react'
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput } from '@/components/ui'
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
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [idea, setIdea] = useLocalStorage('practice:writing-mock:idea', '')
  const [english, setEnglish] = useLocalStorage('practice:writing-mock:english', '')
  const [editingIdea, setEditingIdea] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(IDEA_SECONDS)
  const [job, setJob] = useState<WritingReviewJob | null>(null)
  const [error, setError] = useState('')
  const submitRef = useRef<() => Promise<void>>(async () => {})

  const selected = prompts.find((item) => item.id === selectedId)
  const filtered = useMemo(
    () =>
      prompts.filter(
        (item) =>
          (topic === 'all' || item.topics.includes(topic)) &&
          (type === 'all' || item.type === type) &&
          (!query.trim() || `${item.prompt} ${item.topics.join(' ')} ${item.type}`.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [prompts, query, topic, type],
  )

  const choosePrompt = useCallback(
    (random: boolean, requested?: WritingMockPrompt) => {
      const pool = filtered.length ? filtered : prompts
      const item = requested ?? (random ? pool[Math.floor(Math.random() * pool.length)] : pool[0])
      if (!item) return
      setSelectedId(item.id)
      setIdea('')
      setEnglish('')
      setEditingIdea(false)
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
    setError('')
    try {
      const { job: created } = await writingReviewApi.start(english.trim(), idea.trim() || undefined, selected.prompt)
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
    setEditingIdea(false)
    setJob(null)
    setError('')
    setStartedAt(null)
  }

  if (stage === 'select') {
    return (
      <div className="mx-auto max-w-6xl pb-16">
        <PageHeader eyebrow="Writing" title="Writing Mock Test" description="15 phút lập ý tưởng tiếng Việt + 40 phút viết bài tiếng Anh, sau đó AI chấm theo đề bài và ý tưởng của bạn." />
        <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <Card className="p-4">
              <h2 className="mb-3 text-lg font-bold">Tìm kiếm</h2>
              <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm đề bài…" className="w-full" />
            </Card>
            <Card className="p-4">
              <h2 className="mb-3 text-lg font-bold">Bộ lọc</h2>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Dạng đề</label>
              <select className="mb-4 w-full rounded-lg border p-2.5 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="all">Tất cả dạng đề</option>
                {topicData.types.map((item) => <option key={item}>{item}</option>)}
              </select>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Chủ đề</label>
              <select className="w-full rounded-lg border p-2.5 text-sm" value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="all">Tất cả chủ đề</option>
                {topicData.topics.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Card>
            <Button className="w-full" onClick={() => choosePrompt(true)} disabled={!filtered.length}><Shuffle className="size-4" /> Làm đề ngẫu nhiên</Button>
          </aside>
          <main className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">Đề bài <span className="text-sm font-normal text-slate-500">({filtered.length})</span></h2>
              <span className="text-sm text-slate-500">Chọn một đề để vào làm bài</span>
            </div>
            <div className="space-y-3">
              {filtered.map((item) => (
                <Card key={item.id} className="p-4 transition-shadow hover:shadow-md sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge tone="violet">{item.type}</Badge>
                        {item.topics.map((itemTopic) => <Badge key={itemTopic} tone="slate">{itemTopic}</Badge>)}
                      </div>
                      <p className="font-semibold leading-relaxed text-slate-900 dark:text-white">{item.prompt}</p>
                    </div>
                    <Button size="sm" className="self-start" onClick={() => choosePrompt(false, item)}><FileText className="size-4" /> Vào làm bài</Button>
                  </div>
                </Card>
              ))}
              {!filtered.length ? <EmptyState title="Không tìm thấy đề phù hợp" description="Hãy đổi từ khóa hoặc bộ lọc." /> : null}
            </div>
          </main>
        </div>
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
      <PageHeader eyebrow="Writing Mock Test" title="Writing Mock Test" description={selected.prompt} />
      <div className="mb-3 flex justify-end">
        <span className={cn('inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1.5 font-mono text-base font-bold shadow-sm dark:bg-slate-900', secondsLeft < 60 && 'border-rose-300 text-rose-600')}>
          <Clock3 className="size-4" />{timerLabel(secondsLeft)}
        </span>
      </div>
      <Card className="space-y-4 p-5 sm:p-6">
        {!isIdeas ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="writing-mock-vietnamese-idea" className="block text-sm font-semibold">Ý tưởng tiếng Việt của bạn</label>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditingIdea((value) => !value)}>
                {editingIdea ? 'Lưu ý tưởng' : 'Sửa ý tưởng'}
              </Button>
            </div>
            <textarea
              id="writing-mock-vietnamese-idea"
              value={idea}
              readOnly={!editingIdea}
              onChange={(e) => setIdea(e.target.value)}
              className="min-h-[220px] w-full resize-y rounded-xl border bg-slate-50 p-4 leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-200"
              placeholder="Bạn chưa ghi ý tưởng tiếng Việt."
              aria-label="Ý tưởng tiếng Việt dùng để chuyển sang bài viết tiếng Anh"
            />
          </div>
        ) : null}
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
