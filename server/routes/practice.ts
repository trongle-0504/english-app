import type { CardPhrase } from '../../src/types/content.ts'
import type { PhraseGroup, WorkKind } from '../../src/types/practice.ts'
import { guarded } from '../admin/auth.ts'
import { isObject, jsonBody, requiredObject, stringList } from '../admin/input.ts'
import { ApiError, type ApiHandler, type ApiRequest } from '../api.ts'
import { mistakeBook, mistakeCards } from '../practice/mistakes.ts'
import { creditRealUse } from '../practice/real-use.ts'
import { addedToLibrary, cardIdsOf, createRecentCards, phraseCards, recentWork } from '../practice/recent.ts'

const GROUPS: PhraseGroup[] = ['library', 'extra', 'wording']

/** 1–90 days (default 7). */
function daysOf(value: unknown): number {
  const n = Number(value ?? 7)
  if (!Number.isInteger(n) || n < 1 || n > 90) throw new ApiError(400, '`days` must be 1–90.')
  return n
}
const daysParam = (req: ApiRequest) => daysOf(req.query.get('days') ?? 7)

const text = (value: unknown, max = 1000) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined)

/** Speaking & Writing ↔ Review endpoints, under /api/practice. Card writes (content/review) are guarded. */
export const practiceRoutes: Record<string, ApiHandler> = {
  /** Your recent work's phrases as review cards. Texts not scanned yet are scanned first (cards you used yourself). */
  'GET /practice/recent': async (req, ctx) => {
    await creditRealUse(ctx)
    return { json: await recentWork(ctx, daysParam(req)) }
  },

  /** { days, phraseIds? }: writes selected missing cards of the period and puts them in reviews. */
  'POST /practice/recent/cards': guarded(async (req, ctx) => {
    const body = jsonBody(req)
    const phraseIds = Array.isArray(body.phraseIds)
      ? body.phraseIds.filter((id: unknown): id is string => typeof id === 'string').slice(0, 200)
      : undefined
    return { json: await createRecentCards(ctx, daysOf(body.days), phraseIds) }
  }),

  /** { phrases: [{ term, group, meaning_vi?, example?, phrase? }], from: { kind, id, title } }: the "Ôn tập" button of a phrase. */
  'POST /practice/cards': guarded(async (req, ctx) => {
    const body = jsonBody(req)
    const from = requiredObject(body, 'from')
    const kind = from.kind === 'speaking' || from.kind === 'writing' ? (from.kind as WorkKind) : null
    const id = text(from.id, 40)
    if (!kind || !id || !/^[a-z0-9-]+$/i.test(id)) throw new ApiError(400, '`from` must be { kind: speaking | writing, id }.')
    if (!Array.isArray(body.phrases) || !body.phrases.length || body.phrases.length > 50) throw new ApiError(400, '`phrases`: 1–50 phrases.')
    const phrases = body.phrases.map((raw, i) => {
      if (!isObject(raw)) throw new ApiError(400, `phrases[${i}] must be an object.`)
      const term = text(raw.term, 200)
      const group = GROUPS.includes(raw.group as PhraseGroup) ? (raw.group as PhraseGroup) : null
      if (!term || !group) throw new ApiError(400, `phrases[${i}] needs a term and a group.`)
      const p = isObject(raw.phrase) ? raw.phrase : null
      const phrase: CardPhrase | undefined = p
        ? {
            group,
            verified: Boolean(p.verified),
            ...(p.natural ? { natural: true } : {}),
            dictionary: stringList(p.dictionary, 'dictionary').slice(0, 12),
            sources: (Array.isArray(p.sources) ? p.sources : [])
              .filter((s): s is { name: string; url: string } => isObject(s) && typeof s.name === 'string' && typeof s.url === 'string')
              .slice(0, 6),
          }
        : undefined
      return {
        term,
        group,
        meaning_vi: text(raw.meaning_vi, 300),
        example: text(raw.example, 600),
        ...(phrase ? { phrase } : {}),
      }
    })
    return {
      json: await phraseCards(ctx, phrases, {
        kind,
        id,
        title: text(from.title, 120) ?? '',
      }),
    }
  }),

  /** { terms }: the card of each phrase (the library card when the phrase is in your library), in order. */
  'POST /practice/card-ids': async (req, ctx) => {
    const terms = stringList(jsonBody(req).terms, 'terms')
    if (terms.length > 300) throw new ApiError(400, ': at most 300.')
    return { json: { ids: await cardIdsOf(ctx, terms) } }
  },

  /** { items: [{ term, cardId? }] }: phrases just added to Vocabulary / Notes — they use that card from now on. */
  'POST /practice/library-added': guarded(async (req, ctx) => {
    const body = jsonBody(req)
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) throw new ApiError(400, '`items`: 1–100 phrases.')
    const items = body.items.flatMap((raw) => {
      if (!isObject(raw)) return []
      const term = text(raw.term, 200)
      const cardId = text(raw.cardId, 200)
      return term ? [{ term, ...(cardId ? { cardId } : {}) }] : []
    })
    return { json: await addedToLibrary(ctx, items) }
  }),

  /** Sổ lỗi: your mistakes, their kinds, the repeated ones and the trend. */
  'GET /practice/mistakes': async (_req, ctx) => ({
    json: await mistakeBook(ctx),
  }),

  /** { keys }: review cards of these mistakes. */
  'POST /practice/mistakes/cards': guarded(async (req, ctx) => {
    const keys = stringList(jsonBody(req).keys, 'keys')
    if (!keys.length || keys.length > 100) throw new ApiError(400, '`keys`: 1–100 mistakes.')
    return { json: await mistakeCards(ctx, keys) }
  }),
}
