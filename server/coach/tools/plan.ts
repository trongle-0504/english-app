// The planner and the flashcards, read only.
import { addDays, daysBetween, vnDay } from '../../../src/features/planner/dates.ts'
import { studyDay } from '../../../src/features/review/schedule.ts'
import { readLog, readState } from '../../review/progress.ts'
import { computeStats } from '../../review/stats.ts'
import { reviewCards } from '../../practice/works.ts'
import { eventsAhead, overdueTasks, readPlanner } from '../../planner/store.ts'
import type { ApiContext } from '../../api.ts'
import { cut, ToolError } from '../data.ts'
import { optDay, optInt } from './args.ts'
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

export const getDueCards: CoachTool = {
  name: 'get_due_cards',
  description:
    'Flashcards due today (oldest first) for a quiz in the chat: term, meaning, example. The quiz does not change the schedule.',
  inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: '1-10, default 5' } } },
  label: () => 'Picking your due flashcards…',
  async run(args, ctx) {
    const limit = optInt(args, 'limit', 1, 10, 5)
    const state = await readState(ctx as unknown as ApiContext)
    const today = studyDay(ctx.now, state.settings)
    const due = Object.entries(state.cards)
      .filter(([, c]) => !c.done && c.fsrs.state !== 0 && studyDay(new Date(c.fsrs.due), state.settings) <= today)
      .sort((a, b) => a[1].fsrs.due.localeCompare(b[1].fsrs.due))
    const cards = new Map(reviewCards(ctx).map((c) => [c.id, c]))
    const items = due
      .map(([id]) => cards.get(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .slice(0, limit)
      .map((c) => ({ term: cut(c.term, 80), meaning_vi: cut(c.meaning_vi, 160), example: cut(c.examples[0]?.en, 200) }))
    return { dueToday: due.length, items, reviewHref: '/review' }
  },
}
