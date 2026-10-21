// Sync: brings content/speaking/index.json in step with the library, and content/speaking/topic-tags.json with the
// topic collocations (content/topic-collocations). New items and items edited since they were tagged are sent to the
// AI in batches (one call per batch) and tagged with the speaking functions and topics they serve, their register,
// CEFR level and kind (a reusable collocation, one word, or a fragment of one essay's sentence); tags of deleted items
// are dropped. The files are saved after every batch, so a stopped or failed sync keeps what it did and the next one
// carries on. Nothing here runs unless the Sync button is pressed.
import { z } from 'zod'
import type { ReviewCard } from '../../src/types/content.ts'
import {
  PHRASE_KINDS,
  SPEAKING_FUNCTION_IDS,
  SPEAKING_FUNCTIONS,
  SPEAKING_LEVELS,
  SPEAKING_TOPICS,
  SPEAKING_USES,
  type SpeakingIndexDoc,
  type SpeakingSyncJob,
  type SpeakingSyncStatus,
} from '../../src/types/speaking.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { antigravityAvailable } from '../llm/antigravity-cli.ts'
import { claudeCodeAvailable } from '../llm/claude-code.ts'
import { loadTopicCollocationItems, readTopicTags, topicCard, writeTopicTags } from '../topic-collocations.ts'
import { diffLibrary, itemHash, loadLibrary, readIndex, writeIndex } from './library.ts'
import { speakingJson, tagEffort } from './llm.ts'

const BATCH = 50
/** Batches in flight (Claude Code runs at most 2 calls at once anyway). */
const PARALLEL = 2

// The lists are shown to the model, but any other string is accepted and dropped in code: one made-up topic must not
// throw away a batch of 50 (it did).
const oneOf = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).or(z.string())
const TagSchema = z.object({
  items: z.array(
    z.object({
      n: z.number().int(),
      f: z.array(oneOf(SPEAKING_FUNCTION_IDS)).describe('1-3 speaking functions.'),
      t: z.array(oneOf(SPEAKING_TOPICS)).describe('1-3 topics.'),
      use: oneOf(SPEAKING_USES),
      slot: z.string().describe('How to put it in a sentence with placeholders, or "" when that is just the item.'),
      level: oneOf(SPEAKING_LEVELS),
      kind: oneOf(PHRASE_KINDS),
    }),
  ),
})
const valid = <T extends string>(values: readonly T[], value: string): value is T => (values as readonly string[]).includes(value)

const TAG_SYSTEM = `You tag English vocabulary items for an IELTS Speaking coach that suggests phrases for a candidate's answers.
For every item (number|item|part of speech|Vietnamese meaning|example) return:
- f: 1-3 speaking functions where a candidate would naturally use it:
${SPEAKING_FUNCTIONS.map((f) => `  ${f.id}: ${f.hint}`).join('\n')}
- t: 1-3 topics from the list where it fits; "General" when it suits answers on any topic (free time, a matter of opinion, keen on).
- use: "speaking" = natural in conversation; "both" = fine in speech and writing; "writing" = formal or academic, sounds odd when spoken ("exacerbate", "detrimental", "the democratization of", "remuneration").
- slot: how to drop it into a sentence when that differs from the item, with sb / sth / N / V-ing placeholders ("be a keen admirer of + N", "take up + N/V-ing"); "" otherwise.
- level: the CEFR level a learner needs to USE it naturally — B1 everyday ("free time", "get on well with"), B2 common topic language ("financial burden", "a sedentary lifestyle"), C1 precise / less common ("alleviate poverty", "impulsive decisions"), C2 rare, specialised or showy ("neurological immaturity", "hyperlinked databases", "satisfactory remuneration").
- kind: "collocation" = a reusable word combination, phrasal verb, idiom or sentence frame; "word" = a single word; "fragment" = a piece of one particular sentence, tied to its context and not reusable as it is ("tailor their advertisements specifically to individuals", "showing the wrongdoings of criminals publicly", "countless detrimental impacts of climate change").
Judge by the meaning and example, not by the lesson it comes from. Return every item.`

const line = (card: ReviewCard, n: number) =>
  [n, card.term, card.part_of_speech.join(', '), card.meaning_vi.replace(/\s+/g, ' ').slice(0, 90), (card.examples[0]?.en ?? '').slice(0, 110)].join(
    '|',
  )

// Kept on globalThis: the dev server reloads server modules in-process when they change, while a running sync carries
// on — the page must still see it, and a second sync must not start beside it.
const state = ((globalThis as { __speakingSync?: { job?: SpeakingSyncJob; stop: boolean } }).__speakingSync ??= { stop: false })
/** Serialises index writes from batches running in parallel. */
let writing: Promise<unknown> = Promise.resolve()

/** Where a batch's tags are kept: the library's index, or the topic collocations' tags file. */
interface Store {
  read: () => Promise<SpeakingIndexDoc>
  write: (doc: SpeakingIndexDoc) => Promise<void>
}
const libraryStore = (ctx: ApiContext): Store => ({ read: () => readIndex(ctx), write: (doc) => writeIndex(ctx, doc) })
const topicStore = (ctx: ApiContext): Store => ({ read: () => readTopicTags(ctx.rootDir), write: (doc) => writeTopicTags(ctx.rootDir, doc) })
const topicCards = async (ctx: ApiContext) => (await loadTopicCollocationItems(ctx.rootDir)).filter((it) => it.term?.trim()).map(topicCard)

