import type { SpeakingHistoryItem, SpeakingPart } from '../../../types/speaking.ts'

export interface MergedQuestion {
  id: string
  index: number
  question: string
  createdAt: string
  answered: boolean
  isDuplicate?: boolean
}

export interface TopicGroup {
  topicKey: string
  topic: string
  part: SpeakingPart
  sessions: SpeakingHistoryItem[]
  questions: MergedQuestion[]
  latestCreatedAt: string
}

export const normalize = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Group saved suggestions by normalized topic + Part, newest run first, flagging repeated questions as `isDuplicate`. */
export function groupByTopic(
  items: SpeakingHistoryItem[],
  opts: { part?: SpeakingPart | 'all'; search?: string } = {},
): TopicGroup[] {
  let filtered = items
  if (opts.part && opts.part !== 'all') {
    filtered = filtered.filter((i) => i.part === opts.part)
  }

  const q = opts.search?.trim().toLowerCase() ?? ''
  if (q) {
    filtered = filtered.filter(
      (i) => i.topic.toLowerCase().includes(q) || i.questions.some((qt) => qt.toLowerCase().includes(q)),
    )
  }

  const map = new Map<string, TopicGroup>()
  for (const item of filtered) {
    const key = `${normalize(item.topic)}|${item.part}`
    let group = map.get(key)
    if (!group) {
      group = {
        topicKey: key,
        topic: item.topic,
        part: item.part,
        sessions: [],
        questions: [],
        latestCreatedAt: item.createdAt,
      }
      map.set(key, group)
    }
    group.sessions.push(item)
    if (item.createdAt > group.latestCreatedAt) {
      group.latestCreatedAt = item.createdAt
      group.topic = item.topic
    }
  }

  const groups = [...map.values()]
  for (const group of groups) {
    group.sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    const seenNorm = new Set<string>()
    const dedupedQuestions: MergedQuestion[] = []

    for (const sess of group.sessions) {
      sess.questions.forEach((qt, idx) => {
        const normQ = normalize(qt)
        const isDup = seenNorm.has(normQ)
        seenNorm.add(normQ)
        dedupedQuestions.push({
          id: sess.id,
          index: idx,
          question: qt,
          createdAt: sess.createdAt,
          answered: sess.answered?.[idx] ?? true,
          isDuplicate: isDup,
        })
      })
    }
    group.questions = dedupedQuestions
  }

  return groups.sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt))
}
