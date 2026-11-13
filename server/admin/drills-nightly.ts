// Review drills ("use_prompts" Tự dùng, "dictation" Nghe chép, "paraphrase" Viết lại câu) for Admin entries, written in
// a nightly batch instead of inside Generate. At 03:00 Asia/Ho_Chi_Minh — or when the server starts after that time and
// today's run has not happened — words.json and notes.json are scanned for entries missing a drill field (no queue:
// the state is read from the data, so old entries and last night's failures are picked up too). About five entries go
// in one AI call; each answer is cleaned (src/lib/wordDrills.ts) and only the drill fields are written, inside the
// content mutation queue, to the entry found again by its key at that moment (deleted or already-drilled ones are skipped).
// Admin → Vocabulary / Notes show the pending count and the last run, with "Chạy ngay" and "Tạo drills ngay".
import path from 'node:path'
import { slugify } from '../../content-pipeline/shared.ts'
import { vnDay, vnTime } from '../../src/features/planner/dates.ts'
import { cleanDrills } from '../../src/lib/wordDrills.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { contentFile } from '../files.ts'
import { generateLogged } from './ai.ts'
import { DRILL_FIELDS, drillsPrompt, drillsSchema, type DrillSubject } from './drills.ts'
import { logGenerate } from './generate-log.ts'
import { isObject, type JsonObject } from './input.ts'
import { adminEffort } from './ozdic-grounding.ts'
import { readJsonDoc, updateJsonDoc, writeJsonDoc } from './store.ts'

export type DrillKind = 'word' | 'note'

export interface PendingItem {
  kind: DrillKind
  /** words.json: the word (matched case-insensitively); notes.json: the note id. */
  key: string
  title: string
}

export interface DrillsRun {
  trigger: 'schedule' | 'catch-up' | 'manual'
  startedAt: string
  finishedAt?: string
  ms?: number
  /** Entries found missing drills. */
  items: number
  /** AI calls made. */
  calls: number
  written: number
  failed: { kind: DrillKind; key: string; error: string }[]
  error?: string
}

interface DrillsState {
  /** VN day (YYYY-MM-DD) of the last run that started, scheduled or caught up. */
  lastRunDay?: string
  lastRun?: DrillsRun
}

export const RUN_AT = '03:00'
export const BATCH_SIZE = 5

/** The AI call; tests replace it. */
let generate: typeof generateLogged = generateLogged
export function setDrillsGeneratorForTests(fn: typeof generateLogged = generateLogged): void {
  generate = fn
}

const WORD_DRILLS: DrillSubject = { item: 'word', partners: 'collocations' }
const NOTE_DRILLS: DrillSubject = { item: 'note title', partners: 'patterns' }

type Ctx = Pick<ApiContext, 'rootDir' | 'contentDir'> & Partial<Pick<ApiContext, 'onContentChange'>>

const wordsFile = (ctx: Ctx) => contentFile(ctx.contentDir, 'vocabulary', 'words.json')
const notesFile = (ctx: Ctx) => contentFile(ctx.contentDir, 'note', 'notes.json')
const stateFile = (ctx: Ctx) => path.join(ctx.rootDir, 'data', 'drills-nightly.json')
const wordKey = (word: string) => word.trim().toLowerCase()

/* ───────────── Pure parts (tested) ───────────── */

/** An entry lacks drills when one of the three fields is absent (a field the batch wrote as [] counts as done). */
export function missingDrills(entry: unknown): boolean {
  return isObject(entry) && DRILL_FIELDS.some((field) => !Array.isArray(entry[field]))
}

/** Entries of words.json / notes.json that need drills, words first. The last duplicate of a word is the one shown. */
export function pendingItems(words: unknown[], notes: unknown[]): PendingItem[] {
  const seen = new Set<string>()
  const out: PendingItem[] = []
  for (const w of [...words].reverse()) {
    if (!isObject(w) || typeof w.word !== 'string' || seen.has(wordKey(w.word))) continue
    seen.add(wordKey(w.word))
    if (missingDrills(w)) out.push({ kind: 'word', key: w.word.trim(), title: w.word.trim() })
  }
  out.reverse()
  for (const n of notes) {
    if (isObject(n) && typeof n.id === 'string' && missingDrills(n)) out.push({ kind: 'note', key: n.id, title: String(n.title ?? n.id) })
  }
  return out
}

