// Practice → Speaking ideas → History: every saved suggestion, grouped by day and filtered by date. The questions are
// listed on the left; the chosen one's model answer and full analysis fill the wide panel on the right.
import { ArrowLeft, CalendarDays, History, Layers, Loader2, Mic, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ExportReport } from '@/features/report/ExportReport'
import type { SpeakingHistoryItem, SpeakingPart, SpeakingResult } from '@/types/speaking'
import type { TalkHistoryItem } from '@/types/speakingReview'
import { speakingApi } from './speaking-ideas/api'
import { QuestionPanel } from './speaking-ideas/SuggestionResult'
import { groupByTopic } from './speaking-ideas/topicGroups'
import { useAddToReview } from './speaking-ideas/useAddToReview'
import { talkApi } from './speaking-review/api'
import { practiceKey, practiceStats } from './speaking-review/practiceStats'

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

/** Trash icon that asks once ("Xoá?") before deleting; the question goes away by itself after 4 s. */
function DeleteButton({
  onDelete,
  title = 'Xoá lần gợi ý này',
  small = false,
}: {
  onDelete: () => Promise<void>
  title?: string
  small?: boolean
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])
  if (busy) return <Loader2 className={cn('animate-spin text-slate-400', small ? 'size-3.5' : 'size-4')} />
  return armed ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setBusy(true)
        void onDelete().finally(() => setBusy(false))
      }}
      className={cn(
        'rounded font-semibold text-white transition-colors bg-rose-600 hover:bg-rose-700',
        small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
      )}
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
      className={cn(
        'rounded text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40',
        small ? 'p-1 opacity-40 group-hover/item:opacity-100 hover:!opacity-100' : 'p-1',
      )}
    >
      <Trash2 className={small ? 'size-3.5' : 'size-4'} />
    </button>
  )
}

