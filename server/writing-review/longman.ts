// Collocations from Longman (LDOCE online, https://www.ldoceonline.com/dictionary/<word>), second source next to OZDIC.
// Used on the owner's instruction for a personal, local-only study app (permission requested from Pearson by the owner):
// one page per word, only when a feature needs it, cached forever, one request every LONGMAN_GAP_MS, honest User-Agent,
// no redirects followed (robots.txt disallows /spellcheck/, where unknown words are redirected), and any block stops
// all requests for a while — nothing tries to get around protection. LONGMAN_LOOKUP=off disables network lookups.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse, type HTMLElement } from 'node-html-parser'
import type { CollocationGroup, OzdicEntry } from './ozdic.ts'

/** LONGMAN_CACHE_DIR overrides it (a scratch folder for measuring with an empty cache, tests). */
const cacheDir = () => process.env.LONGMAN_CACHE_DIR || path.join(import.meta.dirname, '..', '..', 'cache', 'longman')
/** 2: senses record whether the COLLOCATIONS box belongs to them. */
const CACHE_VERSION = 2
const MIN_GAP_MS = Number(process.env.LONGMAN_GAP_MS) || 3000
const BLOCK_PAUSE_MS = 30 * 60_000
const USER_AGENT = 'NeuralSymbolic/1.0 (personal IELTS study app, local use only; cached, 1 request per 3s)'

export const longmanEnabled = () => (process.env.LONGMAN_LOOKUP ?? 'on').toLowerCase() !== 'off'

export interface LongmanCollocate {
  /** As printed: "true/real happiness", "bring (somebody) happiness". */
  phrase: string
  /** Longman's gloss: "a lot of happiness". */
  gloss?: string
  examples: string[]
}

export interface LongmanSection {
  /** "adjectives", "verbs", "phrases", "happiness + NOUN", "prepositions"… */
  heading: string
  collocates: LongmanCollocate[]
}

export interface LongmanSense {
  signpost?: string
  definition: string
  grammar?: string
  examples: string[]
  /** Bold combinations inside the sense ("accompanied by"). */
  inline: string[]
  /** The entry's COLLOCATIONS box belongs to this sense ("ties" = relationships, not the necktie sense). */
  hasCollocations?: boolean
}

export interface LongmanHomograph {
  headword: string
  pos: string[]
  pron?: string
  senses: LongmanSense[]
  collocations: LongmanSection[]
  /** Idioms and phrasal verbs the entry points to ("easy on the eye/ear", "take somebody/something down"). Missing in
   * pages cached before it was read: those are fetched again when a phrase is looked up. */
  phrases?: string[]
}

export interface LongmanEntry {
  word: string
  url: string
  found: boolean
  entries: LongmanHomograph[]
  /** Longman could not be reached or blocked the request: no data, and nothing was cached. */
  unavailable?: boolean
  /** Why it was unavailable: "HTTP 429", "timeout", "network error", "Longman requests are paused after a block"… */
  reason?: string
  v?: number
}

export class LongmanUnavailableError extends Error {}

const clean = (s: string | undefined) =>
  (s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s(=]+|[\s)]+$/g, '')
    .trim()
const textOf = (el: HTMLElement | null | undefined) => clean(el?.text)
const exampleText = (el: HTMLElement) => clean(el.childNodes.map((n) => n.text).join(''))