/** True when the nightly run is due: it is 03:00 or later (VN) and today's run has not started yet. */
export function runDue(now: Date, lastRunDay: string | undefined): boolean {
  return vnTime(now) >= RUN_AT && lastRunDay !== vnDay(now)
}

/** The texts a drill may target besides the item itself: a word's collocations, a note's patterns. */
export function partnersOf(kind: DrillKind, entry: JsonObject): string[] {
  const list = kind === 'word' ? entry.collocations : entry.patterns
  if (!Array.isArray(list)) return []
  return list.flatMap((x) => {
    if (!isObject(x)) return []
    const text = kind === 'word' ? (x.text ?? x.word) : x.pattern
    return typeof text === 'string' && text.trim() ? [text.trim()] : []
  })
}

const itemOf = (kind: DrillKind, entry: JsonObject) => String((kind === 'word' ? entry.word : entry.title) ?? '').trim()

/**
 * The drill fields to write for one entry from one answer item: cleaned like Generate used to, every field present
 * ([] when nothing survived). null when nothing at all survived — that entry is left for the next run.
 */
export function drillFields(kind: DrillKind, entry: JsonObject, answer: unknown): Record<(typeof DRILL_FIELDS)[number], unknown[]> | null {
  if (!isObject(answer)) return null
  const cleaned = cleanDrills(answer, itemOf(kind, entry), partnersOf(kind, entry))
  if (!DRILL_FIELDS.some((f) => cleaned[f]?.length)) return null
  return { use_prompts: cleaned.use_prompts ?? [], dictation: cleaned.dictation ?? [], paraphrase: cleaned.paraphrase ?? [] }
}

/** What the model is told about one saved entry (the saved entry already carries the admin's notes). */
export function describeEntry(kind: DrillKind, entry: JsonObject): string {
  const lines = [`--- key: ${kind === 'word' ? entry.word : entry.id}`]
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  if (kind === 'word') {
    lines.push(`word: ${entry.word}`)
    if (strings(entry.part_of_speech).length) lines.push(`part of speech: ${strings(entry.part_of_speech).join(', ')}`)
    for (const sense of Array.isArray(entry.senses) ? entry.senses.filter(isObject) : []) {
      lines.push(`sense: ${sense.definition_vi ?? ''}`)
      for (const ex of strings(sense.examples).slice(0, 2)) lines.push(`  example: ${ex}`)
    }
    for (const c of Array.isArray(entry.collocations) ? entry.collocations.filter(isObject) : []) {
      lines.push(`collocation: ${c.text ?? c.word}${c.meaning_vi ? ` — ${c.meaning_vi}` : ''}`)
    }
  } else {
    lines.push(`note title: ${entry.title}`, `type: ${entry.type ?? ''}`)
    if (entry.formula) lines.push(`formula: ${entry.formula}`)
    if (entry.meaning_vi) lines.push(`meaning: ${String(entry.meaning_vi).replace(/\s+/g, ' ').slice(0, 400)}`)
    for (const p of Array.isArray(entry.patterns) ? entry.patterns.filter(isObject) : []) {
      lines.push(`pattern: ${p.pattern}${p.meaning_vi ? ` — ${String(p.meaning_vi).replace(/\s+/g, ' ').slice(0, 160)}` : ''}`)
    }
    for (const ex of Array.isArray(entry.examples) ? entry.examples.filter(isObject).slice(0, 2) : []) lines.push(`example: ${ex.en}`)
  }
  return lines.join('\n')
}

export function batchPrompt(kind: DrillKind, entries: JsonObject[]): string {
  const subject = kind === 'word' ? WORD_DRILLS : NOTE_DRILLS
  return [
    `You write review drills for ${entries.length} saved ${kind === 'word' ? 'vocabulary entries' : 'study notes'} of an IELTS learner.`,
    `Treat every entry on its own: the rules below apply to EACH entry, in the meaning its senses / notes give. Return one item per entry in "items", with "key" copied exactly from the entry's "key" line.`,
    drillsPrompt(subject),
    '',
    '### ENTRIES',
    ...entries.map((e) => describeEntry(kind, e)),
  ].join('\n')
}

