// Library entries Nova proposed, written on the server after the learner's Confirm (this replaced Admin's "Batch agent").
// Each kept item goes through the Admin generator itself (generateWord / generateNote with onlyNew: an entry that exists
// is never replaced), four at a time (the app-wide ANTIGRAVITY_PARALLEL cap of 4 still bounds all agy calls); the
// proposal on disk carries each item's progress, so the card shows it and closing the tab does not stop it. Its review card is linked like the app's own "Vocabulary / Notes" buttons do.
import { slugify } from '../../src/lib/text.ts'
import type { CoachLibraryProgress } from '../../src/types/coach.ts'
import { generateNote } from '../admin/notes.ts'
import { generateWord } from '../admin/vocabulary.ts'
import { ApiError, type ApiContext, type ApiRequest } from '../api.ts'
import { addedToLibrary } from '../practice/recent.ts'

export interface LibraryItemData {
  target: 'vocabulary' | 'note'
  phrase: string
  meaning_vi?: string
  example?: string
}

/** The notes the generator gets: the phrase, then what the learner gave (never invented). */
export function generatorNotes(item: LibraryItemData): string {
  return [item.phrase, item.meaning_vi ? `- Nghĩa: ${item.meaning_vi}` : '', item.example ? `- Example: ${item.example}` : ''].filter(Boolean).join('\n')
}

function request(body: unknown): ApiRequest {
  return { method: 'POST', path: '', query: new URLSearchParams(), headers: {}, body, rawBody: Buffer.alloc(0), incoming: {} as ApiRequest['incoming'] }
}

export type LibraryWriter = (ctx: ApiContext, item: LibraryItemData) => Promise<{ label: string; href: string; cardId: string }>

/** Writes one entry with the Admin generator; ApiError 409 = already in the library. */
export const writeLibraryEntry: LibraryWriter = async (ctx, item) => {
  if (item.target === 'vocabulary') {
    const res = await generateWord(request({ word: item.phrase, description: generatorNotes(item), onlyNew: true }), ctx)
    const json = res.json as { entry: { word: string }; placement: { topic: string; subTopic: string } }
    const { topic, subTopic } = json.placement
    return {
      label: `Vocabulary › ${topic} › ${subTopic} › ${json.entry.word}`,
      href: `/vocabulary/${slugify(topic)}/${slugify(subTopic)}#${slugify(json.entry.word)}`,
      cardId: `vocab:${slugify(json.entry.word)}`,
    }
  }
  const res = await generateNote(request({ prompt: generatorNotes(item), type: 'auto', onlyNew: true }), ctx)
  const note = (res.json as { note: { id: string; title: string } }).note
  return { label: `Notes › ${note.title}`, href: `/notes#${note.id}`, cardId: `note:${note.id}` }
}

/**
 * Runs the kept items (`progress` is changed in place; `save` is called after every change so the card can poll it).
 * Never throws: each item ends done, skipped (already there) or error.
 */
export async function runLibraryJob(
  ctx: ApiContext,
  items: LibraryItemData[],
  progress: CoachLibraryProgress[],
  save: () => Promise<void>,
  write: LibraryWriter = writeLibraryEntry,
  // Multi-user app: one at a time per account (four would take every agy slot of the machine for one learner).
  workers = process.env.MULTI_USER === '1' ? 1 : 4,
): Promise<void> {
  let next = 0
  const one = async () => {
    while (next < progress.length) {
      const row = progress[next]
      const item = items[next++]
      row.status = 'running'
      await save().catch(() => {})
      try {
        const done = await write(ctx, item)
        await addedToLibrary(ctx, [{ term: item.phrase, cardId: done.cardId }]).catch(() => {})
        Object.assign(row, { status: 'done', label: done.label, href: done.href })
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          await addedToLibrary(ctx, [{ term: item.phrase }]).catch(() => {})
          Object.assign(row, { status: 'skipped', error: 'already in the library' })
        } else {
          Object.assign(row, { status: 'error', error: (error as Error).message.slice(0, 200) || 'failed' })
        }
      }
      await save().catch(() => {})
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, progress.length) }, one))
}
