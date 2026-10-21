// DOL English dictionary (tudien.dolenglish.vn): Vietnamese → English words and collocations, so a model answer can
// say the learner's Vietnamese idea with dictionary-attested English ("gánh nặng tài chính" → "financial burden",
// "thức khuya" → "stay up late"). Method and measurements: input-file/DOL-Dictionary-de-xuat.md.
//
// DOL's strength is long collocations ("giảm gánh nặng tài chính", "cạnh tranh gay gắt"), not single words, so the
// learner's Vietnamese is looked up in collocation-sized chunks (cut by the AI for Speaking, by code for Writing).
// Each chunk is matched three ways: on this machine against the full vnWord → url list (~71 requests, refreshed
// weekly: exact with diacritics, then without, then "contains", the dictionary phrases inside it, a fuzzy match on the
// string WITH diacritics); and through the search API, which also finds gapped matches and synonyms ("cạnh tranh rất
// gay gắt" → "cạnh tranh gay gắt", "tắc đường" → "ùn tắc giao thông") and returns whole entries — its hits are kept
// only when their Vietnamese really appears in the chunk. Longer matches rank first.
//
// Used on the owner's instruction for a personal, local-only study app (DOL's content is © DOL English; ask them
// before sharing anything built on it): public endpoints, honest User-Agent, ≤ 5 requests a second, everything cached
// in cache/dol/ (entries and searches re-read after 30 days), and any failure gives "no hint" instead of an error.
// DOL_LOOKUP=off disables network lookups (the cache is still used).
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DolNote, DolNoteRun, DolStatus } from '../../src/types/lookup.ts'
import { DolError, dolFailed, dolHealth, dolOk } from './dol-health.ts'
import type { DolHint } from '../../src/types/speaking.ts'

const CACHE_DIR = path.join(import.meta.dirname, '..', '..', 'cache', 'dol')
const LIST_FILE = path.join(CACHE_DIR, 'wordlist.json')
const ENTRY_DIR = path.join(CACHE_DIR, 'entries')
const SEARCH_DIR = path.join(CACHE_DIR, 'search')
const SITE = 'https://tudien.dolenglish.vn'
const API = 'https://api.dolenglish.vn/public'
const USER_AGENT = 'LinearThinking/1.0 (personal IELTS study app, local use only; cached, max 5 requests/s)'
const MIN_GAP_MS = Number(process.env.DOL_GAP_MS) || 200
const LIST_MAX_AGE_MS = 7 * 86_400_000
const ENTRY_MAX_AGE_MS = 30 * 86_400_000
const BLOCK_PAUSE_MS = 15 * 60_000

export const dolEnabled = () => (process.env.DOL_LOOKUP ?? 'on').toLowerCase() !== 'off'

/* ───────────── Network ───────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let lastRequest = 0
let queue: Promise<void> = Promise.resolve()
let blockedUntil = 0

/**
 * One GET, at most one start every MIN_GAP_MS. 403 / 429 pause all requests for a while; nothing retries around it.
 * Failures are DolErrors that say what went wrong (unreachable, refused, another status).
 */
async function get(url: string): Promise<Response> {
  if (Date.now() < blockedUntil) throw new DolError('blocked', 'DOL requests are paused after a refusal (403/429)')
  const turn = queue.then(async () => {
    const wait = lastRequest + MIN_GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequest = Date.now()
  })
  queue = turn
  await turn
  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/html' }, signal: AbortSignal.timeout(10_000) })
  } catch (error) {
    throw new DolError('network', `cannot reach DOL: ${(error as Error).message}`)
  }
  if (res.status === 403 || res.status === 429) {
    blockedUntil = Date.now() + BLOCK_PAUSE_MS
    throw new DolError('blocked', `HTTP ${res.status}; DOL requests paused for ${BLOCK_PAUSE_MS / 60_000} min`)
  }
  if (!res.ok) throw new DolError('http', `HTTP ${res.status} for ${url.replace(/\?.*/, '')}`)
  return res
}

/** The body as JSON; a page that is not JSON any more is a structure change. */
async function jsonOf<T>(res: Response, what: string): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    throw new DolError('format', `${what}: the answer is not JSON any more`)
  }
}

/* ───────────── Matching Vietnamese ───────────── */

const nfc = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
/** Without diacritics ("biến đổi khí hậu" → "bien doi khi hau"). */
const plain = (s: string) =>
  nfc(s)
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/đ/g, 'd')
const toks = (s: string) => s.match(/[\p{L}\p{N}]+/gu) ?? []

/** Similarity 0-1 from the edit distance, a swap of two letters counting as one edit ("nhgiệp" ~ "nghiệp"). */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  let before = Array.from({ length: b.length + 1 }, () => 0)
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1)
    }
    before = prev
    prev = row
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length, 1)
}

/** `needle`'s words appear in `hay` as a whole-word run. */
function containsRun(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, k) => hay[i + k] === w)) return true
  return false
}

interface ListItem {
  vi: string
  url: string
}

class LocalIndex {
  private exact = new Map<string, number[]>()
  private plainMap = new Map<string, number[]>()
  private byToken = new Map<string, number[]>()
  readonly items: ListItem[]

  constructor(items: ListItem[]) {
    this.items = items
    const push = (map: Map<string, number[]>, key: string, i: number) => {
      const list = map.get(key)
      if (list) list.push(i)
      else map.set(key, [i])
    }
    items.forEach((item, i) => {
      push(this.exact, item.vi, i)
      const p = plain(item.vi)
      push(this.plainMap, p, i)
      for (const t of new Set(toks(p))) push(this.byToken, t, i)
    })
  }

