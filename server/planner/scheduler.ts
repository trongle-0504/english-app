// Planner notifications. Every 30 s: work out what is due (a pure function, tested), mark it sent, then send it.
// Times are VN wall-clock; a push missed while the PC slept goes out when the server is back, inside its catch-up window.
import path from 'node:path'
import { readJsonDoc, updateJsonDoc } from '../admin/store.ts'
import type { PlannerDoc, PlannerTask } from '../../src/types/planner.ts'
import { minutesOf, vnDateTime, vnDay, vnTime } from '../../src/features/planner/dates.ts'
import { SKILL_LABELS } from '../../src/features/planner/skills.ts'
import { ensureBrief } from './ai.ts'
import { applyAutoTick, reviewSummary } from './context.ts'
import { sendToAll, type PushPayload, type SendOptions } from './push.ts'
import { overdueTasks, plannerDir, readPlanner, type PlannerCtx } from './store.ts'

export interface Due {
  key: string
  kind: 'brief-gen' | 'brief' | 'task' | 'snooze' | 'digest' | 'event'
  taskId?: string
  eventId?: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** True when `now` (VN) is inside the quiet hours; the range may wrap midnight (22:30 → 06:30). */
export function inQuietHours(now: Date, quietStart: string, quietEnd: string): boolean {
  const t = minutesOf(vnTime(now))
  const start = minutesOf(quietStart)
  const end = minutesOf(quietEnd)
  if (start === end) return false
  return start < end ? t >= start && t < end : t >= start || t < end
}

/**
 * What should go out now. Never reads files or the clock: the planner, the keys already sent and `now` come in.
 * A notification is due from its time until the end of its catch-up window, once (its key is then in `sent`).
 * During quiet hours only the brief generation (no push) runs; the rest waits for quietEnd if still in its window.
 */
export function dueNotifications(doc: PlannerDoc, sent: Record<string, string>, now: Date): Due[] {
  const s = doc.settings
  const day = vnDay(now)
  const t = now.getTime()
  const quiet = inQuietHours(now, s.quietStart, s.quietEnd)
  const out: Due[] = []
  const due = (item: Due, from: number, until: number, push = true) => {
    if (sent[item.key] || t < from || t >= until) return
    if (push && quiet) return
    out.push(item)
  }

  const morning = vnDateTime(day, s.morningTime).getTime()
  const briefUntil = vnDateTime(day, '11:00').getTime()
  due({ key: `brief-gen:${day}`, kind: 'brief-gen' }, morning - 15 * MINUTE, briefUntil, false)
  due({ key: `brief:${day}`, kind: 'brief' }, morning, briefUntil)

  if (s.taskReminders) {
    for (const task of doc.tasks) {
      if (task.doneAt) continue
      const snoozed = task.snoozedUntil ? new Date(task.snoozedUntil).getTime() : 0
      if (task.date === day && task.time && snoozed <= t) {
        const at = vnDateTime(day, task.time).getTime()
        // A snooze that started after the reminder time replaces the plain reminder.
        if (!(snoozed && snoozed > at)) due({ key: `task:${task.id}:${task.date}T${task.time}`, kind: 'task', taskId: task.id }, at, at + 2 * HOUR)
      }
      if (snoozed) due({ key: `snooze:${task.id}:${task.snoozedUntil}`, kind: 'snooze', taskId: task.id }, snoozed, snoozed + 2 * HOUR)
    }
  }

  if (s.overdueDigest) {
    const undone = doc.tasks.filter((x) => !x.doneAt && x.date <= day).length
    if (undone > 0) {
      const evening = vnDateTime(day, s.eveningTime).getTime()
      due({ key: `digest:${day}`, kind: 'digest' }, evening, vnDateTime(day, '22:30').getTime())
    }
  }

  for (const event of doc.events) {
    const start = vnDateTime(event.date, event.time ?? '08:00').getTime()
    for (const offset of event.remind) {
      const at = start - offset * MINUTE
      due({ key: `event:${event.id}:${offset}`, kind: 'event', eventId: event.id }, at, at + (offset <= 120 ? 2 : 6) * HOUR)
    }
  }
  return out
}

/* ───────────── Sent keys (progress/planner/sent.json) ───────────── */

const sentFile = (ctx: PlannerCtx) => path.join(plannerDir(ctx), 'sent.json')

export async function readSent(ctx: PlannerCtx): Promise<Record<string, string>> {
  return (await readJsonDoc<{ sent: Record<string, string> }>(sentFile(ctx), { sent: {} })).value.sent ?? {}
}

/** Written before sending, so a slow send or a restart never sends the same key twice. Keys older than 14 days go. */
export function markSent(ctx: PlannerCtx, key: string, now: Date): Promise<void> {
  return updateJsonDoc<{ sent: Record<string, string> }, void>(sentFile(ctx), { sent: {} }, (doc) => {
    doc.sent ??= {}
    const cutoff = now.getTime() - 14 * 24 * HOUR
    for (const [k, at] of Object.entries(doc.sent)) if (new Date(at).getTime() < cutoff) delete doc.sent[k]
    doc.sent[key] = now.toISOString()
  })
}

/* ───────────── Payloads ───────────── */

/** Undone today + overdue: the app icon badge. */
export function badgeCount(doc: PlannerDoc, day: string): number {
  return doc.tasks.filter((t) => !t.doneAt && t.date <= day).length
}

function taskPayload(task: PlannerTask, badge: number): PushPayload {
  const bits = [task.durationMin ? `${task.durationMin} phút` : '', SKILL_LABELS[task.skill]].filter(Boolean)
  return {
    title: `Đến giờ: ${task.title}`,
    body: bits.join(' · '),
    tag: `task-${task.id}`,
    url: task.link || '/planner',
    actions: [
      { action: 'done', title: 'Xong' },
      { action: 'snooze', title: 'Hoãn 1 giờ' },
    ],
    taskId: task.id,
    badge,
  }
}

function whenLabel(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) return minutes === 1440 ? 'ngày mai' : `còn ${minutes / 1440} ngày`
  if (minutes >= 60) return `${Math.round(minutes / 60)} giờ nữa`
  return minutes ? `${minutes} phút nữa` : 'bắt đầu'
}

