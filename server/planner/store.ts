// Planner storage (progress/planner/planner.json) and request validation. Every validation failure is a 400 in Vietnamese.
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { ApiError, type ApiContext } from '../api.ts'
import { isObject, type JsonObject } from '../admin/input.ts'
import { readJsonDoc, updateJsonDoc } from '../admin/store.ts'
import {
  DEFAULT_REMINDERS,
  DEFAULT_SETTINGS,
  PLANNER_EVENT_KINDS,
  PLANNER_SKILLS,
  type PlannerDoc,
  type PlannerEvent,
  type PlannerEventAhead,
  type PlannerEventKind,
  type PlannerRoutineItem,
  type PlannerSettings,
  type PlannerSkill,
  type PlannerTask,
} from '../../src/types/planner.ts'
import { daysBetween, isDay, isTime, minutesOf } from '../../src/features/planner/dates.ts'
import { SKILL_LINKS } from '../../src/features/planner/skills.ts'

export type PlannerCtx = Pick<ApiContext, 'rootDir'>

export const plannerDir = (ctx: PlannerCtx) => path.join(ctx.rootDir, 'progress', 'planner')
const plannerFile = (ctx: PlannerCtx) => path.join(plannerDir(ctx), 'planner.json')

const emptyDoc = (): PlannerDoc => ({ version: 1, tasks: [], events: [], routine: [], settings: { ...DEFAULT_SETTINGS } })

/** Fills fields an older or hand-edited file lacks. */
function withDefaults(doc: Partial<PlannerDoc>): PlannerDoc {
  const settings = { ...DEFAULT_SETTINGS, ...(doc.settings ?? {}) }
  if (!Array.isArray(settings.minutesPerDay) || settings.minutesPerDay.length !== 7) settings.minutesPerDay = [...DEFAULT_SETTINGS.minutesPerDay]
  return {
    version: 1,
    tasks: Array.isArray(doc.tasks) ? doc.tasks : [],
    events: Array.isArray(doc.events) ? doc.events : [],
    routine: Array.isArray(doc.routine) ? doc.routine : [],
    settings,
  }
}

export async function readPlanner(ctx: PlannerCtx): Promise<PlannerDoc> {
  return withDefaults((await readJsonDoc<Partial<PlannerDoc>>(plannerFile(ctx), emptyDoc())).value)
}

/** Read → change → write inside the shared write queue. `fn` changes the doc in place. */
export function updatePlanner<R>(ctx: PlannerCtx, fn: (doc: PlannerDoc) => R | Promise<R>): Promise<R> {
  return updateJsonDoc<Partial<PlannerDoc>, R>(plannerFile(ctx), emptyDoc(), async (raw) => {
    const doc = withDefaults(raw)
    const result = await fn(doc)
    Object.assign(raw, doc)
    return result
  })
}

export const newId = () => randomUUID().replace(/-/g, '').slice(0, 12)

/* ───────────── Validation ───────────── */

const bad = (message: string): never => {
  throw new ApiError(400, message)
}

export function checkDay(value: unknown, name = 'Date'): string {
  if (!isDay(value)) bad(`${name} is not valid (expected YYYY-MM-DD).`)
  return value as string
}

/** '' / undefined → undefined; otherwise HH:mm. */
export function checkTime(value: unknown, name = 'Time'): string | undefined {
  if (value == null || value === '') return undefined
  if (!isTime(value)) bad(`${name} is not valid (expected HH:mm).`)
  return value as string
}

export function checkTitle(value: unknown, max = 120): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!text) bad('Enter a title.')
  if (text.length > max) bad(`The title is too long (max ${max} characters).`)
  return text
}

export function checkDuration(value: unknown): number | undefined {
  if (value == null || value === '' || value === 0) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 5 || value > 480) bad('Duration must be 5 to 480 minutes.')
  return value as number
}

export function checkSkill(value: unknown): PlannerSkill {
  if (value == null || value === '') return 'other'
  if (!PLANNER_SKILLS.includes(value as PlannerSkill)) bad('Unknown category.')
  return value as PlannerSkill
}

export function checkKind(value: unknown): PlannerEventKind {
  if (value == null || value === '') return 'other'
  if (!PLANNER_EVENT_KINDS.includes(value as PlannerEventKind)) bad('Unknown event type.')
  return value as PlannerEventKind
}

export function checkLink(value: unknown): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 300) bad('The link must be an in-app path starting with "/".')
  return value as string
}

export function checkNotes(value: unknown, max = 1000): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') bad('Notes must be text.')
  const text = (value as string).trim()
  if (text.length > max) bad(`Notes are too long (max ${max} characters).`)
  return text || undefined
}

export function checkRemind(value: unknown, fallback: number[]): number[] {
  if (value == null) return fallback
  if (!Array.isArray(value) || value.length > 5 || value.some((n) => !Number.isInteger(n) || n < 0 || n > 43200)) {
    bad('Reminders: at most 5, each 0–43200 minutes before.')
  }
  return [...new Set(value as number[])].sort((a, b) => b - a)
}

const SOURCES: PlannerTask['source'][] = ['manual', 'routine', 'quick-add', 'ai-week', 'reschedule']

