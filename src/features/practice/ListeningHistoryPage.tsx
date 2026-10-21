// Practice → Listening simplify → History: every saved analysis, filtered by date or text. The analyses are listed on
// the left; the chosen one (transcript, questions and the full analysis) fills the wide panel on the right.
import { ArrowLeft, CalendarDays, FileText, History, Loader2, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { ListeningHistoryItem, ListeningSaved } from '@/types/listening'
import { listeningApi } from './listening-simplify/api'
import { SimplifyResultView } from './listening-simplify/SimplifyResultView'

type Range = 'all' | 'today' | '7d' | '30d' | 'day'

const RANGES: { value: Range; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
]

/** Local midnight `days` days from today (negative = earlier). */
function midnight(days = 0, from = new Date()): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  d.setDate(d.getDate() + days)
  return d
}

/** The range as ISO times in local days; `day` is a yyyy-mm-dd from the date picker. */
function bounds(range: Range, day: string): { from?: string; to?: string } {
  if (range === 'today') return { from: midnight().toISOString() }
  if (range === '7d') return { from: midnight(-6).toISOString() }
  if (range === '30d') return { from: midnight(-29).toISOString() }
  if (range === 'day' && day) {
    const [y, m, d] = day.split('-').map(Number)
    const start = new Date(y, m - 1, d)
    return { from: start.toISOString(), to: midnight(1, start).toISOString() }
  }
  return {}
}

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })

/** Trash icon that asks once ("Xoá?") before deleting; the question goes away by itself after 4 s. */
function DeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
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
      title="Xoá bản phân tích này"
      aria-label="Xoá bản phân tích này"
      className="rounded p-1 text-slate-400 opacity-40 transition-colors group-hover/item:opacity-100 hover:bg-rose-50 hover:text-rose-600 hover:!opacity-100 dark:hover:bg-rose-950/40"
    >
      <Trash2 className="size-4" />
    </button>
  )
}

