import { Check, ChevronRight, MoreHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/cn'
import type { PlannerTask } from '@/types/planner'
import { shortDateLabel, shortWeekday, vnDay, vnTime } from './dates'
import { SKILL_DOT, SKILL_LABELS } from './skills'

interface TaskRowProps {
  task: PlannerTask
  /** 'full' on the home and Day view, 'compact' in the Week view. */
  variant?: 'full' | 'compact'
  /** Show the date chip (overdue rows): "T4", "CN", or "4/11" if more than 6 days ago. */
  showDate?: boolean
  onToggle: (task: PlannerTask, done: boolean) => void
  onMenu?: (task: PlannerTask) => void
  /** Opened when the task has no link (the edit sheet). */
  onOpen?: (task: PlannerTask) => void
}

export function TaskRow({ task, variant = 'full', showDate = false, onToggle, onMenu, onOpen }: TaskRowProps) {
  const navigate = useNavigate()
  const done = Boolean(task.doneAt)
  const today = vnDay()
  const snoozed = task.snoozedUntil && new Date(task.snoozedUntil).getTime() > Date.now() ? vnTime(new Date(task.snoozedUntil)) : ''
  const meta = [task.time ?? 'Anytime', task.durationMin ? `${task.durationMin}′` : '', variant === 'full' ? SKILL_LABELS[task.skill] : '']
    .filter(Boolean)
    .join(' · ')

  const open = () => {
    if (task.link) navigate(task.link)
    else onOpen?.(task)
  }

  return (
    <div className={cn('flex items-center gap-1', variant === 'compact' ? 'min-h-11' : 'min-h-14')}>
      {/* 44 px hit area around a 24 px circle. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark not done: ${task.title}` : `Mark done: ${task.title}`}
        onClick={() => onToggle(task, !done)}
        className="-ml-2.5 flex size-11 shrink-0 items-center justify-center rounded-full"
      >
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full border-2 transition-all duration-200',
            done ? 'scale-100 border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600',
          )}
        >
          {done ? <Check className="animate-scale-in size-4" strokeWidth={3} /> : null}
        </span>
      </button>

      <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left">
        <span className={cn('size-2 shrink-0 rounded-full', SKILL_DOT[task.skill], done && 'opacity-40')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate font-medium',
              variant === 'compact' ? 'text-sm' : 'text-[15px]',
              done ? 'text-slate-400 line-through dark:text-slate-500' : 'text-slate-900 dark:text-slate-100',
            )}
          >
            {task.title}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            {showDate ? (
              <span className="rounded bg-amber-100 px-1.5 py-px font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                {shortDateLabel(task.date, today)}
              </span>
            ) : null}
            <span>{meta}</span>
            {task.movedFrom ? <span className="rounded bg-slate-100 px-1.5 py-px dark:bg-slate-800">moved from {shortWeekday(task.movedFrom)}</span> : null}
            {snoozed ? <span className="text-brand-600 dark:text-brand-400">snoozed until {snoozed}</span> : null}
          </span>
        </span>
        {task.link && !onMenu ? <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden /> : null}
      </button>

      {onMenu ? (
        <button
          type="button"
          onClick={() => onMenu(task)}
          aria-label={`Options: ${task.title}`}
          className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <MoreHorizontal className="size-5" />
        </button>
      ) : null}
    </div>
  )
}
