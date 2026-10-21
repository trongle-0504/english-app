import { addDays, studyDay } from '../../src/features/review/schedule.ts'
import { stageOf } from '../../src/features/review/ladder.ts'
import type { ReviewLogEntry, ReviewStateDoc, ReviewStats } from '../../src/types/review.ts'

/** Dashboard numbers from the card states and the review log. */
export function computeStats(state: ReviewStateDoc, log: ReviewLogEntry[], now = new Date()): ReviewStats {
  const { settings } = state
  const today = studyDay(now, settings)

  const heatmap: Record<string, number> = {}
  const since = addDays(today, -364)
  let minutesMs = 0
  for (const entry of log) {
    if (entry.day >= since) heatmap[entry.day] = (heatmap[entry.day] ?? 0) + 1
    if (entry.day === today) minutesMs += Math.min(entry.durationMs ?? 0, 5 * 60_000)
  }

  const todays = log.filter((e) => e.day === today)
  const yesterdayDay = addDays(today, -1)
  const yesterdays = log.filter((e) => e.day === yesterdayDay)
  const studiedDays = new Set(log.map((e) => e.day))
  // The streak survives until the end of today even if today has no reviews yet.
  let current = 0
  for (let day = studiedDays.has(today) ? today : addDays(today, -1); studiedDays.has(day); day = addDays(day, -1)) current++
  let best = 0
  let run = 0
  let previous = ''
  for (const day of [...studiedDays].sort()) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1
    best = Math.max(best, run)
    previous = day
  }

  const monthAgo = addDays(today, -29)
  const mature = log.filter((e) => e.day >= monthAgo && e.prev.state === 2)
  const retention30 = mature.length ? mature.filter((e) => e.rating > 1).length / mature.length : null
  const twoMonthsAgo = addDays(today, -59)
  const maturePrev = log.filter((e) => e.day >= twoMonthsAgo && e.day < monthAgo && e.prev.state === 2)
  const retentionPrev30 = maturePrev.length ? maturePrev.filter((e) => e.rating > 1).length / maturePrev.length : null

  const forecast = Array.from({ length: 14 }, (_, i) => ({ day: addDays(today, i), count: 0 }))
  const byState = { new: 0, learning: 0, review: 0, relearning: 0 }
  const ladder: ReviewStats['ladder'] = { recognize: 0, recall: 0, collocate: 0, paraphrase: 0, produce: 0, off: 0 }
  let done = 0
  for (const card of Object.values(state.cards)) {
    if (card.done) {
      done++
      continue
    }
    const s = card.fsrs.state
    if (s === 0) {
      byState.new++
      continue
    }
    ladder[card.ladder === false ? 'off' : stageOf(card)]++
    byState[s === 1 ? 'learning' : s === 2 ? 'review' : 'relearning']++
    const dueDay = studyDay(new Date(card.fsrs.due), settings)
    const offset = dueDay <= today ? 0 : forecast.findIndex((f) => f.day === dueDay)
    if (offset >= 0) forecast[offset].count++
  }

  const hardest = Object.entries(state.cards)
    .filter(([, c]) => c.fsrs.lapses > 0 && !c.done)
    .sort((a, b) => b[1].fsrs.lapses - a[1].fsrs.lapses)
    .slice(0, 10)
    .map(([id, c]) => ({ id, lapses: c.fsrs.lapses }))

  return {
    today: {
      day: today,
      reviewed: todays.length,
      newStudied: todays.filter((e) => e.prev.state === 0).length,
      minutes: Math.round(minutesMs / 60_000),
    },
    yesterday: {
      reviewed: yesterdays.length,
      newStudied: yesterdays.filter((e) => e.prev.state === 0).length,
      minutes: Math.round(yesterdays.reduce((ms, e) => ms + Math.min(e.durationMs ?? 0, 5 * 60_000), 0) / 60_000),
    },
    retentionPrev30,
    ladder,
    heatmap,
    streak: { current, best },
    retention30,
    forecast,
    byState,
    done,
    hardest,
    totalReviews: log.length,
  }
}
