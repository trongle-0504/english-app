// A change the coach suggested: the learner unticks what they do not want and presses Confirm (or Dismiss).
// Nothing changes before Confirm. Library entries are written here, by the same Admin generator as the app's own
// "Vocabulary / Notes" buttons; the server then records the outcome.
import { BookPlus, CalendarPlus, CalendarRange, Check, Layers, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { AdminApiError } from '@/features/admin/api'
import { invalidateData } from '@/lib/data'
import { cn } from '@/lib/cn'
import type { CoachProposal } from '@/types/coach'
import { addToLibrary } from '../practice/library-add'
import { practiceApi } from '../practice/practice-api'
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
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const Icon = ICONS[proposal.kind]
  const open = proposal.status === 'open'

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
      let library: { index: number; ok: boolean; label?: string; href?: string; error?: string }[] | undefined
      if (proposal.kind === 'library') {
        library = []
        for (const [n, index] of keep.entries()) {
          const data = proposal.items[index].data as { target: 'vocabulary' | 'note'; phrase: string; meaning_vi: string; example: string }
          setProgress(`Writing ${n + 1} of ${keep.length}: ${data.phrase}…`)
          try {
            const done = await addToLibrary(data.target, { phrase: data.phrase, meaning_vi: data.meaning_vi, example: data.example })
            await practiceApi.libraryAdded([{ term: data.phrase, cardId: done.cardId }]).catch(() => {})
            library.push({ index, ok: true, label: done.label, href: done.href })
          } catch (e) {
            // Already in the library (409): linked to that entry, like the Review page does.
            const exists = e instanceof AdminApiError && e.status === 409
            if (exists) await practiceApi.libraryAdded([{ term: data.phrase }]).catch(() => {})
            library.push({ index, ok: exists, error: exists ? 'already in the library' : (e as Error).message })
          }
        }
      }
      const applied = await api.applyProposal(sessionId, proposal.id, keep, library)
      if (proposal.kind === 'review-cards' || proposal.kind === 'library') invalidateData('review/')
      onChange(applied)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
      setProgress('')
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
          {progress ? <span className="w-full text-xs text-slate-500">{progress}</span> : null}
        </div>
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
