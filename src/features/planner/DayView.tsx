import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { PlannerEvent, PlannerTask, PlannerWeek } from '@/types/planner'
import * as api from './api'
import { addDays, dayMonth, longDate, shortWeekday, vnDay, weekStart } from './dates'
import { EVENT_KIND_TONE, SKILL_DOT } from './skills'
import { TaskRow } from './TaskRow'
import { showToast } from './toast'

/** Week strip + the selected day's events, timed tasks ("Scheduled") and the rest ("Anytime"). */
export function DayView({
  version,
  onChanged,
  onMenu,
  onEdit,
  onEditEvent,
}: {
  version: number
  onChanged: () => void
  onMenu: (task: PlannerTask) => void
  onEdit: (task: PlannerTask) => void
  onEditEvent: (event: PlannerEvent) => void
}) {
  const today = vnDay()
  const [day, setDay] = useState(today)
  const [week, setWeek] = useState<PlannerWeek | null>(null)
  const start = weekStart(day)

  const load = useCallback(() => {
    api
      .getWeek(start)
      .then(setWeek)
      .catch((err: Error) => showToast(err.message))
  }, [start])

  useEffect(() => load(), [load, version])

  const toggle = async (task: PlannerTask, done: boolean) => {
    setWeek((w) => w && { ...w, days: w.days.map((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, doneAt: done ? new Date().toISOString() : undefined } : t)) })) })
    try {
      await api.setDone(task.id, done)
      onChanged()
    } catch (err) {
      showToast((err as Error).message)
      load()
    }
  }

  const current = week?.start === start ? week.days.find((d) => d.day === day) : undefined
  const tasks = [...(current?.tasks ?? [])].sort((a, b) => Number(Boolean(a.doneAt)) - Number(Boolean(b.doneAt)))
  const timed = tasks.filter((t) => t.time)
  const anytime = tasks.filter((t) => !t.time)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Previous week" onClick={() => setDay(addDays(start, -7))} className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
          <ChevronLeft className="size-5" />
        </button>
        <div className="grid flex-1 grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => {
            const list = week?.start === start ? (week.days.find((x) => x.day === d)?.tasks ?? []) : []
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                aria-pressed={d === day}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl text-xs transition-colors',
                  d === day ? 'bg-brand-600 text-white dark:bg-brand-500 dark:text-slate-950' : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                  d === today && d !== day && 'ring-2 ring-brand-500/40',
                )}
              >
                <span className={cn('font-semibold', d === day ? 'text-white/80 dark:text-slate-900/70' : 'text-slate-500')}>{shortWeekday(d)}</span>
                <span className="text-base font-bold tabular-nums">{Number(d.slice(8))}</span>
                <span className="flex h-1.5 gap-0.5">
                  {list.slice(0, 4).map((t) => (
                    <span key={t.id} className={cn('size-1.5 rounded-full', t.doneAt ? 'bg-slate-300' : d === day ? 'bg-white' : SKILL_DOT[t.skill])} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
        <button type="button" aria-label="Next week" onClick={() => setDay(addDays(start, 7))} className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
          <ChevronRight className="size-5" />
        </button>
      </div>

      <h2 className="text-lg font-bold text-slate-900 dark:text-white">
        {day === today ? 'Today · ' : ''}
        {longDate(day)}
      </h2>

      {!week ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : (
        <>
          {current?.events.length ? (
            <div className="flex flex-wrap gap-2">
              {current.events.map((e) => (
                <button key={e.id} type="button" onClick={() => onEditEvent(e)} className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold', EVENT_KIND_TONE[e.kind])}>
                  {e.time ? `${e.time} · ` : ''}
                  {e.title}
                  {e.location ? (
                    <span className="inline-flex items-center gap-0.5 font-normal opacity-80">
                      <MapPin className="size-3" />
                      {e.location}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {timed.length ? (
            <section>
              <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Scheduled</h3>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {timed.map((t) => (
                  <li key={t.id}>
                    <TaskRow task={t} onToggle={toggle} onMenu={onMenu} onOpen={onEdit} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {anytime.length ? (
            <section>
              <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Anytime</h3>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {anytime.map((t) => (
                  <li key={t.id}>
                    <TaskRow task={t} onToggle={toggle} onMenu={onMenu} onOpen={onEdit} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!tasks.length && !current?.events.length ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Nothing planned for {day === today ? 'today' : dayMonth(day)}. Tap + to add.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
