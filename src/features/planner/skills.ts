// Labels, default links and colours of the task kinds (study skills, work, personal). Pure: the server imports SKILL_LINKS for a task's default link.
import type { PlannerEventKind, PlannerSkill } from '../../types/planner.ts'

export const SKILL_LABELS: Record<PlannerSkill, string> = {
  vocabulary: 'Vocabulary',
  grammar: 'Grammar',
  reading: 'Reading',
  listening: 'Listening',
  writing: 'Writing',
  speaking: 'Speaking',
  review: 'Flashcards',
  mock: 'Mock test',
  work: 'Work',
  personal: 'Personal',
  other: 'Other',
}

export const SKILL_LINKS: Record<PlannerSkill, string | undefined> = {
  vocabulary: '/vocabulary',
  grammar: '/grammar',
  reading: '/news',
  listening: '/practice/dictation',
  writing: '/practice/writing-review',
  speaking: '/practice/speaking-review',
  review: '/review',
  mock: '/practice/writing-mock',
  work: undefined,
  personal: undefined,
  other: undefined,
}

/** Colour dot (bg-*) per skill. Full class names so Tailwind keeps them. */
export const SKILL_DOT: Record<PlannerSkill, string> = {
  vocabulary: 'bg-amber-500',
  grammar: 'bg-violet-500',
  reading: 'bg-teal-500',
  listening: 'bg-sky-500',
  writing: 'bg-rose-500',
  speaking: 'bg-emerald-500',
  review: 'bg-brand-500',
  mock: 'bg-indigo-500',
  work: 'bg-orange-600',
  personal: 'bg-pink-500',
  other: 'bg-slate-400',
}

/** Border colour of a task's tick circle (border-*), matching SKILL_DOT. */
export const SKILL_RING: Record<PlannerSkill, string> = {
  vocabulary: 'border-amber-500',
  grammar: 'border-violet-500',
  reading: 'border-teal-500',
  listening: 'border-sky-500',
  writing: 'border-rose-500',
  speaking: 'border-emerald-500',
  review: 'border-brand-500',
  mock: 'border-indigo-500',
  work: 'border-orange-600',
  personal: 'border-pink-500',
  other: 'border-slate-400',
}

export const EVENT_KIND_LABELS: Record<PlannerEventKind, string> = {
  exam: 'Exam',
  class: 'Class',
  appointment: 'Appointment',
  deadline: 'Deadline',
  other: 'Other',
}

export const EVENT_KIND_TONE: Record<PlannerEventKind, string> = {
  exam: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  class: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  appointment: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  deadline: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  other: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}
