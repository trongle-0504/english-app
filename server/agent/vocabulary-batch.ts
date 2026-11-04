import { randomUUID } from 'node:crypto'
import type { ApiContext, ApiRequest } from '../api.ts'
import { antigravityJson } from '../llm/antigravity-cli.ts'
import { generateNote } from '../admin/notes.ts'
import { generateWord } from '../admin/vocabulary.ts'
import { ApiError } from '../api.ts'

type Destination = 'note' | 'vocab'
export interface BatchItem {
  term: string
  context: string
}
interface Batch {
  id: string
  destination: Destination
  items: Array<BatchItem & { status: 'queued' | 'running' | 'done' | 'skipped' | 'error'; error?: string }>
  status: 'queued' | 'running' | 'completed'
  createdAt: string
}

const batches = new Map<string, Batch>()
const schema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        properties: { term: { type: 'string' }, context: { type: 'string' } },
        required: ['term', 'context'],
      },
    },
  },
  required: ['items'],
}

function command(text: string): Destination {
  const matches = [...text.matchAll(/(^|\s)\/(note|vocab)\b/gi)]
  if (matches.length !== 1) throw new ApiError(400, 'Tin nhắn phải có đúng một command /note hoặc /vocab.')
  return matches[0][2].toLowerCase() as Destination
}

export async function prepareBatch(text: string) {
  const destination = command(text)
  const result = await antigravityJson({
    label: `admin batch ${destination}`,
    system: 'Extract study items only. Do not call tools, edit files, or perform actions.',
    prompt: `The user chose the ${destination === 'note' ? 'Notes' : 'Vocabulary'} destination with the command /${destination}.
Extract every numbered or clearly separated English word/phrase and its accompanying example sentence or context.
Return one item per phrase. Keep multi-word phrases intact. Do not invent terms or examples.

USER MESSAGE:
${text}`,
    jsonSchema: schema,
  })
  const raw = result.value as { items?: unknown[] }
  const seen = new Set<string>()
  const items = (Array.isArray(raw?.items) ? raw.items : [])
    .filter((item): item is { term?: unknown; context?: unknown } => Boolean(item && typeof item === 'object'))
    .map((item) => ({ term: String(item.term ?? '').trim(), context: String(item.context ?? '').trim() }))
    .filter((item) => item.term && !seen.has(item.term.toLowerCase()) && seen.add(item.term.toLowerCase()))
    .slice(0, 50)
  if (!items.length) throw new ApiError(400, 'Không tìm thấy từ hoặc cụm từ hợp lệ trong tin nhắn.')
  return { destination, items, model: result.model }
}

function request(body: unknown): ApiRequest {
  return { method: 'POST', path: '', query: new URLSearchParams(), headers: {}, body, rawBody: Buffer.alloc(0), incoming: {} as ApiRequest['incoming'] }
}

async function runItem(ctx: ApiContext, destination: Destination, item: BatchItem) {
  const result =
    destination === 'note'
      ? await generateNote(request({ prompt: `${item.term}\n\nExample:\n${item.context}`, type: 'auto', onlyNew: true }), ctx)
      : await generateWord(request({ word: item.term, description: item.context, onlyNew: true, generateQuestions: false }), ctx)
  if (result.status === 409) return 'skipped' as const
  return 'done' as const
}

export function startBatch(ctx: ApiContext, destination: Destination, items: BatchItem) {
  const batch: Batch = {
    id: randomUUID(),
    destination,
    items: [items].map((item) => ({ ...item, status: 'queued' })),
    status: 'queued',
    createdAt: new Date().toISOString(),
  }
  batches.set(batch.id, batch)
  void processBatch(ctx, batch)
  return batch
}

export function startBatchItems(ctx: ApiContext, destination: Destination, items: BatchItem[]) {
  const batch: Batch = { id: randomUUID(), destination, items: items.map((item) => ({ ...item, status: 'queued' })), status: 'queued', createdAt: new Date().toISOString() }
  batches.set(batch.id, batch)
  void processBatch(ctx, batch)
  return batch
}

async function processBatch(ctx: ApiContext, batch: Batch) {
  batch.status = 'running'
  for (const item of batch.items) {
    item.status = 'running'
    try {
      item.status = await runItem(ctx, batch.destination, item)
    } catch (error) {
      item.status = 'error'
      item.error = (error as Error).message
    }
  }
  batch.status = 'completed'
}

export function getBatch(id: string) {
  const batch = batches.get(id)
  if (!batch) throw new ApiError(404, 'Không tìm thấy batch.')
  return batch
}
