// Planner AI (agy): quick add, morning brief, smart reschedule, week draft. Every answer is checked here before it is
// shown or saved: unknown ids dropped, dates kept in range, times and durations re-checked.
import { ApiError } from '../api.ts'
import { antigravityAvailable, antigravityJson } from '../llm/antigravity-cli.ts'
import {
  DEFAULT_REMINDERS,
  PLANNER_EVENT_KINDS,
  isStudySkill,
  PLANNER_SKILLS,
  STUDY_SKILLS,
  type PlannerBrief,
  type PlannerDoc,
  type PlannerEventKind,
  type PlannerSkill,
  type QuickAddItem,
  type RescheduleProposal,
  type WeekDraftTask,
} from '../../src/types/planner.ts'
import {
  addDays,
  daysBetween,
  enWeekday,
  formatMinutes,
  isDay,
  isoWeekday,
  isTime,
  minutesOf,
  viShort,
  vnDay,
  vnTime,
  viWeekday,
  weekDays,
  weekStart,
} from '../../src/features/planner/dates.ts'
import { SKILL_LINKS } from '../../src/features/planner/skills.ts'
import { briefFacts, briefStateKey, capacityOf, latestScores, plannedMinutes, readBrief, reviewSummary, saveBrief, type BriefFacts } from './context.ts'
import { eventsAhead, overdueTasks, readPlanner, tasksForDay, type PlannerCtx } from './store.ts'

const MODEL = () => process.env.PLANNER_ANTIGRAVITY_MODEL || 'gemini-3.8-flash' // no effort suffix
const FAST_EFFORT = () => process.env.PLANNER_FAST_EFFORT || 'low' // quick add, brief
// Low by the user's decision: at medium the week draft thought ~32k tokens and took 4 minutes.
const PLAN_EFFORT = () => process.env.PLANNER_PLAN_EFFORT || 'low' // reschedule, week draft

const BUSY = 'The AI is busy — try again or add it by hand'

const WEEK_LABELS: Record<number, string> = { [-1]: 'tuần trước', 0: 'tuần này', 1: 'tuần sau', 2: '2 tuần nữa', 3: '3 tuần nữa' }

/**
 * One line per day from today-7 to today+21, weeks starting on Monday:
 *   date       | weekday  | short | week        | note
 *   2026-11-07 | Thứ Bảy  | T7    | tuần này    | hôm nay
 *   2026-11-08 | Chủ Nhật | CN    | tuần này    | ngày mai
 *   2026-11-09 | Thứ Hai  | T2    | tuần sau    |
 * week ∈ 'tuần trước' | 'tuần này' | 'tuần sau' | '2 tuần nữa' | '3 tuần nữa'. English weekday names in brackets
 * after the Vietnamese ones ("Thứ Bảy (Saturday)") so English notes resolve too.
 */
export function calendarTable(today: string): string {
  const thisWeek = weekStart(today)
  const rows = ['date       | weekday              | short | week       | note']
  for (let i = -7; i <= 21; i++) {
    const day = addDays(today, i)
    const week = WEEK_LABELS[daysBetween(thisWeek, weekStart(day)) / 7] ?? ''
    const note = i === 0 ? 'hôm nay' : i === 1 ? 'ngày mai' : i === 2 ? 'ngày kia' : i === -1 ? 'hôm qua' : ''
    const weekday = `${viWeekday(day)} (${enWeekday(day)})`
    rows.push(`${day} | ${weekday.padEnd(20)} | ${viShort(day).padEnd(5)} | ${week.padEnd(10)} | ${note}`.trimEnd())
  }
  return rows.join('\n')
}

async function callAi<T>(label: string, system: string, prompt: string, schema: unknown, effort: string): Promise<{ value: T; ms: number }> {
  if (!antigravityAvailable()) throw new ApiError(503, BUSY)
  try {
    const { value, ms } = await antigravityJson({ label, system, prompt, jsonSchema: schema, model: MODEL(), effort })
    return { value: value as T, ms }
  } catch (error) {
    console.warn(`[planner] ${label} failed:`, (error as Error).message)
    throw new ApiError(503, BUSY)
  }
}

/** Cuts to `max` characters at a word boundary, with "…". */
export function cut(text: unknown, max: number): string {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  if (value.length <= max) return value
  const head = value.slice(0, max - 1)
  const space = head.lastIndexOf(' ')
  return `${(space > max * 0.6 ? head.slice(0, space) : head).replace(/[\s,.;:–-]+$/, '')}…`
}

