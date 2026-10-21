import { useCallback, useEffect, useState } from 'react'
import type { Essay, EssayFeedback, EssayItem, EssayItemKind } from '@/types/essays'
import { adminApi } from '../admin/api'
import type { StoredCard } from '@/types/review'
import { reviewApi } from '../review/api'
import { cardStatus, type CardStatus } from './lib'

export interface DictionaryBox {
  source: 'longman' | 'ozdic' | null
  word: string
  url: string
  definitions: string[]
  /** The dictionary's own groups ("ADJECTIVES/NOUN + FACTOR", "VERBS"; OZDIC "ADJ", "VERB + POVERTY"). */
  groups: { heading: string; items: { phrase: string; gloss?: string; example?: string }[] }[]
  listed: boolean
  unavailable?: boolean
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/essays/${path}`, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new Error('Cannot reach the local server (npm run dev / npm start).')
  }
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error('This needs the local server (npm run dev / npm start).')
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data
}

export const essaysApi = {
  rebuild: (body: { essayId: string; paragraph: number; targets: string[]; text: string }) =>
    call<{ feedback: EssayFeedback }>('rebuild', { method: 'POST', body }).then((r) => r.feedback),
  transfer: (body: { essayId: string; task: string; targets: string[]; text: string }) =>
    call<{ feedback: EssayFeedback }>('transfer', { method: 'POST', body }).then((r) => r.feedback),
  dictionary: (word: string, phrase: string) => call<DictionaryBox>(`dictionary?${new URLSearchParams({ word, phrase })}`),
}

/** Editing an essay's items and sending a phrase to Admin (guarded admin endpoints). */
export const essayAdminApi = {
  addItem: (body: { essayId: string; sentence: number; start: number; end: number; kind: EssayItemKind | 'auto' }) =>
    adminApi<{ essay: Essay; item: EssayItem }>('essays/item', { method: 'POST', body }),
  deleteItem: (essayId: string, itemId: string) => adminApi<{ essay: Essay }>('essays/item', { method: 'DELETE', query: { essayId, itemId } }),
  toVocabulary: (word: string, context: string) =>
    adminApi<{ action: 'created' | 'updated'; entry: { word: string }; placement: { topic: string; subTopic: string } }>('vocabulary/generate', {
      method: 'POST',
      body: { word, description: context },
    }),
  toNote: (prompt: string) => adminApi<{ action: 'created' | 'updated'; note: { id: string; title: string } }>('notes/generate', { method: 'POST', body: { prompt, type: 'auto' } }),
}

/** Review progress of cards (null until loaded; `offline` when the local server is not running). */
export function useReviewCards() {
  const [cards, setCards] = useState<Record<string, StoredCard> | null>(null)
  const [offline, setOffline] = useState(false)
  const reload = useCallback(() => {
    reviewApi.state().then(
      (s) => setCards(s.cards),
      () => setOffline(true),
    )
  }, [])
  useEffect(reload, [reload])
  const status = useCallback((id: string): CardStatus => cardStatus(cards?.[id]), [cards])
  const add = useCallback(
    async (ids: string[]) => {
      const { added } = await reviewApi.add(ids)
      reload()
      return added
    },
    [reload],
  )
  /** "I know it already": the card is added if needed and marked done, so it is never scheduled and the essay dims it. */
  const markKnown = useCallback(
    async (ids: string[]) => {
      await reviewApi.add(ids)
      await reviewApi.setDone(ids, true)
      reload()
    },
    [reload],
  )
  const remove = useCallback(
    async (ids: string[]) => {
      await reviewApi.remove(ids)
      reload()
    },
    [reload],
  )
  return { cards, offline, status, add, markKnown, remove }
}

export type ReviewCards = ReturnType<typeof useReviewCards>
