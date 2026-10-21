import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ReviewCard } from '../src/types/content.ts'
import type { SpeakingIndexDoc, SpeakingTag } from '../src/types/speaking.ts'
import { readJsonFile, writeJsonFile } from './files.ts'

export interface TopicCollocationItem {
  id: string
  title?: string
  term: string
  type?: string
  pronunciation?: string
  part_of_speech?: string
  meaning_vi: string
  topic: string
  subTopic?: string
  group?: string
  origin: string
  examples?: Array<{ en: string; vi?: string }>
  patterns?: string[]
}

let cachedItems: TopicCollocationItem[] | null = null

export async function loadTopicCollocationItems(rootDir: string): Promise<TopicCollocationItem[]> {
  if (cachedItems) return cachedItems
  try {
    const indexPath = path.join(rootDir, 'content', 'topic-collocations', 'index.json')
    const raw = await readFile(indexPath, 'utf-8')
    const parsed = JSON.parse(raw) as { items: TopicCollocationItem[] }
    cachedItems = parsed.items || []
    return cachedItems
  } catch (err) {
    console.error('Failed to load topic collocations:', err)
    return []
  }
}

/** A topic collocation as a review card (the shape the Speaking library and the tagger work with). */
export function topicCard(it: TopicCollocationItem): ReviewCard {
  return {
    id: it.id,
    source: 'note',
    term: it.term,
    pronunciation: it.pronunciation,
    part_of_speech: it.part_of_speech ? [it.part_of_speech] : [],
    meaning_vi: it.meaning_vi,
    examples: it.examples || [],
    collocations: [],
    synonyms: [],
    antonyms: [],
    tags: [it.topic, it.subTopic, it.group].filter(Boolean) as string[],
    origin: it.origin || `Topic Collocations · ${it.topic}`,
    href: '/blog?topic=collocations-by-topic',
  }
}

/* ───────────── Tags (Speaking ideas → Library sync) ───────────── */

/**
 * The topic collocations' AI tags: register, CEFR level, kind (collocation / word / essay fragment), speaking functions
 * and topics. Kept beside the library's tags in content/speaking/ (that folder triggers no content rebuild).
 */
const tagsFile = (rootDir: string) => path.join(rootDir, 'content', 'speaking', 'topic-tags.json')

export async function readTopicTags(rootDir: string): Promise<SpeakingIndexDoc> {
  const doc = await readJsonFile<Partial<SpeakingIndexDoc>>(tagsFile(rootDir), {})
  return { version: 1, updated_at: doc.updated_at ?? '', entries: doc.entries ?? {} }
}

export async function writeTopicTags(rootDir: string, doc: SpeakingIndexDoc): Promise<void> {
  doc.updated_at = new Date().toISOString()
  const entries = Object.fromEntries(Object.entries(doc.entries).sort(([a], [b]) => a.localeCompare(b)))
  await writeJsonFile(tagsFile(rootDir), { ...doc, entries })
}

/** The tags as last saved, re-read only when the file changes (a sync writes it after every batch). */
let tagsCache: { mtime: number; doc: SpeakingIndexDoc } | null = null
export async function topicTags(rootDir: string): Promise<SpeakingIndexDoc> {
  const mtime = await stat(tagsFile(rootDir)).then((s) => s.mtimeMs, () => 0)
  if (!tagsCache || tagsCache.mtime !== mtime) tagsCache = { mtime, doc: await readTopicTags(rootDir) }
  return tagsCache.doc
}

/**
 * Whether a tagged topic collocation may be offered. Many come from model Writing Task 2 essays: academic C2 wording
 * ("neurological immaturity") or pieces of one essay's sentence ("tailor their advertisements specifically to
 * individuals"). Never a fragment or C2; for Speaking, never wording that only suits writing.
 */
export function topicItemUsable(tag: SpeakingTag | undefined, use: 'speaking' | 'writing'): boolean {
  if (!tag) return true
  if (tag.kind === 'fragment' || tag.level === 'C2') return false
  return use === 'writing' || tag.use !== 'writing'
}

/** Lower-case words with simple endings removed. */
function stems(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map((w) =>
    w.length <= 4 ? w : w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') || w,
  )
}
const STOP_EN = new Set(stems('a an the to of in on at for by with from as and or but is are be do does it its you your sb sth one'))
const contentStems = (text: string) => stems(text).filter((w) => !STOP_EN.has(w) && w.length > 1)

function viWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}0-9]+/gu) ?? []).filter((w) => w.length > 1)
}
const STOP_VI = new Set(['và', 'hoặc', 'nhưng', 'vì', 'do', 'nên', 'là', 'có', 'được', 'bị', 'cho', 'của', 'trong', 'ở', 'khi', 'thì', 'mà', 'các', 'những', 'một', 'này', 'đó', 'nó'])
const contentVi = (text: string) => viWords(text).filter((w) => !STOP_VI.has(w))

export async function findRelevantTopicCollocations(
  rootDir: string,
  enText: string,
  viText?: string,
  limit = 15,
): Promise<TopicCollocationItem[]> {
  const tags = await topicTags(rootDir)
  // Writing may use formal wording, but never essay fragments or C2 rarities (once the items are tagged).
  const items = (await loadTopicCollocationItems(rootDir)).filter((it) => topicItemUsable(tags.entries[it.id], 'writing'))
  if (!items.length) return []

  const enWords = new Set(contentStems(enText))
  const viList = contentVi(viText || '')
  const viWordSet = new Set(viList)

  // 2-word n-grams for Vietnamese (e.g. "gánh nặng", "đại học", "cạnh tranh")
  const viBigrams: string[] = []
  for (let i = 0; i < viList.length - 1; i++) {
    viBigrams.push(`${viList[i]} ${viList[i + 1]}`)
  }

  const scored: Array<{ item: TopicCollocationItem; score: number }> = []
  for (const it of items) {
    let score = 0
    const itTermStems = contentStems(it.term)
    const itExampleStems = contentStems(it.examples?.[0]?.en || '')
    const itVi = (it.meaning_vi || '').toLowerCase()

    // Vietnamese phrase & word matching
    for (const bg of viBigrams) {
      if (itVi.includes(bg)) score += 6
    }
    for (const w of viWordSet) {
      if (itVi.includes(w)) score += 2
    }

    // English phrase & word matching
    for (const s of itTermStems) {
      if (enWords.has(s)) score += 4
    }
    for (const s of itExampleStems) {
      if (enWords.has(s)) score += 1
    }

    if (score >= 3) {
      scored.push({ item: it, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)

  // Deduplicate by normalized term
  const seen = new Set<string>()
  const unique: TopicCollocationItem[] = []
  for (const x of scored) {
    const key = x.item.term.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(x.item)
    if (unique.length >= limit) break
  }

  return unique
}