const skillOf = (value: unknown): PlannerSkill => (PLANNER_SKILLS.includes(value as PlannerSkill) ? (value as PlannerSkill) : 'other')
const timeOf = (value: unknown): string => (isTime(value) ? (value as string) : '')

/* ───────────── 4.1 Quick add ───────────── */

export const QUICK_ADD_SYSTEM = `You turn one short note written by an IELTS learner in Vietnamese, English or a mix into calendar items for a study planner.

ITEM TYPES
- "task": something the user will do: study or practise (vocabulary, grammar, reading, listening, writing, speaking, flashcard review, mock test), or a work or personal to-do ("gửi báo cáo cho sếp", "làm slide", "đi chợ", "trả tiền điện", "tập gym").
- "event": something that happens at a set time with other people or at a place: the IELTS exam, a class or lesson with a teacher, a deadline, a doctor's appointment, a meeting.
One note can hold several items ("thi thử thứ 7 và ôn từ mỗi tối" = 2 items). Never invent items that are not in the note.

DATES — use only the CALENDAR table below; never compute dates yourself.
- "hôm nay / nay / today" = today; "mai / ngày mai / tomorrow" = today+1; "mốt / ngày kia" = today+2.
- "thứ 2…thứ 7, chủ nhật / CN / Monday…Sunday" without a week word = the NEXT such day after today (if today is that weekday, use today only when the note says "nay", e.g. "tối thứ 7 này").
- "tuần sau / next week" + weekday = that weekday in the row marked "tuần sau". "tuần này / this week" + weekday = that weekday in the current week.
- "cuối tuần / weekend" = the coming Saturday (today if today is Saturday or Sunday).
- WEEK PLAN: when the note lists several weekdays as a plan ("Thứ 2: … Thứ 3: … CN: …", "Mon … Wed … Fri …") with no week word, ALL of them go in ONE Monday–Sunday week of the CALENDAR, never split across two weeks. That week is the current week ("tuần này") if none of the listed weekdays is before today's weekday (today itself counts as still ahead); otherwise it is next week ("tuần sau"). Example: today Monday, "Thứ 2 … Thứ 4 … CN …" = this week's Monday (today), Wednesday and Sunday. Today Wednesday, "Thứ 2 … Thứ 5 …" = next week's Monday and Thursday. A week word in the note ("tuần sau: Thứ 2 …") overrides this. So no date of a week plan is ever before today.
- A date like "15/11" or "15-11" is day/month in the current year (next year if it is already past).
- No date words at all = today.

TIMES — 24-hour "HH:mm".
- "8h", "8 giờ", "8am" = 08:00; "8h tối", "8pm", "20h" = 20:00; "2h chiều" = 14:00; "7h30", "7 rưỡi" = 07:30; "12h trưa" = 12:00.
- A part of the day with no clock time: sáng = 08:00, trưa = 12:00, chiều = 15:00, tối = 20:00, đêm/khuya = 22:00.
- No time words at all = "" (empty).
- A range "19h-21h" = time 19:00 and endTime 21:00.

DURATION — "45 phút", "45p", "1 tiếng", "1h30" (as a duration, not a clock time), "90 mins" → minutes. Unknown = 0.

SKILL (tasks; also fill it for events that are classes) — one of: vocabulary, grammar, reading, listening, writing, speaking, review, mock, work, personal, other.
- work = job or school work that is not IELTS practice: báo cáo, slide, email, họp, deadline dự án, code, bài tập môn khác. personal = life and health: đi chợ, dọn nhà, gym, chạy bộ, trả tiền, gọi điện cho mẹ. other = anything else.
- "ôn thẻ / flashcard / ôn từ / review" = review. "từ vựng / collocation" = vocabulary. "thi thử / mock test / full test" = mock.
- "task 1 / task 2 / essay / viết" = writing. "part 1/2/3 / nói" = speaking. "dictation / chép chính tả / nghe" = listening.

EVENT KIND — exam (the real IELTS test or any official exam), class (lesson, tutor, study group), appointment (doctor, meeting, anything personal), deadline ("nộp", "hạn", "trước thứ 2"), other.
For a deadline phrased "trước thứ 2 / before Monday", the date is that Monday.

REPEAT — "mỗi ngày / hằng ngày / every day" = [1,2,3,4,5,6,7]; "mỗi sáng thứ 2, 4, 6" = [1,3,5] (ISO weekday: 1 = Monday … 7 = Sunday; Vietnamese "thứ 2" = 1, "thứ 3" = 2 … "thứ 7" = 6, "chủ nhật" = 7). No repeat = [].
For a repeated item, "date" is the first matching day from today on.

TITLE — short (≤ 60 chars), in the language the note used, first letter capitalised, WITHOUT the date, time, duration or repeat words. Keep useful detail: "Cambridge 18 Test 2", "Part 2", "Task 2". Location goes to "location", not the title.

REMINDERS — remindMinutesBefore: [] unless the note asks ("nhắc trước 1 tiếng" = [60]). The server adds defaults.

CONFIDENCE — "low" when you had to guess the date or the type; otherwise "high".
UNPARSED — any part of the note you could not use, word for word; "" if none.`

