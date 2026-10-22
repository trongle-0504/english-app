// The phrases of your recent Speaking results and Writing reviews as review cards ("Bài gần đây" on the Review page).
// They are the result pages' three lists, each kept as what it is:
// - "Cụm từ trong thư viện": the library card itself (Vocabulary, Collocations, Notes) — one progress for the phrase.
//   A reference-bank phrase that is not in your library gets a card of its own.
// - "Cụm ngoài thư viện" (listed in Longman / OZDIC, or judged natural) and "Cụm AI tự viết, đã tra từ điển" (listed
//   only): a "Speaking & Writing" card (content/review/speaking-writing.json) with the phrase's dictionary check and the
//   result it came from — or the library card, when you have added the phrase to Vocabulary / Notes.
// Suspicious phrases (amber, not listed and judged unnatural) are left out.
import { userPath } from '../paths.ts'
import { z } from 'zod'
import { phraseCardId, phraseGroups, PHRASE_DECK, PHRASE_DECK_ID, sentenceWith, slugify } from '../../src/features/practice/phrase-groups.ts'
import type { CardPhrase, ReviewCard, ReviewCardInput } from '../../src/types/content.ts'
import type { PhraseCardInput, PhraseGroup, RecentPhrase, RecentResponse, RecentWork, WorkKind } from '../../src/types/practice.ts'
import type { CheckedWording, SpeakingAnswer, SpeakingExtra, SpeakingResult } from '../../src/types/speaking.ts'
import type { TalkReviewResult } from '../../src/types/speakingReview.ts'
import type { WritingReviewResult } from '../../src/types/writingReview.ts'
import type { ApiContext } from '../api.ts'
import { readJsonFile, writeJsonFile } from '../files.ts'
import { deleteCard, saveCards } from '../review/custom.ts'
import { addCards, CARD_ID, readState, withProgress, writeState } from '../review/progress.ts'
import { speakingJson } from '../speaking/llm.ts'
import { reviewCards, speakingResults, speakingTitle, talkReviews, talkTitle, workHref, writingReviews, writingTitle, type WorkContext } from './works.ts'

/** A phrase of a result with what its card needs. */
interface Collected {
  term: string
  group: PhraseGroup
  /** The library card (a library phrase); undefined: a phrase card, or the library card found by its words. */
  cardId?: string
  meaning_vi?: string
  example?: string
  phrase?: CardPhrase
}

/** Library sources: a phrase written the same in one of them uses that card. */
const LIBRARY = new Set(['vocabulary', 'collocation', 'word-collocation', 'note'])

/**
 * Phrases you added to Vocabulary / Notes from here (progress/practice-aliases.json: phrase slug → library card): the
 * entry's word may differ from the phrase (Admin keeps a base form), so the link is kept rather than found again.
 */
const aliasFile = (ctx: WorkContext) => userPath(ctx, 'progress', 'practice-aliases.json')
const readAliases = (ctx: WorkContext) => readJsonFile<Record<string, string>>(aliasFile(ctx), {})

/** The library card of a phrase — added from here, or written the same in the library — or undefined. */
async function libraryOf(ctx: WorkContext, cards: ReviewCard[]): Promise<(term: string) => string | undefined> {
  const bySlug = new Map<string, string>()
  for (const card of cards) if (LIBRARY.has(card.source) && !bySlug.has(slugify(card.term))) bySlug.set(slugify(card.term), card.id)
  const ids = new Set(cards.map((c) => c.id))
  const aliases = await readAliases(ctx)
  return (term) => {
    const slug = slugify(term)
    const alias = aliases[slug]
    return alias && ids.has(alias) ? alias : bySlug.get(slug)
  }
}

const extraPhrase = (e: SpeakingExtra, group: PhraseGroup): CardPhrase => ({
  group,
  verified: e.verified,
  ...(e.natural ? { natural: true } : {}),
  dictionary: e.dictionary,
  sources: e.sources,
})
const wordingPhrase = (w: CheckedWording): CardPhrase => ({
  group: 'wording',
  verified: true,
  dictionary: w.dictionary,
  sources: w.sources,
})

