// FSRS scheduling shared by the server (authoritative) and the app (interval previews).
// Relative imports only: the server loads this file directly with Node.
import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade } from 'ts-fsrs'
import type { ReviewSettings, SchedulerCard } from '../../types/review.ts'

export function toCard(stored: SchedulerCard): Card {
  return { ...stored, due: new Date(stored.due), last_review: stored.last_review ? new Date(stored.last_review) : undefined }
}

export function fromCard(card: Card): SchedulerCard {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as SchedulerCard['state'],
    last_review: card.last_review?.toISOString(),
  }
}

export function newSchedulerCard(now = new Date()): SchedulerCard {
  return fromCard(createEmptyCard(now))
}

function scheduler(settings: Pick<ReviewSettings, 'retention'>, fuzz: boolean) {
  return fsrs(generatorParameters({ request_retention: settings.retention, enable_fuzz: fuzz, maximum_interval: 3650 }))
}

/** Next state after a review. The server uses this with fuzz, so intervals spread out a little. */
export function schedule(card: SchedulerCard, rating: Grade, settings: Pick<ReviewSettings, 'retention'>, now = new Date()): SchedulerCard {
  return fromCard(scheduler(settings, true).next(toCard(card), now, rating).card)
}

/** "1m", "10m", "3d", "2mo"… for the four grade buttons. */
export function previewIntervals(card: SchedulerCard, settings: Pick<ReviewSettings, 'retention'>, now = new Date()): Record<Grade, string> {
  const preview = scheduler(settings, false).repeat(toCard(card), now)
  const label = (due: Date) => formatInterval(due.getTime() - now.getTime())
  return { 1: label(preview[1].card.due), 2: label(preview[2].card.due), 3: label(preview[3].card.due), 4: label(preview[4].card.due) }
}

export function formatInterval(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(days / 36.5) / 10}y`
}

/** Study-day key ("2026-09-26") in the learner's time zone; the day starts at `dayStartHour`. */
export function studyDay(date: Date, settings: Pick<ReviewSettings, 'timeZone' | 'dayStartHour'>): string {
  const shifted = new Date(date.getTime() - settings.dayStartHour * 3600_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: settings.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted)
}

/** Adds whole days to a study-day key. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
