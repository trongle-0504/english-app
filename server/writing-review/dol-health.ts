// Whether the DOL dictionary still works for the app, part by part (word list, entries, search, notes). DOL failures
// never break a feature (no hint is given instead), so they are recorded here — with a code and whether DOL only failed
// to answer or answered in a shape the code no longer understands — and the pages show them, so a user can report them
// (src/features/practice/DolStatusBanner.tsx). Kept in cache/dol/health.json across restarts.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DolFailure, DolPart, DolProblem, DolStatus } from '../../src/types/lookup.ts'

const FILE = path.join(import.meta.dirname, '..', '..', 'cache', 'dol', 'health.json')
const KEEP = 20

/** An error that knows what kind of DOL failure it is. */
export class DolError extends Error {
  kind: DolFailure
  constructor(kind: DolFailure, message: string) {
    super(message)
    this.kind = kind
  }
}

interface Health {
  problems: Partial<Record<DolPart, DolProblem>>
  lastOk: Partial<Record<DolPart, string>>
  recent: DolProblem[]
}

let health: Health | null = null
let loading: Promise<Health> | null = null
let saving: ReturnType<typeof setTimeout> | null = null

function load(): Promise<Health> {
  if (health) return Promise.resolve(health)
  loading ??= readFile(FILE, 'utf8')
    .then((text) => JSON.parse(text) as Health)
    .catch(() => ({ problems: {}, lastOk: {}, recent: [] }))
    .then((h) => (health = { problems: h.problems ?? {}, lastOk: h.lastOk ?? {}, recent: h.recent ?? [] }))
  return loading
}

function save() {
  if (saving) return
  saving = setTimeout(() => {
    saving = null
    void mkdir(path.dirname(FILE), { recursive: true })
      .then(() => writeFile(FILE, JSON.stringify(health, null, 1)))
      .catch(() => {})
  }, 500)
}

/** This part of DOL just worked: its problem, if any, is over. */
export function dolOk(part: DolPart): void {
  void load().then((h) => {
    const had = Boolean(h.problems[part])
    delete h.problems[part]
    h.lastOk[part] = new Date().toISOString()
    if (had) console.log(`[dol] ${part}: working again`)
    save()
  })
}

/** This part of DOL failed: recorded (and logged) with its kind. */
export function dolFailed(part: DolPart, error: unknown): void {
  // Network trouble comes as a DolError from get(); anything else broke while reading the answer: its shape changed.
  const kind: DolFailure = error instanceof DolError ? error.kind : 'format'
  const message = (error as Error)?.message ?? String(error)
  const problem: DolProblem = { part, kind, code: `DOL-${kind.toUpperCase()}-${part.toUpperCase()}`, message, at: new Date().toISOString() }
  console.warn(`[dol] ${problem.code}: ${message}`)
  void load().then((h) => {
    h.problems[part] = problem
    h.recent = [problem, ...h.recent].slice(0, KEEP)
    save()
  })
}

export async function dolHealth(enabled: boolean): Promise<DolStatus> {
  const h = await load()
  return { enabled, problems: Object.values(h.problems).filter((p): p is DolProblem => !!p), lastOk: h.lastOk, recent: h.recent }
}