export async function syncStatus(ctx: ApiContext): Promise<SpeakingSyncStatus> {
  const cards = loadLibrary(ctx)
  const doc = await readIndex(ctx)
  const { pending, changed, removed } = diffLibrary(cards, doc)
  const topic = await topicCards(ctx)
  const topicDiff = diffLibrary(topic, await readTopicTags(ctx.rootDir))
  return {
    library: cards.length,
    tagged: Object.keys(doc.entries).length - removed.length,
    pending: pending.length,
    changed: changed.length,
    removed: removed.length,
    updatedAt: doc.updated_at || undefined,
    topic: {
      total: topic.length,
      tagged: topic.length - topicDiff.pending.length - topicDiff.changed.length,
      pending: topicDiff.pending.length,
      changed: topicDiff.changed.length,
      removed: topicDiff.removed.length,
    },
    job: state.job,
    ready: claudeCodeAvailable() || antigravityAvailable(),
  }
}

async function tagBatch(store: Store, cards: ReviewCard[]): Promise<void> {
  const { value } = await speakingJson({
    label: 'speaking-sync: tag',
    system: TAG_SYSTEM,
    prompt: `Topics: ${SPEAKING_TOPICS.join(', ')}\n\nItems:\n${cards.map((c, i) => line(c, i + 1)).join('\n')}`,
    schema: TagSchema,
    effort: tagEffort(),
  })
  const at = new Date().toISOString()
  const write = writing.then(async () => {
    const doc = await store.read()
    for (const item of value.items) {
      const card = cards[item.n - 1]
      const functions = [...new Set(item.f.filter((f) => valid(SPEAKING_FUNCTION_IDS, f)))].slice(0, 3)
      const topics = [...new Set(item.t.filter((t) => valid(SPEAKING_TOPICS, t)))].slice(0, 3)
      if (!card || !functions.length) continue
      doc.entries[card.id] = {
        term: card.term,
        hash: itemHash(card),
        functions,
        topics: topics.length ? topics : ['General'],
        use: valid(SPEAKING_USES, item.use) ? item.use : 'both',
        ...(item.slot.trim() && item.slot.trim() !== card.term ? { slot: item.slot.trim() } : {}),
        ...(valid(SPEAKING_LEVELS, item.level) ? { level: item.level } : {}),
        ...(valid(PHRASE_KINDS, item.kind) ? { kind: item.kind } : {}),
        tagged_at: at,
      }
    }
    await store.write(doc)
  })
  writing = write.catch(() => {})
  await write
}

async function run(current: SpeakingSyncJob, work: { store: Store; cards: ReviewCard[] }[]) {
  // Each batch goes to one store: the library first, then the topic collocations.
  const batches: { store: Store; cards: ReviewCard[] }[] = []
  for (const { store, cards } of work) for (let i = 0; i < cards.length; i += BATCH) batches.push({ store, cards: cards.slice(i, i + BATCH) })
  const worker = async () => {
    for (let next = batches.shift(); next; next = batches.shift()) {
      const batch = next.cards
      if (state.stop) return
      try {
        await tagBatch(next.store, batch)
      } catch (error) {
        current.failed += batch.length
        console.error('[speaking-sync]', (error as Error).message)
        // Not signed in or out of plan usage: every further batch would fail the same way.
        if (/not logged in|log ?in|usage limit|rate limit|limit reached/i.test((error as Error).message)) {
          current.error = (error as Error).message
          state.stop = true
        }
      }
      current.done += batch.length
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  current.status = current.error ? 'error' : state.stop ? 'stopped' : 'done'
  current.finishedAt = new Date().toISOString()
}

/** `limit`: tag at most this many items (a trial run). */
export async function startSync(ctx: ApiContext, { limit }: { limit?: number } = {}): Promise<SpeakingSyncJob> {
  if (state.job?.status === 'running') throw new ApiError(409, 'A sync is already running.')
  if (!claudeCodeAvailable() && !antigravityAvailable())
    throw new ApiError(503, 'Claude Code or Antigravity CLI is not installed.')
  const work: { store: Store; cards: ReviewCard[] }[] = []
  let removedCount = 0
  let left = limit && limit > 0 ? limit : Infinity
  for (const [store, cards] of [
    [libraryStore(ctx), loadLibrary(ctx)],
    [topicStore(ctx), await topicCards(ctx)],
  ] as const) {
    const doc = await store.read()
    const { pending, changed, removed } = diffLibrary(cards, doc)
    if (removed.length) {
      for (const id of removed) delete doc.entries[id]
      await store.write(doc)
      removedCount += removed.length
    }
    const todo = [...pending, ...changed].slice(0, Math.max(0, left))
    left -= todo.length
    if (todo.length) work.push({ store, cards: todo })
  }
  const total = work.reduce((n, w) => n + w.cards.length, 0)
  state.stop = false
  const job: SpeakingSyncJob = (state.job = {
    status: total ? 'running' : 'done',
    startedAt: new Date().toISOString(),
    total,
    done: 0,
    failed: 0,
    removed: removedCount,
  })
  if (total) void run(job, work)
  else job.finishedAt = job.startedAt
  return job
}

/** Finishes the batches in flight, then stops (their tags are kept). */
export function stopSync(): SpeakingSyncJob | undefined {
  if (state.job?.status === 'running') state.stop = true
  return state.job
}
