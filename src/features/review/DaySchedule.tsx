import { useMemo } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import type { ReviewCard } from '@/types/content'
import { isLearnToday } from './queue'
import { addDays, studyDay } from './schedule'
import { useReviewStore } from './store'
import { selectClass, shortDay } from './WordsManager'

const QUICK_DAYS = 7

/**
 * Which words come up on a chosen day: reviews already scheduled for it, plus the new words that
 * would be introduced if every day until then uses the full "new cards per day" limit.
 */
export function DaySchedule({ cardsById, day, onDayChange }: { cardsById: ReadonlyMap<string, ReviewCard>; day: string; onDayChange: (day: string) => void }) {
  const { cards, settings, today: todayCounts } = useReviewStore()
  const today = settings ? studyDay(new Date(), settings) : ''
  const selected = day && day >= today ? day : today

  const plan = useMemo(() => {
    if (!settings) return null
    const reviews: { card: ReviewCard; due: number }[] = []
    const fresh: { card: ReviewCard; added: string; priority: boolean }[] = []
    for (const [id, stored] of Object.entries(cards)) {
      const card = cardsById.get(id)
      if (!card || stored.done) continue
      if (stored.fsrs.state === 0) {
        fresh.push({ card, added: stored.added, priority: isLearnToday(stored, today) })
        continue
      }
      const dueDay = studyDay(new Date(stored.fsrs.due), settings)
      // Today also carries everything overdue.
      if (selected === today ? dueDay <= today : dueDay === selected) reviews.push({ card, due: Date.parse(stored.fsrs.due) })
    }
    reviews.sort((a, b) => a.due - b.due)
    fresh.sort((a, b) => Number(b.priority) - Number(a.priority) || a.added.localeCompare(b.added))

    const offset = Math.round((Date.parse(`${selected}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
    // Words from Admin marked "learn today" always fit in today, even beyond the limit.
    const leftToday = Math.max(fresh.filter((f) => f.priority).length, settings.newPerDay - (todayCounts?.newStudied ?? 0), 0)
    const start = offset === 0 ? 0 : leftToday + (offset - 1) * settings.newPerDay
    const size = offset === 0 ? leftToday : settings.newPerDay
    return { reviews: reviews.map((r) => r.card), fresh: fresh.slice(start, start + size).map((f) => f.card) }
  }, [cards, cardsById, settings, selected, today, todayCounts])

  if (!settings || !plan) return null
  const quick = Array.from({ length: QUICK_DAYS }, (_, i) => addDays(today, i))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {quick.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDayChange(d === today ? '' : d)}
            aria-pressed={d === selected}
            className={cn(
              'rounded-lg border px-2 py-1 text-xs font-semibold transition-colors',
              d === selected
                ? 'border-brand-500 bg-brand-600 text-white dark:border-brand-400 dark:bg-brand-500 dark:text-slate-950'
                : 'border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300',
            )}
          >
            {shortDay(d, today, { weekday: 'short', day: 'numeric' })}
          </button>
        ))}
        <input
          type="date"
          value={selected}
          min={today}
          onChange={(e) => onDayChange(e.target.value && e.target.value !== today ? e.target.value : '')}
          aria-label="Pick a day"
          className={cn(selectClass, 'h-7 text-xs', !quick.includes(selected) && 'border-brand-400 ring-2 ring-brand-100 dark:ring-brand-900')}
        />
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-300">
        <span className="font-semibold text-slate-900 dark:text-white">
          {shortDay(selected, today, { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
        {' · '}
        {plan.reviews.length} to review · {plan.fresh.length} new
      </p>

      <div className="grid gap-5 md:grid-cols-2 md:gap-8">
        <WordGroup title={selected === today ? 'Reviews (incl. overdue)' : 'Reviews'} cards={plan.reviews} empty="No reviews scheduled." tone="review" />
        <WordGroup title="New words" cards={plan.fresh} empty={selected === today ? 'No new words left for today.' : 'No new words waiting.'} tone="new" />
      </div>
      <p className="text-xs text-slate-400">
        New words assume you study {settings.newPerDay} a day until then. Words you learn in the meantime will add more reviews.
      </p>
    </div>
  )
}

function WordGroup({ title, cards, empty, tone }: { title: string; cards: ReviewCard[]; empty: string; tone: 'review' | 'new' }) {
  return (
    <section>
      <p className="mb-1.5 text-[11px] font-bold tracking-[0.14em] text-slate-400 uppercase">
        {title} · {cards.length}
      </p>
      {cards.length ? (
        <div className="flex flex-wrap gap-1.5">
          {cards.map((card) => {
            const cls = cn(
              'rounded-lg border px-2 py-0.5 text-[13px]',
              tone === 'review'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
            )
            return card.href ? (
              <Link key={card.id} to={card.href} className={cn(cls, 'hover:underline')}>
                {card.term}
              </Link>
            ) : (
              <span key={card.id} className={cls}>
                {card.term}
              </span>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-400">{empty}</p>
      )}
    </section>
  )
}