export function batchSchema(kind: DrillKind) {
  const subject = kind === 'word' ? WORD_DRILLS : NOTE_DRILLS
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { key: { type: 'string', description: 'The entry key, copied exactly.' }, ...drillsSchema(subject) },
          required: ['key', ...DRILL_FIELDS],
        },
      },
    },
    required: ['items'],
  }
}

/* ───────────── Running ───────────── */

/** The current entry for a pending item, or undefined when it is gone. */
const findEntry = (kind: DrillKind, list: unknown[], key: string): JsonObject | undefined =>
  kind === 'word'
    ? (list.findLast((w) => isObject(w) && typeof w.word === 'string' && wordKey(w.word) === wordKey(key)) as JsonObject | undefined)
    : (list.find((n) => isObject(n) && n.id === key) as JsonObject | undefined)

/** Writes the drill fields of the given entries (only those still there and still missing drills). */
async function writeDrills(ctx: Ctx, kind: DrillKind, fields: Map<string, Record<string, unknown[]>>): Promise<number> {
  return updateJsonDoc<unknown[], number>(kind === 'word' ? wordsFile(ctx) : notesFile(ctx), [], (list) => {
    let written = 0
    for (const [key, drills] of fields) {
      const entry = findEntry(kind, list, key)
      // Deleted or renamed meanwhile, or the admin added drills by hand: nothing to do.
      if (!entry || !missingDrills(entry)) continue
      Object.assign(entry, drills)
      written++
    }
    return written
  })
}

/** One AI call for up to BATCH_SIZE entries of one kind; returns the keys written and the failures. */
async function runBatch(ctx: Ctx, kind: DrillKind, entries: JsonObject[], label: string): Promise<{ written: number; failed: DrillsRun['failed'] }> {
  const keyOf = (e: JsonObject) => String(kind === 'word' ? e.word : e.id)
  const failed: DrillsRun['failed'] = []
  let items: unknown[] = []
  try {
    const res = await generate<{ items?: unknown[] }>(ctx as ApiContext, label, {
      prompt: batchPrompt(kind, entries),
      schema: batchSchema(kind),
      thinking: adminEffort(),
    })
    items = Array.isArray(res.value?.items) ? res.value.items : []
  } catch (error) {
    return { written: 0, failed: entries.map((e) => ({ kind, key: keyOf(e), error: (error as Error).message })) }
  }
  const byKey = new Map(items.filter(isObject).map((i) => [String(i.key ?? '').trim().toLowerCase(), i]))
  const fields = new Map<string, Record<string, unknown[]>>()
  for (const entry of entries) {
    const key = keyOf(entry)
    const answer = byKey.get(key.trim().toLowerCase())
    const drills = answer ? drillFields(kind, entry, answer) : null
    if (drills) fields.set(key, drills)
    else failed.push({ kind, key, error: answer ? 'no usable drill in the answer' : 'missing from the answer' })
  }
  const written = fields.size ? await writeDrills(ctx, kind, fields) : 0
  if (written) ctx.onContentChange?.()
  return { written, failed }
}

async function readLists(ctx: Ctx) {
  const [words, notes] = await Promise.all([readJsonDoc<unknown[]>(wordsFile(ctx), []), readJsonDoc<unknown[]>(notesFile(ctx), [])])
  return { words: Array.isArray(words.value) ? words.value : [], notes: Array.isArray(notes.value) ? notes.value : [] }
}

async function readState(ctx: Ctx): Promise<DrillsState> {
  const doc = await readJsonDoc<DrillsState>(stateFile(ctx), {})
  return isObject(doc.value) ? doc.value : {}
}

const g = globalThis as { __drillsNightly?: { running: Promise<DrillsRun> | null; started: boolean; current?: DrillsRun } }
const shared = (g.__drillsNightly ??= { running: null, started: false })