const QUICK_ADD_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['task', 'event'] },
          title: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD from the CALENDAR table' },
          time: { type: 'string', description: 'HH:mm or ""' },
          endTime: { type: 'string', description: 'HH:mm or ""' },
          durationMin: { type: 'integer' },
          skill: { type: 'string', enum: PLANNER_SKILLS },
          eventKind: { type: 'string', enum: ['exam', 'class', 'appointment', 'deadline', 'other', ''] },
          location: { type: 'string' },
          repeatWeekdays: { type: 'array', items: { type: 'integer' } },
          remindMinutesBefore: { type: 'array', items: { type: 'integer' } },
          confidence: { type: 'string', enum: ['high', 'low'] },
        },
        required: ['type', 'title', 'date', 'time', 'endTime', 'durationMin', 'skill', 'eventKind', 'location', 'repeatWeekdays', 'remindMinutesBefore', 'confidence'],
      },
    },
    unparsed: { type: 'string' },
  },
  required: ['items', 'unparsed'],
}

interface RawQuickItem {
  type?: unknown
  title?: unknown
  date?: unknown
  time?: unknown
  endTime?: unknown
  durationMin?: unknown
  skill?: unknown
  eventKind?: unknown
  location?: unknown
  repeatWeekdays?: unknown
  remindMinutesBefore?: unknown
  confidence?: unknown
}

/** The model's items, checked: dates in range, times valid, defaults for reminders and links. Pure (tested). */
export function validateQuickAdd(raw: { items?: RawQuickItem[]; unparsed?: unknown }, today: string): { items: QuickAddItem[]; unparsed: string } {
  const last = addDays(today, 365)
  const repeatEnd = addDays(weekStart(today), 13) // end of next week
  const items: QuickAddItem[] = []
  for (const r of Array.isArray(raw.items) ? raw.items : []) {
    const title = cut(r.title, 120)
    if (!title) continue
    const type = r.type === 'event' ? 'event' : 'task'
    let confidence: 'high' | 'low' = r.confidence === 'low' ? 'low' : 'high'
    let date = isDay(r.date) ? (r.date as string) : ''
    if (!date || date < today || date > last) {
      date = today
      confidence = 'low'
    }
    const time = timeOf(r.time)
    let endTime = timeOf(r.endTime)
    if (endTime && (!time || minutesOf(endTime) <= minutesOf(time))) endTime = ''
    const minutes = Number.isInteger(r.durationMin) ? (r.durationMin as number) : 0
    const durationMin = minutes <= 0 ? 0 : Math.min(480, Math.max(5, minutes))
    const skill = skillOf(r.skill)
    const eventKind: PlannerEventKind | '' =
      type === 'event' ? (PLANNER_EVENT_KINDS.includes(r.eventKind as PlannerEventKind) ? (r.eventKind as PlannerEventKind) : 'other') : ''
    const repeatWeekdays = [...new Set((Array.isArray(r.repeatWeekdays) ? r.repeatWeekdays : []).filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 7))].sort()
    const repeatDates: string[] = []
    if (repeatWeekdays.length) {
      for (let d = today; d <= repeatEnd && repeatDates.length < 14; d = addDays(d, 1)) if (repeatWeekdays.includes(isoWeekday(d))) repeatDates.push(d)
      if (repeatDates.length) date = repeatDates[0]
    }
    const asked = (Array.isArray(r.remindMinutesBefore) ? r.remindMinutesBefore : []).filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 43200).slice(0, 5)
    items.push({
      type,
      title,
      date,
      time,
      endTime,
      durationMin,
      skill,
      eventKind,
      location: cut(r.location, 160),
      repeatWeekdays,
      repeatDates,
      remind: type === 'event' ? (asked.length ? asked : DEFAULT_REMINDERS[eventKind || 'other']) : asked,
      countdown: eventKind === 'exam',
      ...(type === 'task' && SKILL_LINKS[skill] ? { link: SKILL_LINKS[skill] } : {}),
      confidence,
    })
  }
  return { items, unparsed: cut(raw.unparsed, 500) }
}

