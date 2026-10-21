// The library Speaking ideas draws from, and its tags file (content/speaking/index.json).
// Items come from the same build as the review cards (content-pipeline), so ids match the review queue.
import { createHash } from 'node:crypto'
import { buildContent } from '../../content-pipeline/index.ts'
import type { ReviewCard, ReviewIndex } from '../../src/types/content.ts'
import { SPEAKING_SOURCES, type SpeakingIndexDoc } from '../../src/types/speaking.ts'
import type { ApiContext } from '../api.ts'
import { contentFile, readJsonFile, writeJsonFile } from '../files.ts'

const indexFile = (ctx: ApiContext) => contentFile(ctx.contentDir, 'speaking', 'index.json')

const TAGGED = new Set<string>(SPEAKING_SOURCES)

/** Every taggable library item (lesson collocations, vocabulary, their collocations, notes). */
export function loadLibrary(ctx: ApiContext): ReviewCard[] {
  const json = buildContent(ctx.contentDir).files.get('review/index.json')
  const index = JSON.parse(json ?? '{"cards":[]}') as ReviewIndex
  return index.cards.filter((card) => TAGGED.has(card.source) && card.term.trim())
}

/** Fingerprint of what the tags depend on: a change re-tags the item. */
export function itemHash(card: ReviewCard): string {
  const text = [card.term, card.part_of_speech.join(','), card.meaning_vi, ...card.examples.slice(0, 2).map((e) => e.en)].join('|')
  return createHash('sha1').update(text).digest('hex').slice(0, 10)
}

export async function readIndex(ctx: ApiContext): Promise<SpeakingIndexDoc> {
  const doc = await readJsonFile<Partial<SpeakingIndexDoc>>(indexFile(ctx), {})
  return { version: 1, updated_at: doc.updated_at ?? '', entries: doc.entries ?? {} }
}

export async function writeIndex(ctx: ApiContext, doc: SpeakingIndexDoc): Promise<void> {
  doc.updated_at = new Date().toISOString()
  // Sorted keys keep the file's diffs readable.
  const entries = Object.fromEntries(Object.entries(doc.entries).sort(([a], [b]) => a.localeCompare(b)))
  await writeJsonFile(indexFile(ctx), { ...doc, entries })
}

/** What a sync would do: items to tag (new or edited) and tags to drop. */
export function diffLibrary(cards: ReviewCard[], doc: SpeakingIndexDoc) {
  const pending: ReviewCard[] = []
  const changed: ReviewCard[] = []
  const ids = new Set<string>()
  for (const card of cards) {
    ids.add(card.id)
    const tag = doc.entries[card.id]
    if (!tag) pending.push(card)
    else if (tag.hash !== itemHash(card)) changed.push(card)
  }
  const removed = Object.keys(doc.entries).filter((id) => !ids.has(id))
  return { pending, changed, removed }
}
