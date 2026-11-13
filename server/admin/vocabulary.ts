// Vocabulary admin: content/vocabulary/{words,topics}.json (+ optional practice questions).
import { adoptWord, inReference as inSharedBank } from '../users/reference.ts'
import { slugify } from '../../content-pipeline/shared.ts'
import type { RawVocabWord } from '../../content-pipeline/vocabulary.ts'
import { ApiError, type ApiContext, type ApiHandler } from '../api.ts'
import { contentFile } from '../files.ts'
import { generateLogged, loadSchema } from './ai.ts'
import {
  isObject,
  jsonBody,
  optionalName,
  optionalText,
  queryParam,
  requiredName,
  requiredObject,
  requiredText,
  sameName,
  stringList,
  type JsonObject,
} from './input.ts'
import { buildQuestions, saveQuestions } from './practice.ts'
import { exclusive, readJsonDoc, updateJsonDoc, writeJsonDoc } from './store.ts'
import {
  ADDED_PROPERTY,
  adminEffort,
  BREAKDOWN_PROPERTY,
  collocationRulesPrompt,
  CORRECTIONS_PROPERTY,
  corrections,
  dictionaryReference,
  inReference,
  ozdicPrompt,
  resolveLemma,
  stringArray,
} from './ozdic-grounding.ts'
import { downloadImage, firstImages, searchImages, storeImage, writeImage } from './images.ts'
import { startGenerateJob, type PartRunner } from './generate-jobs.ts'
import { logTimings, type GenerateTimings } from './generate-log.ts'
import type { LookupStats } from '../writing-review/longman.ts'
import { vocabularyPrompt } from './vocabulary-prompt.ts'
import { autoAddFromAdmin } from '../review/progress.ts'

interface RawSubTopic {
  name: string
  description_vi?: string
  words: string[]
}

interface RawTopic {
  name: string
  description_vi?: string
  sub_topics: RawSubTopic[]
}

interface TopicFile {
  topic?: RawTopic
  topics?: RawTopic[]
}

type WordEntry = RawVocabWord & JsonObject

const wordsFile = (ctx: ApiContext) => contentFile(ctx.contentDir, 'vocabulary', 'words.json')
const topicsFile = (ctx: ApiContext) => contentFile(ctx.contentDir, 'vocabulary', 'topics.json')

/** The pipeline also accepts a single `{ topic }` object; normalise to `{ topics: [] }` before editing. */
function topicList(file: TopicFile): RawTopic[] {
  file.topics ??= file.topic ? [file.topic] : []
  delete file.topic
  for (const topic of file.topics) {
    topic.sub_topics ??= []
    for (const sub of topic.sub_topics) sub.words ??= []
  }
  return file.topics
}

function summarize(topics: RawTopic[]) {
  return topics.map((t) => ({
    name: t.name,
    description_vi: t.description_vi ?? '',
    sub_topics: t.sub_topics.map((s) => ({ name: s.name, description_vi: s.description_vi ?? '', wordCount: s.words.length })),
  }))
}

function findSubTopic(topics: RawTopic[], topicName: string, subTopicName: string): { topic: RawTopic; sub: RawSubTopic } {
  const topic = topics.find((t) => sameName(t.name, topicName))
  if (!topic) throw new ApiError(400, `Topic "${topicName}" does not exist.`)
  const sub = topic.sub_topics.find((s) => sameName(s.name, subTopicName))
  if (!sub) throw new ApiError(400, `Sub-topic "${subTopicName}" does not exist in "${topic.name}".`)
  return { topic, sub }
}

const wordKey = (word: string) => word.trim().toLowerCase()

/** The entry the site shows for a word: the pipeline keeps the last one when words.json has duplicates. */
function findWord(words: WordEntry[], key: string): WordEntry | undefined {
  return words.findLast((w) => typeof w?.word === 'string' && wordKey(w.word) === key)
}

/* ───────────── Normalisation of Gemini output ───────────── */

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function texts(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).map(text).filter(Boolean)
}

