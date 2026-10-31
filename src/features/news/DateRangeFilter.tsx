import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Tag, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { NEWS_TOPICS } from '@/types/news'

export interface DateRange {
  from: string | null
  to: string | null
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function toYmd(y: number, m0: number, d: number): string {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`
}

export function todayVnYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return toYmd(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
}

function formatShortVi(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return d && m && y ? `${d}/${m}/${y}` : ymd
}

function formatPrettyEn(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(dt)
}

export function matchesDateRange(ymd: string, range: DateRange): boolean {
  if (!range.from && !range.to) return true
  if (!ymd) return false
  const start = range.from ?? range.to!
  const end = range.to ?? range.from!
  return ymd >= start && ymd <= end
}

export function DateRangePopover({
  range,
  onChange,
  dateCounts,
}: {
  range: DateRange
  onChange: (next: DateRange) => void
  dateCounts: ReadonlyMap<string, number>
}) {
  const today = useMemo(() => todayVnYmd(), [])
  const initialBase = range.to ?? range.from ?? today
  const [viewYear, setViewYear] = useState<number>(() => Number(initialBase.slice(0, 4)) || new Date().getFullYear())
  const [viewMonth0, setViewMonth0] = useState<number>(() => (Number(initialBase.slice(5, 7)) || new Date().getMonth() + 1) - 1)
  const [open, setOpen] = useState(false)
  const [selectingEnd, setSelectingEnd] = useState(false)

  const cells = useMemo(() => {
    const firstDayWeek = new Date(Date.UTC(viewYear, viewMonth0, 1)).getUTCDay()
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth0 + 1, 0)).getUTCDate()
    const daysInPrevMonth = new Date(Date.UTC(viewYear, viewMonth0, 0)).getUTCDate()

    const list: { ymd: string; day: number; inMonth: boolean }[] = []

    for (let i = firstDayWeek - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i
      const dt = new Date(Date.UTC(viewYear, viewMonth0 - 1, d))
      list.push({
        ymd: toYmd(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()),
        day: d,
        inMonth: false,
      })
    }

    for (let d = 1; d <= daysInMonth; d++) {
      list.push({
        ymd: toYmd(viewYear, viewMonth0, d),
        day: d,
        inMonth: true,
      })
    }

    const rem = 42 - list.length
    for (let d = 1; d <= rem; d++) {
      const dt = new Date(Date.UTC(viewYear, viewMonth0 + 1, d))
      list.push({
        ymd: toYmd(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()),
        day: d,
        inMonth: false,
      })
    }
    return list
  }, [viewYear, viewMonth0])

  const prevMonth = () => {
    if (viewMonth0 === 0) {
      setViewYear((y) => y - 1)
      setViewMonth0(11)
    } else {
      setViewMonth0((m) => m - 1)
    }
  }

  const nextMonth = () => {
    if (viewMonth0 === 11) {
      setViewYear((y) => y + 1)
      setViewMonth0(0)
    } else {
      setViewMonth0((m) => m + 1)
    }
  }

  const handleDayClick = (ymd: string) => {
    if (!selectingEnd || !range.from) {
      onChange({ from: ymd, to: ymd })
      setSelectingEnd(true)
    } else {
      if (ymd < range.from) {
        onChange({ from: ymd, to: range.from })
      } else {
        onChange({ from: range.from, to: ymd })
      }
      setSelectingEnd(false)
      setOpen(false)
    }
  }

  const hasFilter = Boolean(range.from || range.to)
  const isSingleDay = hasFilter && range.from === range.to

  const triggerLabel = useMemo(() => {
    if (!hasFilter) return 'Tất cả ngày'
    if (isSingleDay) return formatShortVi(range.from!)
    return `${ range.from!.slice(8, 10) }/${ range.from!.slice(5, 7) } – ${ range.to!.slice(8, 10) }/${ range.to!.slice(5, 7) }`
  }, [hasFilter, isSingleDay, range])

  const topHeaderLabel = useMemo(() => {
    if (!hasFilter) return formatPrettyEn(today)
    if (isSingleDay) return formatPrettyEn(range.from!)
    return `${formatShortVi(range.from!)} → ${formatShortVi(range.to!)}`
  }, [hasFilter, isSingleDay, range, today])

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSelectingEnd(false)
      }}
    >
      <div className="relative flex items-center">
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-8 w-full items-center justify-between gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition outline-none',
              hasFilter
                ? 'border-brand-300 bg-brand-50/70 text-brand-800 dark:border-brand-800 dark:bg-brand-950/50 dark:text-brand-200'
                : 'border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
            )}
          >
            <span className="inline-flex items-center gap-1.5 truncate">
              <Calendar className="size-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
              <span className="truncate">{triggerLabel}</span>
            </span>
            {!hasFilter ? <ChevronDown className="size-3.5 shrink-0 opacity-60" /> : <span className="w-3.5 shrink-0" />}
          </button>
        </Popover.Trigger>
        {hasFilter ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onChange({ from: null, to: null })
              setSelectingEnd(false)
            }}
            className="absolute right-1.5 inline-flex size-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title="Xóa lọc ngày"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="animate-scale-in z-50 w-72 overflow-hidden rounded-2xl border border-slate-200/90 bg-white/98 shadow-2xl shadow-slate-900/15 backdrop-blur-xl outline-none dark:border-slate-800 dark:bg-slate-900/98"
        >
          {/* Top Selected Date Bar (matches screenshot header) */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 dark:border-slate-800/80 dark:bg-slate-800/40">
            <span className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{topHeaderLabel}</span>
            {selectingEnd ? (
              <button
                type="button"
                onClick={() => {
                  setSelectingEnd(false)
                  setOpen(false)
                }}
                className="shrink-0 rounded-md bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-2xs hover:bg-brand-700 dark:bg-brand-500 dark:text-slate-950"
              >
                Chọn ngày cuối hoặc bấm Xong
              </button>
            ) : (
              <span className="shrink-0 rounded-md bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Chọn 1 ngày / khoảng
              </span>
            )}
          </div>

          <div className="p-3.5">
            {/* Month & Year Navigation */}
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                {MONTH_NAMES[viewMonth0]} {viewYear}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="inline-flex size-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="inline-flex size-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                  aria-label="Next month"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>

            {/* Weekday Header */}
            <div className="mb-1 grid grid-cols-7 text-center">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  {w}
                </span>
              ))}
            </div>

            {/* 42-Cell Calendar Grid */}
            <div className="grid grid-cols-7 gap-y-1 text-center">
              {cells.map((c) => {
                const count = dateCounts.get(c.ymd) ?? 0
                const isStart = range.from === c.ymd
                const isEnd = range.to === c.ymd
                const isSelectedEndpoint = isStart || isEnd
                const inRange =
                  Boolean(range.from && range.to) && c.ymd > range.from! && c.ymd < range.to!
                const isToday = c.ymd === today

                return (
                  <div
                    key={c.ymd}
                    className={cn(
                      'relative flex items-center justify-center py-0.5',
                      inRange && 'bg-brand-50 dark:bg-brand-950/50',
                      isStart && range.to && range.to !== range.from && 'rounded-l-full bg-brand-50 dark:bg-brand-950/50',
                      isEnd && range.from && range.to !== range.from && 'rounded-r-full bg-brand-50 dark:bg-brand-950/50',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleDayClick(c.ymd)}
                      title={count ? `${formatShortVi(c.ymd)}: ${count} bài báo` : formatShortVi(c.ymd)}
                      className={cn(
                        'relative flex size-8 flex-col items-center justify-center rounded-full text-xs font-medium transition outline-none',
                        isSelectedEndpoint
                          ? 'bg-brand-600 font-bold text-white shadow-sm shadow-brand-600/30 dark:bg-brand-500 dark:text-slate-950'
                          : inRange
                            ? ' font-semibold text-brand-800 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-900/50'
                            : c.inMonth
                              ? 'text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                              : 'text-slate-400/70 hover:bg-slate-100 dark:text-slate-600 dark:hover:bg-slate-800/50',
                        isToday && !isSelectedEndpoint && 'ring-1 ring-brand-500/60 font-bold text-brand-700 dark:text-brand-300',
                      )}
                    >
                      <span>{c.day}</span>
                      {count > 0 ? (
                        <span
                          className={cn(
                            'mt-0.5 size-1 rounded-full',
                            isSelectedEndpoint ? 'bg-white dark:bg-slate-950' : 'bg-brand-500 dark:bg-brand-400',
                          )}
                        />
                      ) : null}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Quick Presets Footer */}
          <div className="flex flex-wrap items-center justify-between gap-1 border-t border-slate-100 bg-slate-50/70 px-3 py-2 dark:border-slate-800/80 dark:bg-slate-800/40">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  onChange({ from: null, to: null })
                  setSelectingEnd(false)
                  setOpen(false)
                }}
                className={cn(
                  'rounded-lg px-2 py-1 text-[11px] font-semibold transition',
                  !hasFilter
                    ? 'bg-brand-600 text-white dark:bg-brand-500 dark:text-slate-950'
                    : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                Tất cả
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange({ from: today, to: today })
                  setSelectingEnd(false)
                  setOpen(false)
                }}
                className={cn(
                  'rounded-lg px-2 py-1 text-[11px] font-semibold transition',
                  isSingleDay && range.from === today
                    ? 'bg-brand-600 text-white dark:bg-brand-500 dark:text-slate-950'
                    : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                Hôm nay
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange({ from: shiftYmd(today, -6), to: today })
                  setSelectingEnd(false)
                  setOpen(false)
                }}
                className="rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                7 ngày qua
              </button>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function TopicFilterDropdown({
  value,
  onChange,
  topicCounts,
}: {
  value: string
  onChange: (next: string) => void
  topicCounts: ReadonlyMap<string, number>
}) {
  const active = value !== 'all'
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-8 w-full items-center justify-between gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition outline-none',
            active
              ? 'border-brand-300 bg-brand-50/70 text-brand-800 dark:border-brand-800 dark:bg-brand-950/50 dark:text-brand-200'
              : 'border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
          )}
        >
          <span className="inline-flex items-center gap-1.5 truncate">
            <Tag className="size-3.5 shrink-0 text-indigo-500" />
            <span className="truncate">{active ? value : 'Tất cả chủ đề'}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="animate-scale-in scrollbar-thin z-50 max-h-72 min-w-48 overflow-y-auto rounded-2xl border border-slate-200/90 bg-white/98 p-1.5 shadow-2xl shadow-slate-900/15 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/98"
        >
          <DropdownMenu.Item
            onSelect={() => onChange('all')}
            className="flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none data-[highlighted]:bg-slate-100 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800"
          >
            <span>Tất cả chủ đề</span>
            {value === 'all' ? <Check className="size-3.5 text-brand-600" /> : null}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
          {NEWS_TOPICS.map((tp) => {
            const c = topicCounts.get(tp) ?? 0
            return (
              <DropdownMenu.Item
                key={tp}
                onSelect={() => onChange(tp)}
                className="flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none data-[highlighted]:bg-slate-100 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800"
              >
                <span className={cn(value === tp && 'font-bold text-brand-700 dark:text-brand-300')}>{tp}</span>
                <span className="flex items-center gap-1.5">
                  {c > 0 ? (
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.2 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {c}
                    </span>
                  ) : null}
                  {value === tp ? <Check className="size-3.5 text-brand-600" /> : null}
                </span>
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
