// How a looked-up word matches an entry: its English term, or its Vietnamese meaning. Shared by the header lookup
// (rank.ts: your Vocabulary, Collocations, Notes) and the server (server/lookup.ts: topic collocations), so both rank
// alike. Keep imports relative.
//
// Most lookups are typed in Vietnamese, so the meaning is cut into its senses ("1. đàm phán, thương lượng; mặc cả" →
// đàm phán · thương lượng · mặc cả) and a sense that IS the query beats one that starts with it, which beats a meaning
// that merely contains it. Typed with diacritics, the diacritics must match (mưa ≠ mua) and meanings rank first; typed
// without, both sides are compared without them.

/** Lower case, no diacritics, đ → d, plain quotes, single spaces. */
export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/’/g, "'").replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()

/** Lower case with diacritics kept. */
const accentLower = (s: string) => s.normalize('NFC').toLowerCase().replace(/’/g, "'").replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()

/** The senses of a Vietnamese meaning: split at line breaks, numbers, ; , / and " - " explanations; brackets dropped. */
export function senses(meaning: string): string[] {
  return meaning
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/\n|;|,|\/|\s[-–—:]\s|\d+[.)]\s/)
    .map((s) => s.replace(/^[\s.:–—-]+|[\s.:–—-]+$/g, '').trim())
    .filter((s) => s.length > 1)
}

export interface Prepared {
  /** The English term, normalized. */
  term: string
  /** The senses and the whole meaning, without and with diacritics. */
  sensesPlain: string[]
  sensesAccent: string[]
  meaningPlain: string
  meaningAccent: string
}

export function prepare(term: string, meaning = ''): Prepared {
  const list = senses(meaning)
  return {
    term: normalize(term),
    sensesPlain: list.map(normalize),
    sensesAccent: list.map(accentLower),
    meaningPlain: normalize(meaning),
    meaningAccent: accentLower(meaning),
  }
}

export interface Query {
  plain: string
  accent: string
  /** Typed with Vietnamese letters or diacritics: certainly Vietnamese. */
  vietnamese: boolean
  termWordStart: RegExp
  meaningWord: RegExp
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function makeQuery(raw: string): Query {
  const plain = normalize(raw)
  const vietnamese = /[\u0080-￿]/.test(raw)
  const needle = vietnamese ? accentLower(raw) : plain
  return {
    plain,
    accent: accentLower(raw),
    vietnamese,
    termWordStart: new RegExp(`(^|[^a-z])${escape(plain)}`),
    meaningWord: new RegExp(`(^|[^\\p{L}])${escape(needle)}($|[^\\p{L}])`, 'u'),
  }
}

/**
 * The rank of an entry for a query (lower is better), or null when it does not match.
 * English term: exact 0 · starts with 1 · a word starts with 2 · contains 3.
 * Vietnamese meaning: a sense equals the query · a sense starts with it · the meaning contains it as whole words —
 * ranked 0.5 / 1.2 / 2.5 when typed with diacritics (surely Vietnamese), 1.5 / 2.2 / 3.5 without.
 */
export function rankOf(q: Query, p: Prepared): number | null {
  let best: number | null = null
  const take = (r: number) => {
    if (best === null || r < best) best = r
  }
  if (!q.vietnamese) {
    if (p.term === q.plain) take(0)
    else if (p.term.startsWith(q.plain)) take(1)
    else if (q.termWordStart.test(p.term)) take(2)
    else if (p.term.includes(q.plain)) take(3)
  }
  if (q.plain.length >= 2) {
    const list = q.vietnamese ? p.sensesAccent : p.sensesPlain
    const needle = q.vietnamese ? q.accent : q.plain
    const shift = q.vietnamese ? 0 : 1
    // Among equal kinds of match, the sense closest to the query in length first ("bị ô nhiễm" before "đầy chất bẩn
    // hoặc ô nhiễm"): up to 0.3 added.
    const closeness = (s: string) => 0.3 * (1 - needle.length / Math.max(s.length, needle.length))
    const starting = list.filter((s) => s.startsWith(`${needle} `))
    const holding = list.filter((s) => q.meaningWord.test(s))
    if (list.some((s) => s === needle)) take(0.5 + shift)
    else if (starting.length) take(1.2 + shift + Math.min(...starting.map(closeness)))
    else if (holding.length) take(2.5 + shift + Math.min(...holding.map(closeness)))
    else if (q.meaningWord.test(q.vietnamese ? p.meaningAccent : p.meaningPlain)) take(2.8 + shift)
  }
  return best
}