function relations(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter(isObject).flatMap((item) => {
    const relation = {
      ...(text(item.text) ? { text: text(item.text) } : {}),
      ...(text(item.word) ? { word: text(item.word) } : {}),
      ...(text(item.pronunciation) ? { pronunciation: text(item.pronunciation) } : {}),
      ...(text(item.meaning_vi) ? { meaning_vi: text(item.meaning_vi) } : {}),
      ...(text(item.type) ? { type: text(item.type) } : {}),
      ...(texts(item.examples).length ? { examples: texts(item.examples) } : {}),
    }
    return relation.text || relation.word ? [relation] : []
  })
}

function normalizeGenerated(raw: JsonObject, fallbackWord: string): WordEntry {
  const senses = (Array.isArray(raw.senses) ? raw.senses : []).filter(isObject).flatMap((sense) => {
    const definition = text(sense.definition_vi)
    if (!definition) return []
    return [
      {
        definition_vi: definition,
        examples: texts(sense.examples),
        patterns: texts(sense.patterns),
        usage_notes_vi: text(sense.usage_notes_vi),
      },
    ]
  })
  const roots = isObject(raw.word_roots) ? raw.word_roots : {}
  const rootItems = (Array.isArray(roots.roots) ? roots.roots : [])
    .filter(isObject)
    .map((r) => ({ root: text(r.root), meaning_vi: text(r.meaning_vi) }))
    .filter((r) => r.root)
  const hasRoots = text(roots.origin) || rootItems.length || text(roots.mnemonic_vi)

  return {
    word: text(raw.word) || fallbackWord,
    pronunciation: text(raw.pronunciation),
    image: text(raw.image),
    part_of_speech: texts(raw.part_of_speech),
    senses,
    collocations: relations(raw.collocations),
    synonyms: relations(raw.synonyms),
    antonyms: relations(raw.antonyms),
    word_family: texts(raw.word_family),
    ...(hasRoots
      ? {
          word_roots: {
            origin: text(roots.origin),
            roots: rootItems,
            ...(text(roots.mnemonic_vi) ? { mnemonic_vi: text(roots.mnemonic_vi) } : {}),
          },
        }
      : {}),
  }
}

/** Manual JSON edits are saved as written, after checking the shape the pipeline relies on. */
function validateEntry(raw: JsonObject): WordEntry {
  const word = requiredText(raw, 'word', { max: 120, collapse: true })
  for (const key of ['part_of_speech', 'word_family']) {
    if (raw[key] != null && !Array.isArray(raw[key]) && typeof raw[key] !== 'string') {
      throw new ApiError(400, `"entry.${key}" must be an array of strings.`)
    }
  }
  for (const key of ['senses', 'collocations', 'synonyms', 'antonyms']) {
    const value = raw[key]
    if (value == null) continue
    if (!Array.isArray(value) || !value.every(isObject)) throw new ApiError(400, `"entry.${key}" must be an array of objects.`)
  }
  ;(raw.senses as JsonObject[] | undefined)?.forEach((sense, i) => {
    if (typeof sense.definition_vi !== 'string') throw new ApiError(400, `"entry.senses[${i}].definition_vi" must be a string.`)
    stringList(sense.examples, `entry.senses[${i}].examples`)
  })
  if (raw.word_roots != null && !isObject(raw.word_roots)) throw new ApiError(400, '"entry.word_roots" must be an object.')
  return { ...raw, word } as WordEntry
}

/* ───────────── Writes ───────────── */

interface Placement {
  topic: string
  subTopic: string
}

/**
 * Upserts a word into words.json and places it in a sub-topic. Both files are read and changed in
 * memory first, so a validation error never leaves one of them half-updated.
 */