export default function SpeakingHistoryPage() {
  const [searchParams] = useSearchParams()
  const deepId = searchParams.get('id') || null
  const rawDeepQ = searchParams.get('q')
  const deepQ = rawDeepQ !== null && /^\d+$/.test(rawDeepQ) ? Number(rawDeepQ) : 0
  const deepLinkHandled = useRef(false)

  const [range, setRange] = useState<Range>('all')
  const [day, setDay] = useState('')
  const [partFilter, setPartFilter] = useState<'all' | '1' | '2' | '3'>('all')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<SpeakingHistoryItem[] | null>(null)
  const [talkItems, setTalkItems] = useState<TalkHistoryItem[]>([])
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<{ id: string; index: number } | null>(() =>
    deepId ? { id: deepId, index: deepQ } : null,
  )
  const [results, setResults] = useState<Record<string, SpeakingResult>>({})
  const review = useAddToReview()
  const stats = useMemo(() => practiceStats(talkItems), [talkItems])

  useEffect(() => {
    talkApi
      .history()
      .then((r) => setTalkItems(r.items))
      .catch(() => {})
  }, [])

  // The list for the chosen dates; the newest question is opened when nothing (still listed) is chosen.
  useEffect(() => {
    let active = true
    speakingApi.history(bounds(range, day)).then(
      ({ items: next }) => {
        if (!active) return
        if (!deepLinkHandled.current && deepId) {
          if (!next.some((i) => i.id === deepId) && range !== 'all') {
            setRange('all')
            setDay('')
            return
          }
          deepLinkHandled.current = true
          setItems(next)
          setError('')
          if (next.some((i) => i.id === deepId)) {
            const targetItem = next.find((i) => i.id === deepId)!
            const clampedIdx = Math.min(deepQ, Math.max(0, targetItem.questions.length - 1))
            setSelected({ id: deepId, index: clampedIdx })
            return
          }
        }
        setItems(next)
        setError('')
        setSelected((current) => (current && next.some((i) => i.id === current.id) ? current : next[0] ? { id: next[0].id, index: 0 } : null))
      },
      (err: Error) => active && setError(err.message),
    )
    return () => {
      active = false
    }
  }, [range, day, deepId, deepQ])

  // The chosen suggestion's full result (kept once loaded).
  const selectedId = selected?.id
  useEffect(() => {
    if (!selectedId || results[selectedId]) return
    let active = true
    speakingApi.get(selectedId).then(
      ({ job }) => active && job.result && setResults((prev) => ({ ...prev, [selectedId]: job.result! })),
      (err: Error) => active && setError(err.message),
    )
    return () => {
      active = false
    }
  }, [selectedId, results])

  /** A suggestion's full result for a report: the one already loaded, else read once. */
  const loadResult = async (id: string): Promise<SpeakingResult> => {
    if (results[id]) return results[id]
    const { job } = await speakingApi.get(id)
    if (!job.result) throw new Error('Không đọc được một lần gợi ý của chủ đề này.')
    return job.result
  }

  // Removes a session; when it was the one on screen, the next one in the list opens.
  const remove = async (id: string) => {
    try {
      await speakingApi.remove(id)
    } catch (err) {
      setError((err as Error).message)
      return
    }
    const rest = (items ?? []).filter((i) => i.id !== id)
    setItems(rest)
    setResults((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (selected?.id === id) setSelected(rest[0] ? { id: rest[0].id, index: 0 } : null)
  }

  // Removes all sessions of a merged topic group
  const removeTopicGroup = async (sessions: SpeakingHistoryItem[]) => {
    for (const s of sessions) {
      try {
        await speakingApi.remove(s.id)
      } catch {
        // continue best effort
      }
    }
    const sessionIds = new Set(sessions.map((s) => s.id))
    const rest = (items ?? []).filter((i) => !sessionIds.has(i.id))
    setItems(rest)
    setResults((prev) => {
      const next = { ...prev }
      for (const id of sessionIds) delete next[id]
      return next
    })
    if (selected && sessionIds.has(selected.id)) {
      setSelected(rest[0] ? { id: rest[0].id, index: 0 } : null)
    }
  }

  // Removes a single question from a session
  const removeQuestion = async (id: string, index: number) => {
    try {
      const res = await speakingApi.removeQuestion(id, index)
      if (res.deletedSession) {
        // Entire session deleted because it only had this question
        const rest = (items ?? []).filter((i) => i.id !== id)
        setItems(rest)
        setResults((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        if (selected?.id === id) {
          setSelected(rest[0] ? { id: rest[0].id, index: 0 } : null)
        }
      } else if (res.result) {
        const updatedResult = res.result
        setResults((prev) => ({
          ...prev,
          [id]: updatedResult,
        }))
        setItems((prev) =>
          (prev ?? []).map((i) =>
            i.id === id
              ? {
                  ...i,
                  questions: updatedResult.answers.map((a) => a.question),
                }
              : i,
          ),
        )
        if (selected?.id === id) {
          if (selected.index === index) {
            const nextIdx = Math.min(index, updatedResult.answers.length - 1)
            setSelected({ id, index: nextIdx })
          } else if (selected.index > index) {
            setSelected({ id, index: selected.index - 1 })
          }
        }
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // Group by (topic name + part), deduplicate duplicate questions, and apply search & filters
  const topicGroups = useMemo(() => {
    if (!items) return []
    const part: SpeakingPart | 'all' = partFilter === 'all' ? 'all' : (Number(partFilter) as SpeakingPart)
    return groupByTopic(items, { part, search })
  }, [items, partFilter, search])

  // Automatically select the first available question if none is currently selected or if current selection is filtered out
  useEffect(() => {
    if (!topicGroups.length) {
      setSelected(null)
      return
    }
    const allQuestions = topicGroups.flatMap((g) => g.questions)
    const exists = selected && allQuestions.some((q) => q.id === selected.id && q.index === selected.index)
    if (!exists) {
      const first = allQuestions[0]
      if (first) {
        setSelected({ id: first.id, index: first.index })
      }
    }
  }, [topicGroups, selected])

  const result = selected ? results[selected.id] : undefined
  const answer = result?.answers[selected!.index]

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Speaking · Speaking ideas"
        title="Speaking history"
        description="Every topic you asked for suggestions on: pick a question on the left to see its model answer and full analysis."
        actions={
          <ButtonLink to="/practice/speaking-ideas" variant="ghost" size="sm">
            <ArrowLeft className="size-4" /> Speaking ideas
          </ButtonLink>
        }
      />

      {/* Filter toolbar: Date Range, Part filter, Search input */}
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
            className="bg-transparent font-medium focus:outline-none [color-scheme:light] dark:[color-scheme:dark]"
            aria-label="Chọn ngày"
          />
        </label>

        <span className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />

        {/* Part Filters (All / Part 1 / Part 2 / Part 3) */}
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-0.5 dark:bg-slate-800">
          {(
            [
              ['all', 'Tất cả Part'],
              ['1', 'Part 1'],
              ['2', 'Part 2'],
              ['3', 'Part 3'],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setPartFilter(val)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors',
                partFilter === val
                  ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-brand-300'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search bar */}
        <div className="relative min-w-44 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo chủ đề, câu hỏi..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-1.5 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900"
          />
        </div>

        {items ? (
          <span className="ml-auto pr-2 text-xs text-slate-500">
            <span className="font-bold text-slate-900 tabular-nums dark:text-white">{topicGroups.length}</span> chủ đề (
            <span className="font-semibold text-slate-700 tabular-nums dark:text-slate-300">
              {topicGroups.reduce((acc, g) => acc + g.questions.length, 0)}
            </span>{' '}
            câu)
          </span>
        ) : null}
      </div>

      {error ? <p className="mb-4 text-sm text-rose-600">{error}</p> : null}

      {items && !topicGroups.length ? (
        <EmptyState icon={<History className="size-6" />} title="Không tìm thấy gợi ý nào" description="Thử chọn khoảng ngày hoặc thay đổi từ khoá tìm kiếm / bộ lọc Part." />
      ) : (
        <div className="grid items-start gap-6 md:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4 md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto md:pr-1">
            {!items ? <Loader2 className="size-5 animate-spin text-slate-400" /> : null}

            {topicGroups.map((group) => {
              const isOpen = group.sessions.some((s) => s.id === selected?.id)
              const hasMultipleSessions = group.sessions.length > 1

              return (
                <div
                  key={group.topicKey}
                  className={cn(
                    'rounded-2xl border bg-white p-3.5 shadow-sm transition-colors dark:bg-slate-900',
                    isOpen
                      ? 'border-brand-400 ring-2 ring-brand-500/15 dark:border-brand-500'
                      : 'border-slate-200 dark:border-slate-800',
                  )}
                >
                  {/* Two lines: the topic on its own (it can be long), then its badges, time and actions. */}
                  <div className="mb-2 space-y-1.5 px-0.5">
                    <p className="font-bold leading-snug break-words text-slate-900 dark:text-white" title={group.topic}>
                      {group.topic}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <Badge tone="brand">P{group.part}</Badge>
                      {hasMultipleSessions ? (
                        <span
                          className="inline-flex items-center gap-0.5 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-brand-700 dark:bg-brand-950/60 dark:text-brand-300"
                          title={`Đã gom ${group.sessions.length} lần gợi ý của cùng chủ đề này`}
                        >
                          <Layers className="size-3" /> {group.sessions.length} đợt
                        </span>
                      ) : null}
                      <span className="text-xs text-slate-400 tabular-nums">{timeLabel(group.latestCreatedAt)}</span>
                      <span className="ml-auto flex items-center gap-1">
                        <ExportReport
                          compact
                          kind="speaking-group"
                          topic={group.topic}
                          questions={group.questions.filter((q) => !q.isDuplicate).map(({ id, index }) => ({ id, index }))}
                          load={loadResult}
                        />
                        <DeleteButton
                          onDelete={() =>
                            hasMultipleSessions ? removeTopicGroup(group.sessions) : remove(group.sessions[0].id)
                          }
                        />
                      </span>
                    </div>
                  </div>

                  <ol className="space-y-1">
                    {group.questions.map((qItem, qIdx) => {
                      const isActive = selected?.id === qItem.id && selected?.index === qItem.index
                      const stat = stats.get(practiceKey(qItem.id, qItem.question))
                      return (
                        <li key={`${qItem.id}-${qItem.index}`} className="group/item flex items-start gap-1">
                          <button
                            type="button"
                            onClick={() => setSelected({ id: qItem.id, index: qItem.index })}
                            className={cn(
                              'flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                              isActive
                                ? 'bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950/50 dark:text-brand-200'
                                : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                            )}
                          >
                            <span
                              className={cn(
                                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                                isActive
                                  ? 'bg-brand-600 text-white dark:bg-brand-500'
                                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800',
                              )}
                            >
                              {qIdx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <span className="line-clamp-2 whitespace-pre-line">{qItem.question}</span>
                              {qItem.isDuplicate || stat ? (
                                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                  {qItem.isDuplicate ? (
                                    <span className="inline-block rounded bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                                      Hỏi lại lúc {timeLabel(qItem.createdAt)} {new Date(qItem.createdAt).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' })}
                                    </span>
                                  ) : null}
                                  {stat ? (
                                    <span
                                      className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                      title={`Đã luyện ${stat.count} lần trong Speaking review (best ${stat.best.toFixed(1)})`}
                                    >
                                      <Mic className="size-2.5" /> {stat.count}× · {stat.best.toFixed(1)}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </button>
                          <div className="shrink-0 pt-1.5 pr-0.5">
                            <DeleteButton
                              small
                              title="Xoá câu hỏi này khỏi lịch sử"
                              onDelete={() => removeQuestion(qItem.id, qItem.index)}
                            />
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              )
            })}
          </aside>

          <div className="min-w-0">
            {answer && result ? (
              <>
                <p className="mb-3 text-xs text-slate-500">
                  {result.topic} · {new Date(result.createdAt).toLocaleString('vi-VN')} · câu {selected!.index + 1}/{result.answers.length}
                </p>
                <QuestionPanel
                  key={`${selected!.id}-${selected!.index}`}
                  answer={answer}
                  part={result.part}
                  number={selected!.index + 1}
                  resultId={selected!.id}
                  answerIndex={selected!.index}
                  added={review.added}
                  onAdd={review.add}
                  onAnalyzeEdit={async (edited: string) => {
                    const { job: started } = await speakingApi.analyzeEdit(selected!.id, selected!.index, edited, result.part)
                    while (true) {
                      await new Promise((resolve) => setTimeout(resolve, 2000))
                      const { job } = await speakingApi.getAnalyzeEdit(started.id)
                      if (job.status === 'done' && job.result) {
                        setResults((prev) => ({ ...prev, [selected!.id]: job.result! }))
                        return
                      }
                      if (job.status === 'error') throw new Error(job.error || 'Không thể phân tích bài sửa.')
                    }
                  }}
                  onResetEdit={async () => {
                    const { result: updated } = await speakingApi.resetEdit(selected!.id, selected!.index)
                    setResults((prev) => ({ ...prev, [selected!.id]: updated }))
                  }}
                />
                {review.error ? <p className="mt-3 text-sm text-rose-600">{review.error}</p> : null}
              </>
            ) : selected ? (
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
