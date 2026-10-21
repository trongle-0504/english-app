// "Luyện dùng từ": which learned cards to practise using, outside the FSRS schedule (see POST /api/review/usage).
import type { ReviewCard } from '@/types/content'
import type { ReviewSettings, StoredCard, UsageStage } from '@/types/review'
import { effectiveStage, USAGE_STAGES, usageStageOf } from './ladder'
import { studyDay } from './schedule'
import { abilitiesOf } from './usageTasks'

export const USAGE_COUNTS = [5, 10, 15, 20]
export const USAGE_COUNT_KEY = 'review:usage-count'
export const DEFAULT_USAGE_COUNT = 10

export interface UsagePick {
  id: string
  card: ReviewCard
  /** The exercise: the card's usage stage, skipping stages it has no material for. */
  mode: Extract<UsageStage, 'collocate' | 'paraphrase' | 'produce'>
}

/**
 * Learned cards (FSRS "Review") with the ladder on, at a usage stage they have material for, not practised yet today.
 * Lower stages first (they are still climbing), then the most recently reviewed within a stage.
 */
export function usageCandidates(cards: Record<string, StoredCard>, byId: ReadonlyMap<string, ReviewCard>, settings: ReviewSettings): UsagePick[] {
  if (!settings.ladder) return []
  const today = studyDay(new Date(), settings)
  const picks: (UsagePick & { last: number })[] = []
  for (const [id, stored] of Object.entries(cards)) {
    const card = byId.get(id)
    if (!card || stored.done || stored.ladder === false || stored.fsrs.state !== 2 || stored.usedOn === today) continue
    const stage = usageStageOf(stored)
    if (!USAGE_STAGES.includes(stage)) continue
    const mode = effectiveStage(stage, abilitiesOf(card))
    if (mode !== 'collocate' && mode !== 'paraphrase' && mode !== 'produce') continue
    picks.push({ id, card, mode, last: Date.parse(stored.fsrs.last_review ?? stored.added) || 0 })
  }
  return picks.sort((a, b) => USAGE_STAGES.indexOf(a.mode) - USAGE_STAGES.indexOf(b.mode) || b.last - a.last).map(({ id, card, mode }) => ({ id, card, mode }))
}

/**
 * The session plan: `count` cards taken in turn from each stage (fill-ins, rewrites, own sentences) so a session mixes
 * them even when most cards are still at "collocate"; then the quick fill-ins first and the sentences (checked in rounds).
 */
export function usagePlan(candidates: UsagePick[], count: number): UsagePick[] {
  const queues = USAGE_STAGES.map((stage) => candidates.filter((p) => p.mode === stage))
  const chosen: UsagePick[] = []
  while (chosen.length < count && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift()
      if (next && chosen.length < count) chosen.push(next)
    }
  }
  return [...chosen.filter((p) => p.mode === 'collocate'), ...chosen.filter((p) => p.mode !== 'collocate')]
}
