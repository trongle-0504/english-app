// Practice → Writing Review → History: every saved review, filtered by date or search keyword.
// Reviews are listed on the left; the selected review fills the wide panel on the right.
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  History,
  Loader2,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Badge, ButtonLink, Card, EmptyState, PageHeader, SearchInput } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { WritingReviewResult, WritingReviewSummary } from '@/types/writingReview'
import { writingReviewApi } from './writing-review/api'
import { WRITING_REVIEW_TOPICS, WRITING_REVIEW_TYPES } from './writing-review/categories'
import { ReviewResult } from './writing-review/ReviewResult'
import {
  dayLabel,
  HistoryDeleteButton,
  timeLabel,
} from './writing-review/WritingReviewHistoryDrawer'

type Range = 'all' | 'today' | '7d' | '30d'

const RANGES: { value: Range; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
]

function midnight(days = 0, from = new Date()): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  d.setDate(d.getDate() + days)
  return d
}

function matchesRange(createdAt: string, range: Range): boolean {
  const t = new Date(createdAt).getTime()
  if (range === 'today') return t >= midnight().getTime()
  if (range === '7d') return t >= midnight(-6).getTime()
  if (range === '30d') return t >= midnight(-29).getTime()
  return true
}

export default function WritingReviewHistoryPage() {
  const [params, setParams] = useSearchParams()
  const initialId = params.get('id') || ''

  const [range, setRange] = useState<Range>('all')
  const [search, setSearch] = useState('')
  const [topic, setTopic] = useState('all')
  const [questionType, setQuestionType] = useState('all')
  const [items, setItems] = useState<WritingReviewSummary[] | null>(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string>(initialId)
  const [results, setResults] = useState<Record<string, WritingReviewResult>>({})
  const [loadingSelected, setLoadingSelected] = useState(false)

  // Load history list on mount
  useEffect(() => {
    let active = true
    writingReviewApi.history(100).then(
      (h) => {
        if (!active) return
        setItems(h.items)
        // If no selectedId or current selectedId not in items, select the newest
        if (!selectedId && h.items.length > 0) {
          setSelectedId(h.items[0].id)
        }
      },
      (err: Error) => {
        if (active) setError(err.message)
      },
    )
    return () => {
      active = false
    }
  }, [])

  // Sync selectedId to URL query param
  useEffect(() => {
    if (selectedId) {
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('id', selectedId)
        return next
      }, { replace: true })
    }
  }, [selectedId, setParams])

  // Load full result for selected item
  useEffect(() => {
    if (!selectedId || results[selectedId]) return
    let active = true
    setLoadingSelected(true)
    writingReviewApi.get(selectedId).then(
      ({ job }) => {
        if (!active) return
        setLoadingSelected(false)
        if (job.result) {
          setResults((prev) => ({ ...prev, [selectedId]: job.result! }))
        }
      },
      (err: Error) => {
        if (!active) return
        setLoadingSelected(false)
        setError(err.message)
      },
    )
    return () => {
      active = false
    }
  }, [selectedId, results])

  // Delete review item
  const handleDelete = async (id: string) => {
    try {
      await writingReviewApi.remove(id)
      setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : null))
      setResults((prev) => {
        const copy = { ...prev }
        delete copy[id]
        return copy
      })
      if (selectedId === id) {
        const remaining = items?.filter((i) => i.id !== id) || []
        setSelectedId(remaining[0]?.id || '')
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // Filter items
  const filtered = useMemo(() => {
    if (!items) return []
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (!matchesRange(item.createdAt, range)) return false
      if (topic !== 'all' && item.topic !== topic) return false
      if (questionType !== 'all' && item.questionType !== questionType) return false
      if (!q) return true
      return (item.title || '').toLowerCase().includes(q)
    })
  }, [items, search, range, topic, questionType])

  // Group by day label
  const grouped = useMemo(() => {
    const groups: { label: string; items: WritingReviewSummary[] }[] = []
    for (const item of filtered) {
      const label = dayLabel(item.createdAt)
      const existing = groups.find((g) => g.label === label)
      if (existing) {
        existing.items.push(item)
      } else {
        groups.push({ label, items: [item] })
      }
    }
    return groups
  }, [filtered])

  const currentResult = selectedId ? results[selectedId] : null

  return (
    <div className="mx-auto max-w-7xl pb-16">
      <PageHeader
        eyebrow="Writing Review"
        title="Lịch sử đánh giá bài viết"
        description="Xem lại các bài viết đã phân tích, đối chiếu sửa lỗi collocations từ điển và bài viết mẫu NeuralSymbolic."
        actions={
          <div className="flex items-center gap-2">
            <ButtonLink to="/practice/writing-review" variant="outline" size="sm">
              <ArrowLeft className="size-4" /> Quay lại Writing Review
            </ButtonLink>
          </div>
        }
      />

      {error ? (
        <p className="mb-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Reviews List */}
        <div className="lg:col-span-4 xl:col-span-4 space-y-4">
          <Card className="p-3.5 space-y-3">
            <SearchInput
              placeholder="Tìm theo tiêu đề..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRange(r.value)}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-xs font-medium transition-all',
                    range === r.value
                      ? 'bg-brand-600 text-white shadow-xs dark:bg-brand-500 dark:text-slate-950 font-semibold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" value={questionType} onChange={(e) => setQuestionType(e.target.value)}>
                <option value="all">Tất cả dạng đề</option>
                {WRITING_REVIEW_TYPES.map((value) => <option key={value}>{value}</option>)}
              </select>
              <select className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="all">Tất cả chủ đề</option>
                {WRITING_REVIEW_TOPICS.map((value) => <option key={value}>{value}</option>)}
              </select>
            </div>
          </Card>

          {/* List items */}
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto space-y-4 pr-1">
            {items === null ? (
              <div className="py-16 text-center text-slate-400">
                <Loader2 className="mx-auto mb-2 size-6 animate-spin text-brand-600" />
                <p className="text-sm">Đang tải lịch sử…</p>
              </div>
            ) : filtered.length === 0 ? (
              <Card className="p-8 text-center text-slate-400">
                <Search className="mx-auto mb-2 size-8 opacity-40" />
                <p className="text-sm font-medium">Không tìm thấy bài viết nào</p>
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="mt-2 text-xs text-brand-600 underline dark:text-brand-400"
                  >
                    Xoá tìm kiếm
                  </button>
                ) : null}
              </Card>
            ) : (
              grouped.map((group) => (
                <div key={group.label} className="space-y-2">
                  <div className="flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wider text-slate-400">
                    <CalendarDays className="size-3.5" />
                    <span>{group.label}</span>
                    <span className="text-[11px] font-normal lowercase text-slate-400">({group.items.length})</span>
                  </div>
                  <div className="space-y-2">
                    {group.items.map((item) => {
                      const isSelected = item.id === selectedId
                      return (
                        <div
                          key={item.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedId(item.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              setSelectedId(item.id)
                            }
                          }}
                          className={cn(
                            'group relative block w-full text-left rounded-xl border p-3.5 transition-all cursor-pointer select-none',
                            isSelected
                              ? 'border-brand-500 bg-brand-50/50 shadow-xs dark:border-brand-500/80 dark:bg-brand-950/30'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                              {timeLabel(item.createdAt)}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <Badge tone="emerald" className="text-[10px] py-0 px-1.5">
                                {item.fixes} lỗi đã sửa
                              </Badge>
                              <HistoryDeleteButton onDelete={() => handleDelete(item.id)} />
                            </div>
                          </div>

                          <p className="mb-1 text-sm font-semibold text-slate-900 dark:text-white">
                            {item.title || 'Bài review không có tiêu đề'}
                          </p>

                          {item.topic || item.questionType ? (
                            <div className="mb-1.5 flex flex-wrap gap-1">
                              {item.questionType ? <Badge tone="violet" className="text-[10px] py-0 px-1.5">{item.questionType}</Badge> : null}
                              {item.topic ? <Badge tone="slate" className="text-[10px] py-0 px-1.5">{item.topic}</Badge> : null}
                            </div>
                          ) : null}

                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Review Details */}
        <div className="lg:col-span-8 xl:col-span-8">
          {loadingSelected && !currentResult ? (
            <Card className="flex flex-col items-center justify-center p-16 text-center">
              <Loader2 className="mb-3 size-8 animate-spin text-brand-600" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Đang tải kết quả bài review…</p>
            </Card>
          ) : currentResult ? (
            <div className="space-y-4">
              {/* Quick Actions Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-2.5 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {currentResult.title || 'Bài review không có tiêu đề'}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{new Date(currentResult.createdAt).toLocaleString('vi-VN')}</span>
                    <span>·</span>
                    <span className="tabular-nums">{currentResult.usage.total.toLocaleString()} tokens</span>
                  </div>
                </div>
                <ButtonLink
                  to={`/practice/writing-review?id=${currentResult.id}`}
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                >
                  <ExternalLink className="size-3.5" /> Mở ở trang Review
                </ButtonLink>
              </div>

              {/* The full review result view */}
              <ReviewResult
                result={currentResult}
                onResultChange={(updated) => {
                  setResults((prev) => ({ ...prev, [updated.id]: updated }))
                }}
              />
            </div>
          ) : (
            <EmptyState
              icon={<History className="size-10" />}
              title="Chọn bài viết để xem"
              description="Chọn một bài viết từ danh sách bên trái để xem chi tiết đối chiếu từ điển và bài viết mẫu NeuralSymbolic."
            />
          )}
        </div>
      </div>
    </div>
  )
}
