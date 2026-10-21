// Reads collocation data from public ozdic.com word pages (/word/<word>, allowed by robots.txt; /api/ is not used).
// The page is server-rendered by Nuxt: the full entry sits in <script id="__NUXT_DATA__"> as a "devalue" array,
// so no browser is needed. Results are cached on disk and requests are spaced out to be polite.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const CACHE_DIR = path.join(import.meta.dirname, '..', '..', 'cache', 'ozdic')
/** Bumped when the cached shape changes; older cache files are re-fetched (offline mode still uses them). */
const CACHE_VERSION = 2
/** Gap between two network requests; raise it for bulk jobs (OZDIC_GAP_MS=4000 for warm-cache). */
const MIN_GAP_MS = Number(process.env.OZDIC_GAP_MS) || 1500
/** After a block (403, bot challenge, repeated 429) no request is sent for this long. */
const BLOCK_PAUSE_MS = 15 * 60_000
const USER_AGENT = 'LinearThinking/1.0 (personal IELTS study app; cached, 1 request per 1.5s)'

export interface CollocationGroup {
  /** e.g. "ADJ.", "VERB + DECISION", "PREP.", "PHRASES" */
  category: string
  /** Every collocate listed in the group, as written ("carry out", "~ into/on", "present (sb with)"). */
  items: string[]
  examples: string[]
}

export interface CollocationSense {
  /** e.g. "(verb.) deal with sth difficult"; empty when the entry has a single unnamed sense. */
  gloss: string
  groups: CollocationGroup[]
}

export interface OzdicEntry {
  word: string
  url: string
  found: boolean
  /** True when the collocations come from the Oxford Collocations Dictionary (reliable); otherwise they are mined. */
  oxford: boolean
  sources: string[]
  pos: string[]
  ipa?: { uk?: string; us?: string }
  senses: CollocationSense[]
  examples: string[]
  /** Dictionary meanings (Wiktionary/WordNet), a few per part of speech — to compare a word with its replacement. */
  definitions?: { pos: string; gloss: string }[]
  /** OZDIC could not be reached (rate limit, bot protection): no data, and nothing was cached. */
  unavailable?: boolean
  v?: number
}

/** OZDIC refused or challenged the request. Never cached; requests pause for a while. */
export class OzdicUnavailableError extends Error {}

/** Rebuilds the object graph from Nuxt's flattened "devalue" payload (values point at other indices). */
function hydrate(flat: unknown[]): unknown {
  const WRAPPERS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef', 'Set', 'Map', 'Date', 'NuxtError', 'Error'])
  const memo = new Map<number, unknown>()
  const visit = (i: number): unknown => {
    if (memo.has(i)) return memo.get(i)
    const v = flat[i]
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && WRAPPERS.has(v[0])) {
        const out = v.length > 1 ? visit(v[1] as number) : null
        memo.set(i, out)
        return out
      }
      const out: unknown[] = []
      memo.set(i, out)
      for (const x of v) out.push(typeof x === 'number' ? visit(x) : x)
      return out
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      memo.set(i, out)
      for (const [k, x] of Object.entries(v)) out[k] = typeof x === 'number' ? visit(x) : x
      return out
    }
    memo.set(i, v)
    return v
  }
  return visit(0)
}

type Raw = Record<string, any>

/** Parses one /word/<word> HTML page. Exported for tests (fed with saved pages). */
export function parseWordPage(html: string, word: string): OzdicEntry {
  const url = `https://ozdic.com/word/${encodeURIComponent(word)}`
  const match = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  const empty: OzdicEntry = { word, url, found: false, oxford: false, sources: [], pos: [], senses: [], examples: [] }
  if (!match) return empty
  const root = hydrate(JSON.parse(match[1])) as Raw
  const raw = root?.data?.[`word-${word}`] as Raw | undefined
  if (!raw || !Array.isArray(raw.collocations)) return empty

  const senses: CollocationSense[] = raw.collocations.map((block: Raw) => ({
    gloss: String(block.gloss ?? ''),
    groups: (block.groups ?? []).map((g: Raw) => ({
      category: String(g.cat ?? '').trim(),
      items: (g.clusters ?? []).flatMap((c: Raw) => (c.words ?? []).map(String)),
      examples: (g.clusters ?? []).map((c: Raw) => c.example).filter(Boolean).map(String),
    })),
  }))
  const sources: string[] = (raw.sources ?? []).map(String)
  return {
    word,
    url,
    found: senses.some((s) => s.groups.length > 0) || (raw.pos ?? []).length > 0,
    oxford: sources.includes('oxford-collocations'),
    sources,
    pos: (raw.pos ?? []).map((p: Raw) => String(p.p)),
    ipa: raw.ipa ? { uk: raw.ipa.uk, us: raw.ipa.us } : undefined,
    senses,
    examples: (raw.examples ?? []).map((e: Raw) => String(e.text).replace(/\s+/g, ' ').trim()),
    definitions: (raw.definitions ?? []).flatMap((d: Raw) =>
      (d.senses ?? []).slice(0, 3).map((s: Raw) => ({ pos: String(d.pos ?? ''), gloss: String(s.gloss ?? '').replace(/\s+/g, ' ').trim() })),
    ),
    v: CACHE_VERSION,
  }
}

