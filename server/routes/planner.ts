// Study planner API: tasks, events, weekly routine, settings, AI helpers and Web Push.
import { ApiError, type ApiHandler } from '../api.ts'
import { isObject, jsonBody, queryParam } from '../admin/input.ts'
import type { PlannerTask } from '../../src/types/planner.ts'
import { addDays, daysBetween, isoWeekday, vnDay, weekDays, weekStart } from '../../src/features/planner/dates.ts'
import { draftWeek, ensureBrief, proposeReschedule, quickAdd } from '../planner/ai.ts'
import { buildHome } from '../planner/context.ts'
import { eventToIcs, icsFileName } from '../planner/ics.ts'
import { listDevices, sendToAll, subscribe, unsubscribe, vapidKeys } from '../planner/push.ts'
import {
  checkDay,
  checkTime,
  eventFromBody,
  findEvent,
  findTask,
  newId,
  readPlanner,
  routineFromBody,
  settingsFromBody,
  sortTasks,
  taskFromBody,
  updatePlanner,
} from '../planner/store.ts'

/** Creates one task per routine item for each day of the week from today on, skipping (routineId, date) pairs that exist. */
export function applyRoutineToWeek(tasks: PlannerTask[], routine: { id: string; weekday: number; title: string; time?: string; durationMin?: number; skill: PlannerTask['skill']; link?: string }[], start: string, today: string, nowIso: string): PlannerTask[] {
  const have = new Set(tasks.filter((t) => t.routineId).map((t) => `${t.routineId}|${t.date}`))
  const added: PlannerTask[] = []
  for (const day of weekDays(weekStart(start))) {
    if (day < today) continue
    for (const item of routine) {
      if (item.weekday !== isoWeekday(day) || have.has(`${item.id}|${day}`)) continue
      have.add(`${item.id}|${day}`)
      added.push({
        id: newId(),
        title: item.title,
        date: day,
        ...(item.time ? { time: item.time } : {}),
        ...(item.durationMin ? { durationMin: item.durationMin } : {}),
        skill: item.skill,
        ...(item.link ? { link: item.link } : {}),
        source: 'routine',
        routineId: item.id,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
    }
  }
  return added
}

const body = jsonBody

export const plannerRoutes: Record<string, ApiHandler> = {
  'GET /planner/home': async (_req, ctx) => ({ json: await buildHome(ctx) }),

  'GET /planner/week': async (req, ctx) => {
    const start = weekStart(checkDay(req.query.get('start') || vnDay(), 'Week'))
    const doc = await readPlanner(ctx)
    const days = weekDays(start).map((day) => ({
      day,
      tasks: sortTasks(doc.tasks.filter((t) => t.date === day)),
      events: doc.events.filter((e) => e.date === day).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')),
    }))
    return { json: { start, days, routine: doc.routine, settings: doc.settings } }
  },

  /* ── Tasks ── */
  'PUT /planner/task': async (req, ctx) => {
    const input = body(req)
    const now = new Date().toISOString()
    const task = await updatePlanner(ctx, (doc) => {
      if (input.id) {
        const prev = findTask(doc, input.id)
        const next = taskFromBody(input, now, prev)
        doc.tasks[doc.tasks.indexOf(prev)] = next
        return next
      }
      const created = taskFromBody(input, now)
      doc.tasks.push(created)
      return created
    })
    return { json: { task } }
  },

  'POST /planner/tasks': async (req, ctx) => {
    const list = body(req).tasks
    if (!Array.isArray(list) || !list.length || list.length > 60) throw new ApiError(400, 'Send 1–60 tasks.')
    const now = new Date().toISOString()
    const created = list.map((item) => {
      if (!isObject(item)) throw new ApiError(400, 'Each task must be an object.')
      return taskFromBody(item, now)
    })
    await updatePlanner(ctx, (doc) => void doc.tasks.push(...created))
    return { json: { tasks: created } }
  },

  'DELETE /planner/task': async (req, ctx) => {
    const id = queryParam(req, 'id')
    await updatePlanner(ctx, (doc) => {
      findTask(doc, id)
      doc.tasks = doc.tasks.filter((t) => t.id !== id)
    })
    return { json: { ok: true } }
  },

  'POST /planner/task/done': async (req, ctx) => {
    const input = body(req)
    const now = new Date().toISOString()
    const task = await updatePlanner(ctx, (doc) => {
      const t = findTask(doc, input.id)
      if (input.done === false) delete t.doneAt
      else t.doneAt ??= now
      delete t.snoozedUntil
      t.updatedAt = now
      return t
    })
    return { json: { task } }
  },

  'POST /planner/task/snooze': async (req, ctx) => {
    const input = body(req)
    const minutes = input.minutes
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 15 || minutes > 1440) throw new ApiError(400, 'Snooze for 15 to 1440 minutes.')
    const now = new Date()
    const task = await updatePlanner(ctx, (doc) => {
      const t = findTask(doc, input.id)
      t.snoozedUntil = new Date(now.getTime() + minutes * 60_000).toISOString()
      t.updatedAt = now.toISOString()
      return t
    })
    return { json: { task } }
  },

  'POST /planner/task/move': async (req, ctx) => {
    const input = body(req)
    const date = checkDay(input.date)
    const time = 'time' in input ? checkTime(input.time) : undefined
    const now = new Date().toISOString()
    const task = await updatePlanner(ctx, (doc) => {
      const t = findTask(doc, input.id)
      if (t.date !== date) t.movedFrom = t.date
      t.date = date
      if ('time' in input) {
        if (time) t.time = time
        else delete t.time
      }
      delete t.snoozedUntil
      t.updatedAt = now
      return t
    })
    return { json: { task } }
  },

  /* ── Events ── */
  'PUT /planner/event': async (req, ctx) => {
    const input = body(req)
    const now = new Date().toISOString()
    const event = await updatePlanner(ctx, (doc) => {
      if (input.id) {
        const prev = findEvent(doc, input.id)
        const next = eventFromBody(input, now, prev)
        doc.events[doc.events.indexOf(prev)] = next
        return next
      }
      const created = eventFromBody(input, now)
      doc.events.push(created)
      return created
    })
    return { json: { event } }
  },

  /** Every event, soonest first (the Events view; past ones are collapsed there). */
  'GET /planner/events': async (_req, ctx) => {
    const today = vnDay()
    const events = (await readPlanner(ctx)).events
      .map((e) => ({ ...e, daysLeft: daysBetween(today, e.date) }))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
    return { json: { events } }
  },

  'DELETE /planner/event': async (req, ctx) => {
    const id = queryParam(req, 'id')
    await updatePlanner(ctx, (doc) => {
      findEvent(doc, id)
      doc.events = doc.events.filter((e) => e.id !== id)
    })
    return { json: { ok: true } }
  },

  'GET /planner/event.ics': async (req, ctx) => {
    const event = findEvent(await readPlanner(ctx), queryParam(req, 'id'))
    return {
      body: Buffer.from(eventToIcs(event), 'utf8'),
      contentType: 'text/calendar; charset=utf-8',
      headers: { 'Content-Disposition': `attachment; filename="${icsFileName(event)}"` },
    }
  },

  /* ── Routine & weeks ── */
  'PUT /planner/routine': async (req, ctx) => {
    const list = body(req).routine
    if (!Array.isArray(list) || list.length > 100) throw new ApiError(400, 'Routine: at most 100 items.')
    const routine = list.map(routineFromBody)
    await updatePlanner(ctx, (doc) => void (doc.routine = routine))
    return { json: { routine } }
  },

  'POST /planner/week/apply-routine': async (req, ctx) => {
    const start = weekStart(checkDay(body(req).start, 'Week'))
    const now = new Date()
    const added = await updatePlanner(ctx, (doc) => {
      const created = applyRoutineToWeek(doc.tasks, doc.routine, start, vnDay(now), now.toISOString())
      doc.tasks.push(...created)
      return created.length
    })
    return { json: { added } }
  },

  'POST /planner/week/copy': async (req, ctx) => {
    const input = body(req)
    const from = weekStart(checkDay(input.from, 'Source week'))
    const to = weekStart(checkDay(input.to, 'Target week'))
    if (from === to) throw new ApiError(400, 'Pick two different weeks.')
    const shift = Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000)
    const now = new Date().toISOString()
    const added = await updatePlanner(ctx, (doc) => {
      const fromDays = new Set(weekDays(from))
      const copies: PlannerTask[] = doc.tasks
        .filter((t) => fromDays.has(t.date))
        .map((t) => {
          const { doneAt: _done, snoozedUntil: _snooze, movedFrom: _moved, routineId: _routine, ...rest } = t
          return { ...rest, id: newId(), date: addDays(t.date, shift), source: 'manual' as const, createdAt: now, updatedAt: now }
        })
      doc.tasks.push(...copies)
      return copies.length
    })
    return { json: { added } }
  },

  'PUT /planner/settings': async (req, ctx) => {
    const input = body(req)
    const settings = await updatePlanner(ctx, (doc) => (doc.settings = settingsFromBody(input, doc.settings)))
    return { json: { settings } }
  },

  /* ── AI ── */
  'POST /planner/quick-add': async (req) => {
    const text = typeof body(req).text === 'string' ? (body(req).text as string).trim() : ''
    if (!text) throw new ApiError(400, 'Type something for the AI to read.')
    if (text.length > 500) throw new ApiError(400, 'At most 500 characters.')
    const { items, unparsed } = await quickAdd(text)
    return { json: { items, unparsed } }
  },

  'POST /planner/brief': async (req, ctx) => {
    const force = isObject(req.body) && req.body.force === true
    return { json: { brief: await ensureBrief(ctx, vnDay(), { force }) } }
  },

  'POST /planner/reschedule': async (_req, ctx) => {
    const { raw: _raw, ms: _ms, ...proposal } = await proposeReschedule(ctx)
    return { json: proposal }
  },

  'POST /planner/reschedule/apply': async (req, ctx) => {
    const input = body(req)
    const moves = Array.isArray(input.moves) ? input.moves : []
    const drop = Array.isArray(input.drop) ? input.drop.filter((id): id is string => typeof id === 'string') : []
    const now = new Date().toISOString()
    const result = await updatePlanner(ctx, (doc) => {
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
    return { json: result }
  },

  'POST /planner/week/draft': async (req, ctx) => {
    const input = body(req)
    const start = weekStart(checkDay(input.start, 'Week'))
    const minutesPerDay =
      Array.isArray(input.minutesPerDay) && input.minutesPerDay.length === 7 && input.minutesPerDay.every((n) => Number.isInteger(n) && n >= 0 && n <= 720)
        ? (input.minutesPerDay as number[])
        : undefined
    const focus = typeof input.focus === 'string' ? input.focus : ''
    const { tasks, summary } = await draftWeek(ctx, start, { minutesPerDay, focus })
    return { json: { tasks, summary } }
  },

  /* ── Push ── */
  'GET /planner/push/key': async (_req, ctx) => ({ json: { publicKey: (await vapidKeys(ctx)).publicKey } }),

  'POST /planner/push/subscribe': async (req, ctx) => {
    const input = body(req)
    const sub = input.subscription
    if (!isObject(sub) || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !isObject(sub.keys)) {
      throw new ApiError(400, 'Missing the notification subscription.')
    }
    const keys = sub.keys as Record<string, unknown>
    if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') throw new ApiError(400, 'Missing the notification subscription keys.')
    const device = typeof input.device === 'string' ? input.device.slice(0, 40) : ''
    await subscribe(ctx, { endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, device)
    return { json: { ok: true } }
  },

  'POST /planner/push/unsubscribe': async (req, ctx) => {
    const endpoint = body(req).endpoint
    if (typeof endpoint !== 'string') throw new ApiError(400, 'Missing endpoint.')
    await unsubscribe(ctx, endpoint)
    return { json: { ok: true } }
  },

  'GET /planner/push/devices': async (_req, ctx) => ({ json: { devices: await listDevices(ctx) } }),

  'POST /planner/push/test': async (_req, ctx) => {
    const results = await sendToAll(ctx, { title: 'Test notification ✓', body: 'This is how the planner will remind you.', tag: 'test', url: '/planner' }, { urgency: 'high' })
    if (!results.length) throw new ApiError(400, 'No device has notifications turned on yet.')
    return { json: { results } }
  },
}
