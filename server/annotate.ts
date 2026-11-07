// The phrases of a finished text found and checked, one way for every page that shows one: Writing's model essay and
// the writer's own revision, Speaking's model answer and the learner's own revision. The text is final when it gets
// here (the writing steps are done); this module finds word combinations, looks them up in Longman / OZDIC and — for a
// text the AI wrote — replaces what the AI wrote that the dictionaries do not list. Steps:
// 1. [[ ]] stays only around library phrases and outside phrases (extras); any other [[ ]] is unwrapped and checked
//    like the rest of the text;
// 2. the AI lists the combinations sentence by sentence (one item per sentence, so none is skipped);
// 3. each one is placed in the sentence's own words and looked up (Longman, OZDIC, then DOL for the learner's idea);
// 4. a dictionary scan: every combination OZDIC lists for a word of the text is found by code, whatever the AI listed;
// 5. coverage: a sentence with fewer phrases than its length suggests is asked about again (twice at most);
// 6. a combination no dictionary lists is judged in its sentence: natural (shown apart from the doubtful ones) or
//    suspicious (with the reason); in a text the AI wrote, a suspicious one the AI wrote may become the learner's words
//    or a listed combination. The learner's own words are only judged, never changed.
import { z } from 'zod'
import type { CheckedWording, CoverageReport, DolHint, SpeakingExtra } from '../src/types/speaking.ts'
import { lookup, lookupLemma, type OzdicEntry } from './writing-review/ozdic.ts'
import {
  CheckSchema,
  dictionaries,
  FUNCTION_WORDS,
  lemmaCandidates,
  listLines,
  newContentWords,
  proofOf,
  verifyPhrase,
  type DictionaryCheck,
  type RewriteIssue,
} from './writing-review/rewrite.ts'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** A model that returns JSON for a Zod schema: Writing's LlmProvider, or Speaking's call wrapped in the same shape. */
export interface JsonModel {
  json<T>(request: { label: string; system: string; prompt: string; schema: z.ZodType<T>; effort?: Effort }): Promise<{ value: T }>
}

/* ───────────── Text helpers ───────────── */

