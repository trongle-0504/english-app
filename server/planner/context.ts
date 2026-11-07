// What the home page, the scheduler and the AI prompts know about the learner: today's plan, review cards due,
// latest scores. Reads other features' files; never writes them.
import path from 'node:path'
import type { ApiContext } from '../api.ts'
import { readJsonDoc, writeJsonDoc } from '../admin/store.ts'
import { readLog, readState } from '../review/progress.ts'
import { computeStats } from '../review/stats.ts'
import { talkReviews, writingReviews } from '../practice/works.ts'
import type { PlannerBrief, PlannerDoc, PlannerHome, PlannerTask } from '../../src/types/planner.ts'
import { addDays, daysBetween, vnDay, viWeekday, weekDays, weekStart } from '../../src/features/planner/dates.ts'
import { eventsAhead, overdueTasks, plannerDir, readPlanner, tasksForDay, updatePlanner, type PlannerCtx } from './store.ts'

export interface ReviewSummary {
  due: number
  streak: number
  reviewedToday: number
  /** Cards due on each of the next 14 days (index 0 = today, overdue included). */
  forecast: { day: string; count: number }[]
}

export async function reviewSummary(ctx: PlannerCtx, now = new Date()): Promise<ReviewSummary> {
  try {
    const apiCtx = ctx as ApiContext
    const stats = computeStats(await readState(apiCtx), await readLog(apiCtx), now)
    return { due: stats.forecast[0]?.count ?? 0, streak: stats.streak.current, reviewedToday: stats.today.reviewed, forecast: stats.forecast }
  } catch {
    return { due: 0, streak: 0, reviewedToday: 0, forecast: [] }
  }
}

/** The most recent Writing band and Speaking overall, null when there is none. */
export async function latestScores(ctx: PlannerCtx): Promise<{ writingBand: number | null; speakingBand: number | null }> {
  const workCtx = { rootDir: ctx.rootDir, contentDir: path.join(ctx.rootDir, 'content') }
  const [writing, speaking] = await Promise.all([writingReviews(workCtx).catch(() => []), talkReviews(workCtx).catch(() => [])])
  const newest = <T extends { createdAt: string }>(list: T[], band: (x: T) => number | undefined) =>
    list
      .filter((x) => typeof band(x) === 'number')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(band)[0] ?? null
  return {
    writingBand: newest(writing, (r) => r.score?.overall),
    speakingBand: newest(speaking, (r) => r.overall),
  }
}

/* ───────────── Briefs (progress/planner/briefs/<day>.json) ───────────── */

const briefFile = (ctx: PlannerCtx, day: string) => path.join(plannerDir(ctx), 'briefs', `${day}.json`)

export async function readBrief(ctx: PlannerCtx, day: string): Promise<PlannerBrief | null> {
  return (await readJsonDoc<PlannerBrief | null>(briefFile(ctx, day), null)).value
}

export async function saveBrief(ctx: PlannerCtx, brief: PlannerBrief): Promise<void> {
  await writeJsonDoc(briefFile(ctx, brief.day), brief)
}

/* ───────────── Home ───────────── */

/**
 * A review task of today is ticked once every card due today has been reviewed. Returns true when something changed,
 * so the file is written only then.
 */
export function autoTickReview(doc: PlannerDoc, today: string, review: ReviewSummary, nowIso: string): boolean {
  if (review.due !== 0 || review.reviewedToday === 0) return false
  let changed = false
  for (const task of doc.tasks) {
    if (task.skill === 'review' && task.date === today && !task.doneAt) {
      task.doneAt = nowIso
      task.updatedAt = nowIso
      changed = true
    }
  }
  return changed
}

/** Runs the review auto-tick and writes the file only when a task changed. */
export async function applyAutoTick(ctx: PlannerCtx, doc: PlannerDoc, review: ReviewSummary, now: Date): Promise<PlannerDoc> {
  const today = vnDay(now)
  if (!autoTickReview(structuredClone(doc), today, review, now.toISOString())) return doc
  return updatePlanner(ctx, (fresh) => {
    autoTickReview(fresh, today, review, now.toISOString())
    return structuredClone(fresh)
  })
}

export function weekProgress(doc: PlannerDoc, today: string): { done: number; total: number } {
  const days = new Set(weekDays(weekStart(today)))
  const week = doc.tasks.filter((t) => days.has(t.date))
  return { done: week.filter((t) => t.doneAt).length, total: week.length }
}

export async function buildHome(ctx: PlannerCtx, now = new Date()): Promise<PlannerHome> {
  const today = vnDay(now)
  const review = await reviewSummary(ctx, now)
  const doc = await applyAutoTick(ctx, await readPlanner(ctx), review, now)
  const events = eventsAhead(doc, today, 30)
  const countdown = eventsAhead(doc, today, 365).find((e) => e.countdown) ?? null
  return {
    day: today,
    now: now.toISOString(),
    tasks: tasksForDay(doc, today),
    overdue: overdueTasks(doc, today),
    events: events.slice(0, 5),
    countdown,
    review: { due: review.due, streak: review.streak, reviewedToday: review.reviewedToday },
    brief: await readBrief(ctx, today).catch(() => null),
    weekProgress: weekProgress(doc, today),
    settings: doc.settings,
  }
}

/* ───────────── AI inputs ───────────── */

export interface BriefFacts {
  today: string
  tasksToday: { id: string; title: string; time: string; durationMin: number; skill: string }[]
  overdue: { id: string; title: string; daysLate: number; skill: string }[]
  events: { title: string; kind: string; date: string; time: string; daysLeft: number }[]
  review: { due: number; streak: number }
  yesterday: { done: number; total: number }
  latestScores: { writingBand: number | null; speakingBand: number | null }
  targetBand: number | null
}

export async function briefFacts(ctx: PlannerCtx, doc: PlannerDoc, now = new Date()): Promise<BriefFacts> {
  const today = vnDay(now)
  const review = await reviewSummary(ctx, now)
  const yesterday = doc.tasks.filter((t) => t.date === addDays(today, -1))
  return {
    today: `${today} (${viWeekday(today)})`,
    tasksToday: tasksForDay(doc, today)
      .filter((t) => !t.doneAt)
      .map((t) => ({ id: t.id, title: t.title, time: t.time ?? '', durationMin: t.durationMin ?? 0, skill: t.skill })),
    overdue: overdueTasks(doc, today).map((t) => ({ id: t.id, title: t.title, daysLate: daysBetween(t.date, today), skill: t.skill })),
    events: eventsAhead(doc, today, 14).map((e) => ({ title: e.title, kind: e.kind, date: e.date, time: e.time ?? '', daysLeft: e.daysLeft })),
    review: { due: review.due, streak: review.streak },
    yesterday: { done: yesterday.filter((t) => t.doneAt).length, total: yesterday.length },
    latestScores: await latestScores(ctx),
    targetBand: doc.settings.targetBand ?? null,
  }
}

/** Minutes planned per day (undone tasks only count; done ones are past effort). */
export function plannedMinutes(tasks: PlannerTask[], days: string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]))
  for (const t of tasks) if (t.date in out && !t.doneAt) out[t.date] += t.durationMin ?? 30
  return out
}

/** Minutes available on a day from settings (index 0 = Monday). */
export function capacityOf(doc: PlannerDoc, day: string): number {
  const index = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
  return doc.settings.minutesPerDay[index] ?? 0
}
