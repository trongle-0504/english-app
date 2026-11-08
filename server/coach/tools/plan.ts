// The planner and the flashcards, read only.
import { addDays, daysBetween, vnDay } from '../../../src/features/planner/dates.ts'
import { readLog, readState } from '../../review/progress.ts'
import { computeStats } from '../../review/stats.ts'
import { reviewCards } from '../../practice/works.ts'
import { eventsAhead, overdueTasks, readPlanner } from '../../planner/store.ts'
import type { ApiContext } from '../../api.ts'
import { cut, ToolError } from '../data.ts'
import { optDay } from './args.ts'
import { DAY, type CoachTool } from './types.ts'

export const getPlan: CoachTool = {
  name: 'get_plan',
  description: "The learner's planner between two VN days (at most 14 days): tasks with ids, times, skill and done state, events, and the overdue tasks.",
  inputSchema: { type: 'object', properties: { from: DAY, to: DAY }, required: ['from', 'to'] },
  label: () => 'Reading your plan…',
  async run(args, ctx) {
    const today = vnDay(ctx.now)
    const from = optDay(args, 'from') ?? today
    const to = optDay(args, 'to') ?? from
    if (to < from) throw new ToolError('to must not be before from.')
    if (daysBetween(from, to) > 13) throw new ToolError('At most 14 days at a time.')
    const doc = await readPlanner(ctx)
    const tasks = doc.tasks
      .filter((t) => t.date >= from && t.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99'))
      .slice(0, 40)
      .map((t) => ({ id: t.id, day: t.date, time: t.time ?? '', title: cut(t.title, 80), skill: t.skill, minutes: t.durationMin ?? null, done: Boolean(t.doneAt) }))
    const events = eventsAhead(doc, from, daysBetween(from, to) + 1)
      .filter((e) => e.date <= to)
      .map((e) => ({ title: cut(e.title, 80), kind: e.kind, day: e.date, time: e.time ?? '', daysLeft: daysBetween(today, e.date) }))
    const overdue = overdueTasks(doc, today, 10).map((t) => ({ id: t.id, day: t.date, title: cut(t.title, 80), skill: t.skill }))
    return { today, from, to, tasks, events, overdue }
  },
}

export const getReviewStats: CoachTool = {
  name: 'get_review_stats',
  description: 'The flashcard review state: cards due today and the next 7 days, streak, cards by state, reviews done today, and the 5 hardest cards.',
  inputSchema: { type: 'object', properties: {} },
  label: () => 'Reading your flashcards…',
  async run(_args, ctx) {
    const apiCtx = ctx as unknown as ApiContext
    const stats = computeStats(await readState(apiCtx), await readLog(apiCtx), ctx.now)
    const terms = new Map(reviewCards(ctx).map((c) => [c.id, c.term]))
    const week = new Set(Array.from({ length: 7 }, (_, i) => addDays(vnDay(ctx.now), i)))
    return {
      dueToday: stats.forecast[0]?.count ?? 0,
      next7Days: stats.forecast.filter((f) => week.has(f.day)).map((f) => ({ day: f.day, due: f.count })),
      streak: stats.streak,
      byState: stats.byState,
      reviewedToday: stats.today.reviewed,
      hardest: stats.hardest.slice(0, 5).map((h) => ({ term: cut(terms.get(h.id) ?? h.id, 60), lapses: h.lapses })),
    }
  },
}
