import { Check, History, Loader2, Plus, ServerOff, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card, PageHeader, SectionTitle } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useLocalStorage } from '@/lib/storage'
import { useQueryParam } from '@/lib/useQueryParam'
import type { WritingReviewJob, WritingReviewSummary } from '@/types/writingReview'
import { MAX_LENGTH, MIN_LENGTH, OfflineError, STEPS, writingReviewApi } from './writing-review/api'
import { ReviewResult } from './writing-review/ReviewResult'
import { DolStatusBanner } from './DolStatusBanner'
import {
  dayLabel,
  HistoryDeleteButton,
  timeLabel,
  WritingReviewHistoryDrawer,
} from './writing-review/WritingReviewHistoryDrawer'

const POLL_MS = 2000

/** Live view of a running review: steps and elapsed time. */
function Progress({ job }: { job: WritingReviewJob }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const current = STEPS.findIndex((s) => s.id === job.step)
  const elapsed = Math.max(0, Math.round((now - Date.parse(job.startedAt)) / 1000))
  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <Loader2 className="size-4 animate-spin text-brand-600" /> Đang review…{' '}
          <span className="text-sm font-normal text-slate-500 tabular-nums">{elapsed}s</span>
        </h2>
      </div>
      <ol className="mt-4 grid gap-1.5 sm:grid-cols-3">
        {STEPS.map((step, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'todo'
          return (
            <li
              key={step.id}
              className={cn('flex items-center gap-2 text-sm', state === 'todo' ? 'text-slate-400' : 'text-slate-700 dark:text-slate-200')}
            >
              {state === 'done' ? (
                <Check className="size-4 text-emerald-600" />
              ) : state === 'active' ? (
                <Loader2 className="size-4 animate-spin text-brand-600" />
              ) : (
                <span className="size-4 rounded-full border border-slate-300 dark:border-slate-600" />
              )}
              <span className={cn(state === 'active' && 'font-semibold')}>{step.label}</span>
            </li>
          )
        })}
      </ol>
      <p className="mt-4 text-xs text-slate-500">Thường mất 1–2 phút. Bạn có thể rời trang — quay lại đây sẽ thấy kết quả.</p>
    </Card>
  )
}

