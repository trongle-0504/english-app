// Phase 2 write tools: they never change data. Each checks its input and stores a proposal on the chat's current turn;
// the learner sees it as a card and applies it with Confirm (CoachService.applyProposal).
import { enWeekday } from '../../../src/features/planner/dates.ts'
import { phraseCardId } from '../../../src/features/practice/phrase-groups.ts'
import { PLANNER_SKILLS, type PlannerSkill } from '../../../src/types/planner.ts'
import type { CoachProposalItem } from '../../../src/types/coach.ts'
import { ApiError } from '../../api.ts'
import { checkDay, checkTime, readPlanner, taskFromBody } from '../../planner/store.ts'
import { mistakeBook } from '../../practice/mistakes.ts'
import { cardIdsOf } from '../../practice/recent.ts'
import { cut, talkDocs, ToolError, validWorkId, writingDocs, type ToolContext } from '../data.ts'
import { fold, libraryEntries } from './library.ts'
import type { CoachTool } from './types.ts'

const MAX_TASKS = 20
const MAX_CARDS = 30
const MAX_LIBRARY = 30

/** What every propose_* tool tells the model: nothing changed yet. */
const AFTER = 'Nothing has changed yet. Tell the learner, in one short line, to check the card under your answer and press Confirm (they can untick items).'

function proposeOrFail(ctx: ToolContext) {
  if (!ctx.propose) throw new ToolError('Proposals are not available here.')
  return ctx.propose
}

const list = (value: unknown, key: string, max: number): unknown[] => {
  if (!Array.isArray(value) || !value.length) throw new ToolError(`${key}: send 1–${max} items.`)
  if (value.length > max) throw new ToolError(`${key}: at most ${max} items in one proposal.`)
  return value
}

const obj = (value: unknown, where: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolError(`${where} must be an object.`)
  return value as Record<string, unknown>
}

/** The planner's own checks, as messages the model can act on. */
function checked<T>(where: string, f: () => T): T {
  try {
    return f()
  } catch (error) {
    if (error instanceof ApiError) throw new ToolError(`${where}: ${error.message}`)
    throw error
  }
}

const dayLabel = (day: string) => `${enWeekday(day).slice(0, 3)} ${day.slice(8)}/${day.slice(5, 7)}`

/* ───────────── propose_tasks ───────────── */

export const proposeTasks: CoachTool = {
  name: 'propose_tasks',
  description: `Proposes new planner tasks (≤ ${MAX_TASKS}); added only when the learner confirms.`,
  inputSchema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            date: { type: 'string' },
            time: { type: 'string', description: 'HH:mm' },
            durationMin: { type: 'integer' },
            skill: { type: 'string', enum: PLANNER_SKILLS },
          },
          required: ['title', 'date'],
        },
      },
    },
    required: ['tasks'],
  },
  label: (a) => `Preparing ${Array.isArray(a.tasks) ? a.tasks.length : ''} task${Array.isArray(a.tasks) && a.tasks.length === 1 ? '' : 's'} for your plan…`.replace('  ', ' '),
  async run(args, ctx) {
    const propose = proposeOrFail(ctx)
    const now = ctx.now.toISOString()
    const items: CoachProposalItem[] = list(args.tasks, 'tasks', MAX_TASKS).map((raw, i) => {
      const body = obj(raw, `tasks[${i}]`)
      const data: Record<string, unknown> = { title: body.title, date: body.date, skill: PLANNER_SKILLS.includes(body.skill as PlannerSkill) ? body.skill : 'other' }
      if (body.time) data.time = body.time
      if (body.durationMin) data.durationMin = body.durationMin
      const task = checked(`tasks[${i}]`, () => taskFromBody(data, now))
      return {
        label: task.title,
        detail: [dayLabel(task.date), task.time, task.durationMin ? `${task.durationMin} min` : '', task.skill].filter(Boolean).join(' · '),
        data,
      }
    })
    const p = propose({ kind: 'tasks', title: `Add ${items.length} task${items.length === 1 ? '' : 's'} to your plan`, items })
    return { proposalId: p.id, proposed: items.length, note: AFTER }
  },
}

/* ───────────── propose_moves ───────────── */