async function payloadFor(ctx: PlannerCtx, doc: PlannerDoc, due: Due, now: Date): Promise<{ payload: PushPayload; opts: SendOptions } | null> {
  const day = vnDay(now)
  const badge = badgeCount(doc, day)
  if (due.kind === 'brief') {
    const brief = await ensureBrief(ctx, day, { now })
    return { payload: { title: brief.headline, body: brief.body, tag: 'brief', url: '/', badge }, opts: { topic: 'brief' } }
  }
  if (due.kind === 'task' || due.kind === 'snooze') {
    const task = doc.tasks.find((t) => t.id === due.taskId)
    return task && !task.doneAt ? { payload: taskPayload(task, badge), opts: { urgency: 'high' } } : null
  }
  if (due.kind === 'digest') {
    const undone = doc.tasks.filter((t) => !t.doneAt && t.date === day)
    const late = overdueTasks(doc, day)
    const list = [...undone, ...late]
    if (!list.length) return null
    return {
      payload: { title: `Còn ${list.length} việc chưa xong`, body: list.slice(0, 3).map((t) => t.title).join(' · '), tag: 'digest', url: '/planner?view=day', badge },
      opts: { topic: 'digest' },
    }
  }
  if (due.kind === 'event') {
    const event = doc.events.find((e) => e.id === due.eventId)
    if (!event) return null
    const offset = Number(due.key.split(':').pop())
    const at = [event.time, event.location].filter(Boolean).join(' · ')
    return {
      payload: { title: `${event.title} · ${whenLabel(offset)}`, body: at || event.date, tag: `event-${event.id}`, url: '/planner?view=events', badge },
      opts: { urgency: offset <= 120 ? 'high' : 'normal' },
    }
  }
  return null
}

/* ───────────── The loop ───────────── */

let running = false
let lastAutoTick = 0

async function tick(ctx: PlannerCtx) {
  if (running) return // a slow brief generation must not overlap the next tick
  running = true
  try {
    const now = new Date()
    let doc = await readPlanner(ctx)
    if (now.getTime() - lastAutoTick > 10 * MINUTE) {
      lastAutoTick = now.getTime()
      doc = await applyAutoTick(ctx, doc, await reviewSummary(ctx, now), now)
    }
    const sent = await readSent(ctx)
    for (const due of dueNotifications(doc, sent, now)) {
      await markSent(ctx, due.key, now) // before sending
      if (due.kind === 'brief-gen') {
        await ensureBrief(ctx, vnDay(now), { now }).catch((error) => console.warn('[planner] brief:', (error as Error).message))
        continue
      }
      const built = await payloadFor(ctx, doc, due, now).catch((error) => {
        console.warn('[planner] payload:', (error as Error).message)
        return null
      })
      if (built) await sendToAll(ctx, built.payload, built.opts).catch((error) => console.warn('[planner] push:', (error as Error).message))
    }
  } catch (error) {
    console.warn('[planner] scheduler tick failed:', (error as Error).message)
  } finally {
    running = false
  }
}

export function startPlannerScheduler(ctx: PlannerCtx & { contentDir?: string }): void {
  const g = globalThis as { __plannerSchedulerStarted?: boolean }
  if (g.__plannerSchedulerStarted) return
  g.__plannerSchedulerStarted = true
  const timer = setInterval(() => void tick(ctx), 30_000)
  timer.unref?.()
  setTimeout(() => void tick(ctx), 5_000).unref?.()
}
