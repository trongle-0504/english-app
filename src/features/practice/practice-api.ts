// Speaking & Writing ↔ Review (server/routes/practice.ts): your recent work's phrases as review cards, the "Ôn tập"
// button of a phrase, and the Sổ lỗi.
import { getAdminToken } from '@/features/admin/api'
import { invalidateData, loadData } from '@/lib/data'
import type { CardPhrase, ReviewIndex } from '@/types/content'
import { phraseCardId } from './phrase-groups'
import type { MistakeBook, PhraseCardInput, PhraseGroup, RecentResponse, WorkKind } from '@/types/practice'

async function call<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getAdminToken()
  if (token) headers['x-admin-token'] = token
  let res: Response
  try {
    res = await fetch(`/api/practice/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Không kết nối được máy chủ của app (npm run dev / npm start).')
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`)
  return json
}

export const practiceApi = {
  recent: (days: number) => call<RecentResponse>(`recent?days=${days}`),
  createRecentCards: (days: number) =>
    call<{ created: number; added: number; merged: number }>('recent/cards', {
      days,
    }),
  phraseCards: (phrases: (PhraseCardInput & { group: PhraseGroup; phrase?: CardPhrase })[], from: { kind: WorkKind; id: string; title: string }) =>
    call<{ ids: string[] }>('cards', { phrases, from }),
  libraryAdded: (items: { term: string; cardId?: string }[]) => call<{ linked: number; merged: number }>('library-added', { items }),
  mistakes: () => call<MistakeBook>('mistakes'),
  mistakeCards: (keys: string[]) => call<{ ids: string[] }>('mistakes/cards', { keys }),
}

/* The card of a phrase (the library card when it is in your library): the buttons of a page ask together, once. */
const idCache = new Map<string, Promise<string>>()
let waiting: { term: string; resolve: (id: string) => void }[] = []
let flushTimer: ReturnType<typeof setTimeout> | undefined

async function flushIds() {
  const batch = waiting
  waiting = []
  flushTimer = undefined
  try {
    const { ids } = await call<{ ids: string[] }>('card-ids', { terms: batch.map((b) => b.term) })
    batch.forEach((b, i) => b.resolve(ids[i] ?? phraseCardId(b.term)))
  } catch {
    batch.forEach((b) => b.resolve(phraseCardId(b.term)))
  }
}

export function cardIdOf(term: string): Promise<string> {
  const key = term.trim().toLowerCase()
  let id = idCache.get(key)
  if (!id) {
    id = new Promise<string>((resolve) => {
      waiting.push({ term: term.trim(), resolve })
      flushTimer ??= setTimeout(() => void flushIds(), 30)
    })
    idCache.set(key, id)
  }
  return id
}

/**
 * Waits until the card index has these cards: cards written to content/review are rebuilt into review/index.json by
 * the content watcher a moment later. Gives up after ~10 s (the cards then show on the next load).
 */
export async function waitForCards(ids: string[]): Promise<boolean> {
  for (let attempt = 0; attempt < 25; attempt++) {
    invalidateData('review/')
    try {
      const index = await loadData<ReviewIndex>('review/index.json')
      const have = new Set(index.cards.map((c) => c.id))
      if (ids.every((id) => have.has(id))) return true
    } catch {
      // The rebuild may be half-way: try again.
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}
