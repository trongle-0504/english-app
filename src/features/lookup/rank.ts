import Fuse from 'fuse.js'
import type { LookupIndex, Note, VocabRelation, VocabWord } from '@/types/content'
import { makeQuery, prepare, rankOf, type Prepared } from './match'

interface Common {
  key: string
  /** How well it matched (match.ts: lower is better); set by the search. */
  rank?: number
  term: string
  meaning?: string
  href: string
}

export type LookupResult = Common &
  (
    | { kind: 'vocabulary'; word: VocabWord }
    /** A collocation card from a Collocations lesson. */
    | { kind: 'collocation'; word: VocabWord; lesson: string; lessonId: string }
    /** A collocation listed inside a vocabulary word. */
    | { kind: 'word-collocation'; relation: VocabRelation; parent: VocabWord }
    | { kind: 'note'; note: Note }
  )

type Entry = LookupResult & { match: Prepared }

/**
 * Searcher over your library: vocabulary words, collocations (lesson cards and those inside words) and notes. Ranked
 * by match.ts — the English term, or a Vietnamese sense (most lookups are Vietnamese: "đàm phán" → negotiate) — then
 * close English spelling (typos). Ties: the shorter term first.
 */
export function createLookup(index: LookupIndex) {
  const senseText = (word: VocabWord) => word.senses.map((s) => s.definition_vi).join('\n')
  const entries: Entry[] = [
    ...index.vocabulary.flatMap(({ word, href }) => [
      { kind: 'vocabulary' as const, key: `v:${word.id}`, term: word.word, meaning: word.senses[0]?.definition_vi, word, href, match: prepare(word.word, senseText(word)) },
      ...word.collocations.map((relation, i) => ({
        kind: 'word-collocation' as const,
        key: `vc:${word.id}:${i}`,
        term: relation.text,
        meaning: relation.meaning_vi,
        relation,
        parent: word,
        href,
        match: prepare(relation.text, relation.meaning_vi ?? ''),
      })),
    ]),
    ...index.collocations.map(({ word, lesson, lessonId, href }) => ({
      kind: 'collocation' as const,
      key: `c:${href}`,
      lessonId,
      term: word.word,
      meaning: word.senses[0]?.definition_vi,
      word,
      lesson,
      href,
      match: prepare(word.word, senseText(word)),
    })),
    ...index.notes.map((note) => ({
      kind: 'note' as const,
      key: `n:${note.id}`,
      term: note.title,
      meaning: note.meaning_vi,
      note,
      href: `/notes#${note.id}`,
      match: prepare(note.title, note.meaning_vi),
    })),
  ]

  const fuzzy = new Fuse(
    entries.map((e) => ({ entry: e, norm: e.match.term })),
    { keys: ['norm'], includeScore: true, ignoreLocation: true, threshold: 0.3 },
  )

  return (query: string, limit = 8): LookupResult[] => {
    const q = makeQuery(query)
    if (q.plain.length < 2) return []

    const ranked = new Map<string, { entry: Entry; rank: number }>()
    const add = (entry: Entry, rank: number) => {
      const current = ranked.get(entry.key)
      if (!current || rank < current.rank) ranked.set(entry.key, { entry, rank })
    }
    for (const entry of entries) {
      const rank = rankOf(q, entry.match)
      if (rank !== null) add(entry, rank)
    }
    // Typo tolerance for longer English queries only; short ones fuzzy-match almost anything.
    if (!q.vietnamese && q.plain.length >= 5) for (const r of fuzzy.search(q.plain, { limit: 20 })) add(r.item.entry, 4 + (r.score ?? 1))

    return [...ranked.values()]
      .sort((a, b) => a.rank - b.rank || a.entry.term.length - b.entry.term.length)
      .slice(0, limit)
      .map(({ entry: { match: _m, ...result }, rank }) => ({ ...result, rank }) as LookupResult)
  }
}

