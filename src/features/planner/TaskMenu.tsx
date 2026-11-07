import { AlarmClock, ArrowRight, CalendarDays, Pencil, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { PlannerTask } from '@/types/planner'
import * as api from './api'
import { addDays, vnDay } from './dates'
import { inputClass, Sheet } from './Sheet'
import { showToast } from './toast'

/** Row menu: Edit · Snooze 1 hour · Move to tomorrow · Move to date… · Delete. */
export function TaskMenu({ task, onClose, onEdit, onChanged }: { task: PlannerTask | null; onClose: () => void; onEdit: (task: PlannerTask) => void; onChanged: () => void }) {
  const [pickDay, setPickDay] = useState('')

  const run = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action()
      showToast(message)
      onChanged()
      onClose()
    } catch (err) {
      showToast((err as Error).message)
    }
  }

  if (!task) return null
  const tomorrow = addDays(vnDay(), 1)
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title={task.title}>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        <MenuItem icon={<Pencil className="size-5" />} onClick={() => onEdit(task)}>
          Edit
        </MenuItem>
        {!task.doneAt ? (
          <MenuItem icon={<AlarmClock className="size-5" />} onClick={() => void run(() => api.snooze(task.id, 60), 'I’ll remind you again in 1 hour.')}>
            Snooze 1 hour
          </MenuItem>
        ) : null}
        <MenuItem icon={<ArrowRight className="size-5" />} onClick={() => void run(() => api.moveTask(task.id, tomorrow), 'Moved to tomorrow.')}>
          Move to tomorrow
        </MenuItem>
        <div className="flex min-h-14 items-center gap-3 py-2">
          <CalendarDays className="size-5 shrink-0 text-slate-500" />
          <input type="date" className={`${inputClass} flex-1`} value={pickDay} min={vnDay()} onChange={(e) => setPickDay(e.target.value)} aria-label="Move to date" />
          <button
            type="button"
            disabled={!pickDay}
            onClick={() => void run(() => api.moveTask(task.id, pickDay), 'Moved.')}
            className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            Move
          </button>
        </div>
        <MenuItem
          icon={<Trash2 className="size-5" />}
          danger
          onClick={() => {
            if (window.confirm(`Delete “${task.title}”?`)) void run(() => api.deleteTask(task.id), 'Deleted.')
          }}
        >
          Delete
        </MenuItem>
      </div>
    </Sheet>
  )
}

function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 w-full items-center gap-3 text-left text-[15px] font-medium ${danger ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}
    >
      <span className={danger ? '' : 'text-slate-500'}>{icon}</span>
      {children}
    </button>
  )
}
