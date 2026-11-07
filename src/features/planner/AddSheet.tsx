import { CalendarPlus, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  DEFAULT_REMINDERS,
  NON_STUDY_SKILLS,
  PLANNER_EVENT_KINDS,
  STUDY_SKILLS,
  type PlannerEvent,
  type PlannerEventKind,
  type PlannerSkill,
  type PlannerTask,
  type QuickAddItem,
} from '@/types/planner'
import * as api from './api'
import { shortWeekday, vnDay } from './dates'
import { Chips, Field, inputClass, Sheet } from './Sheet'
import { EVENT_KIND_LABELS, SKILL_DOT, SKILL_LABELS, SKILL_LINKS } from './skills'
import { showToast } from './toast'

export type AddTab = 'quick' | 'task' | 'event'

const DURATIONS = [15, 30, 45, 60, 90]
const REMINDER_CHIPS = [
  { value: 10080, label: '1 week' },
  { value: 1440, label: '1 day' },
  { value: 120, label: '2 hours' },
  { value: 60, label: '1 hour' },
  { value: 15, label: '15 min' },
]

export function AddSheet({
  open,
  onOpenChange,
  tab: initialTab = 'quick',
  task,
  event,
  date,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab?: AddTab
  /** Edit this task (opens the task tab). */
  task?: PlannerTask | null
  /** Edit this event, or a draft such as { kind: 'exam' }. */
  event?: Partial<PlannerEvent> | null
  /** Default date for a new task/event. */
  date?: string
  onSaved: () => void
}) {
  const editing = Boolean(task?.id || event?.id)
  const [tab, setTab] = useState<AddTab>(initialTab)
  useEffect(() => {
    if (open) setTab(task ? 'task' : event ? 'event' : initialTab)
  }, [open, task, event, initialTab])

  const done = () => {
    onSaved()
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={editing ? (task ? 'Edit task' : 'Edit event') : 'Add to plan'}>
      {!editing ? (
        <SegmentedControl
          className="mb-4 w-full [&>button]:flex-1 [&>button]:justify-center"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'quick', label: 'Quick add', icon: <Sparkles className="size-3.5" /> },
            { value: 'task', label: 'Task' },
            { value: 'event', label: 'Event' },
          ]}
        />
      ) : null}
      {open && tab === 'quick' ? <QuickAddForm onDone={done} /> : null}
      {open && tab === 'task' ? <TaskForm task={task ?? undefined} date={date} onDone={done} /> : null}
      {open && tab === 'event' ? <EventForm event={event ?? undefined} date={date} onDone={done} /> : null}
    </Sheet>
  )
}

/* ───────────── Task ───────────── */

function TaskForm({ task, date, onDone }: { task?: PlannerTask; date?: string; onDone: () => void }) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [day, setDay] = useState(task?.date ?? date ?? vnDay())
  const [time, setTime] = useState(task?.time ?? '')
  const [duration, setDuration] = useState<number | undefined>(task?.durationMin ?? 30)
  const [custom, setCustom] = useState(task?.durationMin && !DURATIONS.includes(task.durationMin) ? String(task.durationMin) : '')
  const [skill, setSkill] = useState<PlannerSkill>(task?.skill ?? 'writing')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const minutes = custom ? Number(custom) : duration
      await api.saveTask({
        ...(task ? { id: task.id } : {}),
        title,
        date: day,
        time: time || '',
        durationMin: minutes || 0,
        skill,
        // Keep a custom link when the skill did not change; otherwise follow the skill.
        link: task && task.skill === skill ? (task.link ?? '') : (SKILL_LINKS[skill] ?? ''),
        notes,
      })
      showToast(task ? 'Saved.' : 'Task added.')
      onDone()
    } catch (err) {
      showToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Task">
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What do you need to do?" maxLength={120} autoFocus={!task} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" className={inputClass} value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label="Time (optional)">
          <input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Duration">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chips
            value={custom ? undefined : duration}
            onChange={(v) => {
              setDuration(v)
              setCustom('')
            }}
            options={DURATIONS.map((m) => ({ value: m, label: `${m}′` }))}
          />
          <input
            inputMode="numeric"
            className={cn(inputClass, 'h-9 w-24 rounded-full text-sm')}
            placeholder="other min"
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))}
          />
        </div>
      </Field>
      <Field label="Category">
        <div className="space-y-2">
          {[
            { name: 'Study', list: STUDY_SKILLS },
            { name: 'Other', list: NON_STUDY_SKILLS },
          ].map((group) => (
            <div key={group.name} className="flex items-start gap-2">
              <span className="w-16 shrink-0 pt-2 text-xs text-slate-400">{group.name}</span>
              <Chips
                className="min-w-0 flex-1"
                value={skill}
                onChange={setSkill}
                options={group.list.map((s) => ({
                  value: s,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn('size-2 rounded-full', SKILL_DOT[s])} />
                      {SKILL_LABELS[s]}
                    </span>
                  ),
                }))}
              />
            </div>
          ))}
        </div>
      </Field>
      <Field label="Notes">
        <textarea className={cn(inputClass, 'h-auto min-h-20 py-2')} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </Field>
      <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-slate-100 bg-white px-5 pt-3 pb-1 dark:border-slate-800 dark:bg-slate-900 justify-end">
        <Button onClick={() => void save()} loading={busy} disabled={!title.trim()}>
          {task ? 'Save' : 'Add task'}
        </Button>
      </div>
    </div>
  )
}

