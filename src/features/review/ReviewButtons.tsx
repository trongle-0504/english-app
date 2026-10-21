import { BookmarkCheck, BookmarkPlus, Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { addToReview, removeFromReview, useReviewStore } from './store'

/** "＋ Review" on a single card; hidden when the review server isn't available. */
export function ReviewToggle({ id, className }: { id: string; className?: string }) {
  const { status, cards } = useReviewStore()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  if (status === 'offline' || status === 'idle') return null
  const inReview = Boolean(cards[id])
  // Removing a card that has been studied deletes its progress: ask for a second click.
  const hasProgress = (cards[id]?.fsrs.reps ?? 0) > 0

  const toggle = async (event: React.MouseEvent) => {
    event.stopPropagation()
    if (inReview && hasProgress && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    setBusy(true)
    try {
      await (inReview ? removeFromReview([id]) : addToReview([id]))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || status === 'loading'}
      onBlur={() => setConfirming(false)}
      aria-pressed={inReview}
      title={inReview ? 'In your reviews — click to remove' : 'Add to spaced-repetition reviews'}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors disabled:opacity-60',
        confirming
          ? 'bg-rose-600 text-white hover:bg-rose-700'
          : inReview
          ? 'bg-emerald-50 text-emerald-700 hover:bg-rose-50 hover:text-rose-700 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-rose-950/50 dark:hover:text-rose-300'
          : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-brand-950/50 dark:hover:text-brand-300',
        className,
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : inReview ? <BookmarkCheck className="size-3.5" /> : <BookmarkPlus className="size-3.5" />}
      {confirming ? 'Remove & lose progress?' : inReview ? 'In review' : 'Review'}
    </button>
  )
}

/** Adds every card of a lesson / deck (removing is done card by card or from the Review page). */
export function AddAllToReview({ ids, label = 'lesson', className }: { ids: string[]; label?: string; className?: string }) {
  const { status, cards } = useReviewStore()
  const [busy, setBusy] = useState(false)
  if (status === 'offline' || status === 'idle' || !ids.length) return null
  const missing = ids.filter((id) => !cards[id])

  if (!missing.length) {
    return (
      <span className={cn('inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300', className)}>
        <Check className="size-4" /> All in review
      </span>
    )
  }
  const run = async () => {
    setBusy(true)
    try {
      await addToReview(missing)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" onClick={run} loading={busy} className={className}>
      {!busy ? <BookmarkPlus className="size-4" /> : null}
      {missing.length < ids.length ? `Add ${missing.length} more to review` : `Add ${label} to review`}
    </Button>
  )
}