export default function WritingReviewPage() {
  const [text, setText] = useState('')
  const [vietnameseText, setVietnameseText] = useState('')
  const [id, setId] = useQueryParam('id')
  // The last review started here: shown again when the page opens without ?id=
  const [lastId, setLastId] = useLocalStorage('practice:writing-review-last', '')
  const shownId = id || lastId
  const [job, setJob] = useState<WritingReviewJob | null>(null)
  const [historyItems, setHistoryItems] = useState<WritingReviewSummary[]>([])
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false)
  const [engine, setEngine] = useState('antigravity')
  const [offline, setOffline] = useState(false)
  const [ready, setReady] = useState(true)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    try {
      localStorage.removeItem('practice:writing-review-draft')
    } catch {}
  }, [])

  // Load history & engine status
  const loadHistory = useCallback(() => {
    writingReviewApi.history().then(
      (h) => {
        setHistoryItems(h.items)
        setReady(h.ready)
        if (h.engine) setEngine(h.engine)
      },
      (err: Error) => setOffline(err instanceof OfflineError),
    )
  }, [])
  useEffect(loadHistory, [loadHistory])

  // Follow the review on screen: poll while it runs, stop when it is done.
  useEffect(() => {
    if (!shownId) {
      setJob(null)
      return
    }
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const { job: next } = await writingReviewApi.get(shownId)
        if (!active) return
        setJob(next)
        if (next.status === 'running') {
          timer = setTimeout(tick, POLL_MS)
        } else if (next.status === 'done') {
          loadHistory()
        }
      } catch (err) {
        if (!active) return
        // The remembered review was deleted: just show the empty page.
        if (!id && shownId === lastId) setLastId('')
        else setError((err as Error).message)
      }
    }
    void tick()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [shownId, id, lastId, setLastId, loadHistory])

  const start = async () => {
    setError('')
    setStarting(true)
    try {
      const { job: created } = await writingReviewApi.start(text, vietnameseText.trim() || undefined)
      setJob(created)
      setLastId(created.id)
      setId(created.id)
      loadHistory()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const handleDelete = async (deleteId: string) => {
    try {
      await writingReviewApi.remove(deleteId)
      setHistoryItems((prev) => prev.filter((i) => i.id !== deleteId))
      if (shownId === deleteId) {
        newReview()
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const running = job?.status === 'running'
  // The input shows only when no review is on screen; "Review bài mới" brings it back.
  const composing = !shownId
  const newReview = () => {
    setLastId('')
    setId('')
    setJob(null)
    setError('')
    setText('')
    setVietnameseText('')
  }
  const length = text.trim().length

  return (
    <div className="readable-xs mx-auto max-w-4xl pb-16">
      <PageHeader
        eyebrow="Writing"
        title="Writing review"
        description="Paste an IELTS Writing paragraph: AI finds spelling, grammar, collocation, word-choice and naturalness errors, then rewrites it. Every replacement word must be found in Longman or OZDIC (Oxford Collocations)."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHistoryDrawer(true)}
              title="Xem lịch sử các bài review đã lưu"
            >
              <History className="size-4" /> Lịch sử {historyItems.length > 0 ? `(${historyItems.length})` : ''}
            </Button>
            {!composing && !running ? (
              <Button size="sm" onClick={newReview}>
                <Plus className="size-4" /> Review bài mới
              </Button>
            ) : null}
          </div>
        }
      />
      <DolStatusBanner className="mb-5" />


      {offline ? (
        <p className="mb-5 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <ServerOff className="size-4 shrink-0" /> Writing review cần server của app (npm run dev / npm start).
        </p>
      ) : null}

      <div className="space-y-6">
        {composing ? (
          <>
            <Card className="space-y-4 p-4 sm:p-6">
            <label className="block">
              <span className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                <span>Ý tưởng / Đoạn văn tiếng Việt gốc (Khuyến khích)</span>
                <span className="text-xs font-normal text-slate-500">Giúp AI hiểu đúng 100% ý muốn diễn đạt để sửa lỗi sát nghĩa nhất</span>
              </span>
              <textarea
                rows={4}
                value={vietnameseText}
                onChange={(e) => setVietnameseText(e.target.value)}
                placeholder="Nhập ý tưởng hoặc đoạn văn tiếng Việt của bạn (ví dụ: Em tôi cố gắng thi đậu vào trường đại học danh giá để giảm bớt gánh nặng tài chính cho ba mẹ...)"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] leading-relaxed focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-800 dark:text-slate-100">Đoạn văn tiếng Anh cần review</span>
              <textarea
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="There are several explanations as to why more people are shifting towards a healthy diet…"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] leading-relaxed focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={() => void start()}
                loading={starting}
                disabled={running || starting || offline || !ready || length < MIN_LENGTH || length > MAX_LENGTH}
              >
                <ShieldCheck className="size-5" /> Review
              </Button>
              <span className={cn('text-xs tabular-nums', length > MAX_LENGTH ? 'text-rose-600' : 'text-slate-500')}>
                {length}/{MAX_LENGTH} ký tự · khoảng 1–3 phút
              </span>
              {!ready ? (
                <span className="text-xs text-rose-600">
                  {engine === 'antigravity'
                    ? "Cần cài Antigravity CLI ('agy')."
                    : 'Cần cài Claude Code (lệnh claude) và đăng nhập một lần.'}
                </span>
              ) : null}
            </div>
            {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}
          </Card>

          {historyItems.length > 0 ? (
            <section className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <SectionTitle count={historyItems.length}>
                  <History className="size-4 text-brand-600" />
                  Lịch sử review gần đây
                </SectionTitle>
                <button
                  type="button"
                  onClick={() => setShowHistoryDrawer(true)}
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline dark:text-brand-400"
                >
                  Xem tất cả ({historyItems.length}) →
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {historyItems.slice(0, 4).map((item) => (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setLastId(item.id)
                      setId(item.id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setLastId(item.id)
                        setId(item.id)
                      }
                    }}
                    className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-4 text-left shadow-xs transition-all hover:border-brand-400 hover:shadow-md cursor-pointer select-none dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/80"
                  >
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {timeLabel(item.createdAt)} · {dayLabel(item.createdAt)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Badge tone="emerald" className="text-[10px] py-0 px-1.5">
                            {item.fixes} lỗi đã sửa
                          </Badge>
                          <HistoryDeleteButton onDelete={() => handleDelete(item.id)} />
                        </div>
                      </div>

                      {item.vietnameseExcerpt ? (
                        <p className="mb-1.5 text-xs text-amber-900/90 dark:text-amber-300/90 line-clamp-2">
                          <span className="font-semibold text-amber-700 dark:text-amber-400 mr-1">Ý tưởng:</span>
                          {item.vietnameseExcerpt}
                        </p>
                      ) : null}

                      <p className="text-[13px] leading-snug text-slate-700 dark:text-slate-300 line-clamp-3">
                        {item.excerpt}
                      </p>
                    </div>

                    <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-100 text-xs font-semibold text-brand-600 group-hover:text-brand-700 dark:border-slate-800/80 dark:text-brand-400">
                      <span>Xem lại kết quả</span>
                      <span className="transition-transform group-hover:translate-x-0.5">→</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          </>
        ) : null}

        {job?.status === 'running' ? <Progress job={job} /> : null}
        {job?.status === 'error' ? (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">Review lỗi: {job.error}</p>
        ) : null}
        {job?.status === 'done' && job.result ? (
          <ReviewResult result={job.result} onResultChange={(updated) => setJob((prev) => (prev ? { ...prev, result: updated } : null))} />
        ) : null}
      </div>

      {/* History Drawer */}
      <WritingReviewHistoryDrawer
        isOpen={showHistoryDrawer}
        onClose={() => setShowHistoryDrawer(false)}
        items={historyItems}
        currentId={shownId}
        onSelect={(selectedId) => {
          setLastId(selectedId)
          setId(selectedId)
        }}
        onDelete={handleDelete}
      />
    </div>
  )
}