export function parseLongmanPage(html: string, word: string, url: string): LongmanEntry {
  const root = parse(html)
  const entries = root
    .querySelectorAll('.ldoceEntry.Entry')
    .filter((entry) => entry.querySelector('.HWD'))
    .map((entry) => {
      const head = entry.querySelector('.Head')
      return {
        headword: textOf(head?.querySelector('.HWD')),
        pos: head?.querySelectorAll('.POS').map((p) => textOf(p)) ?? [],
        pron: textOf(head?.querySelector('.PRON')) || undefined,
        senses: entry
          .querySelectorAll('.Sense')
          .map((sense) => ({
            signpost: textOf(sense.querySelector('.SIGNPOST')) || undefined,
            definition: textOf(sense.querySelector('.DEF')),
            grammar: textOf(sense.querySelector('.GRAM')) || undefined,
            examples: sense.querySelectorAll('.EXAMPLE').slice(0, 3).map(exampleText),
            inline: [...new Set(sense.querySelectorAll('.COLLO, .PROPFORM, .PROPFORMPREP, .LEXUNIT').map((c) => textOf(c)))].filter(Boolean),
            ...(sense.querySelector('.ColloBox') ? { hasCollocations: true } : {}),
          }))
          .filter((s) => s.definition),
        collocations: entry
          .querySelectorAll('.ColloBox .Section')
          .map((section) => ({
            heading: textOf(section.querySelector('.SECHEADING')),
            collocates: section
              .querySelectorAll('.Collocate')
              .map((c) => ({
                phrase: textOf(c.querySelector('.COLLOC')),
                gloss: textOf(c.querySelector('.COLLGLOSS')) || undefined,
                examples: c.querySelectorAll('.EXAMPLE').slice(0, 2).map(exampleText),
              }))
              .filter((c) => c.phrase),
          }))
          .filter((s) => s.collocates.length),
        phrases: [...new Set(entry.querySelectorAll('.Crossref .REFHWD').map((r) => textOf(r)))].filter(Boolean),
      }
    })
  return { word, url, found: entries.length > 0, entries, v: CACHE_VERSION }
}

let lastRequest = 0
let blockedUntil = 0
/** After a 429/503: no request before this time (Retry-After), and a second one in a row blocks. */
let backoffUntil = 0
let strikes = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** What a lookup cost, filled in by `lookupLongman` / OZDIC `lookup` (Admin → Generate timings). */
export interface LookupStats {
  /** Network requests sent. */
  requests: number
  cacheHits: number
  /** Time spent waiting for the polite gap between two requests. */
  waitMs: number
  /** A cached page that the "Word" field prefetch had stored (see `prefetchedRecently`). */
  prefetched?: boolean
}

export interface FetchOptions {
  /**
   * false (Admin → Generate): never sleep for Retry-After or a back-off — fail at once with LongmanUnavailableError so
   * the caller moves on to OZDIC. The back-off still applies to later requests. Default true: wait and retry once.
   */
  wait?: boolean
  stats?: LookupStats
}

/** Reserves the next request time (one every MIN_GAP_MS, also when lookups run side by side) and waits for it. */
async function takeTurn(stats?: LookupStats) {
  const now = Date.now()
  const at = Math.max(now, lastRequest + MIN_GAP_MS)
  lastRequest = at
  if (at > now) {
    await sleep(at - now)
    if (stats) stats.waitMs += at - now
  }
}

/**
 * One polite GET: "" when the word has no page. 429/503 retried once after Retry-After (or, with `wait: false`, not at
 * all); a second 429/503 in a row, a 403 or a challenge pauses all requests.
 */
async function politeFetch(url: string, { wait = true, stats }: FetchOptions = {}): Promise<string> {
  const block = (reason: string): never => {
    blockedUntil = Date.now() + BLOCK_PAUSE_MS
    throw new LongmanUnavailableError(`${reason}; Longman requests paused for ${BLOCK_PAUSE_MS / 60_000} min`)
  }
  for (;;) {
    if (Date.now() < blockedUntil) throw new LongmanUnavailableError('Longman requests are paused after a block')
    if (Date.now() < backoffUntil) {
      if (!wait) throw new LongmanUnavailableError(`backing off after HTTP 429/503 for ${Math.ceil((backoffUntil - Date.now()) / 1000)} s`)
      await sleep(backoffUntil - Date.now())
    }
    await takeTurn(stats)
    if (stats) stats.requests++
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 429 || res.status === 503) {
      if (strikes > 0) block(`HTTP ${res.status} twice`)
      strikes++
      backoffUntil = Date.now() + Math.min(Number(res.headers.get('retry-after')) || 30, 120) * 1000
      if (!wait) throw new LongmanUnavailableError(`HTTP ${res.status}`)
      continue
    }
    strikes = 0
    // Unknown words redirect to /spellcheck/ (disallowed by robots.txt): treated as "no page", never followed.
    if (res.status === 404 || (res.status >= 300 && res.status < 400)) return ''
    if (res.status === 403) block('HTTP 403')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    if (/challenge-platform|Just a moment\.\.\.|cf-chl-/i.test(html) && !html.includes('ldoceEntry')) block('bot challenge page')
    return html
  }
}

