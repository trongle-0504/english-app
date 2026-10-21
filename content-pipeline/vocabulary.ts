import type {
  VocabIndex,
  VocabLesson,
  VocabRelation,
  VocabSense,
  VocabWord,
  WordRoots,
} from '../src/types/content.ts'
import { asStringArray, contentPath, readJson, slugify, warn, type Output } from './shared.ts'
import { cleanDictation, cleanParaphrase, cleanUsePrompts } from '../src/lib/wordDrills.ts'

/* Raw JSON as written by the admin tools. Fields are optional because older entries are sparse. */
interface RawRelation {
  text?: string
  word?: string
  pronunciation?: string
  meaning_vi?: string
  type?: string
  examples?: string[] | string
}

interface RawSense {
  definition_vi?: string
  examples?: string[] | string
  patterns?: string[]
  grammar_patterns?: string[]
  usage_notes_vi?: string
}

export interface RawVocabWord {
  word: string
  pronunciation?: string
  image?: string | { link?: string; value?: string; type?: string }
  /** Where the stored picture comes from, e.g. "Pixabay · Hans". */
  image_credit?: string
  part_of_speech?: string[] | string
  senses?: RawSense[]
  collocations?: RawRelation[]
  synonyms?: RawRelation[]
  antonyms?: RawRelation[]
  word_family?: string[]
  word_roots?: Partial<WordRoots>
  mnemonic_vi?: string
  use_prompts?: unknown
  dictation?: unknown
  paraphrase?: unknown
  collocation_type?: string
  created_at?: string
}

interface RawTopicFile {
  topic?: RawTopic
  topics?: RawTopic[]
}

interface RawTopic {
  name: string
  description_vi?: string
  sub_topics?: { name: string; description_vi?: string; words?: string[] }[]
}

function normalizeImage(image: RawVocabWord['image']): string | undefined {
  if (!image) return undefined
  if (typeof image === 'string') return /^(https?:)?\/\//.test(image) || image.startsWith('/') ? image : undefined
  return image.link || undefined
}

function normalizeRelation(item: RawRelation): VocabRelation | null {
  const text = (item.text ?? item.word ?? '').trim()
  if (!text) return null
  return {
    text,
    pronunciation: item.pronunciation || undefined,
    meaning_vi: item.meaning_vi || undefined,
    type: item.type || undefined,
    examples: asStringArray(item.examples),
  }
}

function normalizeSense(sense: RawSense): VocabSense {
  return {
    definition_vi: sense.definition_vi ?? '',
    examples: asStringArray(sense.examples),
    patterns: asStringArray(sense.patterns?.length ? sense.patterns : sense.grammar_patterns),
    usage_notes_vi: sense.usage_notes_vi || undefined,
  }
}

