import { schedule } from '../../src/features/review/schedule.ts'
import { nextStage, stageOf, USAGE_STAGES, usageStageOf } from '../../src/features/review/ladder.ts'
import { DEFAULT_REVIEW_SETTINGS, type BasicReviewMode, type ProduceVerdict, type ReviewMode, type ReviewSettings, type ReviewStateResponse } from '../../src/types/review.ts'
import { guarded } from '../admin/auth.ts'
import { jsonBody, queryParam, requiredText } from '../admin/input.ts'
import { ApiError, type ApiHandler } from '../api.ts'
import { generateCards, deckSlug, deleteCard, parseImport, saveCards } from '../review/custom.ts'
import { addCards, appendLog, appendUsageLog, CARD_ID, dropLastLog, readLog, readState, today, withProgress, writeState } from '../review/progress.ts'
import { checkProduce } from '../review/produce.ts'
import { computeStats } from '../review/stats.ts'

const BASIC_MODES: BasicReviewMode[] = ['recognize', 'recall', 'listen']
const MODES: ReviewMode[] = [...BASIC_MODES, 'collocate', 'paraphrase', 'produce']
const VERDICTS: ProduceVerdict[] = ['ok', 'missing', 'wrong_meaning', 'wrong_collocation', 'wrong_form', 'changed_meaning']

function idList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !CARD_ID.test(v))) {
    throw new ApiError(400, '`ids` must be a list of card ids.')
  }
  return value as string[]
}

function settingsPatch(body: Record<string, unknown>): Partial<ReviewSettings> {
  const patch: Partial<ReviewSettings> = {}
  if (body.newPerDay !== undefined) {
    const n = Number(body.newPerDay)
    if (!Number.isInteger(n) || n < 0 || n > 500) throw new ApiError(400, 'New cards per day must be 0–500.')
    patch.newPerDay = n
  }
  if (body.autoAddFromAdmin !== undefined) patch.autoAddFromAdmin = Boolean(body.autoAddFromAdmin)
  if (body.retention !== undefined) {
    const r = Number(body.retention)
    if (!(r >= 0.7 && r <= 0.97)) throw new ApiError(400, 'Retention must be between 0.70 and 0.97.')
    patch.retention = r
  }
  if (body.modes !== undefined) {
    const modes = Array.isArray(body.modes) ? body.modes.filter((m): m is BasicReviewMode => BASIC_MODES.includes(m as BasicReviewMode)) : []
    if (!modes.length) throw new ApiError(400, 'Pick at least one review mode.')
    patch.modes = [...new Set(modes)]
  }
  if (body.ladder !== undefined) patch.ladder = Boolean(body.ladder)
  return patch
}