/* ───────────── Event ───────────── */

function EventForm({ event, date, onDone }: { event?: Partial<PlannerEvent>; date?: string; onDone: () => void }) {
  const [title, setTitle] = useState(event?.title ?? (event?.kind === 'exam' ? 'IELTS' : ''))
  const [kind, setKind] = useState<PlannerEventKind>(event?.kind ?? 'class')
  const [day, setDay] = useState(event?.date ?? date ?? vnDay())
  const [time, setTime] = useState(event?.time ?? '')
  const [endTime, setEndTime] = useState(event?.endTime ?? '')
  const [location, setLocation] = useState(event?.location ?? '')
  const [remind, setRemind] = useState<number[]>(event?.remind ?? DEFAULT_REMINDERS[event?.kind ?? 'class'])
  const [countdown, setCountdown] = useState(event?.countdown ?? (event?.kind ?? 'class') === 'exam')
  const [busy, setBusy] = useState(false)

  const pickKind = (next: PlannerEventKind) => {
    setKind(next)
    if (!event?.id) {
      setRemind(DEFAULT_REMINDERS[next])
      setCountdown(next === 'exam')
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      await api.saveEvent({ ...(event?.id ? { id: event.id } : {}), title, kind, date: day, time, endTime, location, remind, countdown })
      showToast(event?.id ? 'Saved.' : 'Event added.')
      onDone()
    } catch (err) {
      showToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Event">
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="IELTS exam at IDP" maxLength={120} autoFocus={!event?.id} />
      </Field>
      <Field label="Type">
        <Chips value={kind} onChange={pickKind} options={PLANNER_EVENT_KINDS.map((k) => ({ value: k, label: EVENT_KIND_LABELS[k] }))} />
      </Field>
      <Field label="Date">
        <input type="date" className={inputClass} value={day} onChange={(e) => setDay(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts">
          <input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Ends">
          <input type="time" className={inputClass} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Location">
        <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={160} />
      </Field>
      <Field label="Remind me" hint={!time ? 'All-day event: counted from 08:00 that day.' : undefined}>
        <div className="flex flex-wrap gap-1.5">
          {REMINDER_CHIPS.map((r) => {
            const on = remind.includes(r.value)
            return (
              <button
                key={r.value}
                type="button"
                aria-pressed={on}
                onClick={() => setRemind((list) => (on ? list.filter((x) => x !== r.value) : [...list, r.value].slice(-5)))}
                className={cn(
                  'min-h-9 rounded-full border px-3 text-sm font-medium',
                  on
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-950/50 dark:text-brand-200'
                    : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300',
                )}
              >
                {r.label}
              </button>
            )
          })}
        </div>
      </Field>
      <label className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Show a countdown on the home page</span>
        <input type="checkbox" className="size-5 accent-brand-600" checked={countdown} onChange={(e) => setCountdown(e.target.checked)} />
      </label>
      <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-slate-100 bg-white px-5 pt-3 pb-1 dark:border-slate-800 dark:bg-slate-900 justify-end">
        <Button onClick={() => void save()} loading={busy} disabled={!title.trim()}>
          {event?.id ? 'Save' : 'Add event'}
        </Button>
      </div>
    </div>
  )
}

/* ───────────── Quick add (AI) ───────────── */

function QuickAddForm({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('')
  const [items, setItems] = useState<(QuickAddItem & { asRoutine?: boolean })[] | null>(null)
  const [unparsed, setUnparsed] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const parse = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await api.quickAdd(text)
      setItems(res.items)
      setUnparsed(res.unparsed)
      if (!res.items.length) setError('The AI found nothing to add. Try writing it more clearly, or add it by hand.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const patch = (i: number, next: Partial<QuickAddItem & { asRoutine?: boolean }>) =>
    setItems((list) => list?.map((item, j) => (j === i ? { ...item, ...next } : item)) ?? null)

  const save = async () => {
    if (!items?.length) return
    setBusy(true)
    try {
      const tasks: Partial<PlannerTask>[] = []
      const routineAdds: { weekday: number; title: string; time?: string; durationMin?: number; skill: PlannerSkill; link?: string }[] = []
      for (const item of items) {
        if (item.type === 'event') {
          await api.saveEvent({ title: item.title, kind: item.eventKind || 'other', date: item.date, time: item.time, endTime: item.endTime, location: item.location, remind: item.remind, countdown: item.countdown })
          continue
        }
        const dates = item.repeatDates.length ? item.repeatDates : [item.date]
        for (const date of dates) {
          tasks.push({ title: item.title, date, time: item.time, durationMin: item.durationMin || 0, skill: item.skill, link: item.link ?? '', source: 'quick-add' })
        }
        if (item.asRoutine) {
          for (const weekday of item.repeatWeekdays) {
            routineAdds.push({ weekday, title: item.title, time: item.time || undefined, durationMin: item.durationMin || undefined, skill: item.skill, link: item.link })
          }
        }
      }
      if (tasks.length) await api.createTasks(tasks)
      if (routineAdds.length) {
        const { routine } = await api.getWeek(vnDay())
        await api.saveRoutine([...routine, ...routineAdds.map((r) => ({ ...r, id: '' }))])
      }
      showToast(`Added ${items.length} ${items.length === 1 ? 'item' : 'items'}.`)
      onDone()
    } catch (err) {
      showToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (items?.length) {
    return (
      <div className="space-y-3">
        {unparsed ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Not understood: “{unparsed}”
          </p>
        ) : null}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((item, i) => (
            <li key={i} className="space-y-2 py-3">
              <div className="flex items-center gap-2">
                {item.type === 'event' ? (
                  <CalendarPlus className="size-4 shrink-0 text-violet-500" />
                ) : (
                  <span className={cn('size-2.5 shrink-0 rounded-full', SKILL_DOT[item.skill])} />
                )}
                <input className={cn(inputClass, 'h-10 flex-1')} value={item.title} onChange={(e) => patch(i, { title: e.target.value })} maxLength={120} />
                <button
                  type="button"
                  aria-label="Remove this item"
                  onClick={() => setItems((list) => list?.filter((_, j) => j !== i) ?? null)}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pl-6 text-xs">
                <span className="rounded-full bg-slate-100 px-2 py-1 font-medium dark:bg-slate-800">
                  {item.type === 'event' ? EVENT_KIND_LABELS[item.eventKind || 'other'] : SKILL_LABELS[item.skill]}
                </span>
                {item.repeatDates.length ? null : (
                  <input type="date" className="h-8 rounded-full border border-slate-200 bg-transparent px-2 dark:border-slate-700" value={item.date} onChange={(e) => patch(i, { date: e.target.value })} />
                )}
                <input type="time" className="h-8 rounded-full border border-slate-200 bg-transparent px-2 dark:border-slate-700" value={item.time} onChange={(e) => patch(i, { time: e.target.value })} />
                {item.endTime ? <span>→ {item.endTime}</span> : null}
                {item.durationMin ? <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">{item.durationMin}′</span> : null}
                {item.location ? <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">📍 {item.location}</span> : null}
                {item.confidence === 'low' ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                    <TriangleAlert className="size-3" /> Check this
                  </span>
                ) : null}
              </div>
              {item.repeatDates.length ? (
                <div className="space-y-1 pl-6 text-xs text-slate-600 dark:text-slate-300">
                  <p>Repeats: {item.repeatDates.map(shortWeekday).filter((d, j, a) => a.indexOf(d) === j).join(' · ')} (next {item.repeatDates.length} dates)</p>
                  {item.type === 'task' ? (
                    <label className="flex min-h-9 items-center gap-2">
                      <input type="checkbox" className="size-4 accent-brand-600" checked={Boolean(item.asRoutine)} onChange={(e) => patch(i, { asRoutine: e.target.checked })} />
                      Save as weekly routine
                    </label>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-slate-100 bg-white px-5 pt-3 pb-1 dark:border-slate-800 dark:bg-slate-900 justify-between">
          <Button variant="ghost" onClick={() => setItems(null)}>
            Edit note
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Add {items.length} {items.length === 1 ? 'item' : 'items'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <textarea
        autoFocus
        className={cn(inputClass, 'h-auto min-h-28 py-2.5')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) void parse()
        }}
      />
      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-slate-100 bg-white px-5 pt-3 pb-1 dark:border-slate-800 dark:bg-slate-900 justify-end">
        <Button onClick={() => void parse()} loading={busy} disabled={!text.trim()}>
          <Sparkles className="size-4" /> Add
        </Button>
      </div>
    </div>
  )
}
