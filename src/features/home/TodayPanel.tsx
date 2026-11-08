// The home page's "today", drawn on the hero photo: date, exam countdown, week progress, the AI brief,
// today's tasks (solid card for legibility), overdue work, next events and a quick-add bar.
import { ArrowRight, Bell, CalendarClock, CalendarPlus, Check, ChevronDown, Play, Repeat, Sparkles, TriangleAlert, WifiOff } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { PlannerEvent, PlannerHome } from '@/types/planner'
import { AddSheet, type AddTab } from '@/features/planner/AddSheet'
import * as api from '@/features/planner/api'
import { daysBetween, daysLeftLabel, formatMinutes, dayMonth, longDate, shortWeekday, vnDay, weekStart } from '@/features/planner/dates'
import { EnablePushCard } from '@/features/planner/EnablePushCard'
import { pushState, type PushState } from '@/features/planner/push'
import { ReschedulePreview } from '@/features/planner/ReschedulePreview'
import { Sheet } from '@/features/planner/Sheet'
import { EVENT_KIND_TONE } from '@/features/planner/skills'
import { TaskRow } from '@/features/planner/TaskRow'
import { showToast } from '@/features/planner/toast'
import { Toaster } from '@/features/planner/Toaster'
import { usePlannerHome } from '@/features/planner/usePlannerHome'
import { WeekDraftSheet } from '@/features/planner/WeekDraftSheet'

const glass = 'bg-white/12 ring-1 ring-white/20 backdrop-blur-xl'
const roundGlass = cn(glass, 'relative flex size-11 items-center justify-center rounded-full text-white transition hover:bg-white/20')

/** A white ring on the photo: `value` out of `max`. */
function Ring({ value, max, children }: { value: number; max: number; children: ReactNode }) {
  const r = 22
  const c = 2 * Math.PI * r
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div className="relative size-12 shrink-0 sm:size-14">
      <svg viewBox="0 0 56 56" className="size-full -rotate-90" aria-hidden>
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" className="stroke-white/20" />
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-white transition-[stroke-dashoffset] duration-700" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-extrabold sm:text-sm text-white tabular-nums">{children}</span>
    </div>
  )
}