export default function ListeningHistoryPage() {
  const [range, setRange] = useState<Range>('all')
  const [day, setDay] = useState('')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<ListeningHistoryItem[] | null>(null)
  const [error, setError] = useState('')
  const [chosenId, setSelectedId] = useState('')
  const [saved, setSaved] = useState<Record<string, ListeningSaved>>({})

  // The list for the chosen dates.
  useEffect(() => {
    let active = true
    listeningApi.history(bounds(range, day)).then(
      ({ items: next }) => {
        if (!active) return
        setItems(next)
        setError('')
      },
      (err: Error) => active && setError(err.message),
    )
    return () => {
      active = false
    }
  }, [range, day])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!items || !q) return items ?? []
    return items.filter((i) => [i.title, i.preview, ...i.sections].some((t) => t.toLowerCase().includes(q)))
  }, [items, search])

  // Rows grouped by local day, newest first (the list already is).
  const days = useMemo(() => {
    const groups: { day: string; items: ListeningHistoryItem[] }[] = []
    for (const item of filtered) {
      const label = dayLabel(item.createdAt)
      const last = groups.at(-1)
      if (last?.day === label) last.items.push(item)
      else groups.push({ day: label, items: [item] })
    }
    return groups
  }, [filtered])

  // The newest analysis opens when nothing (still listed) is chosen.
  const selectedId = filtered.some((i) => i.id === chosenId) ? chosenId : (filtered[0]?.id ?? '')

  // The chosen analysis in full (kept once loaded).
  useEffect(() => {
    if (!selectedId || saved[selectedId]) return
    let active = true
    listeningApi.get(selectedId).then(
      ({ saved: next }) => active && setSaved((prev) => ({ ...prev, [selectedId]: next })),
      (err: Error) => active && setError(err.message),
    )
    return () => {
      active = false
    }
  }, [selectedId, saved])

  const remove = async (id: string) => {
    try {
      await listeningApi.remove(id)
    } catch (err) {
      setError((err as Error).message)
      return
    }
    setItems((prev) => (prev ?? []).filter((i) => i.id !== id))
    setSaved((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const current = selectedId ? saved[selectedId] : undefined

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Listening · Simplify"
        title="Lịch sử phân tích transcript"
        description="Mọi transcript bạn đã phân tích: chọn một bài bên trái để xem lại toàn bộ bản phân tích."
        actions={
          <ButtonLink to="/practice/listening-simplify" variant="ghost" size="sm">
            <ArrowLeft className="size-4" /> Simplify
          </ButtonLink>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => {
              setRange(r.value)
              setDay('')
            }}
            className={cn(
              'rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-colors',
              range === r.value
                ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
                : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {r.label}
          </button>
        ))}

        <span className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />

        <label
          className={cn(
            'inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors',
            range === 'day'
              ? 'border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-950/40 dark:text-brand-200'
              : 'border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200',
          )}
        >
          <CalendarDays className="size-4 opacity-70" />
          <input
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value)
              setRange(e.target.value ? 'day' : 'all')
            }}
            className="bg-transparent font-medium [color-scheme:light] focus:outline-none dark:[color-scheme:dark]"
            aria-label="Chọn ngày"
          />
        </label>

        <div className="relative min-w-44 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tiêu đề, nội dung..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-1.5 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900"
          />
        </div>

        {items ? (
          <span className="ml-auto pr-2 text-xs text-slate-500">
            <span className="font-bold text-slate-900 tabular-nums dark:text-white">{filtered.length}</span> bài
          </span>
        ) : null}
      </div>

      {error ? <p className="mb-4 text-sm text-rose-600">{error}</p> : null}

      {items && !filtered.length ? (
        <EmptyState
          icon={<History className="size-6" />}
          title="Chưa có bản phân tích nào"
          description="Thử chọn khoảng ngày khác hoặc đổi từ khoá tìm kiếm. Mỗi lần bấm Phân tích sẽ được lưu vào đây."
        />
      ) : (
        <div className="grid items-start gap-6 md:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4 md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto md:pr-1">
            {!items ? <Loader2 className="size-5 animate-spin text-slate-400" /> : null}
            {days.map((group) => (
              <div key={group.day} className="space-y-2">
                <p className="px-1 text-xs font-semibold text-slate-500 capitalize dark:text-slate-400">{group.day}</p>
                {group.items.map((item) => {
                  const active = item.id === selectedId
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'group/item rounded-2xl border bg-white shadow-sm transition-colors dark:bg-slate-900',
                        active ? 'border-brand-400 ring-2 ring-brand-500/15 dark:border-brand-500' : 'border-slate-200 dark:border-slate-800',
                      )}
                    >
                      <div className="flex items-start gap-1 p-3">
                        <button type="button" onClick={() => setSelectedId(item.id)} className="min-w-0 flex-1 space-y-1 text-left">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                'truncate text-sm font-bold',
                                active ? 'text-brand-800 dark:text-brand-200' : 'text-slate-900 dark:text-white',
                              )}
                              title={item.title}
                            >
                              {item.title || 'Transcript'}
                            </span>
                            <span className="ml-auto shrink-0 text-xs text-slate-400 tabular-nums">{timeLabel(item.createdAt)}</span>
                          </span>
                          <span className="line-clamp-2 block text-[13px] leading-snug text-slate-500 dark:text-slate-400">{item.preview}</span>
                          <span className="flex flex-wrap gap-1 pt-0.5">
                            <Badge tone={item.mode === 'podcast' ? 'violet' : 'sky'}>{item.mode === 'podcast' ? 'Podcast' : 'IELTS'}</Badge>
                            <Badge tone="slate">{item.sentences} câu</Badge>
                            <Badge tone="slate">{item.sections.length} phần</Badge>
                            {item.hasQuestions ? <Badge tone="amber">có đáp án</Badge> : null}
                          </span>
                        </button>
                        <DeleteButton onDelete={() => remove(item.id)} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </aside>

          <div className="min-w-0 space-y-4">
            {current ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-slate-500">
                    {new Date(current.createdAt).toLocaleString('vi-VN')} · {current.result.model}
                  </p>
                  <ButtonLink to={`/practice/listening-simplify?id=${current.id}`} variant="ghost" size="sm" className="ml-auto">
                    <RotateCcw className="size-4" /> Mở trong trang phân tích
                  </ButtonLink>
                </div>
                <Card className="p-0">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <FileText className="size-4 text-slate-400" /> Transcript gốc
                      {current.questions ? <span className="font-normal text-slate-400">+ câu hỏi / đáp án</span> : null}
                      <span className="ml-auto text-xs font-normal text-slate-400 group-open:hidden">Bấm để mở</span>
                    </summary>
                    <div className="space-y-3 border-t border-slate-100 px-5 py-4 text-[14.5px] leading-relaxed whitespace-pre-line text-slate-700 dark:border-slate-800 dark:text-slate-300">
                      <p>{current.transcript}</p>
                      {current.questions ? <p className="rounded-xl bg-slate-50 px-3 py-2 text-[13.5px] dark:bg-slate-800/60">{current.questions}</p> : null}
                    </div>
                  </details>
                </Card>
                <SimplifyResultView key={current.id} result={current.result} />
              </>
            ) : selectedId ? (
              <Card className="flex min-h-60 items-center justify-center">
                <Loader2 className="size-6 animate-spin text-slate-400" />
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