function commitWord(ctx: ApiContext, entry: WordEntry, options: { target?: Placement; originalWord?: string; onlyNew?: boolean }) {
  return exclusive(async () => {
    const [wordsDoc, topicsDoc] = await Promise.all([
      readJsonDoc<WordEntry[]>(wordsFile(ctx), []),
      readJsonDoc<TopicFile>(topicsFile(ctx), { topics: [] }),
    ])
    const words = wordsDoc.value
    const topics = topicList(topicsDoc.value)
    const key = wordKey(entry.word)
    const renamedFrom = options.originalWord && wordKey(options.originalWord) !== key ? wordKey(options.originalWord) : undefined

    if (renamedFrom && findWord(words, key)) {
      throw new ApiError(409, `"${entry.word}" already exists. Edit that entry instead of renaming this one.`)
    }
    const lookup = renamedFrom ?? key
    const existing = findWord(words, lookup)
    if (existing && options.onlyNew) throw new ApiError(409, `"${existing.word}" is already in Vocabulary.`)
    const saved: WordEntry = { ...entry, created_at: entry.created_at || existing?.created_at || new Date().toISOString() }
    const isSameWord = (w: WordEntry) => typeof w?.word === 'string' && wordKey(w.word) === lookup
    // The saved entry takes the place of the one the site shows; other duplicates of it are dropped.
    const nextWords = existing ? words.flatMap((w) => (w === existing ? [saved] : isSameWord(w) ? [] : [w])) : [...words, saved]

    if (renamedFrom) {
      for (const topic of topics) {
        for (const sub of topic.sub_topics) sub.words = sub.words.map((w) => (wordKey(w) === renamedFrom ? entry.word : w))
      }
    }
    if (options.target) {
      const { sub } = findSubTopic(topics, options.target.topic, options.target.subTopic)
      if (!sub.words.some((w) => wordKey(w) === key)) sub.words.push(entry.word)
    }

    await writeJsonDoc(wordsFile(ctx), nextWords, wordsDoc.style)
    if (renamedFrom || options.target) await writeJsonDoc(topicsFile(ctx), topicsDoc.value, topicsDoc.style)
    return { action: existing ? ('updated' as const) : ('created' as const), entry: saved }
  })
}

function placementOf(body: JsonObject): Placement | undefined {
  const topic = optionalName(body, 'topic')
  const subTopic = optionalName(body, 'subTopic')
  if (!topic && !subTopic) return undefined
  if (!topic || !subTopic) throw new ApiError(400, 'Provide both "topic" and "subTopic", or neither.')
  return { topic, subTopic }
}

const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif|heic|heif)$/
const MAX_IMAGES = 6
const MAX_IMAGE_BASE64 = 14_000_000 // ≈ 10 MB decoded

function images(body: JsonObject): { mimeType: string; data: string }[] {
  const value = body.images
  if (value == null) return []
  if (!Array.isArray(value)) throw new ApiError(400, '"images" must be an array of { mimeType, data }.')
  if (value.length > MAX_IMAGES) throw new ApiError(400, `At most ${MAX_IMAGES} images per request.`)
  return value.map((item, i) => {
    if (!isObject(item) || typeof item.mimeType !== 'string' || typeof item.data !== 'string') {
      throw new ApiError(400, `"images[${i}]" must be { mimeType, data } with base64 data.`)
    }
    if (!IMAGE_TYPES.test(item.mimeType)) throw new ApiError(400, `"images[${i}]" has unsupported type ${item.mimeType}.`)
    if (item.data.length > MAX_IMAGE_BASE64) throw new ApiError(400, `"images[${i}]" is larger than 10 MB.`)
    return { mimeType: item.mimeType, data: item.data.replace(/^data:[^,]*,/, '') }
  })
}

/* ───────────── Handlers ───────────── */

export const listVocabulary: ApiHandler = async (_req, ctx) => {
  const [topicsDoc, wordsDoc] = await Promise.all([
    readJsonDoc<TopicFile>(topicsFile(ctx), { topics: [] }),
    readJsonDoc<WordEntry[]>(wordsFile(ctx), []),
  ])
  const names = new Map<string, string>()
  for (const w of wordsDoc.value) if (typeof w?.word === 'string') names.set(wordKey(w.word), w.word.trim())
  const words = [...names.values()].sort((a, b) => a.localeCompare(b))
  return { json: { topics: summarize(topicList(topicsDoc.value)), words } }
}