/** The phrases of one Speaking answer or Writing model essay, as its page lists them. */
function collect(src: Parameters<typeof phraseGroups>[0]): Collected[] {
  const g = phraseGroups(src)
  const out: Collected[] = []
  for (const p of g.picks) {
    if (CARD_ID.test(p.cardId))
      out.push({
        term: p.term,
        group: 'library',
        cardId: p.cardId,
        meaning_vi: p.meaning_vi,
      })
    // A reference-bank phrase: not a library card.
    else
      out.push({
        term: p.term,
        group: 'library',
        meaning_vi: p.meaning_vi,
        example: sentenceWith(p.term, src) ?? p.example,
        phrase: {
          group: 'library',
          verified: true,
          dictionary: [],
          sources: [],
        },
      })
  }
  for (const e of g.extras) {
    if (!e.verified && !e.natural) continue
    out.push({
      term: e.phrase,
      group: 'extra',
      meaning_vi: e.meaning_vi,
      example: sentenceWith(e.phrase, src) ?? e.example,
      phrase: extraPhrase(e, 'extra'),
    })
  }
  for (const w of g.wording) {
    if (!w.verified || w.library) continue
    out.push({
      term: w.text,
      group: 'wording',
      meaning_vi: w.meaning_vi,
      example: sentenceWith(w.text, src),
      phrase: wordingPhrase(w),
    })
  }
  return out
}

function speakingPhrases(r: SpeakingResult): Collected[] {
  return r.answers.flatMap((a: SpeakingAnswer) => {
    if (r.mode !== 'phrases') return collect(a)
    // "Phrases only": the library items found, and the phrases proposed for your idea.
    return [
      ...(a.candidates ?? [])
        .filter((c) => CARD_ID.test(c.cardId))
        .map((c): Collected => ({
          term: c.term,
          group: 'library',
          cardId: c.cardId,
          meaning_vi: c.meaning_vi,
        })),
      ...(a.ideaPhrases ?? [])
        .filter((e) => e.verified || e.natural)
        .map((e): Collected => ({
          term: e.phrase,
          group: 'extra',
          meaning_vi: e.meaning_vi,
          example: e.example,
          phrase: extraPhrase(e, 'extra'),
        })),
    ]
  })
}

function writingPhrases(r: WritingReviewResult): Collected[] {
  const m = r.modelEssay
  return m ? collect({ ...m, picks: m.picks ?? [], extras: m.extras ?? [] }) : []
}

/** A Speaking review: the better wording its corrections gave you that a dictionary lists (short phrases only). */
function talkPhrases(r: TalkReviewResult): Collected[] {
  return (r.fixes ?? [])
    .filter((f) => ['longman', 'collocation', 'meaning'].includes(f.evidence) && f.replacement.trim().split(/\s+/).length <= 6)
    .map((f) => ({
      term: f.replacement.trim(),
      group: 'wording' as const,
      example: r.correctedSentences[f.sentenceIndex],
      phrase: { group: 'wording' as const, verified: true, dictionary: f.dictionary ?? [], sources: f.sources ?? [] },
    }))
}

interface Gathered {
  work: Omit<RecentWork, 'phrases'>
  phrases: (Collected & { id: string })[]
}

/** Your works since the cutoff (newest first) and their phrases, each with its card id. */
async function gather(ctx: WorkContext, days: number, cards: ReviewCard[]): Promise<Gathered[]> {
  const cutoff = Date.now() - days * 86_400_000
  const libraryId = await libraryOf(ctx, cards)
  const cardOf = (c: Collected) => c.cardId ?? libraryId(c.term) ?? phraseCardId(c.term)
  const works: {
    kind: WorkKind
    id: string
    title: string
    at: string
    phrases: Collected[]
  }[] = [
    ...(await speakingResults(ctx)).map((r) => ({
      kind: 'speaking' as const,
      id: r.id,
      title: speakingTitle(r),
      at: r.createdAt,
      phrases: speakingPhrases(r),
    })),
    ...(await writingReviews(ctx)).map((r) => ({
      kind: 'writing' as const,
      id: r.id,
      title: writingTitle(r),
      at: r.createdAt,
      phrases: writingPhrases(r),
    })),
    ...(await talkReviews(ctx))
      .filter((r) => r.sentences)
      .map((r) => ({
        kind: 'talk' as const,
        id: r.id,
        title: talkTitle(r),
        at: r.createdAt,
        phrases: talkPhrases(r),
      })),
  ]
  return works
    .filter((w) => Date.parse(w.at) >= cutoff)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((w) => {
      const seen = new Set<string>()
      const phrases = w.phrases.flatMap((c) => {
        const id = cardOf(c)
        if (seen.has(id) || !slugify(c.term)) return []
        seen.add(id)
        return [{ ...c, id }]
      })
      return {
        work: {
          kind: w.kind,
          id: w.id,
          title: w.title,
          at: w.at,
          href: workHref(w.kind, w.id),
        },
        phrases,
      }
    })
}