/** Review (spaced repetition) endpoints, under /api/review. Progress writes are open; deck-file writes are guarded. */
export const reviewRoutes: Record<string, ApiHandler> = {
  'GET /review/state': async (_req, ctx) => {
    const state = await readState(ctx)
    const log = await readLog(ctx)
    const day = today(state.settings)
    const todays = log.filter((e) => e.day === day)
    const json: ReviewStateResponse = {
      settings: state.settings,
      cards: state.cards,
      today: { day, reviewed: todays.length, newStudied: todays.filter((e) => e.prev.state === 0).length },
    }
    return { json }
  },

  'GET /review/history': async (_req, ctx) => ({
    json: { entries: (await readLog(ctx)).map(({ id, day, rating, review }) => ({ id, day, rating, review })) },
  }),

  'GET /review/stats': async (_req, ctx) => ({ json: computeStats(await readState(ctx), await readLog(ctx)) }),

  'POST /review/add': async (req, ctx) => ({ json: { added: await addCards(ctx, idList(jsonBody(req).ids)) } }),

  'POST /review/remove': async (req, ctx) => {
    const ids = idList(jsonBody(req).ids)
    const removed = await withProgress(async () => {
      const state = await readState(ctx)
      let count = 0
      for (const id of ids) if (state.cards[id] && delete state.cards[id]) count++
      if (count) await writeState(ctx, state)
      return count
    })
    return { json: { removed } }
  },

  /**
   * Moves cards between "learning" and "done". Done cards keep their FSRS state but are never scheduled.
   * Moving back makes a studied card due now (memory stability is kept), so it shows up in today's session.
   */
  'POST /review/status': async (req, ctx) => {
    const body = jsonBody(req)
    const ids = idList(body.ids)
    const done = Boolean(body.done)
    const changed = await withProgress(async () => {
      const state = await readState(ctx)
      const now = new Date()
      const stamp = now.toISOString()
      let count = 0
      for (const id of ids) {
        const card = state.cards[id]
        if (!card || Boolean(card.done) === done) continue
        if (done) card.done = stamp
        else {
          delete card.done
          if (card.fsrs.state !== 0 && Date.parse(card.fsrs.due) > now.getTime()) card.fsrs = { ...card.fsrs, due: stamp }
        }
        count++
      }
      if (count) await writeState(ctx, state)
      return count
    })
    return { json: { changed } }
  },

  /**
   * { id, mode, rating, verdict? }: one answer in "Luyện dùng từ". Moves the usage stage only — the FSRS schedule and the
   * review stats are untouched — and marks the card as practised today (once a day per card).
   */
  'POST /review/usage': async (req, ctx) => {
    const body = jsonBody(req)
    const id = requiredText(body, 'id')
    const rating = Number(body.rating)
    if (![1, 2, 3, 4].includes(rating)) throw new ApiError(400, '`rating` must be 1–4.')
    const mode = body.mode as ReviewMode
    if (!USAGE_STAGES.includes(mode as (typeof USAGE_STAGES)[number])) throw new ApiError(400, '`mode` must be collocate, paraphrase or produce.')
    const verdict = VERDICTS.includes(body.verdict as ProduceVerdict) ? (body.verdict as ProduceVerdict) : undefined
    const card = await withProgress(async () => {
      const state = await readState(ctx)
      const stored = state.cards[id]
      if (!stored) throw new ApiError(404, 'This card is not in your reviews.')
      if (!state.settings.ladder || stored.ladder === false) throw new ApiError(409, 'The usage ladder is switched off for this card.')
      const now = new Date()
      const from = usageStageOf(stored)
      stored.stage = nextStage(from, mode, rating as 1 | 2 | 3 | 4, verdict)
      stored.usedOn = today(state.settings, now)
      await writeState(ctx, state)
      await appendUsageLog(ctx, { at: now.toISOString(), id, mode, rating: rating as 1 | 2 | 3 | 4, ...(verdict ? { verdict } : {}), from, to: stored.stage })
      return stored
    })
    return { json: { id, card } }
  },

  /** { ids, on }: switches the usage ladder on or off for these cards (off = only recognised; the stage is kept). */
  'POST /review/ladder': async (req, ctx) => {
    const body = jsonBody(req)
    const ids = idList(body.ids)
    const on = Boolean(body.on)
    const changed = await withProgress(async () => {
      const state = await readState(ctx)
      let count = 0
      for (const id of ids) {
        const card = state.cards[id]
        if (!card || (card.ladder !== false) === on) continue
        if (on) delete card.ladder
        else card.ladder = false
        count++
      }
      if (count) await writeState(ctx, state)
      return count
    })
    return { json: { changed } }
  },

  'POST /review/grade': async (req, ctx) => {
    const body = jsonBody(req)
    const id = requiredText(body, 'id')
    const rating = Number(body.rating)
    if (![1, 2, 3, 4].includes(rating)) throw new ApiError(400, '`rating` must be 1–4.')
    const mode = MODES.includes(body.mode as ReviewMode) ? (body.mode as ReviewMode) : 'recognize'
    const durationMs = Number.isFinite(Number(body.durationMs)) ? Math.max(0, Math.min(Number(body.durationMs), 3_600_000)) : undefined
    // "Use it" sentences send the kind of mistake: it decides which stage the card drops back to.
    const verdict = VERDICTS.includes(body.verdict as ProduceVerdict) ? (body.verdict as ProduceVerdict) : undefined
    const card = await withProgress(async () => {
      const state = await readState(ctx)
      const stored = state.cards[id]
      if (!stored) throw new ApiError(404, 'This card is not in your reviews.')
      const now = new Date()
      const prev = stored.fsrs
      const prevStage = stored.stage
      stored.fsrs = schedule(prev, rating as 1 | 2 | 3 | 4, state.settings, now)
      if (state.settings.ladder && stored.ladder !== false) stored.stage = nextStage(stageOf({ ...stored, fsrs: prev }), mode, rating as 1 | 2 | 3 | 4, verdict)
      await writeState(ctx, state)
      await appendLog(ctx, {
        id,
        rating: rating as 1 | 2 | 3 | 4,
        mode,
        review: now.toISOString(),
        day: today(state.settings, now),
        durationMs,
        prev,
        ...(prevStage ? { prevStage } : {}),
      })
      return stored
    })
    return { json: { id, card } }
  },

  /** "Use it" sentences: Gemini checks how the target is used; the grade is suggested by code. */
  'POST /review/produce': async (req, ctx) => ({ json: await checkProduce(ctx, jsonBody(req)) }),

  'POST /review/undo': async (_req, ctx) => {
    const result = await withProgress(async () => {
      const log = await readLog(ctx)
      const last = log.at(-1)
      if (!last) throw new ApiError(404, 'Nothing to undo.')
      const state = await readState(ctx)
      const card = state.cards[last.id]
      if (card) {
        card.fsrs = last.prev
        if (last.prevStage) card.stage = last.prevStage
        else delete card.stage
      }
      await writeState(ctx, state)
      await dropLastLog(ctx, log)
      return { id: last.id, card: state.cards[last.id] ?? null }
    })
    return { json: result }
  },

  'PUT /review/settings': async (req, ctx) => {
    const patch = settingsPatch(jsonBody(req))
    const settings = await withProgress(async () => {
      const state = await readState(ctx)
      state.settings = { ...DEFAULT_REVIEW_SETTINGS, ...state.settings, ...patch }
      await writeState(ctx, state)
      return state.settings
    })
    return { json: { settings } }
  },

  /* Your own cards (content/review/<deck>.json) */

  'POST /review/custom': guarded(async (req, ctx) => {
    const body = jsonBody(req)
    const result = await saveCards(ctx, requiredText(body, 'deck', { max: 80 }), [body.card], { replace: Boolean(body.replace) })
    if (!result.saved.length) throw new ApiError(409, `"${result.skipped[0]}" is already in this deck.`)
    return { status: 201, json: result }
  }),

  'POST /review/custom/generate': guarded(async (req, ctx) => {
    const body = jsonBody(req)
    const deck = requiredText(body, 'deck', { max: 80 })
    const term = requiredText(body, 'term', { max: 200 })
    const [card] = await generateCards(ctx, [{ term, meaning_vi: typeof body.hint === 'string' ? body.hint.trim() : undefined }])
    const result = await saveCards(ctx, deck, [card], { replace: Boolean(body.replace) })
    if (!result.saved.length) throw new ApiError(409, `"${term}" is already in this deck.`)
    return { status: 201, json: { ...result, card } }
  }),

  'POST /review/custom/import': guarded(async (req, ctx) => {
    const body = jsonBody(req)
    const deck = requiredText(body, 'deck', { max: 80 })
    let cards = parseImport(requiredText(body, 'text', { max: 200_000 }))
    if (!cards.length) throw new ApiError(400, 'No cards found in the pasted text.')
    if (cards.length > 300) throw new ApiError(400, 'Import at most 300 cards at a time.')
    if (body.fill) {
      const missing = cards.filter((c) => !c.meaning_vi || !c.pronunciation || !c.examples?.length)
      const filled = await generateCards(ctx, missing)
      cards = cards.map((c) => filled[missing.indexOf(c)] ?? c)
    }
    return { status: 201, json: await saveCards(ctx, deck, cards, { replace: Boolean(body.replace) }) }
  }),

  'DELETE /review/custom': guarded(async (req, ctx) => {
    await deleteCard(ctx, deckSlug(queryParam(req, 'deck')), queryParam(req, 'card'))
    return { json: { ok: true } }
  }),
}
