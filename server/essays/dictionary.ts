// Dictionary box of an essay item (GET /api/essays/dictionary): Longman first (cached, rate-limited lookups — see
// server/writing-review/longman.ts), OZDIC (Oxford Collocations) when Longman has no collocations for the word.
// Collocations keep the dictionary's own groups ("ADJECTIVES/NOUN + FACTOR", "VERBS"; "ADJ", "VERB + POVERTY").
import { inReference } from '../admin/ozdic-grounding.ts'
import { lookupLongman, type LongmanEntry } from '../writing-review/longman.ts'
import { lookupLemma } from '../writing-review/ozdic.ts'

export interface DictionaryGroup {
  heading: string
  /** Longman: one entry per collocation with its gloss and example. OZDIC: the listed words of the group. */
  items: { phrase: string; gloss?: string; example?: string }[]
}

export interface DictionaryBox {
  source: 'longman' | 'ozdic' | null
  word: string
  url: string
  definitions: string[]
  groups: DictionaryGroup[]
  /** The item's phrase is listed by the dictionary. */
  listed: boolean
  /** Neither dictionary could be reached right now (network error, rate limit). */
  unavailable?: boolean
}

/**
 * Longman senses, the one the collocations are about first ("strong ties" → tie = relationship, not the necktie or
 * "to fasten"). The box's own sense when Longman marks it; otherwise the sense of the entry with the box whose
 * definition and examples share most words with the collocations and the item's phrase.
 */
function rankSenses(entries: LongmanEntry['entries'], phrase: string, headword: string): string[] {
  const stem = headword.slice(0, Math.max(3, headword.length - 1))
  const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z']+/).filter((x) => x.length > 2 && !x.startsWith(stem))
  const own = new Set(wordsOf(phrase))
  const scored = entries.flatMap((h) => {
    const box = new Set(h.collocations.flatMap((c) => c.collocates.flatMap((x) => wordsOf(x.phrase))))
    return h.senses.map((s, order) => {
      const words = wordsOf(`${s.signpost ?? ''} ${s.definition} ${s.examples.join(' ')}`)
      const score =
        (s.hasCollocations ? 100 : 0) + (h.collocations.length ? 10 : 0) + words.filter((x) => own.has(x)).length * 3 + words.filter((x) => box.has(x)).length
      return { text: `(${h.pos[0] ?? '?'}) ${s.definition}`, score, order }
    })
  })
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((x) => x.text)
}

export async function dictionaryBox(word: string, phrase: string): Promise<DictionaryBox> {
  const w = word.trim().toLowerCase()
  const longman = await lookupLongman(w)
  const sections = longman.entries.flatMap((h) => h.collocations)
  if (longman.found && sections.length) {
    const lexicon = longman.entries.flatMap((h) => [...h.collocations.flatMap((s) => s.collocates.map((c) => c.phrase)), ...h.senses.flatMap((s) => s.inline)]).join('\n')
    return {
      source: 'longman',
      word: w,
      url: longman.url,
      definitions: rankSenses(longman.entries, phrase, w).slice(0, 3),
      groups: sections.map((s) => ({
        heading: s.heading.toUpperCase(),
        items: s.collocates.map((c) => ({ phrase: c.phrase, gloss: c.gloss, example: c.examples[0] })),
      })),
      listed: phrase ? inReference(phrase, [w], lexicon) : false,
    }
  }
  let ozdic: Awaited<ReturnType<typeof lookupLemma>>
  try {
    ozdic = await lookupLemma(w)
  } catch (error) {
    console.warn(`[essays] dictionary ${w}: ${(error as Error).message}`)
    return { source: null, word: w, url: longman.url, definitions: [], groups: [], listed: false, unavailable: true }
  }
  if (!ozdic.oxford) return { source: null, word: w, url: ozdic.url, definitions: [], groups: [], listed: false, unavailable: ozdic.unavailable || longman.unavailable }
  // Groups whose lists contain the phrase's other words come first ("strong ties" → the relationship ADJ list, not the
  // necktie one; OZDIC sometimes files both under one sense).
  const stem = w.slice(0, Math.max(3, w.length - 1))
  const words = phrase.toLowerCase().split(/[^a-z']+/).filter((x) => x.length > 2 && !x.startsWith(stem))
  const all = ozdic.senses.flatMap((s) => s.groups)
  const hits = (group: (typeof all)[number]) => group.items.filter((item) => item.toLowerCase().split(/[^a-z']+/).some((t) => words.includes(t))).length
  const groups = [...all].sort((a, b) => hits(b) - hits(a))
  return {
    source: 'ozdic',
    word: ozdic.word,
    url: ozdic.url,
    // OZDIC's first gloss is often another sense (tie = necktie); the item already has its meaning, so none is shown.
    definitions: [],
    groups: groups.map((g) => ({ heading: g.category, items: [{ phrase: g.items.join(', '), example: g.examples[0] }] })),
    listed: phrase ? inReference(phrase, [w], all.flatMap((g) => [g.category, ...g.items]).join('\n')) : false,
  }
}