export const getWord: ApiHandler = async (req, ctx) => {
  const word = queryParam(req, 'word')
  const [wordsDoc, topicsDoc] = await Promise.all([
    readJsonDoc<WordEntry[]>(wordsFile(ctx), []),
    readJsonDoc<TopicFile>(topicsFile(ctx), { topics: [] }),
  ])
  const entry = findWord(wordsDoc.value, wordKey(word))
  if (!entry) throw new ApiError(404, `No vocabulary entry for "${word}".`)
  const placements = topicList(topicsDoc.value).flatMap((t) =>
    t.sub_topics.filter((s) => s.words.some((w) => wordKey(w) === wordKey(word))).map((s) => ({ topic: t.name, subTopic: s.name })),
  )
  return { json: { entry, placements } }
}

export const createTopic: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const name = requiredName(body, 'name')
  const description = optionalText(body, 'description_vi', { max: 500 })
  const topics = await updateJsonDoc<TopicFile, RawTopic[]>(topicsFile(ctx), { topics: [] }, (file) => {
    const list = topicList(file)
    if (list.some((t) => sameName(t.name, name))) throw new ApiError(409, `Topic "${name}" already exists.`)
    list.push({ name, description_vi: description, sub_topics: [] })
    return list
  })
  ctx.onContentChange()
  return { status: 201, json: { topics: summarize(topics) } }
}

export const createSubTopic: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const topicName = requiredName(body, 'topic')
  const name = requiredName(body, 'name')
  const description = optionalText(body, 'description_vi', { max: 500 })
  const topics = await updateJsonDoc<TopicFile, RawTopic[]>(topicsFile(ctx), { topics: [] }, (file) => {
    const list = topicList(file)
    const topic = list.find((t) => sameName(t.name, topicName))
    if (!topic) throw new ApiError(400, `Topic "${topicName}" does not exist.`)
    if (topic.sub_topics.some((s) => sameName(s.name, name))) throw new ApiError(409, `Sub-topic "${name}" already exists in "${topic.name}".`)
    topic.sub_topics.push({ name, description_vi: description, words: [] })
    return list
  })
  ctx.onContentChange()
  return { status: 201, json: { topics: summarize(topics) } }
}

const PLACEMENT_SEPARATOR = ' › '

/**
 * Sub-topics Gemini may choose from when the user left the topic (or only the sub-topic) empty.
 * Returns the fixed target when there is nothing to choose.
 */
function placementChoices(topics: RawTopic[], topicName: string, subTopicName: string): { target?: Placement; choices: Placement[] } {
  if (subTopicName && !topicName) throw new ApiError(400, 'Choose a topic for that sub-topic, or leave both empty.')
  if (topicName && subTopicName) {
    const { topic, sub } = findSubTopic(topics, topicName, subTopicName)
    return { target: { topic: topic.name, subTopic: sub.name }, choices: [] }
  }
  const pool = topicName ? topics.filter((t) => sameName(t.name, topicName)) : topics
  if (topicName && !pool.length) throw new ApiError(400, `Topic "${topicName}" does not exist.`)
  const choices = pool.flatMap((t) => t.sub_topics.map((s) => ({ topic: t.name, subTopic: s.name })))
  if (!choices.length) throw new ApiError(400, topicName ? `Topic "${topicName}" has no sub-topics yet.` : 'Create a topic and a sub-topic first.')
  return choices.length === 1 ? { target: choices[0], choices: [] } : { choices }
}

/** Extra prompt section asking Gemini to file the word under one of the existing sub-topics. */
function placementPrompt(topics: RawTopic[], choices: Placement[]): string {
  const lines = topics.flatMap((t) => {
    const subs = t.sub_topics.filter((s) => choices.some((c) => c.topic === t.name && c.subTopic === s.name))
    if (!subs.length) return []
    return [
      `- ${t.name}${t.description_vi ? ` — ${t.description_vi}` : ''}`,
      ...subs.map((s) => `    - ${t.name}${PLACEMENT_SEPARATOR}${s.name}${s.description_vi ? ` — ${s.description_vi}` : ''}`),
    ]
  })
  return [
    '',
    '### PLACEMENT',
    'Also set "placement" to the ONE sub-topic below where a learner would most expect to find this word, using its meaning in the notes (IELTS topics).',
    'Use "Common" only for general words that do not belong to a specific topic. Copy the value exactly ("Topic › Sub-topic").',
    ...lines,
  ].join('\n')
}

