// Usage ladder: knowing a word is not the same as being able to use it. Each card climbs five stages — recognise it,
// recall it from its meaning, use the right collocation, rewrite a given sentence with it (IELTS paraphrasing), use it
// in a sentence of your own — and FSRS keeps deciding
// WHEN a card is due while the stage decides HOW it is practised. Shared by the server (stage updates when grading)
// and the session page (which exercise to show); keep imports relative.
import type { BasicReviewMode, ProduceVerdict, ReviewMode, StoredCard, UsageStage } from '../../types/review.ts'

export const STAGES: UsageStage[] = ['recognize', 'recall', 'collocate', 'paraphrase', 'produce']

export const STAGE_LABEL: Record<UsageStage, string> = {
  recognize: 'Nhận ra',
  recall: 'Nhớ ra từ',
  collocate: 'Dùng đúng cụm',
  paraphrase: 'Viết lại câu',
  produce: 'Tự dùng',
}

/** The stages in English (the Review page). */
export const STAGE_LABEL_EN: Record<UsageStage, string> = {
  recognize: 'Recognise',
  recall: 'Recall',
  collocate: 'Collocation',
  paraphrase: 'Rewrite',
  produce: 'Own sentence',
}

/** The stage a mode practises ("listen", dictation, is a way of recognising; "fix", a mistake card, of recalling). */
const MODE_STAGE: Record<ReviewMode, UsageStage> = {
  recognize: 'recognize',
  listen: 'recognize',
  recall: 'recall',
  collocate: 'collocate',
  paraphrase: 'paraphrase',
  produce: 'produce',
  fix: 'recall',
}

/** Stage of a card; older cards without one start at "recall" once they are past learning (they were already seen). */
export function stageOf(card: StoredCard | undefined): UsageStage {
  if (card?.stage) return card.stage
  return card?.fsrs.state === 2 ? 'recall' : 'recognize'
}

/** The stage that decides the exercise: "recognise" only for a card whose ladder is switched off. */
export function ladderStage(card: StoredCard | undefined): UsageStage {
  return card?.ladder === false ? 'recognize' : stageOf(card)
}

/** The stages practised in "Luyện dùng từ" (using the word), after the two memory stages. */
export const USAGE_STAGES: UsageStage[] = ['collocate', 'paraphrase', 'produce']

/** Stage for "Luyện dùng từ": a learned card that never got a stage has passed recognise/recall, so it starts at "collocate". */
export function usageStageOf(card: StoredCard): UsageStage {
  return card.stage ?? 'collocate'
}

/** What the card has material for (the two lowest stages always work). */
export interface CardAbilities {
  collocate: boolean
  paraphrase: boolean
  produce: boolean
}

const available = (stage: UsageStage, can: CardAbilities) => stage === 'recognize' || stage === 'recall' || can[stage]

/**
 * The stage really practised. A stage the card has no material for is skipped upwards (a word without collocations
 * goes on from "recall" to the sentence stages); when nothing above works, the highest working stage below is used.
 */
export function effectiveStage(stage: UsageStage, can: CardAbilities): UsageStage {
  const at = STAGES.indexOf(stage)
  return (
    STAGES.slice(at).find((s) => available(s, can)) ??
    STAGES.slice(0, at)
      .reverse()
      .find((s) => available(s, can)) ??
    'recall'
  )
}

/**
 * The exercise for a card at its stage. `basic` = the modes switched on in Settings (used for the recognise stage, and
 * for everything when the ladder is off).
 */
export function modeFor(stage: UsageStage, can: CardAbilities, basic: BasicReviewMode[], pick: <T>(xs: T[]) => T): ReviewMode {
  const practised = effectiveStage(stage, can)
  if (practised !== 'recognize') return practised
  const recognise = basic.filter((m) => m === 'recognize' || m === 'listen')
  return recognise.length ? pick(recognise) : 'recognize'
}

/**
 * Stage after a graded review, done with `mode`:
 * - Good / Easy: one step up from the stage practised (never below the current stage).
 * - Hard: stays.
 * - Again on a written sentence: a collocation or word-form slip goes back to "collocate", a wrong meaning or a missing
 *   word back to "recall"; a rewrite that only changed the meaning stays. Again on "collocate" goes back to "recall";
 *   at the two lowest stages it stays (FSRS already brings the card back soon).
 */
export function nextStage(current: UsageStage, mode: ReviewMode, rating: 1 | 2 | 3 | 4, verdict?: ProduceVerdict): UsageStage {
  const at = STAGES.indexOf(current)
  const practised = STAGES.indexOf(MODE_STAGE[mode])
  if (rating >= 3) return STAGES[Math.max(at, Math.min(practised + 1, STAGES.length - 1))]
  if (rating === 2) return current
  if (mode === 'produce' || mode === 'paraphrase') {
    if (verdict === 'wrong_collocation' || verdict === 'wrong_form') return 'collocate'
    return verdict === 'changed_meaning' ? current : 'recall'
  }
  if (mode === 'collocate') return 'recall'
  return current
}

/**
 * Suggested grade of a written sentence (rewrite or own): wrong → Again; right but forced, helped by a hint or very slow → Hard;
 * right and quick → Easy; otherwise Good. The learner confirms it.
 */
export function produceRating(r: { verdict: ProduceVerdict; natural: boolean }, ms: number, hinted: boolean): 1 | 2 | 3 | 4 {
  if (r.verdict !== 'ok') return 1
  if (!r.natural || hinted || ms > 120_000) return 2
  return ms < 30_000 ? 4 : 3
}