export async function quickAdd(text: string, opts: { now?: Date } = {}): Promise<{ items: QuickAddItem[]; unparsed: string; ms: number; raw: unknown }> {
  const now = opts.now ?? new Date()
  const today = vnDay(now)
  const prompt = `CALENDAR (today is marked):\n${calendarTable(today)}\n\nCURRENT TIME: ${vnTime(now)} (Asia/Ho_Chi_Minh)\n\nNOTE:\n${text}`
  const { value, ms } = await callAi<{ items?: RawQuickItem[]; unparsed?: unknown }>('planner-quick-add', QUICK_ADD_SYSTEM, prompt, QUICK_ADD_SCHEMA, FAST_EFFORT())
  return { ...validateQuickAdd(value ?? {}, today), ms, raw: value }
}

/* ───────────── 4.2 Morning brief ───────────── */

export const BRIEF_SYSTEM = `You write today's brief of an IELTS study planner app, in English, for one learner (a Vietnamese learner of English: plain, natural English). It is written in the morning (phone notification + a small card on the home screen) and rewritten during the day when the plan changes or the part of the day changes, so it must fit the moment given by "now" and "partOfDay".

The card is small: the focus line is what the learner reads; the tip shows only when they expand the card. Keep both short and specific. Style: calm, warm and concise, like the daily summary of a premium phone assistant — no hype, no exclamation chains, at most one emoji in the whole brief (optional).

Use ONLY the facts in the JSON. Never invent tasks, numbers, dates or scores. If a list is empty, do not mention it.

Write:
- headline (≤ 60 characters): the notification title. Lead with what matters most today: an exam within 14 days ("5 days to IELTS"), else the number of tasks ("Today: 4 tasks · 2h 15m"), else a rest-day note.
- body (≤ 140 characters): the notification text — the first 2–3 tasks in the suggested order, with their time if they have one.
- greeting (≤ 80 characters): one friendly line for the top of the card, mentioning the streak if it is ≥ 3 days.
- focus (≤ 160 characters): the ONE thing to do next and why, tied to the exam date, the weakest recent score versus the target band, or the overdue work. Write it for "now": never present a time that has already passed as still ahead ("at 19:00" when now is 21:10); a timed task whose time has passed is simply still open. Morning: what to protect today. Afternoon: what to get done before evening. Evening: the one thing still worth doing tonight, or — if tasksToday is empty — a short note on what was done (doneToday) and rest or a few review cards.
- focusTaskId: the id from tasksToday that the focus is about, or "" when the focus is not one of them (overdue work, rest, review cards).
- tip (≤ 140 characters): one concrete IELTS micro-tip tied to the focus task (or another study task in tasksToday); "" when no study task is open (e.g. for a Writing Task 2 task: "Spend 5 minutes on an outline first — one main idea and one example per body paragraph."). Not generic motivation.
- order: ids of tasksToday in the order you suggest doing them — timed tasks keep their time order; put demanding skills (writing, speaking, mock) earlier in the day than review/vocabulary when untimed. Every id from tasksToday exactly once.
- tone: "celebrate" if yesterday was fully done and there is no overdue work, "push" if the exam is ≤ 7 days away or overdue ≥ 3, else "calm".

If there are overdue tasks, say how many in focus or body, gently, and suggest "Smart reschedule" (the app's reschedule button). If there are no tasks today, the brief suggests the review cards due (if any) or rest.`

const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    body: { type: 'string' },
    greeting: { type: 'string' },
    focus: { type: 'string' },
    focusTaskId: { type: 'string' },
    tip: { type: 'string' },
    order: { type: 'array', items: { type: 'string' } },
    tone: { type: 'string', enum: ['calm', 'push', 'celebrate'] },
  },
  required: ['headline', 'body', 'greeting', 'focus', 'focusTaskId', 'tip', 'order', 'tone'],
}

