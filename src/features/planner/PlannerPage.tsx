import { CalendarCheck, Plus, Settings } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { SegmentedControl } from '@/components/ui'
import { useQueryParam } from '@/lib/useQueryParam'
import { DEFAULT_SETTINGS, type PlannerEvent, type PlannerSettings, type PlannerTask } from '@/types/planner'
import { AddSheet, type AddTab } from './AddSheet'
import * as api from './api'
import { vnDay } from './dates'
import { DayView } from './DayView'
import { EventsView } from './EventsView'
import { SettingsSheet } from './SettingsSheet'
import { TaskMenu } from './TaskMenu'
import { Toaster } from './Toaster'
import { WeekView } from './WeekView'

type View = 'day' | 'week' | 'events'

export default function PlannerPage() {
  const [viewParam, setViewParam] = useQueryParam('view')
  const [addParam, setAddParam] = useQueryParam('add')
  const view: View = viewParam === 'week' || viewParam === 'events' ? viewParam : 'day'
  const [version, setVersion] = useState(0)
  const [settings, setSettings] = useState<PlannerSettings>(DEFAULT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [add, setAdd] = useState<{ open: boolean; tab?: AddTab; task?: PlannerTask | null; event?: Partial<PlannerEvent> | null }>({ open: false })
  const [menuTask, setMenuTask] = useState<PlannerTask | null>(null)

  const bump = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    api
      .getWeek(vnDay())
      .then((week) => setSettings(week.settings))
      .catch(() => {})
  }, [version])

  // ?add=1 (manifest shortcut "Thêm nhanh") opens the add sheet once.
  useEffect(() => {
    if (addParam) {
      setAdd({ open: true, tab: 'quick' })
      setAddParam('')
    }
  }, [addParam, setAddParam])

  const editTask = (task: PlannerTask) => {
    setMenuTask(null)
    setAdd({ open: true, task })
  }
  const editEvent = (event: PlannerEvent) => setAdd({ open: true, event })

  return (
    <div className="mx-auto max-w-3xl pb-28">
      <title>NeSy · Planner</title>
      <div className="mt-4 flex items-center justify-between gap-3 sm:mt-8">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
          <CalendarCheck className="size-7 text-brand-600 dark:text-brand-400" /> Planner
        </h1>
        <button
          type="button"
          aria-label="Cài đặt"
          onClick={() => setSettingsOpen(true)}
          className="flex size-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Settings className="size-5" />
        </button>
      </div>

      <SegmentedControl
        className="mt-4 w-full [&>button]:flex-1 [&>button]:justify-center [&>button]:py-2"
        value={view}
        onChange={(v) => setViewParam(v === 'day' ? '' : v)}
        options={[
          { value: 'day', label: 'Ngày' },
          { value: 'week', label: 'Tuần' },
          { value: 'events', label: 'Sự kiện' },
        ]}
      />

      <div className="mt-5">
        {view === 'day' ? <DayView version={version} onChanged={bump} onMenu={setMenuTask} onEdit={editTask} onEditEvent={editEvent} /> : null}
        {view === 'week' ? <WeekView version={version} onChanged={bump} onMenu={setMenuTask} onEdit={editTask} /> : null}
        {view === 'events' ? <EventsView version={version} onChanged={bump} onEdit={editEvent} /> : null}
      </div>

      <button
        type="button"
        aria-label="Thêm"
        onClick={() => setAdd({ open: true, tab: view === 'events' ? 'event' : 'quick' })}
        className="fixed right-4 bottom-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] z-40 flex size-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-xl shadow-brand-600/30 transition-transform hover:bg-brand-700 active:scale-95 dark:bg-brand-500 dark:text-slate-950"
      >
        <Plus className="size-7" />
      </button>

      <AddSheet
        open={add.open}
        onOpenChange={(open) => setAdd((a) => ({ ...a, open }))}
        tab={add.tab}
        task={add.task}
        event={add.event}
        onSaved={bump}
      />
      <TaskMenu task={menuTask} onClose={() => setMenuTask(null)} onEdit={editTask} onChanged={bump} />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} onSaved={setSettings} />
      <Toaster />
    </div>
  )
}