export const generateWord: ApiHandler = async (req, ctx) => {
  const started = Date.now()
  const body = jsonBody(req)
  const word = requiredText(body, 'word', { max: 120, collapse: true })
  const description = optionalText(body, 'description', { max: 20_000 })
  const attachments = images(body)
  const withPractice = body.generateQuestions === true
  // Speaking ideas adds phrases with one click: never replace an entry that already exists.
  const onlyNew = body.onlyNew === true

  // Multi-user app: a word in the shared bank is copied into the learner's library (no AI, no allowance).
  if (process.env.MULTI_USER === '1' && inSharedBank(word)) {
    const adopted = await adoptWord(ctx, word)
    const entry = (await readJsonDoc<WordEntry[]>(wordsFile(ctx), [])).value.find((w) => wordKey(w.word) === wordKey(word))
    if (!adopted.added && onlyNew) throw new ApiError(409, `"${word}" is already in Vocabulary.`)
    return { json: { action: adopted.added ? 'created' : 'updated', entry, placement: { topic: adopted.topic, subTopic: adopted.subTopic }, autoPlaced: true, fromReference: true } }
  }

  // Fail before spending tokens if the placement is wrong; otherwise Gemini picks it in the same request.
  const topics = topicList((await readJsonDoc<TopicFile>(topicsFile(ctx), { topics: [] })).value)
  const { target: fixed, choices } = placementChoices(topics, optionalName(body, 'topic'), optionalName(body, 'subTopic'))
  const baseSchema = (await loadSchema(ctx, 'vocabulary_schema')) as JsonObject

  // 1. Base form ("decisions" → decision; skipped when Longman lists the word as typed), 2. Longman, else OZDIC, for
  // its headwords, 3. the entry grounded on them (no drills: those are written by the nightly batch, drills-nightly.ts).
  const stats: LookupStats = { requests: 0, cacheHits: 0, waitMs: 0 }
  const lemmaStep = await resolveLemma(ctx, word, description, stats)
  const lemma = lemmaStep.result.lemma
  const lemmaDone = Date.now()
  if (onlyNew && findWord((await readJsonDoc<WordEntry[]>(wordsFile(ctx), [])).value, wordKey(lemma))) {
    throw new ApiError(409, `"${lemma}" is already in Vocabulary.`)
  }
  const ozdic = await dictionaryReference(lemmaStep.result.headwords, { baseForms: lemmaStep.result.baseForms, stats })
  const dictionaryDone = Date.now()
  const grounded = Boolean(ozdic.text)

  const schema = {
    ...baseSchema,
    properties: {
      ...(baseSchema.properties as JsonObject),
      ...(fixed
        ? {}
        : {
            placement: {
              type: 'string',
              enum: choices.map((c) => `${c.topic}${PLACEMENT_SEPARATOR}${c.subTopic}`),
              description: 'Topic › Sub-topic for this word.',
            },
          }),
      notes_breakdown: BREAKDOWN_PROPERTY,
      auto_collocations: ADDED_PROPERTY,
      image_query: { type: 'string', description: 'Search words for a stock photo that shows the meaning (see IMAGE).' },
      ...(grounded ? { ozdic_corrections: CORRECTIONS_PROPERTY } : {}),
    },
    required: [
      ...((baseSchema.required as string[]) ?? []),
      ...(fixed ? [] : ['placement']),
      'notes_breakdown',
      'auto_collocations',
      'image_query',
      ...(grounded ? ['ozdic_corrections'] : []),
    ],
  }

  const generated = await generateLogged<unknown>(ctx, `vocabulary: ${lemma}`, {
    prompt:
      vocabularyPrompt(lemma, description) +
      collocationRulesPrompt(grounded) +
      ozdicPrompt(ozdic.text) +
      IMAGE_PROMPT +
      (fixed ? '' : placementPrompt(topics, choices)),
    images: attachments,
    schema,
    temperature: 1,
    thinking: adminEffort(),
  })
  const mainDone = Date.now()
  if (!isObject(generated.value)) throw new ApiError(502, 'Gemini did not return a JSON object.')
  const answer = text(generated.value.placement)
  const picked = choices.find((c) => `${c.topic}${PLACEMENT_SEPARATOR}${c.subTopic}` === answer)
  // An answer outside the list falls back to Common (or the chosen topic's first sub-topic).
  const target: Placement = fixed ?? picked ?? choices.find((c) => sameName(c.topic, 'Common')) ?? choices[0]
  const autoPlaced = !fixed
  const entry = normalizeGenerated(generated.value, lemma)
  // Collocations added because the admin gave none: with OZDIC data each must really be in it (invented ones are
  // dropped); without it they are kept but reported as not verified.
  const key = (phrase: string) =>
    phrase
      .toLowerCase()
      .replace(/\b(a|an|the)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const claimed = new Set(stringArray(generated.value.auto_collocations).map(key))
  const added: string[] = []
  const droppedAdded: string[] = []
  const unverifiedAdded: string[] = []
  if (claimed.size && Array.isArray(entry.collocations)) {
    entry.collocations = entry.collocations.filter((c) => {
      const phrase = text((c as JsonObject).text)
      if (!claimed.has(key(phrase))) return true
      if (!grounded) {
        unverifiedAdded.push(phrase)
        return true
      }
      if (inReference(phrase, [lemma, ...lemmaStep.result.headwords], ozdic.lexicon)) {
        added.push(phrase)
        return true
      }
      // A thin reference (Longman senses only, a short Oxford entry) lets Gemini top up with its own: kept, flagged.
      if (ozdic.collocationCount < 6) {
        unverifiedAdded.push(phrase)
        return true
      }
      droppedAdded.push(phrase)
      return false
    })
  }
  const breakdown = isObject(generated.value.notes_breakdown) ? generated.value.notes_breakdown : {}
  if (!entry.senses?.length) throw new ApiError(502, 'Gemini returned an entry without senses. Try again or add more notes.')
  // Which dictionaries the entry rests on, and a note for the admin when one (or both) could not be used.
  entry.dictionarySource = ozdic.dictionarySource
  if (ozdic.dictionaryNote) entry.dictionaryNote = ozdic.dictionaryNote

  // Picture: a link the admin gave is kept; otherwise one is found in the background after saving (the picker loads
  // the full list of candidates itself).
  const imageQuery = text(generated.value.image_query) || entry.word
  entry.image_query = imageQuery
  const given = typeof entry.image === 'string' ? entry.image : ''
  if (!/^https?:\/\//.test(given)) entry.image = ''

  const { action, entry: saved } = await commitWord(ctx, entry, { target, onlyNew })
  ctx.onContentChange()
  const commitDone = Date.now()
  if (action === 'created') await autoAddFromAdmin(ctx, [`vocab:${slugify(saved.word)}`])

  const job = startGenerateJob('vocabulary', saved.word, {
    image: saved.image ? undefined : wordImageJob(ctx, saved.word, imageQuery),
    practice: withPractice
      ? async () => {
          const questions = await buildQuestions(ctx, saved)
          const summary = await saveQuestions(ctx, target.topic, target.subTopic, saved.word, questions)
          ctx.onContentChange()
          return summary
        }
      : undefined,
  })

  const timings: GenerateTimings = {
    lemma: lemmaStep.lemmaMs,
    dictionary: lemmaDone - started - lemmaStep.lemmaMs + (dictionaryDone - lemmaDone),
    main: mainDone - dictionaryDone,
    commit: commitDone - mainDone,
    total: Date.now() - started,
    dictionaryRequests: stats.requests,
    cacheHits: stats.cacheHits,
    longmanWaitMs: stats.waitMs,
    longmanPrefetched: Boolean(stats.prefetched),
    lemmaSkipped: Boolean(lemmaStep.result.skipped),
    dictionarySource: ozdic.dictionarySource,
    ...(ozdic.longmanError ? { longmanError: ozdic.longmanError } : {}),
  }
  logTimings('vocabulary', saved.word, timings)

  return {
    json: {
      action,
      entry: saved,
      placement: target,
      autoPlaced,
      job,
      lemma: lemmaStep.result,
      lemmaError: lemmaStep.error,
      ozdic: {
        sources: ozdic.sources,
        corrections: grounded ? corrections(generated.value.ozdic_corrections) : [],
        added,
        droppedAdded,
        unverifiedAdded,
        dictionarySource: ozdic.dictionarySource,
        dictionaryNote: ozdic.dictionaryNote,
      },
      notes: {
        examples: stringArray(breakdown.examples),
        collocations: stringArray(breakdown.collocations),
        patterns: stringArray(breakdown.patterns),
      },
      model: generated.model,
      usage: generated.usage,
      lemmaUsage: lemmaStep.usage,
      image: { query: imageQuery },
      timings,
    },
  }
}

/**
 * Background picture for a saved word: the first source with results (firstImages), up to 3 candidates tried, stored
 * as WebP and written into the entry — unless the entry is gone or got a picture meanwhile (null = skipped).
 */
function wordImageJob(ctx: ApiContext, word: string, query: string): PartRunner {
  return async () => {
    const candidates = await firstImages(query)
    if (!candidates.length) throw new Error(`No picture found for "${query}".`)
    let webp: Buffer | undefined
    let chosen = candidates[0]
    for (const candidate of candidates.slice(0, 3)) {
      try {
        webp = await downloadImage(candidate.url)
        chosen = candidate
        break
      } catch {
        // try the next candidate
      }
    }
    if (!webp) throw new Error('Could not download any of the pictures found.')
    const updated = await exclusive(async () => {
      const doc = await readJsonDoc<WordEntry[]>(wordsFile(ctx), [])
      const found = findWord(doc.value, wordKey(word))
      if (!found || (typeof found.image === 'string' && found.image)) return null
      found.image = await writeImage(ctx, found.word, webp)
      found.image_credit = chosen.credit
      found.image_source = chosen.source
      await writeJsonDoc(wordsFile(ctx), doc.value, doc.style)
      return found
    })
    if (updated) ctx.onContentChange()
    return updated && { entry: updated }
  }
}

const IMAGE_PROMPT = `

### IMAGE
Set "image_query" to 3–7 plain English search words for a stock PHOTO that shows the meaning in the sense the user means —
a concrete, photographable scene, not the word itself ("ambitious" → "person climbing mountain summit success",
"behind schedule" → "unfinished construction site delay", "circuit" as a race route → "race track circuit aerial").
No abstract words, no text or letters in the picture.`

/** GET /admin/vocabulary/images?q=…: picture candidates for the picker. */
export const searchWordImages: ApiHandler = async (req) => {
  const q = queryParam(req, 'q').slice(0, 120)
  return { json: await searchImages(q) }
}

/** POST /admin/vocabulary/image { word, url, credit, source } stores a picture for a word; { word, remove: true } drops it. */
export const setWordImage: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const word = requiredText(body, 'word', { max: 120, collapse: true })
  const remove = body.remove === true
  const url = remove ? '' : requiredText(body, 'url', { max: 2000 })
  const image = remove ? '' : await storeImage(ctx, word, url)
  const entry = await exclusive(async () => {
    const doc = await readJsonDoc<WordEntry[]>(wordsFile(ctx), [])
    const found = findWord(doc.value, wordKey(word))
    if (!found) throw new ApiError(404, `No vocabulary entry for "${word}".`)
    found.image = image
    if (remove) {
      delete found.image_credit
      delete found.image_source
    } else {
      found.image_credit = optionalText(body, 'credit', { max: 200 })
      found.image_source = optionalText(body, 'source', { max: 2000 })
    }
    await writeJsonDoc(wordsFile(ctx), doc.value, doc.style)
    return found
  })
  ctx.onContentChange()
  return { json: { entry } }
}

export const saveWord: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const entry = validateEntry(requiredObject(body, 'entry'))
  const originalWord = optionalText(body, 'originalWord', { max: 120, collapse: true }) || undefined
  const target = placementOf(body)
  const result = await commitWord(ctx, entry, { target, originalWord })
  ctx.onContentChange()
  if (result.action === 'created') await autoAddFromAdmin(ctx, [`vocab:${slugify(result.entry.word)}`])
  return { json: result }
}
