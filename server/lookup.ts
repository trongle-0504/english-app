// The header lookup beyond your library: topic collocations (content/topic-collocations, ~5 000 phrases, too big to send
// to the page) ranked like the library (src/features/lookup/match.ts), and the DOL dictionary's ~70 000 Vietnamese
// headwords (the local word list of server/writing-review/dol.ts). A DOL entry's English is fetched only when you open
// it (then cached); headwords already cached show it in the list.
import { makeQuery, prepare, rankOf, type Prepared } from '../src/features/lookup/match.ts'
import type { DolEntryView, LookupExtra, TopicHit } from '../src/types/lookup.ts'
import type { ApiContext } from './api.ts'
import { loadTopicCollocationItems, type TopicCollocationItem } from './topic-collocations.ts'
import { cachedDolEntry, dolEntry, dolIndex, dolPage } from './writing-review/dol.ts'

let prepared: { items: TopicCollocationItem[]; match: Prepared[] } | null = null

async function topicItems(ctx: Pick<ApiContext, 'rootDir'>) {
  if (!prepared) {
    const items = await loadTopicCollocationItems(ctx.rootDir)
    prepared = { items, match: items.map((it) => prepare(it.term, it.meaning_vi)) }
  }
  return prepared
}

const hitOf = (it: TopicCollocationItem, rank: number): TopicHit => ({
  id: it.id,
  rank,
  term: it.term,
  meaning_vi: it.meaning_vi,
  ...(it.pronunciation ? { pronunciation: it.pronunciation } : {}),
  ...(it.part_of_speech ? { part_of_speech: it.part_of_speech } : {}),
  topic: it.topic,
  ...(it.subTopic ? { subTopic: it.subTopic } : {}),
  ...(it.group ? { group: it.group } : {}),
  examples: it.examples ?? [],
})

/** Topic collocations and DOL headwords for a query, best first. */
export async function lookupExtra(ctx: Pick<ApiContext, 'rootDir'>, raw: string, { topic = 8, dol = 6 } = {}): Promise<LookupExtra> {
  const q = makeQuery(raw)
  if (q.plain.length < 2) return { topic: [], dol: [], dolReady: true }

  const { items, match } = await topicItems(ctx)
  const ranked: { i: number; rank: number }[] = []
  match.forEach((m, i) => {
    const rank = rankOf(q, m)
    if (rank !== null) ranked.push({ i, rank })
  })
  ranked.sort((a, b) => a.rank - b.rank || items[a.i].term.length - items[b.i].term.length)

  // The DOL list is Vietnamese: an English query rarely finds anything there, a Vietnamese one finds its headword.
  const index = await dolIndex()
  const words = index ? index.lookup(raw, dol) : []
  const cached = await Promise.all(words.map((w) => cachedDolEntry(w.url)))

  // The same phrase can sit under several topics: once is enough.
  const seen = new Set<string>()
  const unique = ranked.filter((r) => {
    const key = match[r.i].term
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    topic: unique.slice(0, topic).map((r) => hitOf(items[r.i], r.rank)),
    dol: words.map((w, n) => ({ vi: w.vi, url: w.url, ...(cached[n] ? { en: cached[n]!.en, pos: cached[n]!.pos } : {}) })),
    dolReady: Boolean(index),
  }
}

/** One DOL entry (fetched from DOL the first time, then cached). */
export async function lookupDol(url: string): Promise<DolEntryView | null> {
  const e = await dolEntry(url)
  if (!e) return null
  return {
    url: e.url,
    page: dolPage(e.url),
    vi: e.vi,
    en: e.en,
    pos: e.pos,
    ...(e.pronounce ? { pronounce: e.pronounce } : {}),
    ...(e.definitionVi ? { definitionVi: e.definitionVi } : {}),
    ...(e.sameVi && e.sameVi !== '-' ? { sameVi: e.sameVi } : {}),
    ...(e.sameEn && e.sameEn !== '-' ? { sameEn: e.sameEn } : {}),
    examples: e.examples,
    ...(e.note ? { note: e.note } : {}),
  }
}
