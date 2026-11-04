// Admin → Essays: content/essays/<id>.json, one analysed model essay per file (see src/types/essays.ts).
import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { slugify } from '../../content-pipeline/shared.ts'
import { ESSAY_ITEM_KINDS, type Essay, type EssayItemKind } from '../../src/types/essays.ts'
import { ApiError, type ApiContext, type ApiHandler } from '../api.ts'
import { analyzeEssay, describeItem } from '../essays/analyze.ts'
import { contentFile } from '../files.ts'
import { isObject, jsonBody, optionalText, queryParam, requiredObject, requiredText, stringList } from './input.ts'
import { readJsonDoc, writeJsonDoc } from './store.ts'

const dir = (ctx: ApiContext) => contentFile(ctx.contentDir, 'essays')
const fileOf = (ctx: ApiContext, id: string) => contentFile(ctx.contentDir, 'essays', `${id}.json`)
const validId = (id: string) => /^[a-z0-9-]{1,80}$/.test(id)

async function readEssay(ctx: ApiContext, id: string): Promise<Essay> {
  if (!validId(id) || !existsSync(fileOf(ctx, id))) throw new ApiError(404, `No essay "${id}".`)
  return (await readJsonDoc<Essay>(fileOf(ctx, id), {} as Essay)).value
}

/** A free id from the title ("wealth-and-happiness", then "-2"…). */
function freeId(ctx: ApiContext, title: string): string {
  const base = slugify(title).slice(0, 60) || 'essay'
  let id = base
  for (let n = 2; existsSync(fileOf(ctx, id)); n++) id = `${base}-${n}`
  return id
}

/** Manual edits keep the shape the pages rely on. */
function validateEssay(raw: Record<string, unknown>): Essay {
  const id = requiredText(raw, 'id', { max: 80 })
  if (!validId(id)) throw new ApiError(400, '"id" must be lowercase letters, digits and dashes.')
  requiredText(raw, 'title', { max: 200 })
  requiredText(raw, 'prompt', { max: 2000 })
  for (const key of ['sentences', 'paragraphs', 'items', 'critique', 'tasks']) {
    if (!Array.isArray(raw[key])) throw new ApiError(400, `"${key}" must be an array.`)
  }
  const essay = raw as unknown as Essay
  essay.items.forEach((item, i) => {
    const sentence = essay.sentences[item.sentence]
    if (!isObject(item) || !sentence || typeof item.text !== 'string' || !item.id || !item.key) {
      throw new ApiError(400, `"items[${i}]" needs id, key, text and a valid sentence index.`)
    }
    // Offsets follow the text: an edited "text" is looked up again in its sentence.
    const at = sentence.text.toLowerCase().indexOf(item.text.toLowerCase())
    if (at < 0) throw new ApiError(400, `"items[${i}].text" ("${item.text}") is not in sentence ${item.sentence}.`)
    item.start = at
    item.end = at + item.text.length
  })
  return essay
}

export const listEssays: ApiHandler = async (_req, ctx) => {
  const files = existsSync(dir(ctx)) ? (await readdir(dir(ctx))).filter((f) => f.endsWith('.json')) : []
  const essays = []
  for (const file of files) {
    const e = (await readJsonDoc<Essay>(contentFile(ctx.contentDir, 'essays', file), {} as Essay)).value
    if (e?.id) essays.push({ id: e.id, title: e.title, topic: e.topic, createdAt: e.createdAt, items: e.items?.length ?? 0 })
  }
  essays.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { json: { essays } }
}

export const getEssay: ApiHandler = async (req, ctx) => ({ json: { essay: await readEssay(ctx, queryParam(req, 'id')) } })

export const analyzeAndSave: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const prompt = requiredText(body, 'prompt', { max: 2000 })
  const text = requiredText(body, 'text', { max: 12_000 })
  const title = optionalText(body, 'title', { max: 120 })
  const requestedVocabulary = [...new Set(stringList(body.requestedVocabulary, 'requestedVocabulary').map((term) => term.replace(/\s+/g, ' ')))]
  if (requestedVocabulary.some((term) => term.length > 160)) throw new ApiError(400, 'Each requested vocabulary item must be 160 characters or fewer.')
  const { essay, model, usage, missingVocabulary } = await analyzeEssay(
    ctx,
    prompt,
    text,
    async (generated) => freeId(ctx, title || generated),
    requestedVocabulary,
  )
  if (title) essay.title = title
  await writeJsonDoc(fileOf(ctx, essay.id), essay)
  ctx.onContentChange()
  return { status: 201, json: { essay, model, usage, missingVocabulary } }
}

export const saveEssay: ApiHandler = async (req, ctx) => {
  const essay = validateEssay(requiredObject(jsonBody(req), 'essay'))
  const doc = existsSync(fileOf(ctx, essay.id)) ? await readJsonDoc<Essay>(fileOf(ctx, essay.id), {} as Essay) : null
  await writeJsonDoc(fileOf(ctx, essay.id), essay, doc?.style)
  ctx.onContentChange()
  return { json: { essay, action: doc ? 'updated' : 'created' } }
}

export const deleteEssay: ApiHandler = async (req, ctx) => {
  const id = queryParam(req, 'id')
  if (!validId(id) || !existsSync(fileOf(ctx, id))) throw new ApiError(404, `No essay "${id}".`)
  await rm(fileOf(ctx, id))
  ctx.onContentChange()
  return { json: { ok: true, id } }
}

async function writeEssay(ctx: ApiContext, essay: Essay) {
  const doc = await readJsonDoc<Essay>(fileOf(ctx, essay.id), {} as Essay)
  await writeJsonDoc(fileOf(ctx, essay.id), essay, doc.style)
  ctx.onContentChange()
}

/** Adds a phrase the learner selected on the essay page (Gemini fills in the meaning). */
export const addItem: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const essay = await readEssay(ctx, requiredText(body, 'essayId', { max: 80 }))
  const [sentence, start, end] = [Number(body.sentence), Number(body.start), Number(body.end)]
  if (![sentence, start, end].every(Number.isInteger)) throw new ApiError(400, '"sentence", "start" and "end" must be integers.')
  const kind = (optionalText(body, 'kind') || 'auto') as EssayItemKind | 'auto'
  if (kind !== 'auto' && !ESSAY_ITEM_KINDS.includes(kind)) throw new ApiError(400, 'Unknown kind.')
  const same = essay.items.find((i) => i.sentence === sentence && i.start === start && i.end === end && (kind === 'auto' || i.kind === kind))
  if (same) throw new ApiError(409, `"${same.text}" is already in this essay (${same.kind}).`)
  const item = await describeItem(ctx, essay, sentence, start, end, kind)
  essay.items.push(item)
  essay.items.sort((a, b) => a.sentence - b.sentence || a.start - b.start)
  await writeEssay(ctx, essay)
  return { status: 201, json: { essay, item } }
}

/** Removes an item (a phrase the learner does not want to study). */
export const deleteItem: ApiHandler = async (req, ctx) => {
  const essay = await readEssay(ctx, queryParam(req, 'essayId'))
  const itemId = queryParam(req, 'itemId')
  const before = essay.items.length
  essay.items = essay.items.filter((i) => i.id !== itemId)
  if (essay.items.length === before) throw new ApiError(404, `No item "${itemId}".`)
  await writeEssay(ctx, essay)
  return { json: { essay } }
}
