// Library search: vocabulary, collocation lessons, notes and the topic collocations, ranked in code.
// The index is built from the same content build the site serves (/data/lookup.json) and kept for 5 minutes.
import { buildContent } from '../../../content-pipeline/index.ts'
import type { LookupIndex } from '../../../src/types/content.ts'
import { loadTopicCollocationItems } from '../../topic-collocations.ts'
import { cut } from '../data.ts'
import { optEnum, optInt, reqString } from './args.ts'
import type { CoachTool } from './types.ts'

export type LibraryKind = 'word' | 'collocation' | 'note' | 'topic'

export interface LibraryEntry {
  kind: LibraryKind
  term: string
  meaning_vi: string
  example: string
  href: string
  /** Lesson or topic, to tell same terms apart. */
  where?: string
}

/** Lowercase, Vietnamese marks removed, đ → d: "Tắc nghẽn" and "tac nghen" match. */
export const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Ranks entries for a query: exact term, term starting with the whole word ("traffic jam"), term starting with it
 * ("trafficking"), whole word inside ("heavy traffic"), inside, then meaning, then example. Pure (tested).
 */
export function searchEntries(entries: LibraryEntry[], query: string, kind: LibraryKind | 'any', limit: number): LibraryEntry[] {
  const q = fold(query)
  if (!q) return []
  const word = new RegExp(`(^|[^\\p{L}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u')
  const scored: { e: LibraryEntry; score: number }[] = []
  for (const e of entries) {
    if (kind !== 'any' && e.kind !== kind) continue
    const term = fold(e.term)
    let score = 0
    if (term === q) score = 100
    else if (term.startsWith(`${q} `)) score = 85
    else if (term.startsWith(q)) score = 70
    else if (word.test(term)) score = 60
    else if (term.includes(q)) score = 40
    else if (fold(e.meaning_vi).includes(q)) score = 30
    else if (fold(e.example).includes(q)) score = 10
    if (score) scored.push({ e, score: score - Math.min(term.length, 60) / 100 })
  }
  const seen = new Set<string>()
  return scored
    .sort((a, b) => b.score - a.score)
    .map((s) => s.e)
    .filter((e) => {
      const key = `${e.kind}:${fold(e.term)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

let cached: { at: number; contentDir: string; entries: LibraryEntry[] } | null = null
const TTL_MS = 5 * 60_000

export async function libraryEntries(ctx: { rootDir: string; contentDir: string }, now = Date.now()): Promise<LibraryEntry[]> {
  if (cached && cached.contentDir === ctx.contentDir && now - cached.at < TTL_MS) return cached.entries
  const raw = buildContent(ctx.contentDir).files.get('lookup.json')
  const lookup = (raw ? JSON.parse(raw) : { vocabulary: [], collocations: [], notes: [] }) as LookupIndex
  const entries: LibraryEntry[] = [
    ...lookup.vocabulary.map(({ word, href }) => ({
      kind: 'word' as const,
      term: word.word,
      meaning_vi: cut(word.senses?.[0]?.definition_vi, 120),
      example: cut(word.senses?.[0]?.examples?.[0], 160),
      href,
    })),
    ...lookup.collocations.map(({ word, lesson, href }) => ({
      kind: 'collocation' as const,
      term: word.word,
      meaning_vi: cut(word.senses?.[0]?.definition_vi, 120),
      example: cut(word.senses?.[0]?.examples?.[0], 160),
      href,
      where: lesson,
    })),
    ...lookup.notes.map((n) => ({ kind: 'note' as const, term: n.title, meaning_vi: cut(n.meaning_vi, 120), example: cut(n.examples?.[0]?.en, 160), href: '/notes' })),
  ]
  try {
    for (const it of await loadTopicCollocationItems(ctx.rootDir)) {
      entries.push({
        kind: 'topic',
        term: it.term,
        meaning_vi: cut(it.meaning_vi, 120),
        example: cut(it.examples?.[0]?.en, 160),
        href: '/blog?topic=collocations-by-topic',
        where: [it.topic, it.subTopic].filter(Boolean).join(' · '),
      })
    }
  } catch {
    // The topic collocations are optional.
  }
  cached = { at: now, contentDir: ctx.contentDir, entries }
  return entries
}

export const searchLibrary: CoachTool = {
  name: 'search_library',
  description:
    "Search the app's own library: vocabulary words, collocation lessons, grammar/usage notes and topic collocations. Works with English terms and Vietnamese meanings. Returns up to 8 entries with an in-app link (href).",
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' }, kind: { type: 'string', enum: ['word', 'collocation', 'note', 'topic', 'any'] }, limit: { type: 'integer', description: '1-8, default 8' } },
    required: ['query'],
  },
  label: (a) => `Searching the library for “${cut(a.query, 40)}”…`,
  async run(args, ctx) {
    const query = reqString(args, 'query', 80)
    const kind = optEnum(args, 'kind', ['word', 'collocation', 'note', 'topic', 'any'] as const, 'any')
    const limit = optInt(args, 'limit', 1, 8, 8)
    const items = searchEntries(await libraryEntries(ctx), query, kind, limit)
    return { query, items, ...(items.length ? {} : { note: 'Nothing in the app library matches. Say so; do not invent entries.' }) }
  },
}
