// Writing Task 1: what the learner adds to a question — chart pictures (WebP, ≤ 1600 px) and their own model essay —
// plus two caches tied to them: the agent's chart reading (until a picture changes) and the model essay's vocabulary
// (until the essay changes). Learner data, so it lives in progress/writing-task1/, never in content/.
//   progress/writing-task1/prompts/<promptId>.json   { images, nextImage, modelEssay?, chartRead?, modelVocab? }
//   progress/writing-task1/images/<promptId>-<n>.webp
import { createHash } from 'node:crypto'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
  TASK1_MAX_IMAGES,
  TASK1_MAX_MODEL_CHARS,
  TASK1_PROMPT_ID,
  type WritingTask1Extras,
  type WritingTask1ExtrasMap,
} from '../../src/types/writingMock.ts'
import type { WritingTask1Chart, WritingTask1VocabItem } from '../../src/types/writingReview.ts'
import { exclusive } from '../admin/store.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { readJsonFile, writeJsonFile, writeTextFile } from '../files.ts'
import type { Base64Image } from '../images.ts'

export type Task1Context = Pick<ApiContext, 'rootDir' | 'contentDir'>

interface StoredImage {
  n: number
  file: string
  width: number
  height: number
  addedAt: string
}

interface PromptDoc {
  images: StoredImage[]
  /** The next picture number: numbers are never reused, so a cached URL never shows another picture. */
  nextImage: number
  modelEssay?: { text: string; updatedAt: string }
  /** Dropped when a picture is added or removed. */
  chartRead?: WritingTask1Chart
  /** hash = essayHash(model essay); dropped when the essay changes. */
  modelVocab?: { hash: string; items: WritingTask1VocabItem[] }
}

const MAX_SIDE = 1600

const baseDir = (ctx: Task1Context) => path.join(ctx.rootDir, 'progress', 'writing-task1')
const docFile = (ctx: Task1Context, id: string) => path.join(baseDir(ctx), 'prompts', `${id}.json`)
const imageFile = (ctx: Task1Context, file: string) => path.join(baseDir(ctx), 'images', file)

export const imageUrl = (id: string, n: number) => `/api/writing-task1/image?prompt=${id}&n=${n}`

/** The question ids of content/practice/writing-mock/task1-prompts.json (read again when the file changes). */
let known: { file: string; mtime: number; ids: Set<string> } | undefined

async function knownIds(ctx: Task1Context): Promise<Set<string>> {
  const file = path.join(ctx.contentDir, 'practice', 'writing-mock', 'task1-prompts.json')
  let mtime = 0
  try {
    mtime = (await stat(file)).mtimeMs
  } catch {
    return new Set()
  }
  if (known?.file === file && known.mtime === mtime) return known.ids
  const raw = await readJsonFile<{ id?: unknown }[]>(file, [])
  const ids = new Set((Array.isArray(raw) ? raw : []).map((p) => p?.id).filter((id): id is string => typeof id === 'string'))
  known = { file, mtime, ids }
  return ids
}

/** The question text of a Task 1 question ('' when missing). */
export async function promptText(ctx: Task1Context, id: string): Promise<string> {
  const raw = await readJsonFile<{ id?: unknown; prompt?: unknown }[]>(path.join(ctx.contentDir, 'practice', 'writing-mock', 'task1-prompts.json'), [])
  const item = (Array.isArray(raw) ? raw : []).find((p) => p?.id === id)
  return typeof item?.prompt === 'string' ? item.prompt : ''
}

/** A question id from a request: wrong shape → 400 (this also blocks "../"), not a known question → 404. */
export async function checkPromptId(ctx: Task1Context, value: unknown): Promise<string> {
  if (typeof value !== 'string' || !TASK1_PROMPT_ID.test(value)) throw new ApiError(400, 'Invalid Task 1 question id.')
  if (!(await knownIds(ctx)).has(value)) throw new ApiError(404, 'Task 1 question not found.')
  return value
}

function checkImageNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : NaN
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, 'Invalid picture number.')
  return n
}

async function readDoc(ctx: Task1Context, id: string): Promise<PromptDoc> {
  const doc = await readJsonFile<Partial<PromptDoc>>(docFile(ctx, id), {})
  return { ...doc, images: Array.isArray(doc.images) ? [...doc.images] : [], nextImage: Number(doc.nextImage) || 1 }
}

/** read → change → write one question's file, one at a time (two writes of one file would clash on the temp file). */
function updateDoc<R>(ctx: Task1Context, id: string, change: (doc: PromptDoc) => Promise<R> | R): Promise<R> {
  return exclusive(async () => {
    const doc = await readDoc(ctx, id)
    const result = await change(doc)
    await writeJsonFile(docFile(ctx, id), doc)
    return result
  })
}

function extrasOf(id: string, doc: PromptDoc): WritingTask1Extras {
  return {
    promptId: id,
    images: doc.images.map(({ n, width, height, addedAt }) => ({ n, url: imageUrl(id, n), width, height, addedAt })),
    ...(doc.modelEssay ? { modelEssay: doc.modelEssay } : {}),
  }
}

export async function getExtras(ctx: Task1Context, value: unknown): Promise<WritingTask1Extras> {
  const id = await checkPromptId(ctx, value)
  return extrasOf(id, await readDoc(ctx, id))
}

