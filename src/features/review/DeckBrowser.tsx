import { Check, ChevronRight, Loader2, Play, Square, SquareCheck, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, ButtonLink, EmptyState, SearchInput, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import { matchesQuery } from '@/lib/text'
import type { ReviewCard, ReviewDeck, ReviewSource } from '@/types/content'
import { addToReview, removeFromReview, useReviewStore } from './store'

const SOURCES: { value: ReviewSource; label: string }[] = [
  { value: 'vocabulary', label: 'Vocabulary' },
  { value: 'collocation', label: 'Collocations' },
  { value: 'word-collocation', label: 'In vocabulary' },
  { value: 'note', label: 'Notes' },
  { value: 'custom', label: 'My cards' },
  { value: 'essay', label: 'Essays' },
]

/** Tick words one by one; unticking a card that has been studied needs a second click. */
function WordPicker({ ids, cardsById }: { ids: string[]; cardsById: ReadonlyMap<string, ReviewCard> }) {
  const { cards } = useReviewStore()
  const [pending, setPending] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const toggle = async (id: string) => {
    const inReview = Boolean(cards[id])
    if (inReview && (cards[id]?.fsrs.reps ?? 0) > 0 && confirming !== id) {
      setConfirming(id)
      return
    }
    setConfirming(null)
    setPending(id)
    try {
      await (inReview ? removeFromReview([id]) : addToReview([id]))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 pt-1 pr-3 pb-3 pl-9">
      {ids.map((id) => {
        const card = cardsById.get(id)
        if (!card) return null
        const checked = Boolean(cards[id])
        const Icon = pending === id ? Loader2 : checked ? SquareCheck : Square
        return (
          <button
            key={id}
            type="button"
            role="checkbox"
            aria-checked={checked}
            onClick={() => void toggle(id)}
            onBlur={() => confirming === id && setConfirming(null)}
            disabled={pending === id}
            title={confirming === id ? 'Click again to remove (progress will be lost)' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[13px] transition-colors',
              confirming === id
                ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                : checked
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
            )}
          >
            <Icon className={cn('size-3.5 shrink-0', pending === id && 'animate-spin', checked ? 'text-emerald-600' : 'text-slate-400')} />
            {confirming === id ? `Remove “${card.term}”?` : card.term}
          </button>
        )
      })}
    </div>
  )
}

function DeckRow({ deck, cardsById }: { deck: ReviewDeck; cardsById: ReadonlyMap<string, ReviewCard> }) {
  const [open, setOpen] = useState(false)
  const { cards } = useReviewStore()
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const inReview = deck.cardIds.filter((id) => cards[id]).length
  const missing = deck.cardIds.filter((id) => !cards[id])
  const pct = deck.cardIds.length ? (inReview / deck.cardIds.length) * 100 : 0

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    try {
      await task()
    } finally {
      setBusy(false)
      setConfirmRemove(false)
    }
  }

  return (
    <li>
      <div className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 basis-48 items-start gap-2 text-left"
          title={open ? 'Hide words' : 'Show words to pick one by one'}
        >
          <ChevronRight className={cn('mt-0.5 size-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-90')} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{deck.name}</span>
            <span className="mt-1 flex items-center gap-2">
              <span className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </span>
              <span className="text-xs text-slate-500 tabular-nums">
                {inReview}/{deck.cardIds.length} in review
              </span>
            </span>
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          {inReview ? (
            <ButtonLink to={`/review/session?deck=${encodeURIComponent(deck.id)}`} variant="ghost" size="sm" title="Study only this deck">
              <Play className="size-3.5" /> Study
            </ButtonLink>
          ) : null}
          {missing.length ? (
            <Button size="sm" variant="outline" loading={busy} onClick={() => run(() => addToReview(missing))}>
              {missing.length === deck.cardIds.length ? `Add ${missing.length}` : `Add ${missing.length} more`}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 text-xs font-semibold text-emerald-600">
              <Check className="size-3.5" /> All added
            </span>
          )}
          {inReview ? (
            <Button
              size="sm"
              variant={confirmRemove ? 'danger' : 'ghost'}
              onClick={() => (confirmRemove ? run(() => removeFromReview(deck.cardIds.filter((id) => cards[id]))) : setConfirmRemove(true))}
              onBlur={() => setConfirmRemove(false)}
              title="Remove this deck's cards (and their progress) from reviews"
              aria-label="Remove from reviews"
            >
              <Trash2 className="size-3.5" />
              {confirmRemove ? 'Remove & lose progress' : null}
            </Button>
          ) : null}
        </div>
      </div>
      {open ? <WordPicker ids={deck.cardIds} cardsById={cardsById} /> : null}
    </li>
  )
}

/** All decks from every source; add whole decks or tick single words, or study one deck. */
export function DeckBrowser({ decks, cardsById }: { decks: ReviewDeck[]; cardsById: ReadonlyMap<string, ReviewCard> }) {
  const [source, setSource] = useState<ReviewSource>('vocabulary')
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const filtered = decks.filter((d) => d.source === source && (matchesQuery(d.name, query) || matchesQuery(d.group, query)))
    const byGroup = new Map<string, ReviewDeck[]>()
    for (const d of filtered) byGroup.set(d.group, [...(byGroup.get(d.group) ?? []), d])
    return [...byGroup.entries()]
  }, [decks, source, query])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="scrollbar-thin -mx-1 overflow-x-auto px-1">
          <SegmentedControl value={source} onChange={setSource} options={SOURCES} size="sm" />
        </div>
        <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter decks…" className="w-full sm:w-64" />
      </div>
      {groups.length === 0 ? (
        <EmptyState
          title="No decks here"
          description={source === 'custom' ? 'Create your own cards in the “My cards” tab.' : 'Try another filter.'}
        />
      ) : (
        groups.map(([group, list]) => (
          <section key={group}>
            <h3 className={cn('mb-1 px-3 text-[11px] font-bold tracking-[0.16em] text-slate-400 uppercase')}>{group}</h3>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {list.map((deck) => (
                <DeckRow key={deck.id} deck={deck} cardsById={cardsById} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
