import { CalendarArrowDown, MapPin, Pencil, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { PlannerEvent, PlannerEventAhead } from '@/types/planner'
import * as api from './api'
import { daysLeftLabel, viDayMonth, viWeekday } from './dates'
import { EVENT_KIND_LABELS, EVENT_KIND_TONE } from './skills'
import { showToast } from './toast'

/** Upcoming events with countdown chips; past ones collapsed. Each: Sửa · Thêm vào Lịch (.ics) · Xoá. */
export function EventsView({ version, onChanged, onEdit }: { version: number; onChanged: () => void; onEdit: (event: PlannerEvent) => void }) {
  const [events, setEvents] = useState<PlannerEventAhead[] | null>(null)
  const load = useCallback(() => {
    api
      .getEvents()
      .then(setEvents)
      .catch((err: Error) => showToast(err.message))
  }, [])
  useEffect(() => load(), [load, version])

  const remove = async (event: PlannerEvent) => {
    if (!window.confirm(`Xoá “${event.title}”?`)) return
    try {
      await api.deleteEvent(event.id)
      showToast('Đã xoá.')
      load()
      onChanged()
    } catch (err) {
      showToast((err as Error).message)
    }
  }

  if (!events)
    return (
      <div className="space-y-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    )

  const upcoming = events.filter((e) => e.daysLeft >= 0)
  const past = events.filter((e) => e.daysLeft < 0).reverse()

  const row = (e: PlannerEventAhead) => (
    <li key={e.id} className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 dark:text-white">{e.title}</p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
            {viWeekday(e.date)} {viDayMonth(e.date)}
            {e.time ? ` · ${e.time}${e.endTime ? `–${e.endTime}` : ''}` : ''}
          </p>
          {e.location ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
              <MapPin className="size-3" /> {e.location}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', EVENT_KIND_TONE[e.kind])}>{EVENT_KIND_LABELS[e.kind]}</span>
          <span className={cn('text-xs font-semibold', e.daysLeft >= 0 && e.daysLeft <= 7 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500')}>{daysLeftLabel(e.daysLeft)}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <button type="button" onClick={() => onEdit(e)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          <Pencil className="size-4" /> Sửa
        </button>
        <a
          href={api.eventIcsUrl(e.id)}
          download
          className={cn(
            'inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold',
            e.kind === 'exam' ? 'bg-brand-600 text-white dark:bg-brand-500 dark:text-slate-950' : 'text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/40',
          )}
        >
          <CalendarArrowDown className="size-4" /> Thêm vào Lịch
        </a>
        <button type="button" onClick={() => void remove(e)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40">
          <Trash2 className="size-4" /> Xoá
        </button>
      </div>
    </li>
  )

  return (
    <div className="space-y-4">
      {upcoming.length ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">{upcoming.map(row)}</ul>
      ) : (
        <p className="py-8 text-center text-sm text-slate-500">Chưa có sự kiện sắp tới. Bấm + để thêm ngày thi, buổi học hoặc hạn nộp.</p>
      )}
      <p className="text-xs text-slate-500">“Thêm vào Lịch” tải file .ics: lịch của điện thoại sẽ tự nhắc kể cả khi máy tính chạy app đang tắt.</p>
      {past.length ? (
        <details className="group border-t border-slate-100 pt-3 dark:border-slate-800">
          <summary className="min-h-10 cursor-pointer text-sm font-semibold text-slate-500">Đã qua ({past.length})</summary>
          <ul className="divide-y divide-slate-100 opacity-70 dark:divide-slate-800">{past.map(row)}</ul>
        </details>
      ) : null}
    </div>
  )
}
