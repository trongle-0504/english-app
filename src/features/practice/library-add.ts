// Adds a phrase from your Speaking / Writing to the library: a full Vocabulary or Notes entry written by the Admin
// generator (meanings, examples, collocations and the review drills: Tự dùng questions, rewrites, a dictation sentence).
// Used by the result pages' Vocabulary / Notes buttons and the "Bài gần đây" list of the Review page.
import { adminApi, refreshSiteData } from '@/features/admin/api'
import { slugify } from '@/lib/text'

export type LibraryTarget = 'vocabulary' | 'note'

const adminNotes = (extra: { phrase: string; meaning_vi: string; example: string }) =>
  `${extra.phrase}\n- Nghĩa: ${extra.meaning_vi}\n- Example: ${extra.example}`

/**
 * Creates the full entry with the Admin generator (Gemini, which also checks OZDIC / Longman and picks the topic),
 * right here. `onlyNew`: an entry that already exists is never replaced — the server answers 409 instead. `cardId`: the
 * entry's review card (the generator puts it in your reviews, to learn today).
 */
export async function addToLibrary(
  target: LibraryTarget,
  extra: { phrase: string; meaning_vi: string; example: string },
): Promise<{ label: string; href: string; cardId: string }> {
  if (target === 'vocabulary') {
    const res = await adminApi<{ entry: { word: string }; placement: { topic: string; subTopic: string } }>('vocabulary/generate', {
      method: 'POST',
      body: { word: extra.phrase, description: adminNotes(extra), onlyNew: true },
    })
    refreshSiteData('vocabulary')
    const { topic, subTopic } = res.placement
    return {
      label: `Vocabulary › ${topic} › ${subTopic}`,
      href: `/vocabulary/${slugify(topic)}/${slugify(subTopic)}#${slugify(res.entry.word)}`,
      cardId: `vocab:${slugify(res.entry.word)}`,
    }
  }
  const res = await adminApi<{ note: { id: string; title: string } }>('notes/generate', {
    method: 'POST',
    body: { prompt: adminNotes(extra), type: 'auto', onlyNew: true },
  })
  refreshSiteData('notes.json')
  return { label: `Notes › ${res.note.title}`, href: `/notes#${res.note.id}`, cardId: `note:${res.note.id}` }
}
