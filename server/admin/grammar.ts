// Grammar admin: content/grammar/{lessons,topics}.json — reads and writes the same files the pipeline builds from.
import { slugify } from '../../content-pipeline/shared.ts'
import type { CefrLevel, GrammarLesson } from '../../src/types/content.ts'
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
import { exclusive, readJsonDoc, updateJsonDoc, writeJsonDoc } from './store.ts'

type RawLesson = Omit<GrammarLesson, 'slug'>

interface RawTopic {
  id?: string
  name: string
  description_vi?: string
  lessons: string[]
}

interface TopicFile {
  topics: RawTopic[]
}

const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const STRUCTURE_TYPES = ['affirmative', 'negative', 'question', 'other'] as const

const lessonsFile = (ctx: ApiContext) => contentFile(ctx.contentDir, 'grammar', 'lessons.json')
const topicsFile = (ctx: ApiContext) => contentFile(ctx.contentDir, 'grammar', 'topics.json')

function topicList(file: TopicFile): RawTopic[] {
  file.topics = Array.isArray(file.topics) ? file.topics : []
  for (const topic of file.topics) topic.lessons ??= []
  return file.topics
}

const summarize = (topics: RawTopic[]) =>
  topics.map((t) => ({ name: t.name, description_vi: t.description_vi ?? '', lessons: t.lessons }))

/**
 * Checks a lesson against the shape GrammarLesson pages render. `lenient` (Gemini output) fills
 * defaults instead of failing on a missing level or empty lists.
 */
function parseLesson(raw: JsonObject, lenient: boolean): RawLesson {
  const title = requiredText(raw, 'title', { max: 160, collapse: true })
  const level = LEVELS.includes(raw.level as CefrLevel) ? (raw.level as CefrLevel) : lenient ? 'B1' : null
  if (!level) throw new ApiError(400, `"level" must be one of ${LEVELS.join(', ')}.`)

  const list = (key: string): JsonObject[] => {
    const value = raw[key]
    if (value == null) return []
    if (!Array.isArray(value) || !value.every(isObject)) throw new ApiError(400, `"${key}" must be an array of objects.`)
    return value
  }
  /** Required in manual edits; in lenient mode incomplete items are dropped instead. */
  const need = (source: JsonObject, key: string, where: string): string => {
    const value = optionalText(source, key)
    if (!value && !lenient) throw new ApiError(400, `"${where}.${key}" is required.`)
    return value
  }
  const structures = list('structures')
    .map((s, i) => {
      const type = STRUCTURE_TYPES.find((t) => t === s.type) ?? (lenient ? 'other' : null)
      if (!type) throw new ApiError(400, `"structures[${i}].type" must be one of ${STRUCTURE_TYPES.join(', ')}.`)
      return { type, formula: need(s, 'formula', `structures[${i}]`), example: optionalText(s, 'example') }
    })
    .filter((s) => s.formula)
  const usages = list('usages')
    .map((u, i) => ({
      explanation_vi: need(u, 'explanation_vi', `usages[${i}]`),
      examples: (Array.isArray(u.examples) ? u.examples : [])
        .map((e, j) => {
          if (!isObject(e)) throw new ApiError(400, `"usages[${i}].examples[${j}]" must be { en, vi }.`)
          return { en: need(e, 'en', `usages[${i}].examples[${j}]`), vi: optionalText(e, 'vi') }
        })
        .filter((e) => e.en),
    }))
    .filter((u) => u.explanation_vi)
  return {
    title,
    level,
    brief_description_vi: optionalText(raw, 'brief_description_vi'),
    structures,
    usages,
    signals: stringList(raw.signals, 'signals'),
    notes_and_exceptions: stringList(raw.notes_and_exceptions, 'notes_and_exceptions'),
  }
}

