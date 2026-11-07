import { ArrowRight, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Skeleton } from '@/components/ui'
import type { RescheduleProposal } from '@/types/planner'
import * as api from './api'
import { addDays, dayMonth, shortWeekday, vnDay } from './dates'
import { Sheet } from './Sheet'
import { showToast } from './toast'

/**
 * "Smart reschedule": the AI proposes, the learner ticks the rows to keep and applies. Without AI, two plain buttons
 * move everything to today or tomorrow.
 */
export function ReschedulePreview({ open, onOpenChange, onApplied }: { open: boolean; onOpenChange: (open: boolean) => void; onApplied: () => void }) {
  const [proposal, setProposal] = useState<RescheduleProposal | null>(null)
  const [keep, setKeep] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setProposal(null)
    setError('')
    api
      .proposeReschedule()
      .then((p) => {
        setProposal(p)
        setKeep(new Set([...p.moves.map((m) => m.taskId), ...p.drop.map((d) => d.taskId)]))
      })
      .catch((err: Error) => setError(err.message))
  }, [open])

  const title = (id: string) => proposal?.tasks.find((t) => t.id === id)?.title ?? id
  const from = (id: string) => {
    const task = proposal?.tasks.find((t) => t.id === id)
    return task ? shortWeekday(task.date) : ''
  }
  const toggle = (id: string) =>
    setKeep((set) => {
      const next = new Set(set)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const apply = async (moves: { taskId: string; date: string; time?: string }[], drop: string[]) => {
    setBusy(true)
    try {
      const res = await api.applyReschedule(moves, drop)
      showToast(`Moved ${res.moved} ${res.moved === 1 ? 'task' : 'tasks'}${res.dropped ? `, dropped ${res.dropped}` : ''}.`)
      onApplied()
      onOpenChange(false)
    } catch (err) {
      showToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const applyProposal = () =>
    proposal &&
    void apply(
      proposal.moves.filter((m) => keep.has(m.taskId)).map((m) => ({ taskId: m.taskId, date: m.date, time: m.time })),
      proposal.drop.filter((d) => keep.has(d.taskId)).map((d) => d.taskId),
    )

  const moveAll = async (date: string) => {
    setBusy(true)
    try {
      const home = await api.getHome()
      await apply(home.overdue.map((t) => ({ taskId: t.id, date, time: t.time ?? '' })), [])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="size-5 text-violet-500" /> Smart reschedule
        </span>
      }
      footer={
        error ? (
          <>
            <Button variant="outline" onClick={() => void moveAll(addDays(vnDay(), 1))} loading={busy}>
              Move to tomorrow
            </Button>
            <Button onClick={() => void moveAll(vnDay())} loading={busy}>
              All to today
            </Button>
          </>
        ) : proposal && (proposal.moves.length || proposal.drop.length) ? (
          <Button onClick={applyProposal} loading={busy} disabled={!keep.size}>
            Apply ({keep.size})
          </Button>
        ) : null
      }
    >
      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      {!proposal && !error ? (
        <div className="space-y-3 py-2">
          <p className="text-sm text-slate-500">AI is rearranging your overdue tasks…</p>
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : null}
      {proposal ? (
        <div className="space-y-3">
          {proposal.summary ? <p className="rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:bg-violet-950/40 dark:text-violet-200">{proposal.summary}</p> : null}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {proposal.moves.map((m) => (
              <li key={m.taskId}>
                <label className="flex min-h-14 cursor-pointer items-start gap-3 py-2.5">
                  <input type="checkbox" className="mt-1 size-5 accent-brand-600" checked={keep.has(m.taskId)} onChange={() => toggle(m.taskId)} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900 dark:text-white">{title(m.taskId)}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300">
                      {from(m.taskId)} <ArrowRight className="size-3.5" /> {shortWeekday(m.date)} {dayMonth(m.date)}
                      {m.time ? ` ${m.time}` : ''}
                    </span>
                    {m.reason ? <span className="block text-xs text-slate-500">{m.reason}</span> : null}
                  </span>
                </label>
              </li>
            ))}
            {proposal.drop.map((d) => (
              <li key={d.taskId}>
                <label className="flex min-h-14 cursor-pointer items-start gap-3 py-2.5">
                  <input type="checkbox" className="mt-1 size-5 accent-rose-600" checked={keep.has(d.taskId)} onChange={() => toggle(d.taskId)} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-500 line-through">{title(d.taskId)}</span>
                    <span className="block text-xs text-rose-600 dark:text-rose-400">Drop · {d.reason}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {!proposal.moves.length && !proposal.drop.length ? <p className="text-sm text-slate-500">No overdue tasks.</p> : null}
        </div>
      ) : null}
    </Sheet>
  )
}
