import { ChevronDown, Layers, Lightbulb, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, ButtonLink, EmptyState, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { SpeakingHistoryItem, SpeakingPart } from '@/types/speaking'
import type { TalkHistoryItem } from '@/types/speakingReview'
import { groupByTopic } from '../speaking-ideas/topicGroups'
import { practiceKey, practiceStats } from './practiceStats'

const PART_FILTERS: { value: 'all' | '1' | '2' | '3'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '1', label: 'Part 1' },
  { value: '2', label: 'Part 2' },
  { value: '3', label: 'Part 3' },
]

export function IdeasPicker({
  speakingItems,
  talkHistory,
  defaultPart,
  initialResultId,
  onPick,
}: {
  speakingItems: SpeakingHistoryItem[] | null
  talkHistory: TalkHistoryItem[]
  defaultPart: string
  initialResultId?: string | null
  onPick: (suggestionId: string, answerIndex: number) => void
}) {
  const initialPartFilter: 'all' | '1' | '2' | '3' =
    defaultPart === '1' || defaultPart === '2' || defaultPart === '3' ? defaultPart : 'all'
  const [partFilter, setPartFilter] = useState<'all' | '1' | '2' | '3'>(initialPartFilter)
  const [search, setSearch] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const stats = useMemo(() => practiceStats(talkHistory), [talkHistory])

  // If initialResultId belongs to a different part than initialPartFilter, include all parts or use unfiltered check
  const allGroups = useMemo(() => (speakingItems ? groupByTopic(speakingItems) : []), [speakingItems])
  const initialGroupKey = useMemo(() => {
    if (!initialResultId) return null
    const found = allGroups.find((g) => g.sessions.some((s) => s.id === initialResultId))
    return found?.topicKey ?? null
  }, [allGroups, initialResultId])

  const groups = useMemo(() => {
    if (!speakingItems) return []
    const part: SpeakingPart | 'all' = partFilter === 'all' ? 'all' : (Number(partFilter) as SpeakingPart)
    return groupByTopic(speakingItems, { part, search })
  }, [speakingItems, partFilter, search])

  const activeGroupKey = useMemo(() => {
    if (expandedKey !== null) return expandedKey === '__none__' ? null : expandedKey
    if (initialGroupKey && groups.some((g) => g.topicKey === initialGroupKey)) return initialGroupKey
    return groups[0]?.topicKey ?? null
  }, [expandedKey, initialGroupKey, groups])

  if (speakingItems === null) {
    return (
      <div className="space-y-3 py-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (speakingItems.length === 0) {
    return (
      <EmptyState
        icon={<Lightbulb className="size-8" />}
        title="Chưa có câu hỏi nào trong Speaking ideas"
        description="Tạo bài mẫu hoặc danh sách cụm từ theo chủ đề trong Speaking ideas trước, sau đó quay lại đây để luyện nói."
        action={
          <ButtonLink to="/practice/speaking-ideas" size="sm">
            Mở Speaking ideas
          </ButtonLink>
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* Filter bar: search + Part */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo chủ đề hoặc câu hỏi…"
            className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pr-3 pl-9 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
          {PART_FILTERS.map((pf) => (
            <button
              key={pf.value}
              type="button"
              onClick={() => setPartFilter(pf.value)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors',
                partFilter === pf.value
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
              )}
            >
              {pf.label}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-800">
          Không có câu hỏi nào khớp bộ lọc.{' '}
          {partFilter !== 'all' ? (
            <button
              type="button"
              onClick={() => setPartFilter('all')}
              className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
            >
              Xem tất cả Part
            </button>
          ) : null}
        </p>
      ) : (
        <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
          {groups.map((group) => {
            const uniqueQuestions = group.questions.filter((q) => !q.isDuplicate)
            const practisedCount = uniqueQuestions.filter((q) => stats.has(practiceKey(q.id, q.question))).length
            const isOpen = activeGroupKey === group.topicKey
            return (
              <div
                key={group.topicKey}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70"
              >
                <button
                  type="button"
                  onClick={() => setExpandedKey(isOpen ? '__none__' : group.topicKey)}
                  className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-bold text-slate-900 dark:text-white">{group.topic}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <Badge tone="brand">P{group.part}</Badge>
                      {group.sessions.length > 1 ? (
                        <Badge tone="indigo">
                          <Layers className="size-3" /> {group.sessions.length} đợt
                        </Badge>
                      ) : null}
                      <span>
                        đã luyện {practisedCount}/{uniqueQuestions.length} câu
                      </span>
                    </div>
                  </div>
                  <ChevronDown
                    className={cn('size-4 shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')}
                  />
                </button>

                {isOpen ? (
                  <ul className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/50 dark:divide-slate-800/80 dark:border-slate-800 dark:bg-slate-950/30">
                    {uniqueQuestions.map((q, idx) => {
                      const stat = stats.get(practiceKey(q.id, q.question))
                      return (
                        <li key={`${q.id}-${q.index}`}>
                          <button
                            type="button"
                            onClick={() => onPick(q.id, q.index)}
                            className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-brand-50/60 dark:hover:bg-brand-950/30"
                          >
                            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-200/80 text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {idx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                                {q.question}
                              </p>
                              {!q.answered || stat ? (
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  {!q.answered ? <Badge tone="amber">Chưa có bài mẫu</Badge> : null}
                                  {stat ? (
                                    <Badge tone="emerald">
                                      Đã luyện {stat.count}× · best {stat.best.toFixed(1)}
                                    </Badge>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