  /** Entries spelled exactly like this (with diacritics). */
  exactItems(vi: string): ListItem[] {
    return (this.exact.get(nfc(vi)) ?? []).map((i) => this.items[i])
  }

  search(query: string, k = 3): ListItem[] {
    const qx = nfc(query)
    const qp = plain(query)
    // 1. Exact with diacritics: only that ("chạy" must not bring "cháy", "chày").
    const exact = this.exact.get(qx)
    if (exact) return exact.slice(0, k).map((i) => this.items[i])
    const out: number[] = []
    const add = (ids: Iterable<number>) => {
      for (const i of [...ids].sort((a, b) => this.items[a].vi.length - this.items[b].vi.length)) {
        if (out.length >= k) return
        if (!out.includes(i)) out.push(i)
      }
    }
    // 2. Without diacritics (typed without accents). A query typed WITH them must still be close with them: "hại mắt"
    // is not "hai mặt" (two-faced).
    const typedPlain = qx === qp
    add((this.plainMap.get(qp) ?? []).filter((i) => typedPlain || similarity(qx, this.items[i].vi) >= 0.85))
    // 3. Entries that contain the query as whole words, shortest first.
    const qt = toks(qp)
    if (out.length < k && qt.length) {
      const lists = qt.map((t) => this.byToken.get(t) ?? []).sort((a, b) => a.length - b.length)
      const rest = lists.slice(1).map((l) => new Set(l))
      const shared = lists[0].filter((i) => rest.every((s) => s.has(i)))
      const qxt = toks(qx)
      add(shared.filter((i) => containsRun(toks(this.items[i].vi), qxt)))
    }
    if (out.length) return out.map((i) => this.items[i])
    // 4. Long text: the dictionary phrases inside it, longest first.
    if (qt.length >= 3) {
      for (const phrase of this.phrasesIn(query)) add(this.exact.get(phrase) ?? [])
      if (out.length) return out.map((i) => this.items[i])
    }
    // 5. Typos: fuzzy, but scored on the string WITH diacritics ("tắc đường" vs "tà dương" is 0.94 without them).
    const pool = new Set(qt.flatMap((t) => (this.byToken.get(t) ?? []).slice(0, 4000)))
    const scored = [...pool]
      .filter((i) => Math.abs(this.items[i].vi.length - qx.length) <= Math.max(3, qx.length * 0.3))
      .map((i) => ({ i, score: similarity(qx, this.items[i].vi) }))
      .filter((x) => x.score >= 0.85)
      .sort((a, b) => b.score - a.score)
    add(scored.map((x) => x.i))
    return out.map((i) => this.items[i])
  }

  /**
   * For the header lookup: several entries, best first — spelled exactly like the query, then alike without diacritics
   * (a query typed with them must stay close with them: "hại mắt" is not "hai mặt"), then entries holding the query as
   * whole words (shortest first: "đàm phán" → "đàm phán thương mại"), then close spellings (typos).
   */
  lookup(query: string, k = 6): ListItem[] {
    const qx = nfc(query)
    const qp = plain(query)
    const typedPlain = qx === qp
    const out: number[] = []
    const add = (ids: Iterable<number>) => {
      for (const i of [...ids].sort((a, b) => this.items[a].vi.length - this.items[b].vi.length)) {
        if (out.length >= k) return
        if (!out.includes(i)) out.push(i)
      }
    }
    add(this.exact.get(qx) ?? [])
    add((this.plainMap.get(qp) ?? []).filter((i) => typedPlain || similarity(qx, this.items[i].vi) >= 0.85))
    const qt = toks(qp)
    if (out.length < k && qt.length) {
      const lists = qt.map((t) => this.byToken.get(t) ?? []).sort((a, b) => a.length - b.length)
      const rest = lists.slice(1).map((l) => new Set(l))
      const shared = lists[0].filter((i) => rest.every((s) => s.has(i)))
      const needle = typedPlain ? qt : toks(qx)
      add(shared.filter((i) => containsRun(toks(typedPlain ? plain(this.items[i].vi) : this.items[i].vi), needle)))
    }
    if (out.length < k && qt.length && qx.length >= 4) {
      const pool = new Set(qt.flatMap((t) => (this.byToken.get(t) ?? []).slice(0, 4000)))
      add(
        [...pool]
          .filter((i) => Math.abs(this.items[i].vi.length - qx.length) <= Math.max(3, qx.length * 0.3))
          .map((i) => ({ i, score: similarity(typedPlain ? qp : qx, typedPlain ? plain(this.items[i].vi) : this.items[i].vi) }))
          .filter((x) => x.score >= 0.85)
          .sort((a, b) => b.score - a.score)
          .map((x) => x.i),
      )
    }
    return out.map((i) => this.items[i])
  }

  /** Dictionary phrases (2+ syllables) inside a text, longest first, without overlaps. */
  phrasesIn(text: string, maxWords = 6): string[] {
    const words = toks(nfc(text))
    const found: { at: number; n: number; phrase: string }[] = []
    const taken = new Set<number>()
    for (let n = Math.min(maxWords, words.length); n >= 2; n--) {
      for (let at = 0; at + n <= words.length; at++) {
        if ([...Array(n).keys()].some((d) => taken.has(at + d))) continue
        const phrase = words.slice(at, at + n).join(' ')
        if (!this.exact.has(phrase)) continue
        found.push({ at, n, phrase })
        for (let d = 0; d < n; d++) taken.add(at + d)
      }
    }
    return found.sort((a, b) => b.n - a.n || a.at - b.at).map((f) => f.phrase)
  }
}