/** No AI: the brief from the facts alone. */
export function templateBrief(facts: BriefFacts, day: string, now = new Date()): PlannerBrief {
  const tasks = facts.tasksToday
  const total = tasks.reduce((sum, t) => sum + (t.durationMin || 0), 0)
  const exam = facts.events.find((e) => e.kind === 'exam' && e.daysLeft <= 14)
  const headline = exam
    ? `${exam.daysLeft} ${exam.daysLeft === 1 ? 'day' : 'days'} to ${exam.title}`
    : tasks.length
      ? `Today: ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}${total ? ` · ${formatMinutes(total)}` : ''}`
      : 'Nothing planned today'
  const first = tasks.slice(0, 3).map((t) => (t.time ? `${t.time} ${t.title}` : t.title))
  if (facts.overdue.length) first.push(`${facts.overdue.length} overdue`)
  return {
    day,
    headline: cut(headline, 60),
    body: cut(first.join(' · ') || (facts.review.due ? `${facts.review.due} cards due today` : 'Rest, or review a few cards.'), 140),
    greeting: 'Good morning',
    focus: '',
    tip: '',
    order: tasks.map((t) => t.id),
    tone: 'calm',
    // The next open task: the first timed one not yet passed, else the first open one.
    focusTaskId: (tasks.find((t) => t.time && t.time >= facts.now) ?? tasks[0])?.id ?? '',
    source: 'template',
    createdAt: now.toISOString(),
  }
}

/** Fields cut to their limits; `order` filtered to known ids, missing ids appended. Pure (tested). */
export function validateBrief(raw: Record<string, unknown>, facts: BriefFacts, day: string, now = new Date()): PlannerBrief {
  const ids = facts.tasksToday.map((t) => t.id)
  const order = [...new Set((Array.isArray(raw.order) ? raw.order : []).filter((id): id is string => ids.includes(id as string)))]
  for (const id of ids) if (!order.includes(id)) order.push(id)
  const tone = raw.tone === 'push' || raw.tone === 'celebrate' ? raw.tone : 'calm'
  return {
    day,
    headline: cut(raw.headline, 60) || templateBrief(facts, day, now).headline,
    body: cut(raw.body, 140),
    greeting: cut(raw.greeting, 80) || 'Good morning',
    focus: cut(raw.focus, 160),
    tip: cut(raw.tip, 140),
    order,
    tone,
    focusTaskId: ids.includes(raw.focusTaskId as string) ? (raw.focusTaskId as string) : '',
    source: 'ai',
    createdAt: now.toISOString(),
  }
}

export async function generateBrief(ctx: PlannerCtx, day: string, now = new Date()): Promise<{ brief: PlannerBrief; raw?: unknown; ms?: number }> {
  const doc = await readPlanner(ctx)
  const facts = await briefFacts(ctx, doc, now)
  const stateKey = briefStateKey(doc, now)
  if (!doc.settings.aiBrief || !antigravityAvailable()) return { brief: { ...templateBrief(facts, day, now), stateKey } }
  try {
    // Capped at 90 s: after that the template is saved and sent.
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out after 90 s')), 90_000).unref?.())
    const { value, ms } = await Promise.race([
      callAi<Record<string, unknown>>('planner-brief', BRIEF_SYSTEM, `FACTS:\n${JSON.stringify(facts, null, 2)}`, BRIEF_SCHEMA, FAST_EFFORT()),
      timeout,
    ])
    return { brief: { ...validateBrief(value ?? {}, facts, day, now), stateKey }, raw: value, ms }
  } catch (error) {
    console.warn('[planner] brief fell back to the template:', (error as Error).message)
    return { brief: { ...templateBrief(facts, day, now), stateKey } }
  }
}

const inFlight = new Map<string, Promise<PlannerBrief>>()

/** A stale brief is rewritten at most this often, so ticking tasks in a row does not call the AI each time. */
const REFRESH_GAP_MS = 3 * 60_000

/**
 * Today's brief: the cached one unless `force`, or unless `refresh` and the plan moved on since it was written (see
 * briefStateKey) and it is older than REFRESH_GAP_MS. One generation at a time per day.
 */
