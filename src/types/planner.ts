// Study planner: weekly plan, daily schedule, events and reminders. Shared by the server and the client.

/** A study area; drives the colour dot, the default link and the AI's balancing. */
export type PlannerSkill = 'vocabulary' | 'grammar' | 'reading' | 'listening' | 'writing' | 'speaking' | 'review' | 'mock' | 'other'

export const PLANNER_SKILLS: PlannerSkill[] = ['vocabulary', 'grammar', 'reading', 'listening', 'writing', 'speaking', 'review', 'mock', 'other']

export interface PlannerTask {
  id: string
  /** ≤ 120 chars, in the user's language. */
  title: string
  /** Study day, YYYY-MM-DD in Asia/Ho_Chi_Minh. */
  date: string
  /** HH:mm (24 h). Absent = "any time that day" (no time reminder). */
  time?: string
  /** 5–480. */
  durationMin?: number
  skill: PlannerSkill
  /** In-app route starting with '/', opened by tapping the row (default from SKILL_LINKS). */
  link?: string
  /** ≤ 1000 chars. */
  notes?: string
  /** ISO time it was ticked. Absent = not done. */
  doneAt?: string
  /** ISO. Reminders for this task wait until then ("Hoãn 1 giờ"). */
  snoozedUntil?: string
  source: 'manual' | 'routine' | 'quick-add' | 'ai-week' | 'reschedule'
  /** The routine item this was made from (so "apply routine" never duplicates). */
  routineId?: string
  /** The date it had before the last reschedule (UI shows "dời từ T3"). */
  movedFrom?: string
  createdAt: string
  updatedAt: string
}

export type PlannerEventKind = 'exam' | 'class' | 'appointment' | 'deadline' | 'other'

export const PLANNER_EVENT_KINDS: PlannerEventKind[] = ['exam', 'class', 'appointment', 'deadline', 'other']

export interface PlannerEvent {
  id: string
  title: string
  kind: PlannerEventKind
  date: string
  time?: string
  endTime?: string
  location?: string
  notes?: string
  /** Minutes before the start. Date-only events count from 08:00 that day. Defaults in DEFAULT_REMINDERS. */
  remind: number[]
  /** Show the countdown on the home page (default true for kind 'exam'). */
  countdown: boolean
  createdAt: string
  updatedAt: string
}

/** One fixed weekly slot ("every Mon/Wed/Fri 06:30, review 20 min"). */
export interface PlannerRoutineItem {
  id: string
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number
  title: string
  time?: string
  durationMin?: number
  skill: PlannerSkill
  link?: string
}

export interface PlannerSettings {
  /** Morning brief push, HH:mm. */
  morningTime: string
  /** Evening digest of what is still undone, HH:mm. */
  eveningTime: string
  /** No push between these (HH:mm); anything due waits until quietEnd. */
  quietStart: string
  quietEnd: string
  taskReminders: boolean
  overdueDigest: boolean
  aiBrief: boolean
  /** Minutes available per ISO weekday, used by the AI week draft and reschedule. Index 0 = Monday. */
  minutesPerDay: number[]
  /** 4.0–9.0, step 0.5. */
  targetBand?: number
}

export const DEFAULT_SETTINGS: PlannerSettings = {
  morningTime: '07:00',
  eveningTime: '20:30',
  quietStart: '22:30',
  quietEnd: '06:30',
  taskReminders: true,
  overdueDigest: true,
  aiBrief: true,
  minutesPerDay: [90, 90, 90, 90, 90, 150, 60],
}

export interface PlannerDoc {
  version: 1
  tasks: PlannerTask[]
  events: PlannerEvent[]
  routine: PlannerRoutineItem[]
  settings: PlannerSettings
}

export const DEFAULT_REMINDERS: Record<PlannerEventKind, number[]> = {
  exam: [10080, 1440, 120], // 7 days, 1 day, 2 hours
  class: [60],
  appointment: [1440, 60],
  deadline: [1440, 180],
  other: [60],
}

/** An event with the days left until it (0 = today). */
export type PlannerEventAhead = PlannerEvent & { daysLeft: number }

/** What GET /planner/home returns: everything the home page needs in one call. */
export interface PlannerHome {
  /** Today, YYYY-MM-DD (VN). */
  day: string
  /** ISO. */
  now: string
  /** Today's, sorted: timed by time, then untimed by createdAt; done last. */
  tasks: PlannerTask[]
  /** date < today and not done, oldest first, max 20. */
  overdue: PlannerTask[]
  /** Next 30 days, soonest first, max 5. */
  events: PlannerEventAhead[]
  /** Nearest event with countdown=true (≤ 365 days). */
  countdown: PlannerEventAhead | null
  review: { due: number; streak: number; reviewedToday: number }
  /** Today's cached brief, null if not generated yet. */
  brief: PlannerBrief | null
  /** Tasks of the current Mon–Sun week. */
  weekProgress: { done: number; total: number }
  settings: PlannerSettings
}

export interface PlannerBrief {
  day: string
  headline: string
  body: string
  greeting: string
  focus: string
  tip: string
  order: string[]
  tone: 'calm' | 'push' | 'celebrate'
  /** 'ai' or 'template' (AI off/failed). */
  source: 'ai' | 'template'
  createdAt: string
}

/** GET /planner/week. */
export interface PlannerWeek {
  start: string
  days: { day: string; tasks: PlannerTask[]; events: PlannerEvent[] }[]
  routine: PlannerRoutineItem[]
  settings: PlannerSettings
}

/** A quick-add item after the server checked it; not saved until the client confirms. */
export interface QuickAddItem {
  type: 'task' | 'event'
  title: string
  date: string
  /** HH:mm or ''. */
  time: string
  endTime: string
  durationMin: number
  skill: PlannerSkill
  eventKind: PlannerEventKind | ''
  location: string
  repeatWeekdays: number[]
  /** One date per repeat, today … end of next week (max 14). Empty when not repeated. */
  repeatDates: string[]
  remind: number[]
  countdown: boolean
  link?: string
  confidence: 'high' | 'low'
}

export interface RescheduleMove {
  taskId: string
  date: string
  time: string
  reason: string
}

export interface RescheduleProposal {
  moves: RescheduleMove[]
  drop: { taskId: string; reason: string }[]
  summary: string
  /** Snapshot of the overdue tasks the proposal is about (titles for the preview). */
  tasks: PlannerTask[]
}

export interface WeekDraftTask {
  date: string
  time: string
  durationMin: number
  skill: PlannerSkill
  title: string
  why: string
}

export interface PushDevice {
  endpointTail: string
  device: string
  createdAt: string
  lastOkAt?: string
}