/** GET /api/practice/recent?days=N */
export async function recentWork(ctx: WorkContext, days: number): Promise<RecentResponse> {
  const cards = reviewCards(ctx)
  const exists = new Set(cards.map((c) => c.id))
  const gathered = await gather(ctx, days, cards)
  const works: RecentWork[] = gathered.map(({ work, phrases }) => ({
    ...work,
    phrases: phrases.map((p): RecentPhrase => ({
      id: p.id,
      term: p.term,
      group: p.group,
      ...(p.meaning_vi ? { meaning_vi: p.meaning_vi } : {}),
      ...(p.example ? { example: p.example } : {}),
      exists: exists.has(p.id),
    })),
  }))
  const ids = [...new Set(works.flatMap((w) => w.phrases.map((p) => p.id)))]
  return {
    days,
    works,
    ids,
    missing: ids.filter((id) => !exists.has(id)).length,
  }
}

/* ───────────── Writing the cards ───────────── */

const MeaningSchema = z.object({
  meanings: z.array(z.object({ n: z.number().int(), meaning_vi: z.string() })),
})

/** Short Vietnamese meanings, in context, for phrases that have none (the AI's own wording often has none). */
async function fillMeanings(items: ReviewCardInput[]): Promise<void> {
  const missing = items.filter((i) => !i.meaning_vi?.trim())
  for (let start = 0; start < missing.length; start += 40) {
    const batch = missing.slice(start, start + 40)
    try {
      const { value } = await speakingJson({
        label: 'practice: phrase meanings',
        system:
          'Bạn là giáo viên IELTS. Với mỗi cụm từ tiếng Anh, viết nghĩa tiếng Việt ngắn gọn (3–10 chữ) đúng với nghĩa của cụm trong câu đi kèm. Chỉ ghi nghĩa, không giải thích thêm.',
        prompt: batch
          .map((b, n) => {
            const example = b.examples?.[0]
            const sentence = typeof example === 'string' ? example : example?.en
            return `${n + 1}. ${b.term}${sentence ? ` — câu: "${sentence}"` : ''}`
          })
          .join('\n'),
        schema: MeaningSchema,
        effort: 'low',
      })
      for (const m of value.meanings) if (batch[m.n - 1] && m.meaning_vi.trim()) batch[m.n - 1].meaning_vi = m.meaning_vi.trim()
    } catch (error) {
      // A card without a meaning still works (its sentence and dictionary lines are on it).
      console.warn('[practice] meanings failed:', (error as Error).message)
    }
  }
}

const cardInput = (c: Collected, from: { kind: WorkKind; id: string; title: string }): ReviewCardInput => ({
  term: c.term,
  ...(c.meaning_vi ? { meaning_vi: c.meaning_vi } : {}),
  ...(c.example ? { examples: [c.example] } : {}),
  tags: [from.kind, c.group],
  ...(c.phrase ? { phrase: c.phrase } : {}),
  from,
})

/**
 * A phrase card whose phrase is now in your library (you added it to Vocabulary / Notes): one card per phrase. Progress
 * you made on the phrase card goes to the library card when that one has none of its own (a new library card keeps
 * its "learn today"); the phrase card leaves your reviews and its deck.
 */
async function mergeIntoLibrary(ctx: ApiContext, pairs: { phraseId: string; libraryId: string }[]): Promise<number> {
  const written = new Set(reviewCards(ctx).map((c) => c.id))
  const merged = await withProgress(ctx, async () => {
    const state = await readState(ctx)
    const done: string[] = []
    for (const { phraseId, libraryId } of pairs) {
      const old = state.cards[phraseId]
      if (!old) continue
      const target = state.cards[libraryId]
      const uses = [...(target?.uses ?? []), ...(old.uses ?? [])]
      if (!target || (old.fsrs.reps > 0 && target.fsrs.reps === 0)) state.cards[libraryId] = { ...old, ...(uses.length ? { uses } : {}) }
      else if (uses.length) target.uses = uses
      delete state.cards[phraseId]
      done.push(phraseId)
    }
    if (done.length) await writeState(ctx, state)
    return done
  })
  for (const { phraseId } of pairs) if (written.has(phraseId)) await deleteCard(ctx, PHRASE_DECK_ID, phraseId.split(':').pop()!).catch(() => {})
  return merged.length
}