let lastRequest = 0
let blockedUntil = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * One polite GET. Never tries to get around protection: a 429/503 is retried once after Retry-After; a 403, a second
 * 429 or a page without the data (a bot challenge) pauses all requests for BLOCK_PAUSE_MS.
 */
async function politeFetch(url: string): Promise<string> {
  const block = (reason: string): never => {
    blockedUntil = Date.now() + BLOCK_PAUSE_MS
    throw new OzdicUnavailableError(`${reason}; OZDIC requests paused for ${BLOCK_PAUSE_MS / 60_000} min`)
  }
  for (let attempt = 0; ; attempt++) {
    if (Date.now() < blockedUntil) throw new OzdicUnavailableError('OZDIC requests are paused after a block')
    const wait = lastRequest + MIN_GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequest = Date.now()
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, signal: AbortSignal.timeout(20_000) })
    if (res.status === 404) return ''
    if (res.status === 429 || res.status === 503) {
      if (attempt > 0) block(`HTTP ${res.status} twice`)
      await sleep(Math.min(Number(res.headers.get('retry-after')) || 30, 120) * 1000)
      continue
    }
    if (res.status === 403) block('HTTP 403 (bot protection)')
    if (!res.ok) throw new Error(`ozdic ${url}: HTTP ${res.status}`)
    const html = await res.text()
    // A Cloudflare challenge also answers 200: it must not be mistaken for "word not found".
    if (!html.includes('__NUXT_DATA__')) block('page without dictionary data (bot challenge?)')
    return html
  }
}

/**
 * Like `lookup`, but when a plural form has no Oxford data it tries the singular ("jobs" → "job", "cities" → "city"):
 * OZDIC's Oxford entries are keyed by the base form, while plural pages hold machine-mined data.
 */
export async function lookupLemma(word: string, options: { offline?: boolean } = {}): Promise<OzdicEntry> {
  const entry = await lookup(word, options)
  if (entry.oxford) return entry
  const w = word.trim().toLowerCase()
  const singulars = [w.endsWith('ies') ? `${w.slice(0, -3)}y` : '', w.endsWith('es') ? w.slice(0, -2) : '', w.endsWith('s') ? w.slice(0, -1) : ''].filter(
    (s) => s.length > 2,
  )
  for (const singular of singulars) {
    const alt = await lookup(singular, options)
    if (alt.oxford) return alt
  }
  return entry
}

/** Looks a lemma up on ozdic.com (cached). `offline` never touches the network. */
export async function lookup(word: string, { offline = false } = {}): Promise<OzdicEntry> {
  const key = word.trim().toLowerCase()
  const file = path.join(CACHE_DIR, `${key.replace(/[^a-z0-9'-]+/g, '_')}.json`)
  try {
    const cached = JSON.parse(await readFile(file, 'utf8')) as OzdicEntry
    if (offline || cached.v === CACHE_VERSION) return cached
  } catch {
    if (offline) return { word: key, url: `https://ozdic.com/word/${key}`, found: false, oxford: false, sources: [], pos: [], senses: [], examples: [] }
  }
  let html: string
  try {
    html = await politeFetch(`https://ozdic.com/word/${encodeURIComponent(key)}`)
  } catch (error) {
    // Refused / challenged, or the network dropped ("fetch failed", timeout): this word has no data, the review goes on.
    const network = error instanceof TypeError || /fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(String((error as Error).message))
    if (!(error instanceof OzdicUnavailableError) && !network) throw error
    console.warn(`[ozdic] ${key}: ${(error as Error).message}`)
    return { word: key, url: `https://ozdic.com/word/${key}`, found: false, oxford: false, unavailable: true, sources: [], pos: [], senses: [], examples: [] }
  }
  const entry: OzdicEntry = html
    ? parseWordPage(html, key)
    : { word: key, url: `https://ozdic.com/word/${key}`, found: false, oxford: false, sources: [], pos: [], senses: [], examples: [], v: CACHE_VERSION }
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(file, JSON.stringify(entry, null, 1))
  return entry
}
