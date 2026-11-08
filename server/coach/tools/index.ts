// The coach's tool registry and the level-0 overview line sent with every question.
import { enWeekday, vnDay, vnTime } from '../../../src/features/planner/dates.ts'
import type { ApiContext } from '../../api.ts'
import { eventsAhead, overdueTasks, readPlanner, tasksForDay } from '../../planner/store.ts'
import { readLog, readState } from '../../review/progress.ts'
import { computeStats } from '../../review/stats.ts'
import { dayOf, ideaDocs, talkDocs, type ToolContext, writingDocs } from '../data.ts'
import { searchLibrary } from './library.ts'
import { getMistakes } from './mistakes.ts'
import { getPlan, getReviewStats } from './plan.ts'
import type { CoachTool } from './types.ts'
import { getScores, getSpeakingReview, getWritingReview, listWorks } from './works.ts'

export type { CoachTool } from './types.ts'

/** Summaries first, details by id after, search last (the order agy lists them to the model). */
export const COACH_TOOLS: CoachTool[] = [getMistakes, listWorks, getScores, getPlan, getReviewStats, getWritingReview, getSpeakingReview, searchLibrary]

export const toolByName = (name: string) => COACH_TOOLS.find((t) => t.name === name)

/**
 * The registry name of an MCP tool as agy reports it: "mcp_app_82aaed4d_get_mistakes" (agy adds a per-connection hash)
 * or "mcp_app_get_mistakes" → "get_mistakes". Any other name (agy's own tools) is returned unchanged.
 */
export function appToolName(name: string): string {
  const match = /^mcp_app_(?:[0-9a-f]{6,}_)?(.+)$/.exec(name)
  return match && toolByName(match[1]) ? match[1] : name
}

/**
 * Level 0: one short block of facts so most "today / yesterday / last essay" questions need no tool call.
 * Every part is optional: a missing data set is skipped, never guessed. ≤ ~600 characters.
 */
export async function overview(ctx: ToolContext): Promise<string> {
  const today = vnDay(ctx.now)
  const parts: string[] = [`today ${today} (${enWeekday(today)}) ${vnTime(ctx.now)} VN`]
  const safe = async <T>(f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f()
    } catch {
      return null
    }
  }
  const [writing, talks, ideas, plan, cards] = await Promise.all([
    safe(() => writingDocs(ctx)),
    safe(() => talkDocs(ctx)),
    safe(() => ideaDocs(ctx)),
    safe(() => readPlanner(ctx)),
    safe(async () => computeStats(await readState(ctx as unknown as ApiContext), await readLog(ctx as unknown as ApiContext), ctx.now)),
  ])
  if (writing) {
    const last = writing[0]
    parts.push(
      `writing reviews: ${writing.length}${last ? `, last ${dayOf(last.createdAt)} id ${last.id}${typeof last.score?.overall === 'number' ? ` band ${last.score.overall}` : ''}` : ''}`,
    )
  }
  if (talks) {
    const last = talks[0]
    parts.push(`speaking reviews (recordings): ${talks.length}${last ? `, last ${dayOf(last.createdAt)} id ${last.id}${typeof last.overall === 'number' ? ` band ${last.overall}` : ''}` : ''}`)
  }
  if (ideas) parts.push(`speaking ideas: ${ideas.length}${ideas[0] ? `, last ${dayOf(ideas[0].createdAt)}` : ''}`)
  if (cards) parts.push(`flashcards due today ${cards.forecast[0]?.count ?? 0}, streak ${cards.streak.current} days`)
  if (plan) {
    const tasks = tasksForDay(plan, today)
    parts.push(`plan today: ${tasks.filter((t) => !t.doneAt).length} open, ${tasks.filter((t) => t.doneAt).length} done, ${overdueTasks(plan, today).length} overdue`)
    const exam = eventsAhead(plan, today, 365).find((e) => e.kind === 'exam')
    if (exam) parts.push(`exam: ${exam.title} ${exam.date} (${exam.daysLeft} days)`)
    if (plan.settings.targetBand) parts.push(`target band ${plan.settings.targetBand}`)
  }
  return parts.join(' · ')
}