/** "adjective + noun", "Adjective+Noun", "adjective_noun" → "adjective+noun" */
export function normalizeCollocationType(type?: string): string | undefined {
  if (!type) return undefined
  return type.toLowerCase().replace(/\s*\+\s*/g, '+').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

export function normalizeWord(raw: RawVocabWord, id = slugify(raw.word)): VocabWord {
  const roots = raw.word_roots
  const collocations = (raw.collocations ?? []).map(normalizeRelation).filter((x): x is VocabRelation => !!x)
  const texts = collocations.map((c) => c.text)
  const usePrompts = cleanUsePrompts(raw.use_prompts, texts)
  const dictation = cleanDictation(raw.dictation, raw.word.trim(), texts)
  const paraphrase = cleanParaphrase(raw.paraphrase, raw.word.trim(), texts)
  const hasRoots = Boolean(roots && (roots.origin || roots.roots?.length || roots.mnemonic_vi))
  return {
    id,
    word: raw.word.trim(),
    pronunciation: raw.pronunciation ?? '',
    image: normalizeImage(raw.image),
    ...(raw.image_credit && normalizeImage(raw.image) ? { image_credit: raw.image_credit } : {}),
    part_of_speech: asStringArray(raw.part_of_speech),
    senses: (raw.senses ?? []).map(normalizeSense),
    collocations,
    synonyms: (raw.synonyms ?? []).map(normalizeRelation).filter((x): x is VocabRelation => !!x),
    antonyms: (raw.antonyms ?? []).map(normalizeRelation).filter((x): x is VocabRelation => !!x),
    word_family: asStringArray(raw.word_family),
    word_roots: hasRoots
      ? { origin: roots?.origin, roots: roots?.roots ?? [], mnemonic_vi: roots?.mnemonic_vi }
      : undefined,
    mnemonic_vi: raw.mnemonic_vi || undefined,
    ...(usePrompts.length ? { use_prompts: usePrompts } : {}),
    ...(dictation.length ? { dictation } : {}),
    ...(paraphrase.length ? { paraphrase } : {}),
    collocation_type: normalizeCollocationType(raw.collocation_type),
    created_at: raw.created_at,
  }
}

export const ALL_TOPIC_ID = 'all'

export function buildVocabulary(root: string, out: Output): VocabWord[] {
  const rawWords = readJson<RawVocabWord[]>(contentPath(root, 'vocabulary/words.json'), [])
  const topicFile = readJson<RawTopicFile>(contentPath(root, 'vocabulary/topics.json'), {})
  const rawTopics = topicFile.topics ?? (topicFile.topic ? [topicFile.topic] : [])

  const words = rawWords.filter((w) => w?.word).map((w) => normalizeWord(w))
  const byWord = new Map(words.map((w) => [w.word.toLowerCase(), w]))

  const newestFirst = (list: VocabWord[]) =>
    [...list].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))

  const index: VocabIndex = { totalWords: words.length, topics: [] }

  const emitLesson = (lesson: VocabLesson) => {
    out.set(`vocabulary/${lesson.topic.id}/${lesson.subTopic.id}.json`, lesson)
  }

  // Topics and sub-topics keep the order of topics.json (the learner's own ordering).
  for (const topic of rawTopics) {
    const topicId = slugify(topic.name)
    const subTopics = topic.sub_topics ?? []
    const summary: VocabIndex['topics'][number] = {
      id: topicId,
      name: topic.name,
      description_vi: topic.description_vi || undefined,
      wordCount: 0,
      hasAllLesson: subTopics.length > 1,
      subTopics: [],
    }
    const topicWords = new Map<string, VocabWord>()

    for (const sub of subTopics) {
      const subId = slugify(sub.name)
      const found: VocabWord[] = []
      for (const name of sub.words ?? []) {
        const entry = byWord.get(name.toLowerCase().trim())
        if (entry) found.push(entry)
        else warn(`vocabulary: "${name}" in ${topic.name} › ${sub.name} has no entry in words.json`)
      }
      const lessonWords = newestFirst(found)
      lessonWords.forEach((w) => topicWords.set(w.id, w))
      summary.subTopics.push({
        id: subId,
        name: sub.name,
        description_vi: sub.description_vi || undefined,
        wordCount: lessonWords.length,
        preview: lessonWords.slice(0, 6).map((w) => w.word),
      })
      emitLesson({
        // A topic with a single sub-topic is presented as the topic itself.
        title: subTopics.length > 1 ? sub.name : topic.name,
        topic: { id: topicId, name: topic.name },
        subTopic: { id: subId, name: sub.name, description_vi: sub.description_vi || undefined },
        words: lessonWords,
      })
    }

    summary.wordCount = topicWords.size
    if (summary.hasAllLesson) {
      emitLesson({
        title: `All ${topic.name} words`,
        topic: { id: topicId, name: topic.name },
        subTopic: { id: ALL_TOPIC_ID, name: 'All words', description_vi: topic.description_vi || undefined },
        words: newestFirst([...topicWords.values()]),
      })
    }
    index.topics.push(summary)
  }

  const allWords = newestFirst(words)
  index.topics.unshift({
    id: ALL_TOPIC_ID,
    name: 'Toàn bộ từ vựng',
    description_vi: 'Tất cả các chủ đề gộp lại để ôn tập.',
    wordCount: allWords.length,
    hasAllLesson: false,
    subTopics: [
      {
        id: ALL_TOPIC_ID,
        name: 'Tất cả bài học',
        description_vi: 'Toàn bộ từ vựng trong hệ thống để ôn tập tập trung.',
        wordCount: allWords.length,
        preview: allWords.slice(0, 6).map((w) => w.word),
      },
    ],
  })
  emitLesson({
    title: 'Toàn bộ từ vựng',
    topic: { id: ALL_TOPIC_ID, name: 'Toàn bộ từ vựng' },
    subTopic: { id: ALL_TOPIC_ID, name: 'Tất cả bài học', description_vi: 'Toàn bộ từ vựng trong hệ thống.' },
    words: allWords,
  })

  out.set('vocabulary/index.json', index)
  return words
}
