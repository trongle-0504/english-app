// Finds a review card's phrase in a sentence the way people write it: any form of its words ("burnt the midnight oil"
// ~ "burn the midnight oil"), a placeholder filled in ("punish their children instead of talking" ~ "punish sb instead
// of V-ing"), a reflexive for "oneself", articles and "be" optional, a few small words in between ("do a lot of
// research" ~ "do research"). Plain code, no model.
import { FUNCTION_WORDS, lemmaCandidates } from '../writing-review/rewrite.ts'

type Item =
  | { kind: 'word'; word: string }
  /** sb, sth, N…: one to four words. */
  | { kind: 'gap' }
  /** a / an / the, be: may be left out. */
  | { kind: 'optional'; words: ReadonlySet<string> }
  /** V-ing. */
  | { kind: 'ing' }
  /** oneself: myself, himself… */
  | { kind: 'self' }

const GAPS = new Set(
  "sb sth sb's sth's somebody something someone somebody's someone's one's smb smth st n np noun adj adjective sv clause o s v place person time".split(
    ' ',
  ),
)
const ARTICLES: ReadonlySet<string> = new Set(['a', 'an', 'the'])
const BE: ReadonlySet<string> = new Set(['be', 'am', 'is', 'are', 'was', 'were', 'been', 'being', "'m", "'re", "'s"])
const REFLEXIVE = /^(myself|yourself|himself|herself|itself|ourselves|yourselves|themselves|oneself)$/
/** Small words that may stand between two words of a phrase ("do a lot of research", "make a real difference"). */
const FILLER = (w: string) => FUNCTION_WORDS.has(w) || /ly$/.test(w) || ['lot', 'lots', 'bit', 'real', 'great', 'huge', 'big', 'good'].includes(w)
/** Another preposition in between means another phrase ("look at the kids after school" is not "look after"); "a lot of" is fine. */
const PREPOSITIONS = new Set(
  'at in on to for from with about into onto over under after before by through during without between against among towards toward across behind beyond upon within off out up down'.split(
    ' ',
  ),
)