/** Short reason for a failed request, shown to the admin: "HTTP 429", "timeout", "network error"… */
export function failureReason(error: unknown): string {
  const message = String((error as Error)?.message ?? error)
  if ((error as Error)?.name === 'TimeoutError' || /timed? ?out|aborted/i.test(message)) return 'timeout'
  if (error instanceof TypeError || /fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(message)) return 'network error'
  return message.replace(/;.*$/, '').slice(0, 120)
}

/** Words whose Longman page the Admin "Word" field prefetch looked up (see Admin → Generate timings). */
const prefetched = new Map<string, number>()
export function markPrefetched(word: string): void {
  prefetched.set(word.trim().toLowerCase(), Date.now())
  if (prefetched.size > 200) prefetched.delete(prefetched.keys().next().value!)
}
const prefetchedRecently = (key: string) => Date.now() - (prefetched.get(key) ?? 0) < 60 * 60_000

const emptyEntry = (word: string, url: string, extra: Partial<LongmanEntry> = {}): LongmanEntry => ({
  word,
  url,
  found: false,
  entries: [],
  ...extra,
})

/** Longman page for a word (cached). `offline` or LONGMAN_LOOKUP=off never touches the network. */
/** `refresh`: fetch the page again even when it is cached (to read data an older cache version did not keep). */
export async function lookupLongman(
  word: string,
  { offline = false, refresh = false, wait = true, stats }: { offline?: boolean; refresh?: boolean } & FetchOptions = {},
): Promise<LongmanEntry> {
  const key = word.trim().toLowerCase()
  const slug = key.replace(/\s+/g, '-').replace(/[^a-z0-9'-]/g, '')
  const url = `https://www.ldoceonline.com/dictionary/${encodeURIComponent(slug)}`
  const file = path.join(cacheDir(), `${slug.replace(/[^a-z0-9-]+/g, '_') || '_'}.json`)
  try {
    const cached = JSON.parse(await readFile(file, 'utf8')) as LongmanEntry
    if (offline || (cached.v === CACHE_VERSION && !refresh)) {
      if (stats) {
        stats.cacheHits++
        if (prefetchedRecently(key)) stats.prefetched = true
      }
      return cached
    }
  } catch {
    // not cached yet
  }
  if (!slug) return emptyEntry(key, url)
  if (offline || !longmanEnabled()) return emptyEntry(key, url, { unavailable: true, reason: offline ? 'offline' : 'LONGMAN_LOOKUP=off' })
  let html: string
  try {
    html = await politeFetch(url, { wait, stats })
  } catch (error) {
    const reason = failureReason(error)
    console.warn(`[longman] ${key}: ${(error as Error).message}`)
    return emptyEntry(key, url, { unavailable: true, reason })
  }
  const entry = html ? parseLongmanPage(html, key, url) : { ...emptyEntry(key, url), v: CACHE_VERSION }
  await mkdir(cacheDir(), { recursive: true })
  await writeFile(file, JSON.stringify(entry, null, 1))
  return entry
}

/* ───────────── Adapter: Longman collocations in the OZDIC shape, so checker.ts can use them ───────────── */

/** "adjectives" → "ADJ.", "verbs" → "VERB + HAPPINESS", "happiness + NOUN" stays, "phrases" → "PHRASES". */
function categoryOf(heading: string, headword: string): string {
  const h = heading.toLowerCase()
  if (/^adj/.test(h)) return 'ADJ.'
  if (/^verbs?\b/.test(h)) return `VERB + ${headword.toUpperCase()}`
  if (/^adverbs?/.test(h)) return 'ADV.'
  if (/^prep/.test(h)) return 'PREP.'
  if (/^phrases?/.test(h)) return 'PHRASES'
  if (/^nouns?/.test(h)) return `NOUN + ${headword.toUpperCase()}`
  return heading.toUpperCase()
}

/** Forms of the headword to cut out of a Longman phrase ("happiness", "accompanied", "accompanies"). */
function headwordForms(headword: string): RegExp {
  const stem = headword.toLowerCase().replace(/(e|y)$/, '')
  return new RegExp(`\\b${stem}[a-z]*\\b`, 'i')
}

/** "great happiness" → "great"; "bring (somebody) happiness" → "bring (sb)"; phrases keep their full text. */
function collocateOf(phrase: string, headword: string, category: string): string[] {
  const short = phrase.replace(/\bsomebody\b/g, 'sb').replace(/\bsomething\b/g, 'sth')
  return short.split(/\s*\/\s*(?=[a-z(])/i).flatMap((variant) => {
    if (category === 'PHRASES') return [variant.trim()]
    const rest = variant.replace(headwordForms(headword), '~').replace(/\s+/g, ' ').trim()
    const item = rest.replace(/^~\s*|\s*~$/g, '').trim()
    return item && item !== '~' ? [item.replace(/\s*~\s*/g, ' ~ ')] : []
  })
}

/** Longman ColloBox groups as an OzdicEntry ("oxford" = reliable dictionary data), or null when there are none. */
export function longmanAsEntry(entry: LongmanEntry): OzdicEntry | null {
  const senses = entry.entries
    .filter((h) => h.collocations.length)
    .map((h) => ({
      gloss: h.pos.length ? `(${h.pos[0]}.)` : '',
      groups: h.collocations.map((section): CollocationGroup => {
        const category = categoryOf(section.heading, h.headword || entry.word)
        return {
          category,
          items: [...new Set(section.collocates.flatMap((c) => collocateOf(c.phrase, h.headword || entry.word, category)))],
          examples: section.collocates.flatMap((c) => c.examples.slice(0, 1)).slice(0, 3),
        }
      }),
    }))
  if (!senses.length) return null
  return {
    word: entry.word,
    url: entry.url,
    found: true,
    oxford: true,
    sources: ['longman'],
    pos: [...new Set(entry.entries.flatMap((h) => h.pos))],
    senses,
    examples: [],
    definitions: entry.entries.flatMap((h) => h.senses.slice(0, 3).map((s) => ({ pos: h.pos[0] ?? '', gloss: s.definition }))),
  }
}

/** Longman entry as prompt text: senses, and the collocations box with glosses (and one example each when asked). */
export function formatLongman(entry: LongmanEntry, withExamples: boolean): string {
  const lines: string[] = []
  for (const h of entry.entries) {
    lines.push(`## ${h.headword} (${h.pos.join(', ') || '?'}) — Longman`)
    h.senses.slice(0, 6).forEach((s, n) => {
      const inline = s.inline.length ? ` [in use: ${s.inline.join(', ')}]` : ''
      lines.push(`Sense ${n + 1}${s.signpost ? ` (${s.signpost})` : ''}: ${s.definition}${s.grammar ? ` ${s.grammar}` : ''}${inline}`)
    })
    for (const section of h.collocations) {
      lines.push(`COLLOCATIONS · ${section.heading}:`)
      for (const c of section.collocates) {
        const example = withExamples && c.examples[0] ? ` — e.g. "${c.examples[0]}"` : ''
        lines.push(`- ${c.phrase}${c.gloss ? ` (= ${c.gloss})` : ''}${example}`)
      }
    }
  }
  return lines.join('\n')
}