export function ensureBrief(ctx: PlannerCtx, day: string, opts: { now?: Date; force?: boolean; refresh?: boolean } = {}): Promise<PlannerBrief> {
  const running = inFlight.get(day)
  if (running) return running
  const job = (async () => {
    if (!opts.force) {
      const cached = await readBrief(ctx, day).catch(() => null)
      if (cached && !opts.refresh) return cached
      if (cached) {
        const now = opts.now ?? new Date()
        const fresh = cached.stateKey === briefStateKey(await readPlanner(ctx), now)
        if (fresh || now.getTime() - Date.parse(cached.createdAt) < REFRESH_GAP_MS) return cached
      }
    }
    const { brief } = await generateBrief(ctx, day, opts.now)
    await saveBrief(ctx, brief)
    return brief
  })().finally(() => inFlight.delete(day))
  inFlight.set(day, job)
  return job
}

/* ───────────── 4.3 Smart reschedule ───────────── */

export const RESCHEDULE_SYSTEM = `You reschedule the overdue tasks of an IELTS learner (mostly study, some work or personal to-dos) into the next 7 days.

INPUT: overdue tasks, the minutes already planned on each of the next 7 days, the minutes available each day (capacity), upcoming events (the exam date matters most) and today's date.

RULES
1. Every overdue task gets exactly one decision: move (a date from today to today+6, from the CALENDAR) or drop.
2. Do not push a day over its capacity. If everything cannot fit, drop the least valuable tasks: duplicates of something already planned, review/vocabulary tasks more than 7 days late (newer review replaces them), tasks whose purpose has passed.
3. Writing, speaking and mock tasks are the most valuable before an exam; keep them and place them on days with the most free time, earlier in the day.
4. Nothing on the exam day or after it, except a short (≤ 30 min) light review the day before.
5. Tasks with skill work, personal or other are not study: their minutes do not count against capacity, never drop them, and rules 2–4 do not apply to them; move them to the soonest sensible day, keeping their time.
6. Spread the work: at most one moved task of the same skill per day when possible. Prefer today only for short tasks (≤ 30 min) when today has room.
7. time: keep the task's original time if it had one and that slot is free; otherwise "" (any time).
8. reason: ≤ 80 characters, English, concrete ("Monday has 60 free minutes, before Tuesday's class").
9. summary: ≤ 160 characters, English — what moved where and what was dropped, in one or two sentences.`

const RESCHEDULE_SCHEMA = {
  type: 'object',
  properties: {
    moves: {
      type: 'array',
      items: {
        type: 'object',
        properties: { taskId: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, reason: { type: 'string' } },
        required: ['taskId', 'date', 'time', 'reason'],
      },
    },
    drop: {
      type: 'array',
      items: { type: 'object', properties: { taskId: { type: 'string' }, reason: { type: 'string' } }, required: ['taskId', 'reason'] },
    },
    summary: { type: 'string' },
  },
  required: ['moves', 'drop', 'summary'],
}

export function rescheduleInput(doc: PlannerDoc, today: string) {
  const overdue = overdueTasks(doc, today)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  return {
    overdue,
    days,
    input: {
      today,
      overdue: overdue.map((t) => ({ id: t.id, title: t.title, skill: t.skill, durationMin: t.durationMin ?? 30, originalDate: t.date, time: t.time ?? '' })),
      plannedMinutes: plannedMinutes(doc.tasks, days),
      capacity: Object.fromEntries(days.map((d) => [d, capacityOf(doc, d)])),
      events: eventsAhead(doc, today, 30).map((e) => ({ title: e.title, kind: e.kind, date: e.date, daysLeft: e.daysLeft })),
    },
  }
}

/**
 * One decision per overdue task, dates in today…today+6; tasks the model forgot go to the first day with room.
 * Pure (tested).
 */
