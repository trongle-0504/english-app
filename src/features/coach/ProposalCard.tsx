// A change the coach suggested: the learner unticks what they do not want and presses Confirm (or Dismiss).
// Nothing changes before Confirm. Library entries are written on the server by the Admin generator (minutes): the card
// polls the proposal and shows each entry's progress; closing the panel does not stop it.
import { BookPlus, CalendarPlus, CalendarRange, Check, CircleAlert, Layers, Loader2, MinusCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { refreshSiteData } from '@/features/admin/api'
import { invalidateData } from '@/lib/data'
import { cn } from '@/lib/cn'
import type { CoachLibraryProgress, CoachProposal } from '@/types/coach'
import * as api from './api'

const ICONS = { tasks: CalendarPlus, moves: CalendarRange, 'review-cards': Layers, library: BookPlus } as const

export function ProposalCard({
  sessionId,
  proposal,
  onChange,
  onNavigate,
}: {
  sessionId: string
  proposal: CoachProposal
  onChange: (p: CoachProposal) => void
  onNavigate: () => void
}) {
  const [picked, setPicked] = useState(() => new Set(proposal.items.map((_, i) => i)))
  const [busy, setBusy] = useState<'' | 'apply' | 'dismiss'>('')
  const [error, setError] = useState('')
  const Icon = ICONS[proposal.kind]
  const open = proposal.status === 'open'
  const applying = proposal.status === 'applying'

  // A library job runs on the server: poll it until it is applied (refs: the parent passes a new onChange each render).
  const latest = useRef({ proposal, onChange })
  useEffect(() => {
    latest.current = { proposal, onChange }
  })
  useEffect(() => {
    if (!applying) return
    let stop = false
    const timer = window.setInterval(async () => {
      try {
        const next = await api.getProposal(sessionId, proposal.id)
        if (stop) return
        if (next.status !== 'applying') {
          refreshSiteData('vocabulary')
          refreshSiteData('notes.json')
          invalidateData('review/')
        }
        if (JSON.stringify(next) !== JSON.stringify(latest.current.proposal)) latest.current.onChange(next)
      } catch {
        // try again on the next tick
      }
    }, 3000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [applying, sessionId, proposal.id])

  const rowOf = (i: number): CoachLibraryProgress | undefined => proposal.progress?.find((r) => r.index === i)
  const doneCount = (proposal.progress ?? []).filter((r) => r.status !== 'queued' && r.status !== 'running').length

  const toggle = (i: number) =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const confirm = async () => {
    const keep = [...picked].sort((a, b) => a - b)
    if (!keep.length || busy) return
    setBusy('apply')
    setError('')
    try {
      const applied = await api.applyProposal(sessionId, proposal.id, keep)
      if (proposal.kind === 'review-cards') invalidateData('review/')
      onChange(applied)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const dismiss = async () => {
    if (busy) return
    setBusy('dismiss')
    setError('')
    try {
      await api.dismissProposal(sessionId, proposal.id)
      onChange({ ...proposal, status: 'dismissed' })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="mt-2 rounded-2xl border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900/60 dark:bg-violet-950/30">
      <p className="flex items-center gap-2 text-sm font-semibold text-violet-900 dark:text-violet-200">
        <Icon className="size-4 shrink-0" /> {proposal.title}
      </p>
      <ul className="mt-2 space-y-1">
        {proposal.items.map((item, i) => {
          const on = open ? picked.has(i) : (proposal.kept ?? []).includes(i)
          const row = rowOf(i)
          return (
            <li key={i}>
              <label className={cn('flex items-start gap-2 rounded-lg px-1 py-1 text-sm', open && 'cursor-pointer hover:bg-white/70 dark:hover:bg-slate-800/60', !on && 'opacity-50')}>
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-violet-600"
                  checked={on}
                  disabled={!open || Boolean(busy)}
                  onChange={() => toggle(i)}
                />
                <span className="min-w-0">
                  <span className="block break-words text-slate-800 dark:text-slate-100">{item.label}</span>
                  {item.detail ? <span className="block text-xs break-words text-slate-500 dark:text-slate-400">{item.detail}</span> : null}
                  {row ? <ProgressLine row={row} onNavigate={onNavigate} /> : null}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {proposal.notes?.length ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{proposal.notes.join(' ')}</p> : null}

      {open ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!picked.size || Boolean(busy)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40 dark:bg-violet-500 dark:hover:bg-violet-400"
          >
            {busy === 'apply' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Confirm{picked.size !== proposal.items.length ? ` ${picked.size}` : ''}
          </button>
          <button
            type="button"
            onClick={() => void dismiss()}
            disabled={Boolean(busy)}
            className="inline-flex h-9 items-center rounded-full px-3 text-sm font-medium text-slate-600 hover:bg-white/70 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Dismiss
          </button>
        </div>
      ) : applying ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-violet-800 dark:text-violet-200">
          <Loader2 className="size-4 animate-spin" /> Writing {doneCount} of {proposal.progress?.length ?? 0}… (you can close this panel)
        </p>
      ) : proposal.status === 'applied' ? (
        <div className="mt-2 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="size-4" /> Done · {proposal.result?.summary}
          </p>
          {proposal.result?.links?.length ? (
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {proposal.result.links.map((l) => (
                <Link key={l.href} to={l.href} onClick={onNavigate} className="text-sm font-medium text-violet-700 underline underline-offset-2 dark:text-violet-300">
                  {l.label}
                </Link>
              ))}
            </p>
          ) : null}
          {proposal.result?.failed?.length ? <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">Not done: {proposal.result.failed.join('; ')}</p> : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">Dismissed — nothing changed.</p>
      )}
      {error ? <p className="mt-1.5 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
    </div>
  )
}

function ProgressLine({ row, onNavigate }: { row: CoachLibraryProgress; onNavigate: () => void }) {
  if (row.status === 'queued') return <span className="block text-xs text-slate-400">Waiting…</span>
  if (row.status === 'running')
    return (
      <span className="flex items-center gap-1 text-xs text-violet-700 dark:text-violet-300">
        <Loader2 className="size-3 animate-spin" /> Writing…
      </span>
    )
  if (row.status === 'done')
    return row.href ? (
      <Link to={row.href} onClick={onNavigate} className="flex items-center gap-1 text-xs font-medium text-emerald-700 underline underline-offset-2 dark:text-emerald-400">
        <Check className="size-3" /> {row.label ?? 'Saved'}
      </Link>
    ) : (
      <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
        <Check className="size-3" /> Saved
      </span>
    )
  if (row.status === 'skipped')
    return (
      <span className="flex items-center gap-1 text-xs text-slate-500">
        <MinusCircle className="size-3" /> {row.error ?? 'already in the library'}
      </span>
    )
  return (
    <span className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400">
      <CircleAlert className="size-3" /> {row.error ?? 'failed'}
    </span>
  )
}
