import type { TalkHistoryItem } from '../../../types/speakingReview.ts'
import { normalize } from '../speaking-ideas/topicGroups.ts'

export interface PracticeStat {
  count: number
  best: number
  lastAt: string
}

export const practiceKey = (suggestionId: string, question: string) =>
  `${suggestionId}|${normalize(question)}`

/** Count attempts, best band and last attempt timestamp per linked Speaking ideas question. */
export function practiceStats(items: TalkHistoryItem[]): Map<string, PracticeStat> {
  const map = new Map<string, PracticeStat>()
  for (const item of items) {
    if (!item.source) continue
    const key = practiceKey(item.source.suggestionId, item.source.question)
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { count: 1, best: item.overall, lastAt: item.createdAt })
    } else {
      prev.count += 1
      if (item.overall > prev.best) prev.best = item.overall
      if (item.createdAt > prev.lastAt) prev.lastAt = item.createdAt
    }
  }
  return map
}