/** Upserts the lesson (matched by slug, like the pipeline) and links it to a topic, all-or-nothing. */
function commitLesson(ctx: ApiContext, lesson: RawLesson, options: { topic?: string; originalTitle?: string }) {
  return exclusive(async () => {
    const [lessonsDoc, topicsDoc] = await Promise.all([
      readJsonDoc<RawLesson[]>(lessonsFile(ctx), []),
      readJsonDoc<TopicFile>(topicsFile(ctx), { topics: [] }),
    ])
    const lessons = lessonsDoc.value
    const topics = topicList(topicsDoc.value)
    const slug = slugify(lesson.title)
    const renamedFrom = options.originalTitle && slugify(options.originalTitle) !== slug ? slugify(options.originalTitle) : undefined
    if (renamedFrom && lessons.some((l) => slugify(l.title ?? '') === slug)) {
      throw new ApiError(409, `A lesson titled "${lesson.title}" already exists.`)
    }
    const index = lessons.findIndex((l) => slugify(l.title ?? '') === (renamedFrom ?? slug))
    if (index >= 0) lessons[index] = lesson
    else lessons.push(lesson)

    let topicsChanged = false
    if (renamedFrom) {
      for (const topic of topics) {
        topic.lessons = topic.lessons.map((title) => {
          if (slugify(title) !== renamedFrom) return title
          topicsChanged = true
          return lesson.title
        })
      }
    }
    if (options.topic) {
      const topic = topics.find((t) => sameName(t.name, options.topic!))
      if (!topic) throw new ApiError(400, `Topic "${options.topic}" does not exist.`)
      if (!topic.lessons.some((title) => slugify(title) === slug)) {
        topic.lessons.push(lesson.title)
        topicsChanged = true
      }
    }

    await writeJsonDoc(lessonsFile(ctx), lessons, lessonsDoc.style)
    if (topicsChanged) await writeJsonDoc(topicsFile(ctx), topicsDoc.value, topicsDoc.style)
    return index >= 0 ? ('updated' as const) : ('created' as const)
  })
}

export const listGrammar: ApiHandler = async (_req, ctx) => {
  const [topicsDoc, lessonsDoc] = await Promise.all([
    readJsonDoc<TopicFile>(topicsFile(ctx), { topics: [] }),
    readJsonDoc<RawLesson[]>(lessonsFile(ctx), []),
  ])
  const lessons = lessonsDoc.value.map((l) => l?.title).filter((t): t is string => typeof t === 'string')
  return { json: { topics: summarize(topicList(topicsDoc.value)), lessons } }
}

export const getLesson: ApiHandler = async (req, ctx) => {
  const title = queryParam(req, 'title')
  const [lessonsDoc, topicsDoc] = await Promise.all([
    readJsonDoc<RawLesson[]>(lessonsFile(ctx), []),
    readJsonDoc<TopicFile>(topicsFile(ctx), { topics: [] }),
  ])
  const entry = lessonsDoc.value.find((l) => slugify(l.title ?? '') === slugify(title))
  if (!entry) throw new ApiError(404, `No grammar lesson titled "${title}".`)
  const topics = topicList(topicsDoc.value)
    .filter((t) => t.lessons.some((l) => slugify(l) === slugify(title)))
    .map((t) => t.name)
  return { json: { entry, topics } }
}

export const createTopic: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const name = requiredName(body, 'name')
  const description = optionalText(body, 'description_vi', { max: 500 })
  const topics = await updateJsonDoc<TopicFile, RawTopic[]>(topicsFile(ctx), { topics: [] }, (file) => {
    const list = topicList(file)
    if (list.some((t) => sameName(t.name, name))) throw new ApiError(409, `Topic "${name}" already exists.`)
    list.push({ id: '', name, description_vi: description, lessons: [] })
    return list
  })
  ctx.onContentChange()
  return { status: 201, json: { topics: summarize(topics) } }
}

export const generateLesson: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const title = requiredText(body, 'title', { max: 160, collapse: true })
  const description = optionalText(body, 'description')
  const topic = requiredName(body, 'topic')

  const topicsDoc = await readJsonDoc<TopicFile>(topicsFile(ctx), { topics: [] })
  if (!topicList(topicsDoc.value).some((t) => sameName(t.name, topic))) throw new ApiError(400, `Topic "${topic}" does not exist.`)

  const prompt = `
You are an expert English teacher generating a structured JSON object for a grammar lesson.
Return only ONE valid JSON object matching the response schema.

GRAMMAR TOPIC: ${title}
TEACHER INSTRUCTIONS/DESCRIPTION:
${description}

Rules:
- Output language for explanations must be Vietnamese.
- Keep English examples natural and accurate.
- If the instruction is empty, generate standard foundational concepts for this topic automatically.
`.trim()
  const generated = await generateLogged<unknown>(ctx, `grammar: ${title}`, {
    prompt,
    schema: await loadSchema(ctx, 'grammar_schema'),
    temperature: 0.3,
  })
  if (!isObject(generated.value)) throw new ApiError(502, 'Gemini did not return a JSON object.')
  const entry = parseLesson({ ...generated.value, title: optionalText(generated.value, 'title') || title }, true)
  const action = await commitLesson(ctx, entry, { topic })
  ctx.onContentChange()
  return { json: { action, entry, topic, model: generated.model, usage: generated.usage } }
}

export const saveLesson: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const entry = parseLesson(requiredObject(body, 'entry'), false)
  const topic = optionalName(body, 'topic') || undefined
  const originalTitle = optionalText(body, 'originalTitle', { max: 160, collapse: true }) || undefined
  const action = await commitLesson(ctx, entry, { topic, originalTitle })
  ctx.onContentChange()
  return { json: { action, entry } }
}