/**
 * Phrases you just added to Vocabulary / Notes (the Admin generator wrote the entry and put its card in your reviews):
 * each phrase uses that card from now on — remembered, as the entry's word may differ — and its "Speaking & Writing"
 * card is merged into it. POST /api/practice/library-added { items: [{ term, cardId? }] }.
 */
export async function addedToLibrary(ctx: ApiContext, items: { term: string; cardId?: string }[]): Promise<{ linked: number; merged: number }> {
  const cards = reviewCards(ctx)
  const ids = new Set(cards.map((c) => c.id))
  const libraryId = await libraryOf(ctx, cards)
  const aliases = await readAliases(ctx)
  const pairs: { phraseId: string; libraryId: string }[] = []
  for (const item of items) {
    const id = item.cardId && ids.has(item.cardId) ? item.cardId : libraryId(item.term)
    if (!id) continue
    aliases[slugify(item.term)] = id
    pairs.push({ phraseId: phraseCardId(item.term), libraryId: id })
  }
  if (pairs.length) await writeJsonFile(aliasFile(ctx), aliases)
  return { linked: pairs.length, merged: await mergeIntoLibrary(ctx, pairs) }
}

/**
 * Writes the cards your recent work still lacks and puts every card of it in your reviews (new cards wait for a
 * session; nothing is due before you study it). POST /api/practice/recent/cards { days }.
 */
export async function createRecentCards(ctx: ApiContext, days: number): Promise<{ created: number; added: number; merged: number }> {
  const cards = reviewCards(ctx)
  const exists = new Set(cards.map((c) => c.id))
  const gathered = await gather(ctx, days, cards)
  const toWrite = new Map<string, ReviewCardInput>()
  const pairs: { phraseId: string; libraryId: string }[] = []
  for (const { work, phrases } of gathered) {
    for (const p of phrases) {
      const own = phraseCardId(p.term)
      if (p.id !== own && exists.has(own)) pairs.push({ phraseId: own, libraryId: p.id })
      if (exists.has(p.id) || toWrite.has(p.id) || p.id !== own) continue
      toWrite.set(p.id, cardInput(p, { kind: work.kind, id: work.id, title: work.title }))
    }
  }
  const inputs = [...toWrite.values()]
  await fillMeanings(inputs)
  const created = inputs.length ? (await saveCards(ctx, PHRASE_DECK, inputs)).saved.length : 0
  const added = await addCards(ctx, [...new Set(gathered.flatMap((g) => g.phrases.map((p) => p.id)))].filter((id) => CARD_ID.test(id)))
  const merged = pairs.length ? await mergeIntoLibrary(ctx, pairs) : 0
  return { created, added, merged }
}

/** The card of each phrase — the library card when the phrase is in your library — for the result pages' buttons. */
export async function cardIdsOf(ctx: WorkContext, terms: string[]): Promise<string[]> {
  const libraryId = await libraryOf(ctx, reviewCards(ctx))
  return terms.map((term) => libraryId(term) ?? phraseCardId(term))
}

/**
 * The "Ôn tập" button of a phrase on a result page: the library card when the phrase is in your library, else its
 * "Speaking & Writing" card (written when missing); either is put in your reviews. POST /api/practice/cards.
 */
export async function phraseCards(
  ctx: ApiContext,
  phrases: (PhraseCardInput & { group: PhraseGroup; phrase?: CardPhrase })[],
  from: { kind: WorkKind; id: string; title: string },
): Promise<{ ids: string[] }> {
  const cards = reviewCards(ctx)
  const exists = new Set(cards.map((c) => c.id))
  const libraryId = await libraryOf(ctx, cards)
  const ids: string[] = []
  const inputs: ReviewCardInput[] = []
  for (const p of phrases) {
    const id = libraryId(p.term) ?? phraseCardId(p.term)
    ids.push(id)
    if (!exists.has(id) && id === phraseCardId(p.term) && !inputs.some((i) => slugify(i.term) === slugify(p.term))) inputs.push(cardInput(p, from))
  }
  await fillMeanings(inputs)
  if (inputs.length) await saveCards(ctx, PHRASE_DECK, inputs)
  await addCards(
    ctx,
    ids.filter((id) => CARD_ID.test(id)),
  )
  return { ids }
}
