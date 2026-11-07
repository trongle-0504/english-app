import { Minus, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { WeekDraftTask } from '@/types/planner'
import * as api from './api'
import { formatMinutes, viDayMonth, viShort, vnDay, weekDays } from './dates'
import { inputClass, Sheet } from './Sheet'
import { SKILL_DOT, SKILL_LABELS, SKILL_LINKS } from './skills'
import { showToast } from './toast'

/** "AI lập kế hoạch tuần": minutes per day + focus → an editable draft → added to the week. */
export function WeekDraftSheet({
  open,
  onOpenChange,
  start,
  minutesPerDay,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  start: string
  minutesPerDay: number[]
  onAdded: () => void
}) {
  const [minutes, setMinutes] = useState(minutesPerDay)
  const [focus, setFocus] = useState('')
  const [draft, setDraft] = useState<{ tasks: WeekDraftTask[]; summary: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const today = vnDay()
  const days = weekDays(start)

  useEffect(() => {
    if (open) {
      setMinutes(minutesPerDay)
      setDraft(null)
      setError('')
    }
  }, [open, minutesPerDay])

  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      setDraft(await api.draftWeek(start, minutes, focus))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!draft?.tasks.length) return
    setBusy(true)
    try {
      await api.createTasks(draft.tasks.map((t) => ({ title: t.title, date: t.date, time: t.time, durationMin: t.durationMin, skill: t.skill, link: SKILL_LINKS[t.skill] ?? '', notes: t.why, source: 'ai-week' })))
      showToast(`Đã thêm ${draft.tasks.length} việc vào tuần.`)
      onAdded()
      onOpenChange(false)
    } catch (err) {
      showToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const step = (i: number, delta: number) => setMinutes((list) => list.map((m, j) => (j === i ? Math.max(0, Math.min(720, m + delta)) : m)))

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="size-5 text-violet-500" /> AI lập kế hoạch tuần
        </span>
      }
      footer={
        draft ? (
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Làm lại
            </Button>
            <Button onClick={() => void add()} loading={busy} disabled={!draft.tasks.length}>
              Thêm vào tuần ({draft.tasks.length})
            </Button>
          </>
        ) : (
          <Button onClick={() => void generate()} loading={busy}>
            <Sparkles className="size-4" /> Tạo bản nháp
          </Button>
        )
      }
    >
      {!draft ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Số phút có thể học mỗi ngày (ngày đã qua được bỏ qua).</p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {days.map((day, i) => (
              <li key={day} className={cn('flex min-h-12 items-center justify-between gap-3', day < today && 'opacity-40')}>
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {viShort(day)} <span className="text-slate-400">{viDayMonth(day)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <button type="button" aria-label="Bớt 15 phút" onClick={() => step(i, -15)} className="flex size-10 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                    <Minus className="size-4" />
                  </button>
                  <span className="w-20 text-center text-sm tabular-nums">{minutes[i] ? formatMinutes(minutes[i]) : 'nghỉ'}</span>
                  <button type="button" aria-label="Thêm 15 phút" onClick={() => step(i, 15)} className="flex size-10 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                    <Plus className="size-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Trọng tâm (tuỳ chọn)</span>
            <input className={inputClass} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Tuần này tập trung Writing Task 2" maxLength={300} />
          </label>
          {busy ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">AI đang lập kế hoạch (thường dưới 1 phút)…</p>
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : null}
          {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
        </div>
      ) : (
        <div className="space-y-3">
          {draft.summary ? <p className="rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:bg-violet-950/40 dark:text-violet-200">{draft.summary}</p> : null}
          {!draft.tasks.length ? <p className="text-sm text-slate-500">AI không đề xuất việc nào (tuần đã kín hoặc không còn thời gian).</p> : null}
          {days
            .filter((d) => draft.tasks.some((t) => t.date === d))
            .map((day) => (
              <section key={day}>
                <h4 className="mt-2 text-xs font-bold tracking-wide text-slate-500 uppercase">
                  {viShort(day)} {viDayMonth(day)}
                </h4>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {draft.tasks.map((t, i) =>
                    t.date === day ? (
                      <li key={i} className="flex items-start gap-2 py-2">
                        <span className={cn('mt-3.5 size-2 shrink-0 rounded-full', SKILL_DOT[t.skill])} />
                        <div className="min-w-0 flex-1">
                          <input
                            className={cn(inputClass, 'h-10 text-sm')}
                            value={t.title}
                            onChange={(e) => setDraft((d) => d && { ...d, tasks: d.tasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                          />
                          <p className="mt-1 text-xs text-slate-500">
                            {t.durationMin}′ · {SKILL_LABELS[t.skill]}
                            {t.why ? ` · ${t.why}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label="Bỏ việc này"
                          onClick={() => setDraft((d) => d && { ...d, tasks: d.tasks.filter((_, j) => j !== i) })}
                          className="flex size-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </li>
                    ) : null,
                  )}
                </ul>
              </section>
            ))}
        </div>
      )}
    </Sheet>
  )
}
