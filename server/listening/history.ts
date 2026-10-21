// Listening → Simplify history: every finished analysis is kept as progress/listening/<id>.json together with the
// transcript and questions it was made from, so it can be read again later.
import { randomBytes } from 'node:crypto'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { ListeningHistoryItem, ListeningSaved, SimplifyResult } from '../../src/types/listening.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { readJsonFile, writeJsonFile } from '../files.ts'

const dir = (ctx: ApiContext) => path.join(ctx.rootDir, 'progress', 'listening')
const fileOf = (ctx: ApiContext, id: string) => path.join(dir(ctx), `${id}.json`)
const validId = (id: string) => /^[a-z0-9-]{6,40}$/.test(id)

export async function saveSimplify(ctx: ApiContext, transcript: string, questions: string, result: SimplifyResult): Promise<ListeningSaved> {
  const saved: ListeningSaved = {
    id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
    createdAt: new Date().toISOString(),
    transcript,
    questions,
    result,
  }
  await writeJsonFile(fileOf(ctx, saved.id), saved)
  return saved
}

export async function getSimplify(ctx: ApiContext, id: string): Promise<ListeningSaved | null> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  return readJsonFile<ListeningSaved | null>(fileOf(ctx, id), null)
}

export async function deleteSimplify(ctx: ApiContext, id: string): Promise<void> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  await rm(fileOf(ctx, id), { force: true })
}

/** Saved analyses, newest first, optionally only those created in [from, to) (ISO dates or times). */
export async function listSimplify(ctx: ApiContext, { from, to }: { from?: string; to?: string } = {}): Promise<ListeningHistoryItem[]> {
  let files: string[] = []
  try {
    files = (await readdir(dir(ctx))).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const items: ListeningHistoryItem[] = []
  for (const file of files) {
    const saved = await readJsonFile<ListeningSaved | null>(path.join(dir(ctx), file), null).catch(() => null)
    if (!saved?.result?.sections) continue
    if ((from && saved.createdAt < from) || (to && saved.createdAt >= to)) continue
    const lines = saved.result.sections.flatMap((s) => s.lines)
    items.push({
      id: saved.id,
      createdAt: saved.createdAt,
      title: saved.result.sections[0]?.title_vi ?? '',
      preview: saved.transcript.replace(/\s+/g, ' ').slice(0, 160),
      sections: saved.result.sections.map((s) => s.title_vi).filter(Boolean),
      sentences: lines.length,
      hasQuestions: Boolean(saved.questions.trim()),
      mode: saved.result.mode ?? 'ielts',
      model: saved.result.model,
    })
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