const WORD = /[a-z]+(?:['’-][a-z]+)*/g

/** The same word in another form: "giving" ~ "give", "paid" ~ "pay", "steps" ~ "step". */
const sameForm = (a: string, b: string) => a === b || lemmaCandidates(a).includes(b) || lemmaCandidates(b).includes(a)

/** "to wreck/ruin sb's career" → its readings, each a list of items ("wreck" gap "career", "ruin" gap "career"). */
export function termPatterns(term: string): Item[][] {
  const plain = term
    .toLowerCase()
    .replace(/’/g, "'")
    .split(/\s\+\s|\s\+|\+\s/)[0] // "be a keen admirer of + N": the slot hint is not part of the words
    .replace(/\([^)]*\)/g, ' ') // optional words in brackets
    .replace(/\.{3}|…/g, ' sth ')
  const words = plain.match(/[a-z]+(?:['/-][a-z]+)*/g) ?? []
  // Alternatives written with a slash: "wreck/ruin".
  let readings: string[][] = [[]]
  for (const word of words) {
    const options = word.includes('/') ? word.split('/').filter(Boolean) : [word]
    readings = readings.flatMap((r) => options.map((o) => [...r, o])).slice(0, 8)
  }
  const patterns: Item[][] = []
  for (const reading of readings) {
    const items: Item[] = reading.map((w): Item => {
      if (GAPS.has(w)) return { kind: 'gap' }
      if (w === 'v-ing' || w === 'ving' || w === 'doing' || w === 'n-ing') return { kind: 'ing' }
      if (REFLEXIVE.test(w)) return { kind: 'self' }
      if (ARTICLES.has(w)) return { kind: 'optional', words: ARTICLES }
      if (BE.has(w)) return { kind: 'optional', words: BE }
      return { kind: 'word', word: w }
    })
    // "to wreck…": the infinitive "to" is not written in a sentence; gaps at the ends match nothing of their own.
    if (items[0]?.kind === 'word' && items[0].word === 'to' && items.length > 1) items.shift()
    while (items.length && items[0].kind !== 'word') items.shift()
    while (items.length && items.at(-1)!.kind !== 'word') items.pop()
    // At least one real word: a phrase of small words alone ("be in") would be found everywhere.
    if (!items.some((i) => i.kind === 'word' && i.word.length > 2 && !FUNCTION_WORDS.has(i.word))) continue
    patterns.push(items)
  }
  return patterns
}

export interface Token {
  word: string
  start: number
  end: number
}

export function tokenize(text: string): Token[] {
  return [...text.toLowerCase().replace(/’/g, "'").matchAll(WORD)].map((m) => ({
    word: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }))
}

/**
 * Where the pattern is in the tokens: [first, last] token index, or null. Between two of its words, at most two small
 * words (three in all), or one other word.
 */
function matchAt(items: Item[], toks: Token[], first: number): [number, number] | null {
  const go = (i: number, k: number, skipped: number, others: number): number | null => {
    if (i === items.length) return k - 1
    const item = items[i]
    if (item.kind === 'gap') {
      for (let n = 1; n <= 4 && k + n <= toks.length; n++) {
        const end = go(i + 1, k + n, skipped, others)
        if (end !== null) return end
      }
      return null
    }
    if (item.kind === 'optional') {
      if (k < toks.length && item.words.has(toks[k].word)) {
        const end = go(i + 1, k + 1, skipped, others)
        if (end !== null) return end
      }
      return go(i + 1, k, skipped, others)
    }
    // A word (or V-ing, or a reflexive): here, or after a few words in between (never before the first word).
    for (let n = 0; k + n < toks.length; n++) {
      if (n > 0) {
        if (i === 0) break
        const between = toks[k + n - 1].word
        if (PREPOSITIONS.has(between)) break
        const filler = FILLER(between)
        if (filler ? skipped + 1 > 3 : others + 1 > 1) break
        skipped += filler ? 1 : 0
        others += filler ? 0 : 1
      }
      const t = toks[k + n].word
      const hit = item.kind === 'word' ? sameForm(t, item.word) : item.kind === 'ing' ? t.length > 4 && t.endsWith('ing') : REFLEXIVE.test(t)
      if (hit) {
        const end = go(i + 1, k + n + 1, skipped, others)
        if (end !== null) return end
      }
    }
    return null
  }
  const end = go(0, first, 0, 0)
  return end === null ? null : [first, end]
}

/** The first place of the card's phrase in the text, as character offsets, or null. */
export function findTerm(patterns: Item[][], text: string, toks = tokenize(text)): { start: number; end: number } | null {
  for (let first = 0; first < toks.length; first++) {
    for (const items of patterns) {
      const span = matchAt(items, toks, first)
      if (span) return { start: toks[span[0]].start, end: toks[span[1]].end }
    }
  }
  return null
}

/** The character range of `part` in `text` (case ignored), or null. */
export function locate(text: string, part: string): { start: number; end: number } | null {
  if (!part.trim()) return null
  const at = text.toLowerCase().indexOf(part.toLowerCase().trim())
  return at < 0 ? null : { start: at, end: at + part.trim().length }
}

export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end

/**
 * You were reaching for the card's phrase: what you wrote is short (a phrase, not a whole sentence the review rewrote)
 * and has one of its real words in some form ("make a lot of research" for "do research").
 */
export function attempted(patterns: Item[][], wrote: string): boolean {
  const toks = tokenize(wrote)
  if (!toks.length || toks.length > 8) return false
  const words = patterns.flatMap((items) =>
    items.flatMap((i) => (i.kind === 'word' && i.word.length > 2 && !FUNCTION_WORDS.has(i.word) ? [i.word] : [])),
  )
  return toks.some((t) => words.some((w) => sameForm(t.word, w)))
}