/** Only the questions with a picture or a model essay. */
export async function listExtras(ctx: Task1Context): Promise<WritingTask1ExtrasMap> {
  let files: string[] = []
  try {
    files = (await readdir(path.join(baseDir(ctx), 'prompts'))).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return {}
  }
  const map: WritingTask1ExtrasMap = {}
  for (const file of files) {
    const id = file.slice(0, -'.json'.length)
    if (!TASK1_PROMPT_ID.test(id)) continue
    try {
      const doc = await readDoc(ctx, id)
      if (doc.images.length || doc.modelEssay) map[id] = { images: doc.images.length, hasModel: Boolean(doc.modelEssay) }
    } catch {
      // A broken file is skipped.
    }
  }
  return map
}

/** Converts to WebP (EXIF-rotated, longest side ≤ 1600 px) before entering the write queue. */
async function toWebp(image: Base64Image, i: number): Promise<{ data: Buffer; width: number; height: number }> {
  try {
    const { data, info } = await sharp(Buffer.from(image.data, 'base64'))
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
  } catch {
    throw new ApiError(400, `Picture ${i + 1} could not be read as an image.`)
  }
}

export async function addImages(ctx: Task1Context, value: unknown, images: Base64Image[]): Promise<WritingTask1Extras> {
  const id = await checkPromptId(ctx, value)
  const converted = await Promise.all(images.map(toWebp))
  return updateDoc(ctx, id, async (doc) => {
    if (doc.images.length + converted.length > TASK1_MAX_IMAGES) {
      throw new ApiError(400, `At most ${TASK1_MAX_IMAGES} pictures per question (${doc.images.length} already).`)
    }
    for (const picture of converted) {
      const n = doc.nextImage++
      const file = `${id}-${n}.webp`
      await writeTextFile(imageFile(ctx, file), picture.data)
      doc.images.push({ n, file, width: picture.width, height: picture.height, addedAt: new Date().toISOString() })
    }
    delete doc.chartRead
    return extrasOf(id, doc)
  })
}

export async function removeImage(ctx: Task1Context, value: unknown, nValue: unknown): Promise<WritingTask1Extras> {
  const id = await checkPromptId(ctx, value)
  const n = checkImageNumber(nValue)
  return updateDoc(ctx, id, async (doc) => {
    const image = doc.images.find((i) => i.n === n)
    if (!image) throw new ApiError(404, 'Picture not found.')
    await rm(imageFile(ctx, image.file), { force: true })
    doc.images = doc.images.filter((i) => i.n !== n)
    delete doc.chartRead
    return extrasOf(id, doc)
  })
}

export async function readImage(ctx: Task1Context, value: unknown, nValue: unknown): Promise<Buffer> {
  const id = await checkPromptId(ctx, value)
  const n = checkImageNumber(nValue)
  const image = (await readDoc(ctx, id)).images.find((i) => i.n === n)
  if (!image) throw new ApiError(404, 'Picture not found.')
  try {
    return await readFile(imageFile(ctx, image.file))
  } catch {
    throw new ApiError(404, 'Picture not found.')
  }
}

/** The question's pictures for the model (base64 WebP), in the order they were added. */
export async function chartImages(ctx: Task1Context, id: string): Promise<Base64Image[]> {
  const doc = await readDoc(ctx, await checkPromptId(ctx, id))
  const out: Base64Image[] = []
  for (const image of doc.images) {
    try {
      out.push({ mimeType: 'image/webp', data: (await readFile(imageFile(ctx, image.file))).toString('base64') })
    } catch {
      // A missing file is skipped.
    }
  }
  return out
}

export async function cachedChartRead(ctx: Task1Context, id: string): Promise<WritingTask1Chart | undefined> {
  return (await readDoc(ctx, id)).chartRead
}

/** Saves the chart reading, unless the pictures changed while it was being read. */
export async function saveChartRead(ctx: Task1Context, id: string, chart: WritingTask1Chart, imageCount: number): Promise<void> {
  await updateDoc(ctx, id, (doc) => {
    if (doc.images.length === imageCount) doc.chartRead = chart
  })
}

export async function savedModelEssay(ctx: Task1Context, id: string): Promise<PromptDoc['modelEssay']> {
  return (await readDoc(ctx, id)).modelEssay
}

export const essayHash = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 12)

export async function cachedModelVocab(ctx: Task1Context, id: string, hash: string): Promise<WritingTask1VocabItem[] | undefined> {
  const vocab = (await readDoc(ctx, id)).modelVocab
  return vocab?.hash === hash ? vocab.items : undefined
}

/** Saves the model essay's vocabulary, unless the essay changed meanwhile. */
export async function saveModelVocab(ctx: Task1Context, id: string, hash: string, items: WritingTask1VocabItem[]): Promise<void> {
  await updateDoc(ctx, id, (doc) => {
    if (doc.modelEssay && essayHash(doc.modelEssay.text) === hash) doc.modelVocab = { hash, items }
  })
}

/** Saves the learner's model essay; empty text removes it. The same text writes nothing (and keeps the cache). */
export async function saveModelEssay(ctx: Task1Context, value: unknown, textValue: unknown): Promise<WritingTask1Extras> {
  const id = await checkPromptId(ctx, value)
  if (typeof textValue !== 'string') throw new ApiError(400, '"text" must be a string.')
  const text = textValue.replace(/\r\n?/g, '\n').trim()
  if (text.length > TASK1_MAX_MODEL_CHARS) throw new ApiError(400, `The model essay is too long (max ${TASK1_MAX_MODEL_CHARS} characters).`)
  return exclusive(async () => {
    const doc = await readDoc(ctx, id)
    if ((doc.modelEssay?.text ?? '') === text) return extrasOf(id, doc)
    if (text) doc.modelEssay = { text, updatedAt: new Date().toISOString() }
    else delete doc.modelEssay
    delete doc.modelVocab
    await writeJsonFile(docFile(ctx, id), doc)
    return extrasOf(id, doc)
  })
}