/* ───────────── The word list ───────────── */

interface WordListFile {
  fetchedAt: string
  items: [vi: string, url: string][]
}

let index: LocalIndex | null = null
let loading: Promise<LocalIndex | null> | null = null
let downloading: Promise<void> | null = null

type ListPage = { pageProps?: { pageData?: { content?: { url?: string; vnWord?: string }[]; last?: boolean } } }

/**
 * The word list is not an API: the "newest words" page's Next.js data (its buildId read from the page's HTML, then a
 * JSON per page). Each step that finds nothing it knows is a structure change (DOL rebuilt or redesigned the page).
 */
async function listBuildId(): Promise<string> {
  const html = await (await get(`${SITE}/danh-sach-tu-moi-nhat/0`)).text()
  const data = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  let buildId: string | undefined
  try {
    buildId = data ? (JSON.parse(data[1]) as { buildId?: string }).buildId : undefined
  } catch {
    buildId = undefined
  }
  if (!buildId) throw new DolError('format', 'the word-list page has no __NEXT_DATA__ buildId any more (page redesigned)')
  return buildId
}

async function listPage(buildId: string, page: number): Promise<{ content: { url?: string; vnWord?: string }[]; last: boolean }> {
  const json = await jsonOf<ListPage>(await get(`${SITE}/_next/data/${buildId}/danh-sach-tu-moi-nhat/${page}.json`), 'word-list page')
  const pageData = json.pageProps?.pageData
  if (!pageData || !Array.isArray(pageData.content)) throw new DolError('format', `word-list page ${page}: no pageProps.pageData.content any more`)
  if (page === 0 && !pageData.content.some((c) => c.url && c.vnWord)) throw new DolError('format', 'word-list page 0: items have no url / vnWord any more')
  return { content: pageData.content, last: Boolean(pageData.last) }
}

async function downloadList(): Promise<void> {
  const buildId = await listBuildId()
  const items: [string, string][] = []
  for (let page = 0; page < 300; page++) {
    const pageData = await listPage(buildId, page)
    for (const c of pageData.content) if (c.url && c.vnWord) items.push([nfc(c.vnWord), c.url])
    if (pageData.last || !pageData.content.length) break
  }
  if (items.length < 1000) throw new DolError('format', `word list too short (${items.length} words): the list pages changed`)
  dolOk('list')
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(LIST_FILE, JSON.stringify({ fetchedAt: new Date().toISOString(), items } satisfies WordListFile))
  index = new LocalIndex(items.map(([vi, url]) => ({ vi, url })))
  console.log(`[dol] word list: ${items.length} entries`)
}

/** Downloads the word list in the background (once at a time); lookups use the search API meanwhile. */
function refreshList(): void {
  if (downloading || !dolEnabled()) return
  downloading = downloadList()
    .catch((error: Error) => dolFailed('list', error))
    .finally(() => (downloading = null))
}

/** The local index: from memory, else from cache/dol/wordlist.json (refreshed weekly in the background), else null
 * while the first download runs. Call early (when a job starts) so it is ready by the time it is needed. */
export function dolIndex(): Promise<LocalIndex | null> {
  if (index) return Promise.resolve(index)
  loading ??= (async () => {
    try {
      const file = JSON.parse(await readFile(LIST_FILE, 'utf8')) as WordListFile
      index = new LocalIndex(file.items.map(([vi, url]) => ({ vi, url })))
      if (Date.now() - Date.parse(file.fetchedAt) > LIST_MAX_AGE_MS) refreshList()
      return index
    } catch {
      refreshList()
      return null
    } finally {
      loading = null
    }
  })()
  return loading
}

/* ───────────── Entries ───────────── */

interface DolEntry {
  url: string
  vi: string
  en: string
  pos: string[]
  pronounce?: string
  definitionVi?: string
  sameVi?: string
  sameEn?: string
  examples: { vi: string; en: string }[]
  /** "Ghi chú": the synonyms told apart (detail API only; the search API has none). */
  note?: DolNote
  /** 2: read by the detail API with its note; older cached entries (or search hits) are read again when needed. */
  v?: 2
  fetchedAt: string
}

/**
 * The note as DOL stores it — Slate rich text: paragraphs of runs (bold, italic, a red underline for "Phân biệt:" /
 * "Ví dụ:") and ✅ icons — as lines of runs. Undefined when there is none or it cannot be read.
 */
function noteOf(raw: unknown): DolNote | undefined {
  let tree: unknown = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return undefined
    try {
      tree = JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  const lines: DolNoteRun[][] = [[]]
  const push = (run: DolNoteRun) => lines[lines.length - 1].push(run)
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown>
    if (n.type === 'ICON') return push({ text: '', check: true })
    if (typeof n.text === 'string') {
      n.text.split('\n').forEach((part, i) => {
        if (i) lines.push([])
        if (part)
          push({
            text: part,
            ...(n.bold ? { bold: true } : {}),
            ...(n.italic ? { italic: true } : {}),
            ...(n.UNDERLINE_COLOR || n.underline ? { label: true } : {}),
          })
      })
      return
    }
    if (Array.isArray(n.children)) {
      if (n.type && n.type !== 'p' && lines[lines.length - 1].length) lines.push([])
      walk(n.children)
      if (n.type === 'p') lines.push([])
    }
  }
  walk(tree)
  // Blank lines kept single (a paragraph break), none at the ends.
  const out = lines.filter((line, i) => line.some((r) => r.text.trim() || r.check) || (i > 0 && lines[i - 1].some((r) => r.text.trim() || r.check)))
  while (out.length && !out[0].length) out.shift()
  while (out.length && !out.at(-1)!.length) out.pop()
  return out.length ? out : undefined
}