/** Runs the whole pending list once, batches one after another (never more than one AI call at a time). */
export function runNightlyDrills(ctx: Ctx, trigger: DrillsRun['trigger']): Promise<DrillsRun> {
  if (shared.running) return shared.running
  shared.running = (async () => {
    const started = Date.now()
    const run: DrillsRun = { trigger, startedAt: new Date(started).toISOString(), items: 0, calls: 0, written: 0, failed: [] }
    shared.current = run
    try {
      if (trigger !== 'manual') {
        const state = await readState(ctx)
        await writeJsonDoc(stateFile(ctx), { ...state, lastRunDay: vnDay(new Date(started)) })
      }
      const { words, notes } = await readLists(ctx)
      const pending = pendingItems(words, notes)
      run.items = pending.length
      for (const kind of ['word', 'note'] as const) {
        const list = kind === 'word' ? words : notes
        const entries = pending
          .filter((p) => p.kind === kind)
          .flatMap((p): JsonObject[] => {
            const entry = findEntry(kind, list, p.key)
            return entry ? [entry] : []
          })
        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
          run.calls++
          const res = await runBatch(ctx, kind, entries.slice(i, i + BATCH_SIZE), 'drills: nightly')
          run.written += res.written
          run.failed.push(...res.failed)
        }
      }
    } catch (error) {
      run.error = (error as Error).message
    }
    run.finishedAt = new Date().toISOString()
    run.ms = Date.now() - started
    const state = await readState(ctx).catch(() => ({}) as DrillsState)
    await writeJsonDoc(stateFile(ctx), { ...state, lastRun: run }).catch((e) => console.warn('[drills] could not save state:', (e as Error).message))
    console.log(`[drills] ${trigger} run: ${run.items} pending, ${run.calls} AI calls, ${run.written} written, ${run.failed.length} failed, ${run.ms} ms`)
    logGenerate({ kind: 'nightly', ...run })
    return run
  })().finally(() => {
    shared.running = null
    shared.current = undefined
  })
  return shared.running
}

/** "Tạo drills ngay" for one entry. Returns the updated entry. */
export async function drillsForItem(ctx: Ctx, kind: DrillKind, key: string): Promise<JsonObject> {
  const { words, notes } = await readLists(ctx)
  const entry = findEntry(kind, kind === 'word' ? words : notes, key)
  if (!entry) throw new ApiError(404, `No ${kind === 'word' ? 'vocabulary entry' : 'note'} "${key}".`)
  if (!missingDrills(entry)) return entry
  const res = await runBatch(ctx, kind, [entry], `drills: ${kind === 'word' ? entry.word : slugify(String(entry.title ?? key))}`)
  if (res.failed.length) throw new ApiError(502, `Drills could not be written: ${res.failed[0].error}.`)
  const after = await readLists(ctx)
  return findEntry(kind, kind === 'word' ? after.words : after.notes, key) ?? entry
}

export async function drillsStatus(ctx: Ctx) {
  const [{ words, notes }, state] = await Promise.all([readLists(ctx), readState(ctx)])
  const pending = pendingItems(words, notes)
  return {
    pending: { words: pending.filter((p) => p.kind === 'word').length, notes: pending.filter((p) => p.kind === 'note').length, items: pending.slice(0, 50) },
    running: shared.current ?? null,
    lastRun: state.lastRun ?? null,
    lastRunDay: state.lastRunDay ?? null,
    runAt: `${RUN_AT} Asia/Ho_Chi_Minh`,
  }
}

async function tick(ctx: Ctx) {
  try {
    const now = new Date()
    if (shared.running || !runDue(now, (await readState(ctx)).lastRunDay)) return
    // Started more than a few minutes after 03:00: the machine was off or the server down — catch up.
    const trigger = vnTime(now) > '03:05' ? 'catch-up' : 'schedule'
    await runNightlyDrills(ctx, trigger)
  } catch (error) {
    console.warn('[drills] scheduler:', (error as Error).message)
  }
}

/**
 * Starts the once-a-minute check (idempotent). Called by server/index.ts and lazily by the Admin drills routes, so it
 * also runs under `npm run dev`. The first check comes a few seconds after start: that is the catch-up.
 */
export function startDrillsScheduler(ctx: Ctx): void {
  if (shared.started) return
  shared.started = true
  setInterval(() => void tick(ctx), 60_000).unref?.()
  setTimeout(() => void tick(ctx), 10_000).unref?.()
}