/** A task from a request body; `prev` is the stored task being edited (keeps fields the body leaves out). */
export function taskFromBody(body: JsonObject, now: string, prev?: PlannerTask): PlannerTask {
  const pick = <K extends keyof PlannerTask>(key: K) => (key in body ? body[key] : prev?.[key])
  const skill = checkSkill(pick('skill'))
  const link = 'link' in body ? checkLink(body.link) : (prev?.link ?? SKILL_LINKS[skill])
  const source = SOURCES.includes(body.source as PlannerTask['source']) ? (body.source as PlannerTask['source']) : (prev?.source ?? 'manual')
  const task: PlannerTask = {
    id: prev?.id ?? newId(),
    title: checkTitle(pick('title')),
    date: checkDay(pick('date')),
    time: checkTime(pick('time')),
    durationMin: checkDuration(pick('durationMin')),
    skill,
    link: link ?? SKILL_LINKS[skill],
    notes: checkNotes(pick('notes')),
    doneAt: prev?.doneAt,
    snoozedUntil: prev?.snoozedUntil,
    source,
    routineId: typeof pick('routineId') === 'string' ? (pick('routineId') as string) : undefined,
    movedFrom: prev?.movedFrom,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  }
  return clean(task)
}

export function eventFromBody(body: JsonObject, now: string, prev?: PlannerEvent): PlannerEvent {
  const pick = <K extends keyof PlannerEvent>(key: K) => (key in body ? body[key] : prev?.[key])
  const kind = checkKind(pick('kind'))
  const time = checkTime(pick('time'))
  const endTime = checkTime(pick('endTime'), 'End time')
  if (endTime && !time) bad('An end time needs a start time.')
  if (endTime && time && minutesOf(endTime) <= minutesOf(time)) bad('The end time must be after the start time.')
  const location = typeof pick('location') === 'string' ? (pick('location') as string).replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  const event: PlannerEvent = {
    id: prev?.id ?? newId(),
    title: checkTitle(pick('title')),
    kind,
    date: checkDay(pick('date')),
    time,
    endTime,
    location: location || undefined,
    notes: checkNotes(pick('notes')),
    remind: checkRemind(pick('remind'), DEFAULT_REMINDERS[kind]),
    countdown: typeof pick('countdown') === 'boolean' ? (pick('countdown') as boolean) : kind === 'exam',
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  }
  return clean(event)
}

export function routineFromBody(value: unknown): PlannerRoutineItem {
  if (!isObject(value)) bad('Each routine item must be an object.')
  const body = value as JsonObject
  const weekday = body.weekday
  if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) bad('Weekday must be 1 (Monday) to 7 (Sunday).')
  const skill = checkSkill(body.skill)
  return clean({
    id: typeof body.id === 'string' && /^[\w-]{1,40}$/.test(body.id) ? body.id : newId(),
    weekday: weekday as number,
    title: checkTitle(body.title),
    time: checkTime(body.time),
    durationMin: checkDuration(body.durationMin),
    skill,
    link: checkLink(body.link) ?? SKILL_LINKS[skill],
  })
}

export function settingsFromBody(body: JsonObject, prev: PlannerSettings): PlannerSettings {
  const next = { ...prev }
  for (const key of ['morningTime', 'eveningTime', 'quietStart', 'quietEnd'] as const) {
    if (key in body) next[key] = checkTime(body[key]) ?? bad('The time cannot be empty.')
  }
  for (const key of ['taskReminders', 'overdueDigest', 'aiBrief'] as const) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') bad(`"${key}" must be true or false.`)
      next[key] = body[key] as boolean
    }
  }
  if ('minutesPerDay' in body) {
    const list = body.minutesPerDay
    if (!Array.isArray(list) || list.length !== 7 || list.some((n) => !Number.isInteger(n) || n < 0 || n > 720)) {
      bad('Minutes per day: 7 whole numbers from 0 to 720.')
    }
    next.minutesPerDay = list as number[]
  }
  if ('targetBand' in body) {
    const band = body.targetBand
    if (band == null || band === '') delete next.targetBand
    else if (typeof band !== 'number' || band < 4 || band > 9 || (band * 2) % 1 !== 0) bad('Target band: 4.0 to 9.0, in steps of 0.5.')
    else next.targetBand = band
  }
  return next
}

/** Drops undefined fields so the JSON file stays tidy. */
function clean<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] === undefined) delete value[key]
  return value
}

/* ───────────── Queries ───────────── */

/** Timed by time, then untimed by createdAt; done last. */
export function sortTasks(tasks: PlannerTask[]): PlannerTask[] {
  return [...tasks].sort((a, b) => {
    if (Boolean(a.doneAt) !== Boolean(b.doneAt)) return a.doneAt ? 1 : -1
    if (a.time && b.time) return a.time.localeCompare(b.time)
    if (a.time !== b.time) return a.time ? -1 : 1
    return a.createdAt.localeCompare(b.createdAt)
  })
}

export const tasksForDay = (doc: PlannerDoc, day: string) => sortTasks(doc.tasks.filter((t) => t.date === day))

/** Not done and dated before today, oldest first, max `limit`. */
export function overdueTasks(doc: PlannerDoc, today: string, limit = 20): PlannerTask[] {
  return doc.tasks
    .filter((t) => !t.doneAt && t.date < today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
    .slice(0, limit)
}

/** Events from today to today+days, soonest first. */
export function eventsAhead(doc: PlannerDoc, today: string, days: number): PlannerEventAhead[] {
  return doc.events
    .map((e) => ({ ...e, daysLeft: daysBetween(today, e.date) }))
    .filter((e) => e.daysLeft >= 0 && e.daysLeft <= days)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
}

export function findTask(doc: PlannerDoc, id: unknown): PlannerTask {
  const task = doc.tasks.find((t) => t.id === id)
  if (!task) throw new ApiError(404, 'Task not found (it may have been deleted).')
  return task
}

export function findEvent(doc: PlannerDoc, id: unknown): PlannerEvent {
  const event = doc.events.find((e) => e.id === id)
  if (!event) throw new ApiError(404, 'Event not found.')
  return event
}
