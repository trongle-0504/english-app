import { ChevronLeft, ChevronRight, Copy, Repeat, Settings2, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { PlannerTask, PlannerWeek } from '@/types/planner'
import * as api from './api'
import { addDays, formatMinutes, isoWeekday, dayMonth, viWeekday, vnDay, weekStart } from './dates'
import { RoutineSheet } from './RoutineSheet'
import { TaskRow } from './TaskRow'
import { showToast } from './toast'
import { WeekDraftSheet } from './WeekDraftSheet'

/** One block per day with planned minutes against the day's capacity; routine, copy and AI draft actions. */
export function WeekView({ version, onChanged, onMenu, onEdit }: { version: number; onChanged: () => void; onMenu: (task: PlannerTask) => void; onEdit: (task: PlannerTask) => void }) {
  const today = vnDay()
  const [start, setStart] = useState(weekStart(today))
  const [week, setWeek] = useState<PlannerWeek | null>(null)
  const [routineOpen, setRoutineOpen] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)

  const load = useCallback(() => {
    api
      .getWeek(start)
      .then(setWeek)
      .catch((err: Error) => showToast(err.message))
  }, [start])
  useEffect(() => load(), [load, version])

  const changed = () => {
    load()
    onChanged()
  }

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

  const run = async (action: () => Promise<number>, label: string) => {
    try {
      const added = await action()
      showToast(added ? `${label}: added ${added} ${added === 1 ? 'task' : 'tasks'}.` : `${label}: nothing new to add.`)
      changed()
    } catch (err) {
      showToast((err as Error).message)
    }
  }

  const all = week?.start === start ? week.days.flatMap((d) => d.tasks) : []
  const minutes = all.reduce((s, t) => s + (t.durationMin ?? 0), 0)
  const end = addDays(start, 6)

  const chip = 'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))} className="flex size-11 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
          <ChevronLeft className="size-5" />
        </button>
        <div className="text-center">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Week of {dayMonth(start)} – {dayMonth(end)}
          </h2>
          <p className="text-xs text-slate-500">
            {all.length} tasks · {formatMinutes(minutes)} · {all.filter((t) => t.doneAt).length} done
          </p>
        </div>
        <button type="button" aria-label="Next week" onClick={() => setStart(addDays(start, 7))} className="flex size-11 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <button type="button" className={cn(chip, 'border-violet-200 text-violet-700 dark:border-violet-800 dark:text-violet-300')} onClick={() => setDraftOpen(true)}>
          <Sparkles className="size-4" /> Plan with AI
        </button>
        <button type="button" className={chip} onClick={() => void run(() => api.applyRoutine(start), 'Routine')}>
          <Repeat className="size-4" /> Apply routine
        </button>
        <button type="button" className={chip} onClick={() => void run(() => api.copyWeek(addDays(start, -7), start), 'Copy last week')}>
          <Copy className="size-4" /> Copy last week
        </button>
        <button type="button" className={chip} onClick={() => setRoutineOpen(true)}>
          <Settings2 className="size-4" /> Routine…
        </button>
      </div>

      {!week || week.start !== start ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {week.days.map((d) => {
            const planned = d.tasks.reduce((s, t) => s + (t.durationMin ?? 0), 0)
            const capacity = week.settings.minutesPerDay[isoWeekday(d.day) - 1] ?? 0
            return (
              <section key={d.day} className={cn('py-3', d.day < today && 'opacity-60')}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className={cn('font-bold', d.day === today ? 'text-brand-600 dark:text-brand-400' : 'text-slate-900 dark:text-white')}>
                    {viWeekday(d.day)} <span className="font-normal text-slate-400">{dayMonth(d.day)}</span>
                  </h3>
                  <span className={cn('text-xs tabular-nums', planned > capacity ? 'font-semibold text-amber-600' : 'text-slate-500')}>
                    {formatMinutes(planned)} / {formatMinutes(capacity)}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={cn('h-full rounded-full', planned > capacity ? 'bg-amber-500' : 'bg-brand-500')} style={{ width: `${capacity ? Math.min(100, (planned / capacity) * 100) : planned ? 100 : 0}%` }} />
                </div>
                {d.events.map((e) => (
                  <p key={e.id} className="mt-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                    {e.time ? `${e.time} ` : ''}
                    {e.title}
                  </p>
                ))}
                {d.tasks.length ? (
                  <ul>
                    {d.tasks.map((t) => (
                      <li key={t.id}>
                        <TaskRow task={t} variant="compact" onToggle={toggle} onMenu={onMenu} onOpen={onEdit} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-xs text-slate-400">Free</p>
                )}
              </section>
            )
          })}
        </div>
      )}

      {week ? (
        <>
          <RoutineSheet open={routineOpen} onOpenChange={setRoutineOpen} routine={week.routine} onSaved={load} />
          <WeekDraftSheet open={draftOpen} onOpenChange={setDraftOpen} start={start} minutesPerDay={week.settings.minutesPerDay} onAdded={changed} />
        </>
      ) : null}
    </div>
  )
}
