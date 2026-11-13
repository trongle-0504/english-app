// The shared vocabulary bank (PLAN-multi-user-v2.md, section 5): the owner's approved word entries in
// content/reference/{words,topics}.json, read-only for everyone. A learner browses it and adds a word to their own
// library (a copy, placed in the same topic): no AI call, no daily allowance used. Writing / Speaking reviews already
// draw on the shared topic collocations (content/topic-collocations) for every learner.
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { updateJsonDoc } from '../admin/store.ts'
import { ApiError, type ApiContext, type ApiHandler } from '../api.ts'
import { contentFile } from '../files.ts'

interface RefWord {
  word: string
  [key: string]: unknown
}
interface TopicTree {
  topics: { name: string; description_vi?: string; sub_topics: { name: string; description_vi?: string; words: string[] }[] }[]
}

const refDir = () => path.resolve(import.meta.dirname, '..', '..', 'content', 'reference')
const key = (w: string) => w.trim().toLowerCase()

let cache: { stamp: number; words: RefWord[]; topics: TopicTree; place: Map<string, { topic: string; sub: string }> } | null = null

export function loadReference() {
  const wordsFile = path.join(refDir(), 'words.json')
  let stamp = -1
  try {
    stamp = statSync(wordsFile).mtimeMs
  } catch {
    return { words: [] as RefWord[], topics: { topics: [] } as TopicTree, place: new Map<string, { topic: string; sub: string }>() }
  }
  if (cache?.stamp === stamp) return cache
  const words = JSON.parse(readFileSync(wordsFile, 'utf8')) as RefWord[]
  let topics: TopicTree = { topics: [] }
  try {
    topics = JSON.parse(readFileSync(path.join(refDir(), 'topics.json'), 'utf8')) as TopicTree
  } catch {
    /* words without topics */
  }
  const place = new Map<string, { topic: string; sub: string }>()
  for (const t of topics.topics ?? []) for (const s of t.sub_topics ?? []) for (const w of s.words ?? []) place.set(key(w), { topic: t.name, sub: s.name })
  cache = { stamp, words, topics, place }
  return cache
}

export const inReference = (word: string) => loadReference().words.some((w) => key(w.word) === key(word))

/** Copies one bank entry into the caller's library (idempotent). */
export async function adoptWord(ctx: ApiContext, word: string): Promise<{ added: boolean; topic?: string; subTopic?: string }> {
  const ref = loadReference()
  const entry = ref.words.find((w) => key(w.word) === key(word))
  if (!entry) throw new ApiError(404, 'Từ này không có trong kho chung.')
  const added = await updateJsonDoc<RefWord[], boolean>(contentFile(ctx.contentDir, 'vocabulary', 'words.json'), [], (words) => {
    if (words.some((w) => key(w.word) === key(entry.word))) return false
    words.push({ ...entry, created_at: new Date().toISOString(), from_reference: true })
    return true
  })
  const place = ref.place.get(key(entry.word)) ?? { topic: 'My words', sub: 'Added' }
  await updateJsonDoc<TopicTree, void>(contentFile(ctx.contentDir, 'vocabulary', 'topics.json'), { topics: [] }, (tree) => {
    tree.topics ??= []
    let topic = tree.topics.find((t) => t.name === place.topic)
    if (!topic) tree.topics.push((topic = { name: place.topic, sub_topics: [] }))
    let sub = topic.sub_topics.find((s) => s.name === place.sub)
    if (!sub) topic.sub_topics.push((sub = { name: place.sub, words: [] }))
    if (!sub.words.some((w) => key(w) === key(entry.word))) sub.words.push(entry.word)
  })
  ctx.onContentChange()
  return { added, topic: place.topic, subTopic: place.sub }
}

export const referenceRoutes: Record<string, ApiHandler> = {
  /** ?q=&topic= → `{ words, topics, total }`: the bank, each word marked when it is already in the caller's library. */
  'GET /reference/words': async (req, ctx) => {
    const ref = loadReference()
    const q = key(req.query.get('q') ?? '')
    const topic = req.query.get('topic') ?? ''
    let mine = new Set<string>()
    try {
      mine = new Set((JSON.parse(readFileSync(contentFile(ctx.contentDir, 'vocabulary', 'words.json'), 'utf8')) as RefWord[]).map((w) => key(w.word)))
    } catch {
      /* empty library */
    }
    const list = ref.words
      .filter((w) => (!q || key(w.word).includes(q) || JSON.stringify(w.senses ?? '').toLowerCase().includes(q)) && (!topic || ref.place.get(key(w.word))?.topic === topic))
      .slice(0, 200)
      .map((w) => {
        const sense = (w.senses as { definition_vi?: string; examples?: string[] }[] | undefined)?.[0]
        return { word: w.word, meaning_vi: sense?.definition_vi ?? '', example: sense?.examples?.[0] ?? '', image: typeof w.image === 'string' ? w.image : '', topic: ref.place.get(key(w.word))?.topic ?? '', mine: mine.has(key(w.word)) }
      })
    return { json: { words: list, topics: (ref.topics.topics ?? []).map((t) => t.name), total: ref.words.length } }
  },
  /** Body `{ word }` → `{ added, topic, subTopic }`. */
  'POST /reference/adopt': async (req, ctx) => {
    const word = typeof (req.body as { word?: unknown })?.word === 'string' ? (req.body as { word: string }).word : ''
    if (!word.trim()) throw new ApiError(400, 'Thiếu từ.')
    return { json: await adoptWord(ctx, word) }
  },
}