/** The note as plain text for a prompt: the synonyms and what tells them apart, examples left out, about `max` long. */
export function noteText(note: DolNote | undefined, max = 360): string {
  if (!note) return ''
  const kept: string[] = []
  let inExample = false
  for (const line of note) {
    const plainLine = line.map((r) => (r.check ? '•' : r.text)).join('').trim()
    if (!plainLine) {
      inExample = false
      continue
    }
    // The examples under "Ví dụ:" (and their translations) are left out; a new synonym (✅) or label ends them.
    if (line.some((r) => r.check) || /^(Phân biệt|Lưu ý|Cách dùng)\s*:/i.test(plainLine)) inExample = false
    if (/^(Ví dụ|Example)s?\s*:/i.test(plainLine)) {
      inExample = true
      continue
    }
    if (inExample || line.every((r) => r.italic || !r.text.trim())) continue
    // DOL's opening line ("Cùng DOL phân biệt… nhé!", "Các cụm từ khác nhau… bạn nên biết nè!") says nothing.
    if ((!kept.length || /\bDOL\b/.test(plainLine)) && /(nhé|nè|nha)\s*!?$/i.test(plainLine)) continue
    kept.push(plainLine.replace(/^(Phân biệt)\s*:\s*/i, ''))
  }
  const text = kept.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text
}


const text = (v: unknown) =>
  typeof v === 'string'
    ? v
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : ''
const fileOf = (url: string) => path.join(ENTRY_DIR, `${url.replace(/[^a-z0-9-]+/gi, '_').slice(0, 150)}.json`)

async function saveEntry(e: DolEntry): Promise<void> {
  await mkdir(ENTRY_DIR, { recursive: true })
  await writeFile(fileOf(e.url), JSON.stringify(e, null, 1))
}