export const plainOf = (marked: string) => marked.replace(/\[\[|\]\]|\{\{|\}\}/g, '')
/** Lower case with straight apostrophes: same length as the input, so offsets still match. */
export const fold = (text: string) => text.toLowerCase().replace(/[’‘]/g, "'")
const stem = (w: string) => (w.length <= 4 ? w : w.replace(/ies$/, 'y').replace(/(ing|ed|es|s)$/, '') || w)
const FILLER = new Set('a an the their his her its our my your them this these those sb sth one someone something'.split(' '))
const contentStemsOf = (text: string) => (fold(text).match(/[a-z']+/g) ?? []).filter((w) => w.length > 2 && !FILLER.has(w)).map(stem)

/** A marked sentence as plain text with the spans of its [[ ]] phrases and {{ }} frames. */
function parseMarked(marked: string): { plain: string; spans: { start: number; end: number; kind: 'phrase' | 'frame'; text: string }[] } {
  let plain = ''
  const spans: { start: number; end: number; kind: 'phrase' | 'frame'; text: string }[] = []
  for (const part of marked.split(/(\[\[[\s\S]*?\]\]|\{\{[\s\S]*?\}\})/).filter(Boolean)) {
    const phrase = part.startsWith('[[') && part.endsWith(']]')
    const frame = part.startsWith('{{') && part.endsWith('}}')
    const text = phrase || frame ? part.slice(2, -2) : plainOf(part)
    if (phrase || frame) spans.push({ start: plain.length, end: plain.length + text.length, kind: phrase ? 'phrase' : 'frame', text })
    plain += text
  }
  return { plain, spans }
}

/** Two phrases say the same thing: one holds the other, or they share most content words ("cutoff scores" / "cutoff score"). */
export function samePhrase(a: string, b: string): boolean {
  const x = fold(a).trim()
  const y = fold(b).trim()
  if (x.length < 3 || y.length < 3) return false
  if (x.includes(y) || y.includes(x)) return true
  const s = contentStemsOf(a)
  const t = new Set(contentStemsOf(b))
  return s.length > 0 && s.filter((w) => t.has(w)).length / Math.min(s.length, t.size || 1) >= 0.4
}

/** Removes [[ ]] / {{ }} markers left without their partner (an edit can cut through a marked phrase). */
function balanceMarkers(text: string): string {
  const tokens = text.split(/(\[\[|\]\]|\{\{|\}\})/)
  const keep = tokens.map(() => true)
  const open: Record<string, number | undefined> = {}
  const opener: Record<string, string> = { ']]': '[[', '}}': '{{' }
  tokens.forEach((t, i) => {
    if (t === '[[' || t === '{{') {
      if (open[t] !== undefined) keep[open[t]!] = false
      open[t] = i
    } else if (t === ']]' || t === '}}') {
      if (open[opener[t]] === undefined) keep[i] = false
      else open[opener[t]] = undefined
    }
  })
  for (const t of ['[[', '{{']) if (open[t] !== undefined) keep[open[t]!] = false
  return tokens.filter((_, i) => keep[i]).join('')
}

/** Replaces `original` (matched on the text without markers, ignoring case) in a marked sentence; null when absent. */
export function replaceInMarked(raw: string, original: string, replacement: string): string | null {
  const map: number[] = []
  let plain = ''
  for (let i = 0; i < raw.length; ) {
    if (/^(\[\[|\]\]|\{\{|\}\})/.test(raw.slice(i, i + 2))) {
      i += 2
      continue
    }
    map.push(i)
    plain += raw[i]
    i++
  }
  const at = original ? plain.toLowerCase().indexOf(original.toLowerCase()) : -1
  if (at < 0) return null
  return balanceMarkers(raw.slice(0, map[at]) + replacement + raw.slice(map[at + original.length - 1] + 1))
}

/* ───────────── The learner's words ───────────── */

/** A run of spaces as one, quotes straightened: the only ways a marked sentence may differ from the writer's text. */
function normalized(text: string): { norm: string; at: number[] } {
  let norm = ''
  const at: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (norm && !norm.endsWith(' ')) {
        norm += ' '
        at.push(i)
      }
      continue
    }
    norm += text[i].replace(/[’‘]/, "'").replace(/[“”]/, '"')
    at.push(i)
  }
  return { norm: norm.trimEnd(), at }
}

/**
 * The writer's text, word for word: each sentence the model marked must read, without its brackets, as the next piece
 * of the writer's text (only spaces and quote styles may differ). A sentence that does not (a word changed, added or
 * dropped) becomes the writer's own words for that piece, unmarked, and text the model left out comes back as a
 * sentence of its own. `restored` counts both.
 */
export function keepWritersText<T extends { marked: string }>(
  text: string,
  sentences: T[],
  extra: (marked: string) => T,
): { sentences: T[]; restored: number } {
  const { norm, at } = normalized(text)
  const original = (from: number, to: number) => (to > from ? text.slice(at[from], at[to - 1] + 1).replace(/\s+/g, ' ').trim() : '')
  const said = sentences.map((s) => normalized(plainOf(s.marked)).norm.trim())
  const out: T[] = []
  let restored = 0
  let cursor = 0
  for (let i = 0; i < sentences.length; i++) {
    if (!said[i]) continue
    while (norm[cursor] === ' ') cursor++
    // Intact here, or intact further on after words the model left out (those come back as their own sentence) — unless
    // a later sentence comes first, which means this one was changed and only matches further on by chance.
    const posOf = (k: number) => (said[k] ? norm.indexOf(said[k], cursor) : -1)
    const found = posOf(i)
    const overtaken = said.some((_, k) => k > i && posOf(k) >= 0 && posOf(k) < found)
    if (found >= 0 && !overtaken) {
      const gap = original(cursor, found)
      if (gap) {
        out.push(extra(gap))
        restored++
      }
      out.push(sentences[i])
      cursor = found + said[i].length
      continue
    }
    // Up to where the next sentence the model kept intact begins (or the end).
    let end = norm.length
    for (let j = i + 1; j < sentences.length; j++) {
      const next = said[j] ? norm.indexOf(said[j], cursor) : -1
      if (next >= 0) {
        end = next
        break
      }
    }
    const piece = original(cursor, end)
    if (piece) {
      out.push({ ...sentences[i], marked: piece })
      restored++
    }
    cursor = end
  }
  while (norm[cursor] === ' ') cursor++
  const rest = original(cursor, norm.length)
  if (rest) {
    out.push(extra(rest))
    restored++
  }
  return { sentences: out, restored }
}

/** Hover note of wording Longman / OZDIC do not list, saying whose words they are. */
const NOT_LISTED = 'Longman và OZDIC không liệt kê cụm này'
const yourNote = () => `${NOT_LISTED}: cụm bạn tự viết.`
/** In a text the AI wrote: the learner's own words (draft, idea), or the AI's. */
const aiTextNote = (learnerText: string[]) => {
  const written = fold(learnerText.join(' '))
  return (text: string) => (written.includes(fold(text)) ? `${NOT_LISTED}: cụm lấy từ bản nháp của bạn.` : `${NOT_LISTED}: AI tự viết.`)
}

/* ───────────── DOL as a third dictionary ───────────── */

/** Lower-case words with simple endings removed, as Speaking's ranking does ("paintings", "painted" → "paint"). */
const dolStems = (text: string) =>
  (text.toLowerCase().match(/[a-z]+/g) ?? []).map((w) => (w.length <= 4 ? w : w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') || w))
const DOL_STOP = new Set(dolStems('a an the to of in on at for by with from as and or but is are be do does it its you your sb sth one'))
const dolContent = (text: string) => dolStems(text).filter((w) => !DOL_STOP.has(w) && w.length > 1)

export type Proof = { dictionary: string[]; sources: { name: 'Longman' | 'OZDIC' | 'DOL'; url: string }[] }

/**
 * DOL as a third dictionary: a phrase that is the DOL translation of the learner's own Vietnamese ("cutoff scores" for
 * "điểm chuẩn" → "admission cutoff score") is attested for exactly this idea, even when Longman / OZDIC do not list the
 * combination — so it is never swapped for a "listed" phrase that means something else.
 */
export function dolProof(phrase: string, hints: DolHint[]): Proof | null {
  const p = dolContent(phrase)
  const hit = hints.find((h) => {
    const e = dolContent(h.en)
    const [small, large] = p.length <= e.length ? [p, e] : [e, p]
    return small.length > 0 && (small.length >= 2 || large.length === 1) && large.length - small.length <= 1 && small.every((w) => large.includes(w))
  })
  return hit ? { dictionary: [`DOL · ${hit.vi} → ${hit.en}`], sources: [{ name: 'DOL', url: hit.url }] } : null
}

/* ───────────── Listing (AI) and placing ───────────── */

export const WordingItemSchema = z.object({
  sentence: z.number().int().describe('Sentence number (1-based).'),
  text: z.string().describe('The collocation or verb pattern, copied exactly as written in that sentence (same inflection), 2-5 words.'),
  meaning_vi: z.string().optional().describe('Vietnamese meaning.'),
  checks: z.array(CheckSchema),
})
export type RawWording = z.infer<typeof WordingItemSchema>

const ListingSchema = z.object({
  sentences: z.array(
    z.object({
      n: z.number().int().describe('Sentence number.'),
      items: z.array(
        z.object({
          text: z.string().describe('Copied exactly as written in that sentence (same inflection), 2-5 words, no brackets.'),
          meaning_vi: z.string().optional().describe('Its Vietnamese meaning in this sentence, short (2-8 words).'),
          checks: z.array(CheckSchema),
        }),
      ),
    }),
  ),
})

const LISTING_SYSTEM = (kind: string) => `You list the word combinations in ${kind} so a learner can look them up in Longman and the Oxford Collocations Dictionary (OZDIC).
Go through EVERY sentence asked for and give one item per sentence (its number n), with items [] only when the sentence truly has none.
In each sentence go through it word by word and list every natural combination a learner should notice — usually 2-4 in a sentence of 15 words or more:
  * each verb with its object or complement (verb + noun: "fixed the leaking roof", "cut household costs", "spent hours on");
  * each adjective with its noun ("heavy traffic", "a narrow escape"), each adverb with its verb or adjective ("deeply moved", "highly recommend");
  * verb + preposition ("cope with"), noun + noun ("job security"), fixed verb patterns and idioms ("take part in", "from scratch").
Skip only pairs nobody would look up ("very good", "go home").
Words inside [[ ]] (suggested phrases) and {{ }} (sentence frames) are already covered: never list them or any words inside them.
- text: copied exactly as it appears in that sentence (same inflection; articles and pronouns kept), 2-5 words, no brackets.
- meaning_vi: its Vietnamese meaning in this sentence, short (2-8 words), for every item ("pay the bills" → "trả các hóa đơn").
- checks: for a collocation dictionary: base = lemma of the headword whose entry lists the combination (the noun for verb+noun, adjective+noun and noun+noun; the verb for verb+preposition and verb+adverb; the adjective for adverb+adjective), collocate = lemma of the partner word, pattern.`

/**
 * Where a combination the model listed sits in the text, in the sentence's own words: the sentence it named first,
 * then any other; an exact match first, then the shortest run of words that has its content words in order, at most
 * two words apart ("pester parents" finds "pester their parents"). Undefined when it is not in the text.
 */
function placeWording(sentences: string[], w: { sentence: number; text: string }): { sentence: number; text: string } | undefined {
  const target = fold(plainOf(w.text).trim().replace(/\s+/g, ' ')).replace(/^[,.;:]+|[,.;:]+$/g, '')
  if (!target) return undefined
  const order = [w.sentence - 1, ...sentences.keys()].filter((i, k, all) => i >= 0 && i < sentences.length && all.indexOf(i) === k)
  for (const i of order) {
    const at = fold(sentences[i]).indexOf(target)
    if (at >= 0) return { sentence: i + 1, text: sentences[i].slice(at, at + target.length) }
  }
  const want = (target.match(/[a-z']+/g) ?? []).filter((x) => !FILLER.has(x)).map(stem)
  if (want.length < 2) return undefined
  for (const i of order) {
    const words = [...sentences[i].matchAll(/[A-Za-z’']+/g)]
    for (let s = 0; s < words.length; s++) {
      if (stem(fold(words[s][0])) !== want[0]) continue
      let found = 1
      let end = s
      for (let j = s + 1; j < words.length && j - end <= 3 && found < want.length; j++) {
        if (stem(fold(words[j][0])) === want[found]) {
          found++
          end = j
        }
      }
      if (found === want.length) {
        return { sentence: i + 1, text: sentences[i].slice(words[s].index, words[end].index + words[end][0].length) }
      }
    }
  }
  return undefined
}

/* ───────────── What was found ───────────── */

/** A combination found in the text (0-based sentence) and what the dictionaries say about it. */
interface Found {
  sentence: number
  text: string
  original?: string
  meaning_vi?: string
  verified: boolean
  proof: Proof
  /** The lookup, with the dictionaries' lists (the fix step shows them); absent for a scan hit. */
  issue?: RewriteIssue
  /** Found by the dictionary scan (listed by construction). */
  scanned?: boolean
  /** Not listed, but judged natural in its sentence. */
  natural?: boolean
  /** Not listed and judged suspicious: why (Vietnamese). */
  why?: string
}

const toChecked = (f: Found): CheckedWording => ({
  text: f.text,
  ...(f.original ? { original: f.original } : {}),
  ...(f.meaning_vi ? { meaning_vi: f.meaning_vi } : {}),
  verified: f.verified,
  ...(!f.verified && f.natural ? { natural: true } : {}),
  ...(!f.verified && f.why ? { why: f.why } : {}),
  dictionary: f.proof.dictionary,
  sources: f.proof.sources,
})

/** Where a found combination sits in its sentence's plain text (-1 when no longer there). */
const spanOf = (f: Found, plains: string[]) => {
  const at = fold(plains[f.sentence] ?? '').indexOf(fold(f.text))
  return at < 0 ? null : { start: at, end: at + f.text.length }
}
const overlapping = (a: Found, b: Found, plains: string[]) => {
  if (a.sentence !== b.sentence) return false
  const x = spanOf(a, plains)
  const y = spanOf(b, plains)
  return Boolean(x && y && x.start < y.end && y.start < x.end)
}

/* ───────────── Dictionary scan (code) ───────────── */

const SCAN_SKIP = new Set([
  ...FUNCTION_WORDS,
  ...'get gets got getting go goes went gone going make makes made making take takes took taken taking give gives gave given giving put puts say says said tell tells told know knows knew known think thinks thought want wants wanted like likes liked really even still well way thing things lot lots people person something anything everything nothing someone anyone everyone actually basically quite rather pretty'.split(
    ' ',
  ),
])
/** How far (in words) a collocate may stand from its headword. */
const SCAN_WINDOW = 4
/** Network lookups one scan may make (OZDIC is fetched politely, 1.5 s apart); cached pages are free. */
const SCAN_FETCHES = 40

/** Where an OZDIC group's collocates stand: before the headword ("ADJ.", "VERB + PAPER"), after it ("PAPER + VERB"), either. */
function sideOf(category: string, head: string): 'before' | 'after' | 'either' | null {
  const c = category.toUpperCase().replace(/\.$/, '').trim()
  if (/^PREP|PHRASE|^SPECIAL/.test(c)) return null
  if (c === 'ADJ' || c === 'QUANT' || c === 'NOUN') return 'before'
  const parts = c.split('+').map((p) => p.trim())
  if (parts.length === 2) {
    const h = head.toUpperCase().slice(0, 4)
    if (parts[1].startsWith(h)) return 'before'
    if (parts[0].startsWith(h)) return 'after'
  }
  return 'either'
}

/** The content words of an OZDIC collocate ("carry out", "~ into/on", "present (sb with)"), one list per alternative. */
function itemWords(item: string): string[][] {
  const clean = item
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[~…]/g, ' ')
    .replace(/\b(sb|sth|sb's|one's|someone|something)\b/gi, ' ')
    .toLowerCase()
  let options: string[][] = [[]]
  for (const word of clean.split(/\s+/).filter(Boolean)) {
    const alts = word.split('/').map((a) => a.replace(/[^a-z'-]/g, '')).filter(Boolean)
    options = options.flatMap((o) => alts.map((a) => [...o, a])).slice(0, 4)
  }
  return options.map((ws) => ws.filter((w) => w.length > 1 && !FUNCTION_WORDS.has(w))).filter((ws) => ws.length > 0 && ws.length <= 3)
}

const sameWord = (token: string, word: string) =>
  token === word || lemmaCandidates(token).includes(word) || lemmaCandidates(word).includes(token)

/**
 * Every combination OZDIC lists for a word of the text, found by code: for each content word with an Oxford entry,
 * a collocate of its entry standing near it (on the side the entry gives) is a listed combination. Never over a
 * [[ ]] phrase or a {{ }} frame; overlapping hits keep the tightest.
 */
async function scanDictionary(sentences: string[]): Promise<{ found: Found[]; fetches: number }> {
  const entries = new Map<string, Promise<OzdicEntry | null>>()
  let fetches = 0
  const entryOf = (word: string) => {
    let hit = entries.get(word)
    if (!hit) {
      hit = (async () => {
        const forms = lemmaCandidates(word)
        for (const form of forms) {
          const cached = await lookup(form, { offline: true })
          if (cached.oxford) return cached
        }
        // Not cached: the word (its plural falls back to the singular), then one dictionary form of a verb ("tackled").
        for (const form of [word, ...forms.filter((f) => f !== word && /(ed|ing)$/.test(word))].slice(0, 2)) {
          if (fetches >= SCAN_FETCHES) return null
          fetches++
          const entry = await lookupLemma(form).catch(() => null)
          if (entry?.oxford) return entry
        }
        return null
      })()
      entries.set(word, hit)
    }
    return hit
  }

  const found: Found[] = []
  const plains = sentences.map((s) => parseMarked(s).plain)
  for (const [i, sentence] of sentences.entries()) {
    const { plain, spans } = parseMarked(sentence)
    const tokens = [...plain.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)].map((m) => ({ word: fold(m[0]), start: m.index, end: m.index + m[0].length }))
    const covered = (start: number, end: number) => spans.some((s) => start < s.end && s.start < end)
    const hits: Found[] = []
    for (const [h, head] of tokens.entries()) {
      if (head.word.length < 3 || SCAN_SKIP.has(head.word) || covered(head.start, head.end)) continue
      const entry = await entryOf(head.word)
      if (!entry) continue
      for (const sense of entry.senses) {
        for (const group of sense.groups) {
          const side = sideOf(group.category, entry.word)
          if (!side) continue
          for (const item of group.items) {
            for (const words of itemWords(item)) {
              // The collocate's words, in order, within the window on the entry's side of the headword.
              const lo = side === 'after' ? h + 1 : Math.max(0, h - SCAN_WINDOW)
              const hi = side === 'before' ? h - 1 : Math.min(tokens.length - 1, h + SCAN_WINDOW)
              const at: number[] = []
              for (let j = lo; j <= hi && at.length < words.length; j++) if (j !== h && sameWord(tokens[j].word, words[at.length])) at.push(j)
              if (at.length < words.length) continue
              const first = Math.min(h, ...at)
              const last = Math.max(h, ...at)
              const start = tokens[first].start
              const end = tokens[last].end
              if (covered(start, end)) continue
              hits.push({
                sentence: i,
                text: plain.slice(start, end),
                verified: true,
                scanned: true,
                proof: {
                  dictionary: [`OZDIC · ${entry.word} · ${group.category}: ${group.items.slice(0, 12).join(', ')} (✓ ${item})`],
                  sources: [{ name: 'OZDIC', url: entry.url }],
                },
              })
            }
          }
        }
      }
    }
    // Overlapping hits: the tightest wins.
    hits.sort((a, b) => a.text.length - b.text.length)
    for (const hit of hits) if (!found.some((f) => overlapping(f, hit, plains) || (f.sentence === hit.sentence && fold(f.text) === fold(hit.text)))) found.push(hit)
  }
  return { found, fetches }
}

/* ───────────── Combinations no dictionary lists: natural, suspicious, or replaced ───────────── */

const JudgeSchema = z.object({
  items: z.array(
    z.object({
      n: z.number().int(),
      decision: z.enum(['natural', 'flag', 'writer', 'dictionary']).catch('flag'),
      replacement: z.string().describe('For writer / dictionary: replaces the item text word for word; "" otherwise.'),
      why: z.string().describe('For flag: what an examiner would mark down, in Vietnamese, at most 20 words; "" otherwise.'),
      checks: z.array(CheckSchema),
    }),
  ),
})

const JUDGE_SYSTEM = (kind: string) => `You judge word combinations in ${kind} for a Vietnamese learner of English.
Each item is a combination that neither Longman nor the Oxford Collocations Dictionary (OZDIC) lists. Dictionaries leave out many perfectly natural combinations (noun compounds, phrasal verbs, idioms, names of things, the precise term), so the question is only whether an examiner would mark this one down in this sentence.
First ask of each item: would an examiner mark it down here? Be honest both ways: a correct, idiomatic combination is natural even if plain; an odd, stiff, redundant or wrong-register one is not, even if it sounds academic.
- natural: an educated native writer or speaker would say exactly this here, in this register. It stays as it is — never replace a natural item.
- flag: an examiner would mark it down (odd or unnatural combination, wrong word, redundant, wrong register, unclear). Say why in Vietnamese.
Only for an item that would be marked down AND is marked "may be replaced", you may give a replacement instead of flag:
- writer: the learner's own words say this idea in correct, natural English that fits: use them, changed only to fit the sentence's grammar.
- dictionary: a combination the dictionaries list (their lists are under the item) says exactly the same, naturally, in this sentence.
An item marked "judge only" is the learner's own text: never replace it, decide natural or flag.
A replacement means exactly the same with the same strength — never a different verb or a stronger or weaker word ("outweigh" is not "reduce", "greater" is not "immense"), takes the place of the item's text exactly (same grammar), uses plain common words that fit ${kind}, and is never the item's own text.
checks (for a replacement): its new word combinations for a collocation dictionary (base = lemma of the headword whose entry lists it: the noun for verb+noun, adjective+noun and noun+noun; the verb for verb+preposition; the adjective for adverb+adjective; collocate = lemma of the partner word, pattern), [] otherwise.`

type CheckedExtra = SpeakingExtra & { issue?: RewriteIssue }

export interface UnlistedReplacement {
  original: string
  replacement: string
  source: 'writer' | 'dictionary'
}

/**
 * Every combination Longman / OZDIC do not list is judged in its sentence: natural (shown as such, not as a doubt), or
 * suspicious (stays marked unconfirmed, with the reason). In a text the AI wrote, a suspicious combination the AI wrote
 * may also be replaced by the learner's own words or a listed combination — a new combination goes in only when a
 * dictionary confirms it. The learner's own words are only judged, never changed. Edits sentences, found and extras.
 */
async function judgeUnlisted(
  sentences: string[],
  found: Found[],
  extras: CheckedExtra[],
  req: AnnotateRequest,
  model: JsonModel,
): Promise<UnlistedReplacement[]> {
  const written = fold(req.learnerText.join(' '))
  const mayReplace = (t: string) => (req.fix ?? req.mode === 'model') && !written.includes(fold(t))
  type Item = { kind: 'wording'; item: Found } | { kind: 'extra'; item: CheckedExtra }
  const unlisted: Item[] = [
    ...found.filter((f) => !f.verified && !f.scanned).map((item) => ({ kind: 'wording' as const, item })),
    ...extras.filter((e) => !e.verified).map((item) => ({ kind: 'extra' as const, item })),
  ]
  if (!unlisted.length) return []
  const textOf = (u: Item) => (u.kind === 'wording' ? u.item.text : u.item.phrase)
  const sentenceOf = (u: Item) =>
    u.kind === 'wording' ? u.item.sentence : sentences.findIndex((s) => fold(plainOf(s)).includes(fold(u.item.phrase)))

  const items = unlisted.map((u, i) => {
    const lists = mayReplace(textOf(u))
      ? listLines((u.item.issue?.checks ?? []).flatMap((c) => c.lists))
          .split('\n')
          .filter(Boolean)
          .slice(0, 6)
      : []
    const at = sentenceOf(u)
    return [
      `${i + 1}. ${at >= 0 ? `sentence ${at + 1}` : 'suggested phrase'}: "${textOf(u)}" (${mayReplace(textOf(u)) ? 'may be replaced' : 'judge only'})`,
      ...lists.map((l) => `   ${l}`),
    ].join('\n')
  })
  const proposed = await model
    .json({
      label: `${req.label}: unlisted wording`,
      system: JUDGE_SYSTEM(req.kind),
      prompt: [
        `Learner's own words:\n"${req.learnerText.join('\n').trim() || '(none)'}"`,
        `\nText, one sentence per line ([[ ]] = suggested phrases, {{ }} = frames):\n${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
        `\nNot listed in Longman / OZDIC:\n${items.join('\n')}`,
      ].join('\n'),
      schema: JudgeSchema,
      effort: req.effort,
    })
    .then((r) => r.value.items)
    .catch((error: Error) => {
      console.warn(`[annotate] unlisted wording check skipped (${error.message})`)
      return []
    })

  const dict = dictionaries()
  const replaced: UnlistedReplacement[] = []
  const flag = (u: Item, why: string) => {
    u.item.natural = false
    if (why.trim()) u.item.why = why.trim()
  }
  for (const it of proposed) {
    const u = unlisted[it.n - 1]
    if (!u) continue
    const original = textOf(u)
    if (it.decision === 'natural') {
      u.item.natural = true
      continue
    }
    if (it.decision === 'flag' || !mayReplace(original)) {
      flag(u, it.why)
      continue
    }
    const replacement = plainOf(it.replacement).trim()
    const at = sentenceOf(u)
    if (!replacement || fold(replacement) === fold(original) || at < 0) {
      flag(u, it.why)
      continue
    }
    // The learner's own words: nothing in the replacement that they did not say.
    const fromLearner = it.decision === 'writer' && newContentWords(req.learnerText.join(' '), replacement).length === 0
    const fresh = newContentWords(original, replacement).length > 0 && it.checks.length > 0
    const issue = fresh ? await verifyPhrase(replacement, it.checks, dict) : null
    const next = fromLearner || issue?.verified ? replaceInMarked(sentences[at], original, replacement) : null
    if (next === null) {
      flag(u, it.why)
      continue
    }
    sentences[at] = next
    replaced.push({ original, replacement, source: fromLearner ? 'writer' : 'dictionary' })

    const confirmed = issue?.verified ? issue : null
    const proof = confirmed ? (proofOf(confirmed) as Proof) : null
    if (u.kind === 'wording') {
      // The learner's words, not confirmed: plain text again (no longer the AI's own wording).
      const k = found.indexOf(u.item)
      if (confirmed && proof) found[k] = { ...u.item, text: replacement, original, verified: true, issue: confirmed, proof: { dictionary: proof.dictionary ?? [], sources: proof.sources ?? [] } }
      else found.splice(k, 1)
    } else if (confirmed && proof) {
      Object.assign(u.item, { original, phrase: replacement, verified: true, issue: confirmed, dictionary: proof.dictionary ?? [], sources: proof.sources ?? [] })
    } else {
      // No longer a phrase to learn: its [[ ]] would otherwise read as a library phrase.
      extras.splice(extras.indexOf(u.item), 1)
      sentences[at] = sentences[at].replace(`[[${replacement}]]`, replacement)
    }
  }
  return replaced
}

/* ───────────── The whole thing ───────────── */

export interface AnnotateRequest {
  /** The final sentences, [[ ]] / {{ }} marked. */
  sentences: string[]
  /** Library phrases the text may wrap in [[ ]]. */
  picks: { term: string; slot?: string }[]
  /** Outside phrases the writing call suggested, looked up here (a text the AI wrote). */
  extras?: { phrase: string; meaning_vi: string; example: string; checks: DictionaryCheck[] }[]
  /** More phrases that may stay in [[ ]] (a learner's revision: the AI answer's outside phrases). */
  keepWrapped?: string[]
  /** The learner's own words (draft, idea, or the revision itself): whose words a phrase is. */
  learnerText: string[]
  /** Max coverage retry rounds for thin/empty sentences (default 2). Writing uses 1. */
  maxRounds?: number
  /** model: the AI wrote the text; user: the learner's own text, never changed. */
  mode: 'model' | 'user'
  /** Let the judge step replace suspicious combinations the AI wrote (default: a model text). */
  fix?: boolean
  /** What the text is, for the prompts: "an IELTS Writing Task 2 essay", "an IELTS Speaking Part 2 answer". */
  kind: string
  /** Combinations the writing call already listed (merged with the listing step's). */
  seed?: RawWording[]
  /** DOL entries for the learner's Vietnamese: a third dictionary. */
  dolHints?: DolHint[]
  effort: Effort
  /** Prefix of the call labels ("writing", "speaking"). */
  label: string
}

/** What the steps did, kept with the result so a missed phrase can be traced. */
export type AnnotationReport = CoverageReport

export interface Annotation {
  /** The sentences, edited only where an unlisted phrase the AI wrote was replaced. */
  sentences: string[]
  wording: CheckedWording[]
  /** The wording of each sentence, for marking it. */
  perSentence: CheckedWording[][]
  extras: SpeakingExtra[]
  fixes: UnlistedReplacement[]
  /** Hover note of wording the dictionaries do not list. */
  note: (text: string) => string
  report: AnnotationReport
}

/**
 * Sentences with fewer phrases than their length suggests: about one for every nine words outside frames (at least one
 * from six words on). `empty` are those with none at all.
 */
function coverage(sentences: string[], found: Found[]): { thin: number[]; empty: number[] } {
  const thin: number[] = []
  const empty: number[] = []
  for (const [i, s] of sentences.entries()) {
    const { plain, spans } = parseMarked(s)
    const free = spans.filter((x) => x.kind === 'frame').reduce((t, x) => t.replace(x.text, ' '), plain)
    const words = (free.match(/[A-Za-z]+/g) ?? []).length
    const need = words >= 6 ? Math.max(1, Math.floor(words / 9)) : 0
    const have = spans.filter((x) => x.kind === 'phrase').length + found.filter((f) => f.sentence === i).length
    if (have < need) thin.push(i)
    if (need && !have) empty.push(i)
  }
  return { thin, empty }
}

export async function annotate(req: AnnotateRequest, model: JsonModel): Promise<Annotation> {
  const dict = dictionaries()
  const known = [...req.picks.flatMap((p) => [p.term, p.slot ?? '']), ...(req.extras ?? []).map((e) => e.phrase), ...(req.keepWrapped ?? [])].filter(
    (k) => k.trim().length >= 3,
  )
  // 1. [[ ]] only around library and outside phrases: anything else is checked like the rest of the text.
  const sentences = req.sentences.map((s) => s.replace(/\[\[([\s\S]*?)\]\]/g, (whole, inner: string) => (known.some((k) => samePhrase(inner, k)) ? whole : inner)))
  const plains = () => sentences.map((s) => parseMarked(s).plain)
  const proofFor = (issue: RewriteIssue, text: string): { verified: boolean; proof: Proof } => {
    // A combination is not confirmed by one of its words having an entry: "do a mistake" has a single content word
    // ("do" is a function word), and "OZDIC has an entry for mistake" says nothing about the combination.
    const wordOnly = issue.basis === 'word' && text.trim().split(/\s+/).length > 1 && !issue.words?.some((w) => w.word.includes(' '))
    if (issue.verified && !wordOnly) {
      const p = proofOf(issue)
      return { verified: true, proof: { dictionary: p.dictionary ?? [], sources: p.sources ?? [] } }
    }
    const dol = req.dolHints?.length ? dolProof(text, req.dolHints) : null
    return dol ? { verified: true, proof: dol } : { verified: false, proof: { dictionary: [], sources: [] } }
  }
  const report: AnnotationReport = { listed: 0, dropped: [], scanned: 0, retried: [], uncovered: [], fetches: 0 }

  const extras: CheckedExtra[] = await Promise.all(
    (req.extras ?? [])
      .filter((e) => newContentWords('', e.phrase).length > 0)
      .slice(0, 3)
      .map(async (e) => {
        const issue = await verifyPhrase(e.phrase, e.checks, dict)
        const { verified, proof } = proofFor(issue, e.phrase)
        return { phrase: e.phrase, meaning_vi: e.meaning_vi, example: e.example, verified, dictionary: proof.dictionary, sources: proof.sources, issue }
      }),
  )

  // 2-3. Listed sentence by sentence, placed in the sentence's own words, looked up.
  const found: Found[] = []
  const list = async (which: number[], retry: boolean): Promise<RawWording[]> => {
    const ask = new Set(which)
    const value = await model
      .json({
        label: `${req.label}: wording${retry ? ' (again)' : ''}`,
        system: LISTING_SYSTEM(req.kind),
        prompt: [
          `Text, one sentence per line:\n${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
          `\nList the combinations of sentences: ${which.map((i) => i + 1).join(', ')}.`,
          ...(retry
            ? [
                'These sentences hold more combinations than have been listed so far. Go through each one again, verb by verb and noun by noun, and list the ones not listed yet; give [] only when nothing is left.',
                `Already listed:\n${which.map((i) => `${i + 1}: ${found.filter((f) => f.sentence === i).map((f) => `"${f.text}"`).join(', ') || '(nothing)'}`).join('\n')}`,
              ]
            : []),
        ].join('\n'),
        schema: ListingSchema,
        effort: req.effort,
      })
      .then((r) => r.value)
      .catch((error: Error) => {
        console.warn(`[annotate] ${req.label} wording listing failed (${error.message})`)
        return { sentences: [] }
      })
    return value.sentences
      .filter((s) => ask.has(s.n - 1))
      .flatMap((s) => s.items.map((it) => ({ sentence: s.n, text: it.text, meaning_vi: it.meaning_vi, checks: it.checks })))
  }
  const add = async (raw: RawWording[]) => {
    report.listed += raw.length
    const text = plains()
    const placed: (RawWording & { at: number })[] = []
    for (const w of raw) {
      const at = placeWording(text, w)
      if (!at) {
        report.dropped.push(w.text)
        continue
      }
      if (!newContentWords('', at.text).length) continue
      const i = at.sentence - 1
      const key = fold(at.text)
      const { spans } = parseMarked(sentences[i])
      if (spans.some((s) => fold(s.text).includes(key) || key.includes(fold(s.text)))) continue
      if (found.some((f) => f.sentence === i && fold(f.text) === key) || placed.some((p) => p.at === i && fold(p.text) === key)) continue
      placed.push({ ...w, text: at.text, at: i })
    }
    // All at once: cached pages answer at once, the dictionaries space out network requests.
    const looked = await Promise.all(
      placed.map(async (p): Promise<Found> => {
        const issue = await verifyPhrase(p.text, p.checks, dict)
        return { sentence: p.at, text: p.text, meaning_vi: p.meaning_vi, issue, ...proofFor(issue, p.text) }
      }),
    )
    found.push(...looked)
  }
  await add([...(req.seed ?? []), ...(await list([...sentences.keys()], false))])

  // 4. The dictionary scan: a listed combination the AI missed comes in; one the AI listed but could not confirm gives way.
  const scan = await scanDictionary(sentences)
  report.fetches = scan.fetches
  for (const hit of scan.found) {
    const text = plains()
    const clash = found.filter((f) => overlapping(f, hit, text) || (f.sentence === hit.sentence && fold(f.text) === fold(hit.text)))
    if (clash.some((f) => f.verified)) continue
    for (const f of clash) found.splice(found.indexOf(f), 1)
    found.push(hit)
    report.scanned++
  }

  // 5. Coverage: a sentence with fewer phrases than its length suggests (or none) is asked about again.
  const maxRounds = req.maxRounds ?? 2
  for (let round = 0; round < maxRounds; round++) {
    const { thin } = coverage(sentences, found)
    if (!thin.length) break
    report.retried.push(...thin)
    await add(await list(thin, true))
  }
  report.uncovered = coverage(sentences, found).empty

  // 6. Combinations no dictionary lists judged: natural or suspicious (in a text the AI wrote, possibly replaced).
  const fixes = await judgeUnlisted(sentences, found, extras, req, model)

  const text = plains()
  const kept = found.filter((f) => spanOf(f, text))
  const perSentence = sentences.map((_, i) => kept.filter((f) => f.sentence === i).map(toChecked))
  console.info(
    `[annotate] ${req.label}: ${kept.length} combinations (${report.scanned} from the dictionary scan), ` +
      `${report.dropped.length} not placed, ${report.uncovered.length} sentence(s) still without any`,
  )
  return {
    sentences,
    wording: perSentence.flat(),
    perSentence,
    extras: extras.map(({ issue: _issue, ...e }) => e),
    fixes,
    note: req.mode === 'user' ? yourNote : aiTextNote(req.learnerText),
    report,
  }
}
