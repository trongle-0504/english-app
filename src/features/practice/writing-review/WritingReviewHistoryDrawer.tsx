import { CalendarDays, Check, History, Loader2, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, SearchInput } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { WritingReviewSummary } from '@/types/writingReview'
import { WRITING_REVIEW_TOPICS, WRITING_REVIEW_TYPES } from './categories'

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

export const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

export const dayLabel = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hôm nay'
  if (d.toDateString() === yesterday.toDateString()) return 'Hôm qua'
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })
}

/** Trash icon with single-click confirmation ("Xoá?") before executing. */
export function HistoryDeleteButton({
  onDelete,
  title = 'Xoá bài review này',
}: {
  onDelete: () => Promise<void>
  title?: string
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])

  if (busy) return <Loader2 className="size-4 animate-spin text-slate-400" />

  return armed ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setBusy(true)
        void onDelete().finally(() => setBusy(false))
      }}
      className="rounded bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white transition-colors hover:bg-rose-700"
    >
      Xoá?
    </button>
  ) : (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setArmed(true)
      }}
      title={title}
      aria-label={title}
      className="relative hit-area rounded p-1 text-slate-400 opacity-60 transition-colors hover:bg-rose-50 hover:text-rose-600 hover:opacity-100 dark:hover:bg-rose-950/40"
    >
      <Trash2 className="size-4" />
    </button>
  )
}

export function WritingReviewHistoryDrawer({
  isOpen,
  onClose,
  items,
  currentId,
  onSelect,
  onDelete,
}: {
  isOpen: boolean
  onClose: () => void
  items: WritingReviewSummary[]
  currentId?: string
  onSelect: (id: string) => void
  onDelete: (id: string) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<Range>('all')
  const [topic, setTopic] = useState('all')
  const [questionType, setQuestionType] = useState('all')

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const filtered = useMemo(() => {
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in">
      {/* Backdrop click to close */}
      <div className="fixed inset-0" onClick={onClose} aria-hidden />

      {/* Drawer content */}
      <div className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-2xl transition-transform dark:bg-slate-900 sm:border-l sm:border-slate-200 dark:sm:border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
              <History className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Lịch sử Writing Review</h2>
              <p className="text-xs text-slate-500">{items.length} bài đã lưu</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/practice/writing-review/history"
              onClick={onClose}
              className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline dark:text-brand-400"
            >
              Mở trang đầy đủ ↗
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              aria-label="Đóng"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="border-b border-slate-100 bg-slate-50/70 p-3.5 space-y-2.5 dark:border-slate-800 dark:bg-slate-900/50">
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
                    : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
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
        </div>

        {/* Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {grouped.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <Search className="mx-auto mb-2 size-8 opacity-40" />
              <p className="text-sm font-medium">Không tìm thấy bài viết nào phù hợp</p>
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="mt-2 text-xs text-brand-600 underline dark:text-brand-400"
                >
                  Xoá tìm kiếm
                </button>
              ) : null}
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.label} className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <CalendarDays className="size-3.5" />
                  <span>{group.label}</span>
                  <span className="text-[11px] font-normal lowercase text-slate-400">({group.items.length})</span>
                </div>
                <div className="space-y-2.5">
                  {group.items.map((item) => {
                    const isSelected = item.id === currentId
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          onSelect(item.id)
                          onClose()
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            onSelect(item.id)
                            onClose()
                          }
                        }}
                        className={cn(
                          'group relative block w-full text-left rounded-xl border p-3 transition-all cursor-pointer select-none',
                          isSelected
                            ? 'border-brand-500 bg-brand-50/40 shadow-xs dark:border-brand-500/80 dark:bg-brand-950/20'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                            {timeLabel(item.createdAt)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {isSelected ? (
                              <Badge tone="brand" className="text-[10px] py-0 px-1.5">
                                <Check className="size-3" /> Đang xem
                              </Badge>
                            ) : null}
                            {item.overall !== undefined ? (
                              <Badge tone="brand" className="text-[10px] py-0 px-1.5 font-bold">
                                Band {item.overall.toFixed(1)}
                              </Badge>
                            ) : null}
                            <Badge tone="emerald" className="text-[10px] py-0 px-1.5">
                              {item.fixes} lỗi đã sửa
                            </Badge>
                            <HistoryDeleteButton onDelete={() => onDelete(item.id)} />
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
    </div>
  )
}
