// Planner writes shared by the routes and the Study Coach (its confirmed proposals): same checks, same errors.
import type { PlannerTask } from '../../src/types/planner.ts'
import { isObject } from '../admin/input.ts'
import { ApiError } from '../api.ts'
import { checkDay, checkTime, taskFromBody, updatePlanner, type PlannerCtx } from './store.ts'

/** POST /planner/tasks: 1–60 task bodies → the created tasks (all or nothing). */
export async function createTasks(ctx: PlannerCtx, list: unknown, now = new Date().toISOString()): Promise<PlannerTask[]> {
  if (!Array.isArray(list) || !list.length || list.length > 60) throw new ApiError(400, 'Send 1–60 tasks.')
  const created = list.map((item) => {
    if (!isObject(item)) throw new ApiError(400, 'Each task must be an object.')
    return taskFromBody(item, now)
  })
  await updatePlanner(ctx, (doc) => void doc.tasks.push(...created))
  return created
}

/** POST /planner/reschedule/apply: moves (unknown ids skipped) and drops, in one write. */
export function applyMoves(ctx: PlannerCtx, moves: unknown[], drop: string[], now = new Date().toISOString()): Promise<{ moved: number; dropped: number }> {
  return updatePlanner(ctx, (doc) => {
    let moved = 0
    for (const m of moves) {
      if (!isObject(m)) continue
      const task = doc.tasks.find((t) => t.id === m.taskId)
      if (!task) continue
      const date = checkDay(m.date)
      const time = checkTime(m.time)
      if (task.date !== date) task.movedFrom = task.date
      task.date = date
      if (time) task.time = time
      else delete task.time
      delete task.snoozedUntil
      task.updatedAt = now
      moved++
    }
    const before = doc.tasks.length
    doc.tasks = doc.tasks.filter((t) => !drop.includes(t.id))
    return { moved, dropped: before - doc.tasks.length }
  })
}