export function validateReschedule(
  raw: { moves?: unknown; drop?: unknown; summary?: unknown },
  doc: PlannerDoc,
  today: string,
): Omit<RescheduleProposal, 'tasks'> {
  const { overdue, days, input } = rescheduleInput(doc, today)
  const byId = new Map(overdue.map((t) => [t.id, t]))
  const decided = new Set<string>()
  const used: Record<string, number> = { ...input.plannedMinutes }
  const moves: RescheduleProposal['moves'] = []
  const drop: RescheduleProposal['drop'] = []
  for (const m of Array.isArray(raw.moves) ? (raw.moves as Record<string, unknown>[]) : []) {
    const task = byId.get(m.taskId as string)
    if (!task || decided.has(task.id) || !days.includes(m.date as string)) continue
    decided.add(task.id)
    used[m.date as string] += isStudySkill(task.skill) ? (task.durationMin ?? 30) : 0
    moves.push({ taskId: task.id, date: m.date as string, time: timeOf(m.time), reason: cut(m.reason, 80) })
  }
  for (const d of Array.isArray(raw.drop) ? (raw.drop as Record<string, unknown>[]) : []) {
    const task = byId.get(d.taskId as string)
    // Work and personal tasks are never dropped by the AI; a drop falls through to the automatic move below.
    if (!task || decided.has(task.id) || !isStudySkill(task.skill)) continue
    decided.add(task.id)
    drop.push({ taskId: task.id, reason: cut(d.reason, 80) })
  }
  for (const task of overdue) {
    if (decided.has(task.id)) continue
    const need = isStudySkill(task.skill) ? (task.durationMin ?? 30) : 0
    const day = days.find((d) => used[d] + need <= capacityOf(doc, d)) ?? today
    used[day] += need
    moves.push({ taskId: task.id, date: day, time: '', reason: 'Auto: first day with room' })
  }
  return { moves, drop, summary: cut(raw.summary, 160) }
}

export async function proposeReschedule(ctx: PlannerCtx, now = new Date()): Promise<RescheduleProposal & { raw: unknown; ms: number }> {
  const doc = await readPlanner(ctx)
  const today = vnDay(now)
  const { overdue, input } = rescheduleInput(doc, today)
  if (!overdue.length) return { moves: [], drop: [], summary: 'No overdue tasks.', tasks: [], raw: null, ms: 0 }
  const prompt = `CALENDAR:\n${calendarTable(today)}\n\nINPUT:\n${JSON.stringify(input, null, 2)}`
  const { value, ms } = await callAi<Record<string, unknown>>('planner-reschedule', RESCHEDULE_SYSTEM, prompt, RESCHEDULE_SCHEMA, PLAN_EFFORT())
  return { ...validateReschedule(value ?? {}, doc, today), tasks: overdue, raw: value, ms }
}

/* ───────────── 4.4 AI week draft ───────────── */

export const WEEK_DRAFT_SYSTEM = `You plan one week of IELTS study for one learner.

INPUT: the 7 dates of the week (CALENDAR), minutes available per date, target band, latest Writing and Speaking bands (may be null), exam date and days left (may be null), flashcards due per day, the learner's focus note (may be empty), and the tasks already planned that week (do not duplicate them; their minutes count against the day).

RULES
1. Total minutes per date ≤ the minutes available minus what is already planned. A date with 0 available gets nothing.
2. If flashcards are due on a date, add one review task first that day: title "Flashcard review (~N cards)", skill review, 10–20 min (≈ 1 min per 3 cards, min 10, max 30).
3. Balance toward the weaker skill: if one of Writing/Speaking is ≥ 0.5 below the target, give it about twice the time of the other productive skill. Unknown bands → balance evenly.
4. If the exam is ≤ 42 days away, include one full mock test (skill mock, 150–180 min) on the date with the most time, and nothing heavy the day after it.
5. If the exam falls inside the week: the last 2 days before it only light review and one speaking warm-up; nothing on the exam day.
6. Tasks are concrete and doable in one sitting: "Writing Task 2: outline + write 1 essay (environment topic), then get it scored", "Speaking Part 2: 3 cue cards, record & score", "Listening: Cambridge 18 Test 1, dictation of Section 3". Titles ≤ 70 characters, in English.
7. Each task 15–90 minutes (mock up to 180). time: "" unless the learner's focus note asks for times.
8. Follow the focus note when it is reasonable.
9. why: ≤ 80 characters, English, why this task is here. summary: ≤ 200 characters, English, the shape of the week.`

const WEEK_DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          time: { type: 'string' },
          durationMin: { type: 'integer' },
          skill: { type: 'string', enum: STUDY_SKILLS },
          title: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['date', 'time', 'durationMin', 'skill', 'title', 'why'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['tasks', 'summary'],
}