export const proposeMoves: CoachTool = {
  name: 'propose_moves',
  description: `Proposes moving planner tasks (ids from get_plan) to another day/time (≤ ${MAX_TASKS}); moved only when the learner confirms.`,
  inputSchema: {
    type: 'object',
    properties: {
      moves: {
        type: 'array',
        items: {
          type: 'object',
          properties: { taskId: { type: 'string' }, date: { type: 'string' }, time: { type: 'string', description: 'HH:mm' } },
          required: ['taskId', 'date'],
        },
      },
    },
    required: ['moves'],
  },
  label: () => 'Preparing the moves…',
  async run(args, ctx) {
    const propose = proposeOrFail(ctx)
    const doc = await readPlanner(ctx)
    const notes: string[] = []
    const items: CoachProposalItem[] = []
    for (const [i, raw] of list(args.moves, 'moves', MAX_TASKS).entries()) {
      const m = obj(raw, `moves[${i}]`)
      const task = doc.tasks.find((t) => t.id === m.taskId)
      if (!task) {
        notes.push(`Unknown task ${cut(String(m.taskId ?? ''), 40)} — skipped.`)
        continue
      }
      const date = checked(`moves[${i}]`, () => checkDay(m.date))
      const time = checked(`moves[${i}]`, () => checkTime(m.time))
      if (items.some((x) => x.data.taskId === task.id)) continue
      items.push({
        label: task.title,
        detail: `${dayLabel(task.date)}${task.time ? ` ${task.time}` : ''} → ${dayLabel(date)}${time ? ` ${time}` : ''}`,
        data: { taskId: task.id, date, ...(time ? { time } : {}) },
      })
    }
    if (!items.length) throw new ToolError(`No task to move. ${notes.join(' ')} Use get_plan for the task ids.`)
    const p = propose({ kind: 'moves', title: `Move ${items.length} task${items.length === 1 ? '' : 's'}`, items, ...(notes.length ? { notes } : {}) })
    return { proposalId: p.id, proposed: items.length, ...(notes.length ? { skipped: notes } : {}), note: AFTER }
  },
}

/* ───────────── propose_review_cards ───────────── */

const WORK_KIND = { writing: 'writing', speaking_review: 'talk' } as const

export const proposeReviewCards: CoachTool = {
  name: 'propose_review_cards',
  description:
    `Proposes review flashcards (≤ ${MAX_CARDS}); added only when the learner confirms. mistakes: wrong/right pairs exactly as the tools gave them. ` +
    'phrases: phrases to learn; phrases not in the library need from_kind + from_id (the work they came from).',
  inputSchema: {
    type: 'object',
    properties: {
      mistakes: { type: 'array', items: { type: 'object', properties: { wrong: { type: 'string' }, right: { type: 'string' } }, required: ['wrong', 'right'] } },
      phrases: {
        type: 'array',
        items: { type: 'object', properties: { term: { type: 'string' }, meaning_vi: { type: 'string' }, example: { type: 'string' } }, required: ['term'] },
      },
      from_kind: { type: 'string', enum: Object.keys(WORK_KIND) },
      from_id: { type: 'string' },
    },
  },
  label: () => 'Preparing review cards…',
  async run(args, ctx) {
    const propose = proposeOrFail(ctx)
    const mistakes = Array.isArray(args.mistakes) ? args.mistakes : []
    const phrases = Array.isArray(args.phrases) ? args.phrases : []
    if (!mistakes.length && !phrases.length) throw new ToolError('Send mistakes and/or phrases.')
    if (mistakes.length + phrases.length > MAX_CARDS) throw new ToolError(`At most ${MAX_CARDS} cards in one proposal.`)
    const notes: string[] = []
    const items: CoachProposalItem[] = []

    if (mistakes.length) {
      const book = await mistakeBook({ rootDir: ctx.rootDir, contentDir: ctx.contentDir })
      for (const [i, raw] of mistakes.entries()) {
        const m = obj(raw, `mistakes[${i}]`)
        const wrong = fold(String(m.wrong ?? ''))
        const right = fold(String(m.right ?? ''))
        const hit = book.items.find((x) => x.right && fold(x.wrong) === wrong && fold(x.right) === right)
        if (!hit) {
          notes.push(`“${cut(m.wrong, 40)} → ${cut(m.right, 40)}” is not in the mistake book — skipped.`)
          continue
        }
        if (items.some((x) => x.data.key === hit.key)) continue
        items.push({ label: `${cut(hit.wrong, 80)} → ${cut(hit.right, 80)}`, detail: 'Mistake card', data: { type: 'mistake', key: hit.key } })
      }
    }

    if (phrases.length) {
      let from: { kind: 'writing' | 'talk'; id: string; title: string } | null = null
      if (args.from_id !== undefined && args.from_id !== '') {
        const kind = WORK_KIND[args.from_kind as keyof typeof WORK_KIND]
        if (!kind || !validWorkId(args.from_id)) throw new ToolError('from_kind must be writing or speaking_review, with the id from list_works.')
        const title =
          kind === 'writing'
            ? ((r) => r && (r.title || r.prompt || r.text))((await writingDocs(ctx)).find((r) => r.id === args.from_id))
            : ((r) => r && (r.question || r.topic || r.transcript))((await talkDocs(ctx)).find((r) => r.id === args.from_id))
        if (title === undefined) throw new ToolError('Unknown from_id. Use list_works.')
        from = { kind, id: args.from_id, title: cut(title, 120) }
      }
      const rows = phrases.map((raw, i) => {
        const p = obj(raw, `phrases[${i}]`)
        const term = cut(p.term, 200)
        if (!term) throw new ToolError(`phrases[${i}] needs a term.`)
        return { term, meaning_vi: cut(p.meaning_vi, 300), example: cut(p.example, 600) }
      })
      const ids = await cardIdsOf(ctx, rows.map((r) => r.term))
      rows.forEach((r, i) => {
        const inLibrary = ids[i] !== phraseCardId(r.term)
        if (!inLibrary && !from) {
          notes.push(`“${cut(r.term, 40)}” is not in the library and no from_id was given — skipped.`)
          return
        }
        if (items.some((x) => x.data.type === 'phrase' && fold(String(x.data.term)) === fold(r.term))) return
        items.push({
          label: r.term,
          detail: inLibrary ? 'Library card' : r.meaning_vi || 'Phrase card',
          data: { type: 'phrase', term: r.term, ...(r.meaning_vi ? { meaning_vi: r.meaning_vi } : {}), ...(r.example ? { example: r.example } : {}), ...(!inLibrary && from ? { from } : {}) },
        })
      })
    }

    if (!items.length) throw new ToolError(`Nothing to add. ${notes.join(' ')}`)
    const p = propose({ kind: 'review-cards', title: `Add ${items.length} card${items.length === 1 ? '' : 's'} to your reviews`, items, ...(notes.length ? { notes } : {}) })
    return { proposalId: p.id, proposed: items.length, ...(notes.length ? { skipped: notes } : {}), note: AFTER }
  },
}

