// Sổ lỗi: the mistakes of your own writing — every correction of your Writing reviews, and the phrases the analysis
// flagged in the Speaking answers / model essays you edited — sorted into kinds (by code: articles, prepositions,
// singular/plural, then the review's own kinds), the ones you make again, and how many per 100 words over time. A
// correction becomes a review card ("Sổ lỗi" deck) that shows your sentence for you to correct.
import { MISTAKE_DECK, MISTAKE_DECK_ID, slugify } from '../../src/features/practice/phrase-groups.ts'
import type { ReviewCardInput } from '../../src/types/content.ts'
import type { MistakeBook, MistakeCategory, MistakeGroup, MistakeItem, MistakeTrendPoint } from '../../src/types/practice.ts'
import type { AnswerSentence } from '../../src/types/speaking.ts'
import type { WritingFix } from '../../src/types/writingReview.ts'
import type { ApiContext } from '../api.ts'
import { ApiError } from '../api.ts'
import { saveCards } from '../review/custom.ts'
import { readState, withProgress, writeState } from '../review/progress.ts'
import { reviewCards, segmentsText, speakingResults, speakingTitle, talkReviews, talkTitle, workHref, writingReviews, writingTitle, type WorkContext } from './works.ts'

const ARTICLES = new Set(['a', 'an', 'the'])
const PREPOSITIONS = new Set(
  'at in on to for from with about into onto over under after before by through during without between against among towards toward across behind beyond upon within of off out up down'.split(
    ' ',
  ),
)
const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/’/g, "'")
    .match(/[a-z]+(?:'[a-z]+)?/g) ?? []
/** "studies" ~ "study", "children" stays: enough to see a singular / plural slip. */
const singular = (w: string) =>
  w.length > 3
    ? w
        .replace(/ies$/, 'y')
        .replace(/(?<=[sxz]|ch|sh)es$/, '')
        .replace(/(?<!s)s$/, '')
    : w

const TYPE_CATEGORY: Record<WritingFix['type'], MistakeCategory> = {
  spelling: 'spelling',
  grammar: 'grammar',
  'word form': 'word_form',
  collocation: 'collocation',
  'word choice': 'word_choice',
  naturalness: 'naturalness',
  confusable: 'confusable',
  'verb pattern': 'verb_pattern',
}

/** The kind of a correction: what changed decides (only articles, only prepositions, only -s), else the review's kind. */
export function categoryOf(fix: Pick<WritingFix, 'original' | 'replacement' | 'type'>): MistakeCategory {
  const a = words(fix.original)
  const b = words(fix.replacement)
  const removed = a.filter((w) => !b.includes(w))
  const added = b.filter((w) => !a.includes(w))
  const changed = [...removed, ...added]
  if (changed.length && changed.every((w) => ARTICLES.has(w))) return 'article'
  if (changed.length && changed.every((w) => PREPOSITIONS.has(w))) return 'preposition'
  if (removed.length && removed.length === added.length && removed.every((w, i) => singular(w) === singular(added[i]) && w !== added[i]))
    return 'number'
  return TYPE_CATEGORY[fix.type] ?? 'grammar'
}

/** The same mistake written in another form or sentence has the same key. */
const keyOf = (category: MistakeCategory, wrong: string, right: string) =>
  `${category}|${words(wrong).map(singular).join(' ')}|${words(right).map(singular).join(' ')}`

/** The card key of a mistake (a slug, at most 80 characters) and its card. */
const cardKey = (key: string) => slugify(slugify(key).slice(0, 80))
export const mistakeCardId = (key: string) => `custom:${MISTAKE_DECK_ID}:${cardKey(key)}`

/** Phrases flagged as unnatural in a text you edited. */
function flaggedIn(sentences: AnswerSentence[]): { phrase: string; why: string; sentence: string }[] {
  return sentences.flatMap((s) =>
    s.segments
      .filter((g) => g.mark === 'unverified' && g.text.trim())
      .map((g) => ({
        phrase: g.text.trim(),
        why: g.note ?? '',
        sentence: segmentsText(s.segments).trim(),
      })),
  )
}

/** Every mistake, newest work first. */
async function allMistakes(ctx: WorkContext): Promise<{ items: MistakeItem[]; trend: MistakeTrendPoint[] }> {
  const items: MistakeItem[] = []
  const trend: MistakeTrendPoint[] = []
  for (const r of await writingReviews(ctx)) {
    const base = {
      kind: 'writing' as const,
      workId: r.id,
      title: writingTitle(r),
      at: r.createdAt,
      href: workHref('writing', r.id),
    }
    for (const fix of r.fixes) {
      const category = categoryOf(fix)
      items.push({
        ...base,
        key: keyOf(category, fix.original, fix.replacement),
        category,
        severity: fix.severity ?? 'error',
        sentence: r.sentences[fix.sentenceIndex] ?? '',
        wrong: fix.original,
        right: fix.replacement,
        fixed: r.correctedSentences[fix.sentenceIndex],
        why: fix.explanation,
        dictionary: fix.dictionary ?? [],
      })
    }
    const count = words(r.text).length
    const errors = r.fixes.filter((f) => (f.severity ?? 'error') === 'error').length
    trend.push({
      id: r.id,
      at: r.createdAt,
      title: writingTitle(r),
      words: count,
      errors,
      per100: count ? Math.round((errors * 1000) / count) / 10 : 0,
    })
    if (r.modelEssay?.userEdited) {
      for (const f of flaggedIn(r.modelEssay.sentences ?? [])) {
        items.push({
          ...base,
          key: keyOf('flagged', f.phrase, ''),
          category: 'flagged',
          severity: 'error',
          sentence: f.sentence,
          wrong: f.phrase,
          right: '',
          why: f.why,
          dictionary: [],
        })
      }
    }
  }
  // What you said in a Speaking review: its corrections, like a Writing review's (no trend: speech is not counted per 100 words).
  for (const r of await talkReviews(ctx)) {
    for (const fix of r.fixes ?? []) {
      const category = categoryOf(fix)
      items.push({
        kind: 'talk',
        workId: r.id,
        title: talkTitle(r),
        at: r.createdAt,
        href: workHref('talk', r.id),
        key: keyOf(category, fix.original, fix.replacement),
        category,
        severity: fix.severity ?? 'error',
        sentence: r.sentences[fix.sentenceIndex] ?? '',
        wrong: fix.original,
        right: fix.replacement,
        fixed: r.correctedSentences[fix.sentenceIndex],
        why: fix.explanation,
        dictionary: fix.dictionary ?? [],
      })
    }
  }
  for (const r of await speakingResults(ctx)) {
    r.answers.forEach((a, part) => {
      if (!a.userEdited) return
      for (const f of flaggedIn(a.sentences ?? [])) {
        items.push({
          kind: 'speaking',
          workId: r.id,
          part,
          title: speakingTitle(r),
          at: r.createdAt,
          href: workHref('speaking', r.id),
          key: keyOf('flagged', f.phrase, ''),
          category: 'flagged',
          severity: 'error',
          sentence: f.sentence,
          wrong: f.phrase,
          right: '',
          why: f.why,
          dictionary: [],
        })
      }
    })
  }
  items.sort((a, b) => b.at.localeCompare(a.at))
  trend.sort((a, b) => a.at.localeCompare(b.at))
  return { items, trend }
}

/** GET /api/practice/mistakes */
export async function mistakeBook(ctx: WorkContext): Promise<MistakeBook> {
  const { items, trend } = await allMistakes(ctx)
  const cards = new Set(reviewCards(ctx).map((c) => c.id))
  const groups = new Map<string, MistakeGroup>()
  for (const item of items) {
    const group = groups.get(item.key)
    if (group) group.count++
    else {
      const cardId = mistakeCardId(item.key)
      groups.set(item.key, {
        key: item.key,
        category: item.category,
        wrong: item.wrong,
        right: item.right,
        count: 1,
        ...(cards.has(cardId) ? { cardId } : {}),
      })
    }
  }
  const categories = new Map<MistakeCategory, { id: MistakeCategory; count: number; errors: number }>()
  for (const item of items) {
    const c = categories.get(item.category) ?? {
      id: item.category,
      count: 0,
      errors: 0,
    }
    c.count++
    if (item.severity === 'error') c.errors++
    categories.set(item.category, c)
  }
  return {
    items,
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
    categories: [...categories.values()].sort((a, b) => b.count - a.count),
    trend,
  }
}

/**
 * Review cards of these mistakes (their latest sentence): "Sổ lỗi" deck, practised only by correcting the sentence (the
 * usage ladder is off for them). POST /api/practice/mistakes/cards { keys }.
 */
export async function mistakeCards(ctx: ApiContext, keys: string[]): Promise<{ ids: string[] }> {
  const { items } = await allMistakes(ctx)
  const inputs: ReviewCardInput[] = []
  for (const key of new Set(keys)) {
    const item = items.find((i) => i.key === key && i.right)
    if (!item) continue
    inputs.push({
      id: cardKey(key),
      term: `${item.wrong} → ${item.right}`,
      ...(item.why ? { meaning_vi: item.why } : {}),
      ...(item.fixed ? { examples: [item.fixed] } : {}),
      tags: ['mistake', item.category],
      mistake: {
        sentence: item.sentence,
        wrong: item.wrong,
        right: item.right,
        fixed: item.fixed,
        why: item.why,
        dictionary: item.dictionary,
      },
      from: { kind: item.kind, id: item.workId, title: item.title },
    })
  }
  if (!inputs.length) throw new ApiError(400, 'Không có lỗi nào (có cách sửa) để tạo thẻ.')
  const { saved } = await saveCards(ctx, MISTAKE_DECK, inputs, {
    replace: true,
  })
  // Mistake cards are corrected, not climbed: the usage ladder is off for them.
  await withProgress(ctx, async () => {
    const state = await readState(ctx)
    for (const id of saved) if (state.cards[id]) state.cards[id].ladder = false
    await writeState(ctx, state)
  })
  return { ids: saved }
}