export interface DraftWeekInput {
  week: { date: string; weekday: string; availableMinutes: number; plannedMinutes: number; reviewDue: number }[]
  targetBand: number | null
  latestScores: { writingBand: number | null; speakingBand: number | null }
  exam: { date: string; daysLeft: number } | null
  focus: string
  alreadyPlanned: { date: string; title: string; skill: string; durationMin: number }[]
}

/**
 * Dates inside the week and not before today; durations clamped; then each day trimmed from the end until it fits its
 * free minutes. `trimmed` counts the tasks dropped for room. Pure (tested).
 */
export function validateWeekDraft(raw: { tasks?: unknown; summary?: unknown }, input: DraftWeekInput, today: string): { tasks: WeekDraftTask[]; summary: string; trimmed: number } {
  const free = Object.fromEntries(input.week.map((d) => [d.date, Math.max(0, d.availableMinutes - d.plannedMinutes)]))
  const tasks: WeekDraftTask[] = []
  for (const r of Array.isArray(raw.tasks) ? (raw.tasks as Record<string, unknown>[]) : []) {
    const date = r.date as string
    if (!(date in free) || date < today) continue
    const title = cut(r.title, 120)
    if (!title) continue
    const skill = skillOf(r.skill)
    const minutes = Number.isInteger(r.durationMin) ? (r.durationMin as number) : 30
    const durationMin = Math.min(skill === 'mock' ? 180 : 90, Math.max(skill === 'review' ? 10 : 15, minutes))
    tasks.push({ date, time: timeOf(r.time), durationMin, skill, title, why: cut(r.why, 80) })
  }
  let trimmed = 0
  const kept: WeekDraftTask[] = []
  for (const date of Object.keys(free)) {
    const day = tasks.filter((t) => t.date === date)
    while (day.length && day.reduce((s, t) => s + t.durationMin, 0) > free[date]) {
      day.pop()
      trimmed++
    }
    kept.push(...day)
  }
  return { tasks: kept, summary: cut(raw.summary, 200), trimmed }
}

export async function draftInput(ctx: PlannerCtx, doc: PlannerDoc, start: string, opts: { minutesPerDay?: number[]; focus?: string; now?: Date }): Promise<DraftWeekInput> {
  const now = opts.now ?? new Date()
  const today = vnDay(now)
  const days = weekDays(weekStart(start)).filter((d) => d >= today)
  const review = await reviewSummary(ctx, now)
  const dueOn = (day: string) => review.forecast.find((f) => f.day === day)?.count ?? 0
  const planned = plannedMinutes(doc.tasks, days)
  const exam = eventsAhead(doc, today, 365).find((e) => e.kind === 'exam')
  return {
    week: days.map((date) => ({
      date,
      weekday: enWeekday(date),
      availableMinutes: opts.minutesPerDay?.[isoWeekday(date) - 1] ?? capacityOf(doc, date),
      plannedMinutes: planned[date],
      reviewDue: dueOn(date),
    })),
    targetBand: doc.settings.targetBand ?? null,
    latestScores: await latestScores(ctx),
    exam: exam ? { date: exam.date, daysLeft: exam.daysLeft } : null,
    focus: cut(opts.focus, 300),
    alreadyPlanned: days.flatMap((d) => tasksForDay(doc, d).filter((t) => isStudySkill(t.skill)).map((t) => ({ date: d, title: t.title, skill: t.skill, durationMin: t.durationMin ?? 30 }))),
  }
}

export async function draftWeek(
  ctx: PlannerCtx,
  start: string,
  opts: { minutesPerDay?: number[]; focus?: string; now?: Date } = {},
): Promise<{ tasks: WeekDraftTask[]; summary: string; trimmed: number; raw: unknown; ms: number; input: DraftWeekInput }> {
  const now = opts.now ?? new Date()
  const today = vnDay(now)
  const doc = await readPlanner(ctx)
  const input = await draftInput(ctx, doc, start, opts)
  if (!input.week.length) throw new ApiError(400, 'This week is already over.')
  const prompt = `CALENDAR:\n${calendarTable(today)}\n\nINPUT:\n${JSON.stringify(input, null, 2)}`
  const { value, ms } = await callAi<Record<string, unknown>>('planner-week-draft', WEEK_DRAFT_SYSTEM, prompt, WEEK_DRAFT_SCHEMA, PLAN_EFFORT())
  return { ...validateWeekDraft(value ?? {}, input, today), raw: value, ms, input }
}