/* ───────────── propose_library_add ───────────── */

export const proposeLibraryAdd: CoachTool = {
  name: 'propose_library_add',
  description:
    `Proposes adding words/phrases to the app library (vocabulary: word or collocation; note: structure/usage), ≤ ${MAX_LIBRARY} in one ` +
    'proposal. Use it for every "add these words / thêm từ" request: all items in one call. The server writes full entries ' +
    '(meanings, collocations, examples, picture, review card) only after the learner confirms. meaning_vi and example are ' +
    "optional: copy the learner's own text, never invent one. Words already in the library are left out.",
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            target: { type: 'string', enum: ['vocabulary', 'note'] },
            phrase: { type: 'string' },
            meaning_vi: { type: 'string' },
            example: { type: 'string', description: 'the example or context the learner gave' },
          },
          required: ['target', 'phrase'],
        },
      },
    },
    required: ['items'],
  },
  label: (a) => `Preparing ${Array.isArray(a.items) ? `${a.items.length} ` : ''}library entr${Array.isArray(a.items) && a.items.length === 1 ? 'y' : 'ies'}…`,
  async run(args, ctx) {
    const propose = proposeOrFail(ctx)
    const raw = list(args.items, 'items', MAX_LIBRARY)
    const known = new Map<string, string>()
    for (const e of await libraryEntries(ctx)) if (e.kind === 'word' || e.kind === 'note') known.set(`${e.kind === 'word' ? 'vocabulary' : 'note'}:${fold(e.term)}`, e.href)
    const notes: string[] = []
    const items: CoachProposalItem[] = []
    for (const [i, value] of raw.entries()) {
      const it = obj(value, `items[${i}]`)
      const target = it.target === 'note' ? 'note' : it.target === 'vocabulary' ? 'vocabulary' : null
      const phrase = cut(it.phrase, 120)
      const meaning_vi = cut(it.meaning_vi, 300)
      const example = cut(it.example, 600)
      if (!target || !phrase) throw new ToolError(`items[${i}] needs target (vocabulary | note) and phrase.`)
      const key = `${target}:${fold(phrase)}`
      if (known.has(key)) {
        notes.push(`“${cut(phrase, 40)}” is already in the library — skipped.`)
        continue
      }
      if (items.some((x) => `${x.data.target}:${fold(String(x.data.phrase))}` === key)) continue
      items.push({
        label: phrase,
        detail: [target === 'note' ? 'Notes' : 'Vocabulary', meaning_vi, example ? `“${cut(example, 80)}”` : ''].filter(Boolean).join(' · '),
        data: { target, phrase, ...(meaning_vi ? { meaning_vi } : {}), ...(example ? { example } : {}) },
      })
    }
    if (!items.length) throw new ToolError(`Nothing to add. ${notes.join(' ')}`)
    const p = propose({ kind: 'library', title: `Add ${items.length} entr${items.length === 1 ? 'y' : 'ies'} to your library`, items, ...(notes.length ? { notes } : {}) })
    return { proposalId: p.id, proposed: items.length, ...(notes.length ? { skipped: notes } : {}), note: AFTER }
  },
}

export const PROPOSE_TOOLS = [proposeTasks, proposeMoves, proposeReviewCards, proposeLibraryAdd]