/** The detail API and the search API return the same entry under different field names. */
function entryOf(
  url: string,
  f: { vi: unknown; en: unknown; pos: unknown; pronounce: unknown; definition: unknown; sameVi: unknown; sameEn: unknown; examples: unknown },
): DolEntry | null {
  const en = text(f.en)
  if (!en) return null
  const examples = (Array.isArray(f.examples) ? f.examples : [])
    .map((x) => {
      // Search results hold each example as a JSON string.
      const ex = (typeof x === 'string' ? JSON.parse(x) : x) as Record<string, unknown>
      return { vi: text(ex.viExample), en: text(ex.enExample) }
    })
    .filter((x) => x.en)
  return {
    url,
    vi: text(f.vi),
    en,
    pos: Array.isArray(f.pos) ? f.pos.map(String) : text(f.pos) ? [text(f.pos)] : [],
    ...(text(f.pronounce) ? { pronounce: text(f.pronounce) } : {}),
    ...(text(f.definition) ? { definitionVi: text(f.definition) } : {}),
    ...(text(f.sameVi) ? { sameVi: text(f.sameVi) } : {}),
    ...(text(f.sameEn) ? { sameEn: text(f.sameEn) } : {}),
    examples,
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * One entry by its url (cached; re-read after 30 days, or once when the cached copy predates notes; the stale copy
 * when DOL cannot be reached).
 */
async function entry(url: string): Promise<DolEntry | null> {
  let cached: DolEntry | null = null
  try {
    cached = JSON.parse(await readFile(fileOf(url), 'utf8')) as DolEntry
    if (cached.v === 2 && Date.now() - Date.parse(cached.fetchedAt) < ENTRY_MAX_AGE_MS) return cached
  } catch {
    // not cached yet
  }
  if (!dolEnabled()) return cached
  try {
    const d = await jsonOf<Record<string, unknown>>(await get(`${API}/page-management/api/dictionary/${encodeURIComponent(url)}`), 'entry')
    // The entry answered without the fields the app reads: DOL renamed them.
    if (!d || typeof d !== 'object' || !('viWord' in d) || !('enWord' in d))
      throw new DolError('format', `entry "${url}": no viWord / enWord any more (fields: ${Object.keys(d ?? {}).slice(0, 12).join(', ')})`)
    const fresh = entryOf(url, {
      vi: d.viWord,
      en: d.enWord,
      pos: d.partOfSpeech,
      pronounce: d.pronounce,
      definition: d.vnDefinition,
      sameVi: d.sameVIWord,
      sameEn: d.sameENWord,
      examples: d.examples,
    })
    if (fresh) {
      const note = noteOf(d.note)
      if (note) {
        fresh.note = note
        dolOk('note')
      } else if (typeof d.note === 'string' && d.note.trim().startsWith('[')) {
        // A note is there but not in the rich-text shape the app reads.
        dolFailed('note', new DolError('format', `entry "${url}": the note is not Slate rich text any more`))
      }
      fresh.v = 2
    }
    dolOk('entry')
    if (!fresh) return cached
    await saveEntry(fresh)
    return fresh
  } catch (error) {
    dolFailed('entry', error)
    return cached
  }
}

/** A DOL entry by its url (header lookup): from the cache, fetched from DOL when missing or a month old. */
export const dolEntry = entry

/** A DOL entry from this machine's cache only — never fetched (previews in the lookup list). */
export async function cachedDolEntry(url: string): Promise<DolEntry | null> {
  try {
    return JSON.parse(await readFile(fileOf(url), 'utf8')) as DolEntry
  } catch {
    return null
  }
}

/** The entry's page on the DOL site. */
export const dolPage = (url: string) => `${SITE}/${url}`

export type { DolEntry }

/** A search hit: the full entry, and its Vietnamese synonyms (the search API indexes them). */
interface SearchHit {
  entry: DolEntry
  same: string[]
}

// "v2": ten hits per query (the first cached searches kept six).
const searchFile = (query: string) => path.join(SEARCH_DIR, `${createHash('sha1').update(`v2|${nfc(query)}`).digest('hex').slice(0, 20)}.json`)

/**
 * The search API (Elastic: finds long collocations, gapped matches such as "cạnh tranh rất gay gắt" → "cạnh tranh gay
 * gắt", synonyms such as "tắc đường" → "ùn tắc giao thông"). Each hit carries its whole entry, so it needs no detail
 * call; hits are cached as entries and the query's hit list for 30 days.
 */
async function search(query: string): Promise<SearchHit[]> {
  const file = searchFile(query)
  try {
    const cached = JSON.parse(await readFile(file, 'utf8')) as { fetchedAt: string; hits: SearchHit[] }
    if (Date.now() - Date.parse(cached.fetchedAt) < ENTRY_MAX_AGE_MS || !dolEnabled()) return cached.hits
  } catch {
    // not cached yet
  }
  if (!dolEnabled()) return []
  try {
    const res = await jsonOf<{ results?: Record<string, { raw?: unknown }>[] }>(
      await get(`${API}/search-transform/api/dictionary/result?${new URLSearchParams({ query, size: '10', page: '1' })}`),
      'search',
    )
    if (!res || !Array.isArray(res.results)) throw new DolError('format', 'search: the answer has no "results" list any more')
    // Results whose fields the app cannot read (url, vi_word, en_word renamed) would silently give no hints.
    if (res.results.length && !res.results.some((r) => r.url?.raw && r.vi_word?.raw && r.en_word?.raw))
      throw new DolError('format', `search: results have no url / vi_word / en_word any more (fields: ${Object.keys(res.results[0]).slice(0, 12).join(', ')})`)
    const hits: SearchHit[] = []
    for (const r of res.results ?? []) {
      const url = String(r.url?.raw ?? '').replace(/^\//, '')
      const e = url
        ? entryOf(url, {
            vi: r.vi_word?.raw,
            en: r.en_word?.raw,
            pos: r.type?.raw,
            pronounce: r.pronounce?.raw,
            definition: r.vn_definition?.raw,
            sameVi: r.same_viword?.raw,
            sameEn: r.same_enword?.raw,
            examples: r.examples?.raw,
          })
        : null
      if (!e?.vi) continue
      hits.push({ entry: e, same: (e.sameVi ?? '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean) })
      await saveEntry(e)
    }
    await mkdir(SEARCH_DIR, { recursive: true })
    await writeFile(file, JSON.stringify({ fetchedAt: new Date().toISOString(), hits }))
    dolOk('search')
    return hits
  } catch (error) {
    dolFailed('search', error)
    return []
  }
}

/* ───────────── Health ───────────── */

/** How DOL is doing for the app (the parts that failed last time, recent failures). */
export const dolStatus = () => dolHealth(dolEnabled())

/** A known entry, read live to check that DOL still works (never from the cache). */
const PROBE_ENTRY = 'ho-tro-lan-nhau-tieng-anh-la-gi'

/**
 * Checks every part live — the word-list page and its first JSON page, an entry with its note, a search — and records
 * each result; for "Kiểm tra lại" after a fix. Four requests, paced like the others.
 */
export async function dolSelfCheck(): Promise<DolStatus> {
  if (!dolEnabled()) return dolStatus()
  try {
    await listPage(await listBuildId(), 0)
    dolOk('list')
  } catch (error) {
    dolFailed('list', error)
  }
  try {
    await rm(fileOf(PROBE_ENTRY), { force: true })
    const e = await entry(PROBE_ENTRY)
    if (e && !e.note) dolFailed('note', new DolError('format', `entry "${PROBE_ENTRY}": its note is gone or unreadable`))
  } catch (error) {
    dolFailed('entry', error)
  }
  await rm(searchFile('đàm phán'), { force: true }).catch(() => {})
  await search('đàm phán')
  // The records are written a moment later.
  await sleep(50)
  return dolStatus()
}

/** Words a chunk may have inside a dictionary phrase ("cạnh tranh RẤT gay gắt"): degree, tense, plural, possession. */
const FILLER = new Set(
  'rất khá quá hơn lắm cực thật đã đang sẽ vẫn cũng đều lại còn những các mấy của cho được bị một này đó ấy nhiều ít'.split(' ').flatMap((w) => [w, plain(w)]),
)

/** `needle`'s words appear in `hay` in order, with at most `maxGap` filler words between two of them. */
function inOrder(hay: string[], needle: string[], maxGap = 2): boolean {
  if (!needle.length || needle.length > hay.length) return false
  for (let start = 0; start + needle.length <= hay.length; start++) {
    let at = start
    let ok = hay[start] === needle[0]
    for (const w of needle.slice(1)) {
      if (!ok) break
      let next = at + 1
      while (next < hay.length && next - at - 1 < maxGap && hay[next] !== w && FILLER.has(hay[next])) next++
      ok = hay[next] === w
      at = next
    }
    if (ok) return true
  }
  return false
}

/** Linking words and everyday phrases the dictionary also has, but that never need a hint. */
const COMMON = new Set(
  [
    'bởi vì', 'tuy nhiên', 'ngoài ra', 'vì vậy', 'do đó', 'mặc dù', 'nhưng mà', 'thật sự', 'rất nhiều', 'có thể', 'chúng ta',
    'chúng tôi', 'của mình', 'người ta', 'hơn nữa', 'bên cạnh đó', 'trong khi', 'ví dụ', 'chẳng hạn', 'cho nên', 'vì thế',
    'nói chung', 'tóm lại', 'đầu tiên', 'cuối cùng', 'thứ hai', 'một số', 'nhiều người', 'mọi người', 'bây giờ', 'hiện nay',
    'ngày nay', 'tôi nghĩ', 'theo tôi', 'quan trọng', 'vấn đề', 'như vậy', 'điều này', 'việc này', 'trở nên', 'bản thân',
    'ngày càng', 'càng ngày càng', 'more and more',
    // Ways of addressing people and phrases whose dictionary sense is rarely the one meant in an essay.
    'các em', 'các bạn', 'các con', 'chúng nó', 'bọn trẻ', 'bằng cách', 'có điều kiện', 'không có điều kiện', 'nhiều tháng',
    'nhiều năm', 'mỗi ngày', 'hằng ngày', 'một cách', 'nó cũng', 'cũng như',
  ].map(nfc),
)

interface Candidate {
  url: string
  vi: string
  /** Words of the chunk it covers. */
  size: number
  exact: boolean
  entry?: DolEntry
}

/**
 * Dictionary entries for one collocation-sized chunk of Vietnamese: the chunk itself (on this machine), the dictionary
 * phrases inside it, and the search API's hits whose Vietnamese — or a synonym — appears in the chunk in order (a
 * word or two may stand between: "cạnh tranh rất gay gắt") or contains it.
 */
async function candidatesFor(chunk: string, idx: LocalIndex | null): Promise<Candidate[]> {
  // A chunk typed with diacritics is compared with them ("vừa" is not "vữa" = mortar); one typed without, without.
  const form = nfc(chunk) === plain(chunk) ? plain : nfc
  const q = toks(form(chunk))
  const out = new Map<string, Candidate>()
  const add = (c: Candidate) => {
    const had = out.get(c.url)
    if (!had) out.set(c.url, c)
    else if (c.entry && !had.entry) had.entry = c.entry
  }
  if (idx) {
    for (const item of idx.search(chunk, 2)) {
      const v = toks(form(item.vi))
      // An entry that says more than the chunk does not translate it ("trên mạng" ≠ "lang thang trên mạng").
      if (v.length > q.length + 1 && inOrder(v, q, 0)) continue
      add({ url: item.url, vi: item.vi, size: Math.min(v.length, q.length), exact: v.join(' ') === q.join(' ') })
    }
    for (const phrase of idx.phrasesIn(chunk, 8)) {
      for (const item of idx.exactItems(phrase)) add({ url: item.url, vi: item.vi, size: toks(phrase).length, exact: phrase === q.join(' ') })
    }
  }
  const fits = (x: string[]) => inOrder(q, x) || (inOrder(x, q, 0) && x.length <= q.length + 1)
  for (const hit of await search(chunk)) {
    const v = toks(form(hit.entry.vi))
    // An entry that says more than the chunk does not translate it, even when one of its synonyms matches ("trên mạng"
    // is not "lang thang trên mạng" = surf the web).
    if (inOrder(v, q, 0) && v.length > q.length + 1) continue
    const matched = [v, ...hit.same.map((s) => toks(form(s)))].filter((x) => x.length && fits(x))
    if (!matched.length) continue
    add({
      url: hit.entry.url,
      vi: hit.entry.vi,
      size: Math.min(q.length, Math.max(...matched.map((x) => x.length))),
      exact: v.join(' ') === q.join(' '),
      entry: hit.entry,
    })
  }
  // A part of the chunk must not cut through another dictionary word: in "không có điều kiện", "có điều" (= however)
  // takes half of "điều kiện".
  const qx = toks(nfc(chunk))
  const cutsAWord = (c: Candidate) => {
    const v = toks(nfc(c.vi))
    // Only a short part can be such a slice; a long one ("trung tâm luyện thi" in "… luyện thi tốt") is the real phrase.
    if (!idx || v.length >= qx.length || v.length > 2) return false
    for (let at = 0; at + v.length <= qx.length; at++) {
      if (!v.every((w, k) => qx[at + k] === w)) continue
      const end = at + v.length
      const before = at > 0 && idx.exactItems(`${qx[at - 1]} ${qx[at]}`).length > 0
      const after = end < qx.length && idx.exactItems(`${qx[end - 1]} ${qx[end]}`).length > 0
      if (before || after) return true
    }
    return false
  }
  // Worth showing: not a linking phrase, and two words or more unless the chunk is one word ("vừa cười vừa khóc" must
  // not come back as "vừa" → "fit").
  return [...out.values()]
    .filter((c) => !COMMON.has(nfc(c.vi)) && (c.size >= 2 || q.length === 1) && !cutsAWord(c))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.size - a.size)
}

/** "Intense Competition" / "Traffic congestion" → lower case, as the words are used inside a sentence. */
function sentenceCase(en: string): string {
  const words = en.trim().split(/\s+/)
  if (/\b(I|Vietnam\w*|English|Tet|Lunar|Christmas|God|Internet)\b/.test(en) || words.some((w) => /^[A-Z]{2,}/.test(w))) return en.trim()
  const titled = words.every((w) => /^[A-Z][a-z'’-]*$/.test(w))
  const sentence = /^[A-Z][a-z'’-]*$/.test(words[0]) && words.slice(1).every((w) => !/^[A-Z]/.test(w))
  return titled || sentence ? en.trim().toLowerCase() : en.trim()
}

const hintOf = (query: string, e: DolEntry): DolHint => ({
  query,
  vi: e.vi,
  en: sentenceCase(e.en),
  ...(e.sameEn && nfc(e.sameEn) !== nfc(e.en) ? { alt: sentenceCase(e.sameEn) } : {}),
  ...(e.pos.length ? { pos: e.pos.join(', ').toLowerCase() } : {}),
  ...(e.definitionVi ? { definitionVi: e.definitionVi.slice(0, 220) } : {}),
  ...(e.examples[0] ? { example: e.examples[0] } : {}),
  ...(noteText(e.note, 260) ? { note: noteText(e.note, 260) } : {}),
  url: `${SITE}/${e.url}`,
})

/* ───────────── What features call ───────────── */

/**
 * English for collocation-sized chunks of the learner's Vietnamese ("giảm gánh nặng tài chính", "cạnh tranh gay gắt"),
 * longest dictionary matches first: up to two entries per chunk (the second only when it is a collocation of its own),
 * each entry once, at most `max`. Never throws.
 */
export async function dolHints(chunks: string[], { max = 14, near = 0 }: { max?: number; near?: number } = {}): Promise<DolHint[]> {
  const unique = [...new Map(chunks.map((t) => [nfc(t), t.trim()])).values()].filter((t) => t && /\p{L}/u.test(t)).slice(0, 20)
  if (!unique.length) return []
  const idx = await dolIndex()
  const perChunk = await Promise.all(
    unique.map(async (chunk) => {
      // The best match, and a second one when it is a collocation of its own or covers other words of the chunk
      // ("kẹt xe ở thành phố lớn" → "thành phố lớn" and "kẹt xe").
      const candidates = await candidatesFor(chunk, idx).catch(() => [])
      const first = candidates[0]
      const firstWords = new Set(first ? toks(nfc(first.vi)) : [])
      const second = candidates.slice(1).find((c) => c.size >= 3 || !toks(nfc(c.vi)).some((w) => firstWords.has(w)))
      const picked = [first, second].filter((c): c is Candidate => !!c)
      const words = toks(nfc(chunk)).length
      const strict = await Promise.all(
        picked.map(async (c): Promise<DolHint | null> => {
          // A search hit has no note: the entry itself is read (once, then cached) for it.
          const e = (c.entry?.v === 2 ? c.entry : await entry(c.url)) ?? c.entry
          // Only part of the chunk ("sử dụng" of "sử dụng điện thoại" → "use"): a neighbour, not its translation.
          return e ? { ...hintOf(chunk, e), match: c.size * 3 >= words * 2 ? 'exact' : 'near' } : null
        }),
      )
      return [...strict.filter((h): h is DolHint => !!h), ...(near ? await nearHits(chunk, near, new Set(picked.map((c) => c.url))) : [])]
    }),
  )
  const seen = new Set<string>()
  return perChunk
    .flat()
    .filter((h) => !seen.has(h.url) && !!seen.add(h.url))
    .slice(0, max)
}

/**
 * The search API's best neighbours of a chunk that share a word with it but are not its words ("sử dụng điện thoại" →
 * "chơi điện thoại" = use a phone for entertainment, "nghiện điện thoại" = phone addiction). Code cannot tell which one
 * means the learner's idea, so they go to the AI marked "near" and it picks.
 */
async function nearHits(chunk: string, count: number, skip: Set<string>): Promise<DolHint[]> {
  const q = new Set(toks(nfc(chunk)).filter((w) => !FILLER.has(w)))
  const shared = (vi: string) => new Set(toks(nfc(vi)).filter((w) => q.has(w))).size
  // Most words in common first ("chơi điện thoại" before "gọi điện"), then the search's own order.
  const hits = (await search(chunk))
    .filter((h) => !skip.has(h.entry.url) && !COMMON.has(nfc(h.entry.vi)) && toks(nfc(h.entry.vi)).length >= 2)
    .map((h, rank) => ({ h, rank, shared: shared(h.entry.vi) }))
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.rank - b.rank)
    .slice(0, count)
  return hits.map(({ h }) => ({ ...hintOf(chunk, h.entry), match: 'near' as const }))
}

/** Hints numbered for a prompt (d1, d2…), so the AI can say which ones say the learner's idea. */
export const numberHints = (hints: DolHint[]) => hints.map((h, i) => ({ ...h, ref: `d${i + 1}` }))

/**
 * The prompt block: each chunk with its entries — "exact" when the dictionary's words are the chunk's, "near" when the
 * search found a neighbour that may or may not mean the same thing.
 */
export function dolPromptBlock(hints: DolHint[]): string {
  const byChunk = new Map<string, DolHint[]>()
  for (const h of hints) byChunk.set(h.query, [...(byChunk.get(h.query) ?? []), h])
  return [...byChunk]
    .map(
      ([chunk, list]) =>
        `- "${chunk}": ${list
          .map((h) => `${h.ref ? `[${h.ref}] ` : ''}${h.vi} → ${h.en}${h.alt ? ` / ${h.alt}` : ''}${h.match === 'near' ? ' (near)' : ''}${h.match !== 'near' && h.example?.en ? ` (e.g. "${h.example.en}")` : ''}${h.match !== 'near' && h.note ? ` [DOL note: ${h.note}]` : ''}`)
          .join('; ')}`,
    )
    .join('\n')
}

/**
 * The hints the AI chose (by ref) — the ones that say part of the learner's idea exactly. With no choice made (an old
 * call, or none chosen), the exact matches.
 */
export function chosenHints(hints: DolHint[], refs: string[] | undefined): DolHint[] {
  const chosen = new Set((refs ?? []).map((r) => r.trim().toLowerCase()))
  const picked = hints.filter((h) => h.ref && chosen.has(h.ref))
  return (picked.length ? picked : hints.filter((h) => h.match !== 'near')).map(({ ref: _, ...h }) => h)
}

/** The rule that goes with dolPromptBlock in a system prompt. */
export const DOL_RULE = `When the prompt lists "Dictionary entries (DOL)" for the Vietnamese idea, each chunk of the idea comes with entries from a Vietnamese-English dictionary: exact ones (the dictionary's words are the chunk's) and "near" ones the dictionary's search found (a related phrase that may or may not mean the same: "nghiện điện thoại" = phone addiction is not "sử dụng điện thoại"). Prefer the English of an entry that says exactly what the candidate means — it is dictionary-attested and natural — and never use one that does not. An entry may carry a "DOL note" telling it apart from its synonyms (formal or informal, literal or figurative, which context): use it to pick the wording whose nuance fits the candidate's sentence and register — a synonym the note names may be the better choice. Report in "dol" the refs (d1, d2…) of every entry that says part of the candidate's idea exactly, used or not; leave out the rest.`

/**
 * How the AI cuts a learner's Vietnamese into lookup chunks (Speaking's analyze step, Writing Review's chunk step):
 * DOL knows long collocations far better than single words.
 */
export const viChunkRule = (max: number) =>
  `cut it into collocation-sized chunks for a Vietnamese-English collocation dictionary (it knows long phrases far better than single words): up to ${max} chunks of 2-6 words, each one natural unit of meaning — verb + object ("giảm gánh nặng tài chính", "tải đề thi cũ"), adjective / adverb + noun or verb ("cạnh tranh gay gắt", "học phí rẻ"), set expressions ("vừa cười vừa khóc", "thức khuya ôn thi"), situations ("kẹt xe ngày càng tệ", "giá xăng tăng"). Cover every idea in order; copy the words as written (same spelling and diacritics) but you may drop filler words inside a chunk (rất, đã, đang, những, các, của tôi); no pronouns or linking words at the edges; a single word only when it is specific and not basic`

/** Words that join clauses (longest first, so "vì vậy" wins over "vì"): a text is cut there and at punctuation. */
const JOINERS = new RegExp(
  `(?:^|\\s+)(?:${[
    'và', 'hoặc', 'nhưng', 'nhưng mà', 'vì', 'bởi vì', 'do', 'nên', 'cho nên', 'vì vậy', 'vì thế', 'do đó', 'để', 'khi', 'mà',
    'thì', 'nếu', 'tuy nhiên', 'bằng cách', 'cũng như', 'trong khi', 'mặc dù', 'dù', 'rằng', 'là vì', 'giúp', 'khiến', 'ngoài ra',
    'hơn nữa', 'ngày nay', 'hiện nay',
  ]
    .sort((a, b) => b.length - a.length)
    .join('|')})(?=\\s|$)`,
  'giu',
)

/**
 * A Vietnamese text cut into chunks for dictionary lookups: at punctuation and joining words, a long part into
 * overlapping 6-word windows (so no collocation is cut in two: "không có | điều kiện"). At most 20 chunks.
 */
export function vietnameseChunks(viText: string): string[] {
  return viText
    .normalize('NFC')
    .split(/[.,;:!?\n()"“”\-–—…]+/)
    .flatMap((clause) => clause.split(JOINERS))
    .flatMap((part) => {
      const words = (part ?? '').trim().split(/\s+/).filter(Boolean)
      if (words.length <= 7) return [words.join(' ')]
      const windows: string[] = []
      for (let at = 0; at < words.length - 2; at += 4) windows.push(words.slice(at, at + 6).join(' '))
      return windows
    })
    .filter((c) => toks(c).filter((w) => !FILLER.has(w)).length >= 2)
    .slice(0, 20)
}

/**
 * Hints for a Vietnamese text without an AI step (Writing Review): its chunks looked up as above. Code cuts the chunks
 * blindly, so only collocations are kept (3+ Vietnamese syllables, or English of 2+ words / hyphenated): "gánh nặng tài
 * chính" → "financial burden", not "học sinh" → "student".
 */
export async function dolHintsForText(viText: string, max = 14): Promise<DolHint[]> {
  if (!viText.trim()) return []
  const hints = await dolHints(vietnameseChunks(viText), { max: 40 })
  return hints.filter((h) => toks(nfc(h.vi)).length >= 3 || /[\s-]/.test(h.en.trim())).slice(0, max)
}
