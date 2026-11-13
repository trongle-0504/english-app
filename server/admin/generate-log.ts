// Step timings of Admin → Vocabulary / Notes → Generate, kept apart from the token log (logs/gemini-usage.jsonl) so
// before/after runs can be compared: one line per request ("request"), per background job ("background"), per nightly
// drills run ("nightly"), in logs/admin-generate.jsonl (warm-agent events: logs/antigravity-warm.jsonl).
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const LOG_DIR = path.join(import.meta.dirname, '..', '..', 'logs')
const LOG = path.join(LOG_DIR, 'admin-generate.jsonl')

/** Per-step times of one Generate request (ms) and how the dictionary step went. Returned to the page too. */
export interface GenerateTimings {
  /** The AI base-form call (0 when skipped). */
  lemma: number
  /** Longman / OZDIC lookups, the fast-path lookup included. */
  dictionary: number
  /** The main AI call. */
  main: number
  /** Writing the entry. */
  commit: number
  total: number
  dictionaryRequests: number
  cacheHits: number
  /** Time spent waiting for the polite gap between Longman/OZDIC requests. */
  longmanWaitMs: number
  /** A Longman page used here was stored by the "Word" field prefetch. */
  longmanPrefetched: boolean
  lemmaSkipped: boolean
  dictionarySource: 'longman' | 'ozdic' | 'both' | 'none'
  longmanError?: string
}

export function logGenerate(entry: Record<string, unknown>): void {
  // Test runs (node --test) do not write to the app's log.
  if (process.env.NODE_TEST_CONTEXT) return
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
  } catch (error) {
    console.warn('[admin-generate] could not write the log:', (error as Error).message)
  }
}

/** `[admin-generate] decision lemma=0 dict=812 main=19873 commit=34 total=20730` */
export function logTimings(kind: 'vocabulary' | 'note', item: string, t: GenerateTimings): void {
  console.log(
    `[admin-generate] ${kind} ${JSON.stringify(item)} lemma=${t.lemma} dict=${t.dictionary} main=${t.main} commit=${t.commit} total=${t.total}` +
      ` source=${t.dictionarySource} requests=${t.dictionaryRequests} cache=${t.cacheHits}${t.lemmaSkipped ? ' lemma-skipped' : ''}${t.longmanError ? ` longman-error=${JSON.stringify(t.longmanError)}` : ''}`,
  )
  logGenerate({ kind: 'request', feature: kind, item, ...t })
}