export function TodayPanel() {
  const navigate = useNavigate()
  const { home, offline, error, loading, reload, toggle } = usePlannerHome()
  const [push, setPush] = useState<PushState | null>(null)
  const [pushOpen, setPushOpen] = useState(false)
  const [add, setAdd] = useState<{ open: boolean; tab?: AddTab; event?: Partial<PlannerEvent> | null }>({ open: false })
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)
  const [briefOpen, setBriefOpen] = useState(false)
  const [briefBusy, setBriefBusy] = useState(false)

  useEffect(() => {
    pushState()
      .then(setPush)
      .catch(() => setPush('unsupported'))
  }, [])

  // Brief on load: once per day per tab session, after 05:00, when the AI brief is on.
  useEffect(() => {
    if (!home || home.brief || !home.settings.aiBrief || offline) return
    const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false }))
    if (hour < 5) return
    const key = `planner:brief-asked:${home.day}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      // No session storage: ask anyway.
    }
    setBriefBusy(true)
    api
      .generateBrief()
      .then(() => reload())
      .catch(() => {})
      .finally(() => setBriefBusy(false))
  }, [home, offline, reload])

  // Stale brief (the plan or the part of the day changed): rewrite it quietly after the changes settle. The old card
  // stays until the new one arrives.
  const briefStale = Boolean(home?.briefStale && home.settings.aiBrief && !offline)
  useEffect(() => {
    if (!briefStale) return
    const timer = setTimeout(() => {
      setBriefBusy(true)
      api
        .generateBrief(false, true)
        .then(() => reload())
        .catch(() => {})
        .finally(() => setBriefBusy(false))
    }, 8000)
    return () => clearTimeout(timer)
  }, [briefStale, home?.brief?.stateKey, reload])

  const makeBrief = async () => {
    setBriefBusy(true)
    try {
      await api.generateBrief(Boolean(home?.brief))
      await reload()
    } catch (err) {
      showToast((err as Error).message)
    } finally {
      setBriefBusy(false)
    }
  }

  const moveOverdueToToday = async () => {
    if (!home?.overdue.length) return
    try {
      const res = await api.applyReschedule(home.overdue.map((t) => ({ taskId: t.id, date: home.day, time: t.time ?? '' })), [])
      showToast(`Moved ${res.moved} ${res.moved === 1 ? 'task' : 'tasks'} to today.`)
      void reload()
    } catch (err) {
      showToast((err as Error).message)
    }
  }

  const applyWeekRoutine = async () => {
    try {
      const added = await api.applyRoutine(weekStart(vnDay()))
      if (added) {
        showToast(`Added ${added} ${added === 1 ? 'task' : 'tasks'} from your routine.`)
        void reload()
      } else navigate('/planner?view=week')
    } catch (err) {
      showToast((err as Error).message)
    }
  }

  const day = home?.day ?? vnDay()

  return (
    <div className="text-white">
      {/* 1. Date; Add task (Quick add sheet) and the bell on the right (the bottom of the screen belongs to the Coach button). */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-sm font-bold tracking-[0.14em] text-white/85 uppercase">{longDate(day)}</h1>
          {offline ? (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/25 px-2 py-0.5 text-xs font-semibold text-amber-100">
              <WifiOff className="size-3" /> Offline
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <QuickAddBar onClick={() => setAdd({ open: true, tab: 'quick' })} />
          <button type="button" aria-label="Notifications" onClick={() => setPushOpen(true)} className={roundGlass}>
            <Bell className="size-5" />
            {push && push !== 'on' && push !== 'unsupported' && push !== 'dev' ? <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-amber-400 ring-2 ring-slate-900/40" /> : null}
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
        {/* Left column on desktop: tiles + brief */}
        <div className="min-w-0 space-y-3">
          {/* 2. Countdown + week progress */}
          <div className="grid grid-cols-2 gap-3">
            {home?.countdown ? (
              <Link to="/planner?view=events" className={cn(glass, 'flex items-center gap-2.5 rounded-2xl p-2.5 sm:gap-3 sm:p-3')}>
                {/* Days left out of 30, or out of the days since the event was added when that is smaller. */}
                <Ring value={home.countdown.daysLeft} max={Math.min(30, Math.max(1, daysBetween(home.countdown.createdAt.slice(0, 10), home.countdown.date)))}>
                  {home.countdown.daysLeft}
                </Ring>
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{home.countdown.daysLeft === 0 ? 'Today' : `${home.countdown.daysLeft} ${home.countdown.daysLeft === 1 ? 'day' : 'days'}`}</span>
                  <span className="line-clamp-2 text-xs leading-snug break-words text-white/75" title={`${home.countdown.title} · ${shortWeekday(home.countdown.date)} ${dayMonth(home.countdown.date)}`}>
                    {home.countdown.title}
                  </span>
                </span>
              </Link>
            ) : (
              <button type="button" onClick={() => setAdd({ open: true, tab: 'event', event: { kind: 'exam' } })} className={cn(glass, 'flex items-center gap-2.5 rounded-2xl p-2.5 text-left sm:gap-3 sm:p-3')}>
                <span className="flex size-12 sm:size-14 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-white/40">
                  <CalendarPlus className="size-5" />
                </span>
                <span className="text-sm font-bold">Add exam date</span>
              </button>
            )}
            <Link to="/planner?view=week" className={cn(glass, 'flex items-center gap-2.5 rounded-2xl p-2.5 sm:gap-3 sm:p-3')}>
              <Ring value={home?.weekProgress.done ?? 0} max={home?.weekProgress.total ?? 0}>
                {home?.weekProgress.total ? `${Math.round(((home.weekProgress.done ?? 0) / home.weekProgress.total) * 100)}%` : '–'}
              </Ring>
              <span className="min-w-0">
                <span className="block text-sm font-bold tabular-nums">
                  {home?.weekProgress.done ?? 0}/{home?.weekProgress.total ?? 0} tasks
                </span>
                <span className="block text-xs text-white/75">this week</span>
              </span>
            </Link>
          </div>

          {/* 3. AI brief: the focus line, the tip on expand, one action for the focus task. */}
          {home?.brief && (home.brief.focus || home.brief.tip || home.brief.body) ? (
            <BriefCard home={home} open={briefOpen} onOpenChange={setBriefOpen} busy={briefBusy} onToggle={toggle} />
          ) : home && !offline ? (
            <button type="button" onClick={() => void makeBrief()} disabled={briefBusy} className={cn(glass, 'flex min-h-12 w-full items-center gap-2 rounded-2xl px-3.5 text-left text-sm font-semibold')}>
              <Sparkles className={cn('size-4', briefBusy && 'animate-pulse')} />
              {briefBusy ? 'Writing today’s brief…' : 'Get today’s brief'}
            </button>
          ) : null}
        </div>

        {/* 4–6. Solid card: today, overdue, events */}
        <div className="min-w-0 rounded-3xl bg-white/92 p-4 text-slate-900 shadow-xl backdrop-blur-xl sm:p-5 dark:bg-slate-900/88 dark:text-slate-100">
          {loading && !home ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : !home ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">{error || 'Could not load today’s plan.'}</p>
          ) : (
            <TodayCard
              home={home}
              onToggle={toggle}
              onReschedule={() => setRescheduleOpen(true)}
              onMoveToday={() => void moveOverdueToToday()}
              onDraft={() => setDraftOpen(true)}
              onRoutine={() => void applyWeekRoutine()}
            />
          )}
        </div>
      </div>

      <AddSheet open={add.open} onOpenChange={(open) => setAdd((a) => ({ ...a, open }))} tab={add.tab} event={add.event} onSaved={() => void reload()} />
      <ReschedulePreview open={rescheduleOpen} onOpenChange={setRescheduleOpen} onApplied={() => void reload()} />
      {home ? <WeekDraftSheet open={draftOpen} onOpenChange={setDraftOpen} start={weekStart(home.day)} minutesPerDay={home.settings.minutesPerDay} onAdded={() => void reload()} /> : null}
      <Sheet open={pushOpen} onOpenChange={setPushOpen} title="Notifications">
        <EnablePushCard onChange={setPush} />
      </Sheet>
      <Toaster />
    </div>
  )
}

function TodayCard({
  home,
  onToggle,
  onReschedule,
  onMoveToday,
  onDraft,
  onRoutine,
}: {
  home: PlannerHome
  onToggle: ReturnType<typeof usePlannerHome>['toggle']
  onReschedule: () => void
  onMoveToday: () => void
  onDraft: () => void
  onRoutine: () => void
}) {
  const done = home.tasks.filter((t) => t.doneAt).length
  const total = home.tasks.length
  const minutesLeft = home.tasks.filter((t) => !t.doneAt).reduce((s, t) => s + (t.durationMin ?? 0), 0)
  const emptyWeek = !total && !home.weekProgress.total && !home.overdue.length

  return (
    <div>
      {home.overdue.length ? <OverdueBanner home={home} onToggle={onToggle} onReschedule={onReschedule} onMoveToday={onMoveToday} /> : null}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Today</h2>
        {total ? (
          <span className="text-xs font-semibold text-slate-500 tabular-nums">
            {done}/{total}
            {minutesLeft ? ` · ${formatMinutes(minutesLeft)} left` : ''}
          </span>
        ) : null}
      </div>
      {total ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/80">
          <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      ) : null}

      {emptyWeek ? (
        <div className="py-4 text-center">
          <p className="font-semibold">No plan for this week yet</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={onDraft} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-violet-600 px-4 text-sm font-semibold text-white">
              <Sparkles className="size-4" /> Plan my week with AI
            </button>
            <button type="button" onClick={onRoutine} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-300 px-4 text-sm font-semibold dark:border-slate-600">
              <Repeat className="size-4" /> Use my routine
            </button>
          </div>
        </div>
      ) : total ? (
        <ul className="mt-1 divide-y divide-slate-200/70 dark:divide-slate-700/70">
          {home.tasks.map((t) => (
            <li key={t.id}>
              <TaskRow task={t} onToggle={onToggle} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-3 text-sm text-slate-500">
          Nothing planned for today{home.review.due ? ` — ${home.review.due} cards are due.` : '.'}
          {home.review.due ? (
            <Link to="/review" className="ml-1 font-semibold text-brand-600 dark:text-brand-400">
              Review now
            </Link>
          ) : null}
        </p>
      )}


      {home.events.length ? (
        <div className="mt-3 border-t border-slate-200/70 pt-3 dark:border-slate-700/70">
          <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">Upcoming</p>
          <ul className="mt-1">
            {home.events.slice(0, 3).map((e) => (
              <li key={e.id}>
                <Link to="/planner?view=events" className="flex min-h-11 items-center gap-2.5">
                  <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', EVENT_KIND_TONE[e.kind])}>
                    <CalendarClock className="size-4" />
                  </span>
                  <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium break-words">{e.title}</span>
                  <span className={cn('shrink-0 text-xs font-semibold', e.daysLeft <= 7 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500')}>{daysLeftLabel(e.daysLeft)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Link to="/planner?view=week" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-600 dark:text-brand-400">
        View week <ArrowRight className="size-4" />
      </Link>
    </div>
  )
}

/** Overdue work, above today's list: one line with the actions; the tasks open on tap. */
function OverdueBanner({
  home,
  onToggle,
  onReschedule,
  onMoveToday,
}: {
  home: PlannerHome
  onToggle: ReturnType<typeof usePlannerHome>['toggle']
  onReschedule: () => void
  onMoveToday: () => void
}) {
  const [open, setOpen] = useState(false)
  const n = home.overdue.length
  return (
    <div className="mb-3 rounded-2xl bg-amber-50 p-3 dark:bg-amber-950/40">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-9 w-full items-center gap-2 text-left">
        <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="flex-1 text-sm font-bold text-amber-800 dark:text-amber-300">
          {n} overdue {n === 1 ? 'task' : 'tasks'}
        </span>
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{open ? 'Hide' : 'Show'}</span>
        <ChevronDown className={cn('size-4 text-amber-700 transition-transform dark:text-amber-400', open && 'rotate-180')} />
      </button>
      {open ? (
        <ul className="mt-1 divide-y divide-amber-200/60 dark:divide-amber-900/50">
          {home.overdue.map((t) => (
            <li key={t.id}>
              <TaskRow task={t} showDate onToggle={onToggle} />
            </li>
          ))}
        </ul>
      ) : null}
      {/* One row on phones: compact padding, no wrapping. */}
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={onReschedule} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-amber-600 px-3 text-[13px] font-semibold whitespace-nowrap text-white sm:px-4 sm:text-sm">
          <Sparkles className="size-4 shrink-0" /> Smart reschedule
        </button>
        <button
          type="button"
          onClick={onMoveToday}
          title="Move every overdue task to today"
          className="inline-flex min-h-10 items-center rounded-full border border-amber-300 px-3 text-[13px] font-semibold whitespace-nowrap text-amber-800 sm:px-4 sm:text-sm dark:border-amber-800 dark:text-amber-300"
        >
          All to today
        </button>
      </div>
    </div>
  )
}

/** The AI card: "Today’s focus", the focus line (tip when expanded), and Start (study task) or Done (other task). */
function BriefCard({
  home,
  open,
  onOpenChange,
  busy,
  onToggle,
}: {
  home: PlannerHome
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  onToggle: ReturnType<typeof usePlannerHome>['toggle']
}) {
  const brief = home.brief!
  const task = home.tasks.find((t) => t.id === brief.focusTaskId && !t.doneAt)
  const hasMore = Boolean(brief.tip)
  const action = 'inline-flex min-h-8 items-center gap-1 rounded-full bg-white/90 px-3 text-xs font-bold text-slate-900 transition hover:bg-white'
  return (
    <div className={cn(glass, 'rounded-2xl p-3.5')}>
      <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-white/80 uppercase">
        <Sparkles className={cn('size-3.5', busy && 'animate-pulse')} /> Today’s focus
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-white/95">{brief.focus || brief.body}</p>
      {open && brief.tip ? <p className="mt-1 text-sm leading-relaxed text-white/80">💡 {brief.tip}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {task?.link ? (
          <Link to={task.link} className={action}>
            <Play className="size-3.5 fill-current" /> Start
          </Link>
        ) : task ? (
          <button type="button" onClick={() => onToggle(task, true)} className={action}>
            <Check className="size-3.5" strokeWidth={3} /> Done
          </button>
        ) : null}
        {hasMore ? (
          <button type="button" onClick={() => onOpenChange(!open)} className="ml-auto inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-white/80">
            {open ? 'Less' : 'Tip'} <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function QuickAddBar({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Add a task to your plan"
      title="Add a task to your plan"
      className={cn(glass, 'flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-semibold text-white/90 transition hover:bg-white/20 sm:px-4', className)}
    >
      <CalendarPlus className="size-4 shrink-0" />
      <span className="hidden whitespace-nowrap min-[360px]:inline">Add task</span>
    </button>
  )
}
