import type { SpeakingMockPart1Topic, SpeakingMockPart23SubTopic } from '@/types/content'
import type { TalkReviewResult, TalkStep } from '@/types/speakingReview'

export type MockPartNumber = 1 | 2 | 3

export type PartCombinationId = 'full' | 'p1' | 'p2' | 'p3' | 'p23' | 'p12' | 'p13'

export interface PartCombinationOption {
  id: PartCombinationId
  label: string
  shortLabel: string
  description: string
  parts: MockPartNumber[]
}

export const PART_COMBINATIONS: PartCombinationOption[] = [
  {
    id: 'full',
    label: 'Full Mock Test (Part 1 + 2 + 3)',
    shortLabel: 'Part 1 + 2 + 3',
    description: 'Thi thử đầy đủ cả 3 phần như phòng thi IELTS thực tế (~11–14 phút)',
    parts: [1, 2, 3],
  },
  {
    id: 'p1',
    label: 'Part 1 Only',
    shortLabel: 'Part 1',
    description: 'Phỏng vấn giới thiệu & các chủ đề quen thuộc (1 phút / câu)',
    parts: [1],
  },
  {
    id: 'p2',
    label: 'Part 2 Only (Cue Card)',
    shortLabel: 'Part 2',
    description: '2 phút chuẩn bị ý tưởng + 2 phút trình bày liên tục theo Cue Card',
    parts: [2],
  },
  {
    id: 'p3',
    label: 'Part 3 Only (Discussion)',
    shortLabel: 'Part 3',
    description: 'Thảo luận chuyên sâu & mở rộng theo chủ đề (1 phút / câu)',
    parts: [3],
  },
  {
    id: 'p23',
    label: 'Part 2 + Part 3',
    shortLabel: 'Part 2 + 3',
    description: 'Trình bày Cue Card Part 2 kết hợp câu hỏi thảo luận sâu Part 3',
    parts: [2, 3],
  },
]

export interface MockQuestionItem {
  /** Unique id within the session, e.g. "p1-q1", "p2-cue", "p3-q2" */
  id: string
  part: MockPartNumber
  /** 1-based index within its part */
  indexInPart: number
  /** Total questions in this part */
  totalInPart: number
  /** Topic title (e.g. "Food" or "Describe a person you admire") */
  topic: string
  /** Category title if Part 2/3 */
  category?: string
  /** The prompt read by the examiner and sent to /api/speaking-review as `question` */
  questionText: string
  /** For Part 2: the bullet points on the cue card */
  cueCardBullets?: string[]
  /** Preparation time in seconds (120s for Part 2, 0 for Part 1 & 3) */
  prepSeconds: number
  /** Maximum speaking time in seconds (60s for Part 1 & 3, 120s for Part 2) */
  speakSeconds: number
}

export interface MockQuestionRecording {
  questionId: string
  part: MockPartNumber
  indexInPart: number
  topic: string
  questionText: string
  cueCardBullets?: string[]
  /** 16 kHz mono 16-bit PCM WAV Blob for local playback */
  wavBlob: Blob
  /** Object URL created from wavBlob for <audio> playback */
  audioUrl: string
  /** Base64-encoded WAV payload for POST /api/speaking-review */
  base64Audio: string
  /** Recorded duration in seconds */
  durationSeconds: number
  recordedAt: string
}

export type EvaluationStatus = 'idle' | 'submitting' | 'running' | 'done' | 'error'

export interface MockQuestionEvaluation {
  questionId: string
  status: EvaluationStatus
  jobId?: string
  step?: TalkStep
  result?: TalkReviewResult
  error?: string
}

export interface BuiltMockSession {
  sessionId: string
  startedAt: string
  parts: MockPartNumber[]
  part1Topic?: SpeakingMockPart1Topic
  part23SubTopic?: SpeakingMockPart23SubTopic
  questions: MockQuestionItem[]
}

const SEEN_STORAGE_KEY = 'practice:speaking-mock:seen-sets:v1'
const COMPLETED_STORAGE_KEY = 'practice:speaking-mock:completed-sets:v1'

export function getSeenSetIds(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function markSetIdSeen(id: string): void {
  if (!id) return
  try {
    const current = getSeenSetIds().filter((x) => x !== id)
    current.push(id)
    // Keep most recent 200 ids
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(current.slice(-200)))
  } catch {
    // ignore storage errors
  }
}

export function getCompletedSetIds(): Set<string> {
  try {
    const raw = localStorage.getItem(COMPLETED_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

export function markSetIdCompleted(id: string): void {
  if (!id) return
  try {
    const set = getCompletedSetIds()
    set.add(id)
    localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify([...set]))
  } catch {
    // ignore storage errors
  }
}

/**
 * Picks a random item from `items`, avoiding items whose `id` is in `seenIds` whenever possible.
 * If all items in `items` have been seen, picks the one seen longest ago or a fresh random one.
 */
export function pickUnseenRandom<T extends { id: string }>(items: T[]): T | undefined {
  if (!items.length) return undefined
  if (items.length === 1) {
    markSetIdSeen(items[0].id)
    return items[0]
  }
  const seen = getSeenSetIds()
  const unseen = items.filter((item) => !seen.includes(item.id))
  const pool = unseen.length > 0 ? unseen : items
  const chosen = pool[Math.floor(Math.random() * pool.length)]
  markSetIdSeen(chosen.id)
  return chosen
}

export function buildMockSessionQuestions(opts: {
  parts: MockPartNumber[]
  part1Topic?: SpeakingMockPart1Topic
  part23SubTopic?: SpeakingMockPart23SubTopic
}): BuiltMockSession {
  const { parts, part1Topic, part23SubTopic } = opts
  const sortedParts = [...new Set(parts)].sort((a, b) => a - b) as MockPartNumber[]
  const questions: MockQuestionItem[] = []

  if (sortedParts.includes(1) && part1Topic) {
    const p1List = part1Topic.questions
    p1List.forEach((q, idx) => {
      questions.push({
        id: `p1-q${idx + 1}`,
        part: 1,
        indexInPart: idx + 1,
        totalInPart: p1List.length,
        topic: part1Topic.topic,
        questionText: q,
        prepSeconds: 0,
        speakSeconds: 60,
      })
    })
  }

  if (sortedParts.includes(2) && part23SubTopic) {
    const cueBullets = part23SubTopic.part2.cueCard
    const fullPrompt = [
      part23SubTopic.part2.topic,
      ...(cueBullets.length ? ['You should say:', ...cueBullets.map((b) => `• ${b}`)] : []),
    ].join('\n')
    questions.push({
      id: 'p2-cue',
      part: 2,
      indexInPart: 1,
      totalInPart: 1,
      topic: part23SubTopic.subTopic,
      category: part23SubTopic.category,
      questionText: fullPrompt,
      cueCardBullets: cueBullets,
      prepSeconds: 120,
      speakSeconds: 120,
    })
  }

  if (sortedParts.includes(3) && part23SubTopic) {
    const p3List = part23SubTopic.part3.questions
    p3List.forEach((q, idx) => {
      questions.push({
        id: `p3-q${idx + 1}`,
        part: 3,
        indexInPart: idx + 1,
        totalInPart: p3List.length,
        topic: part23SubTopic.subTopic,
        category: part23SubTopic.category,
        questionText: q,
        prepSeconds: 0,
        speakSeconds: 60,
      })
    })
  }

  return {
    sessionId: `mock-${Date.now().toString(36)}`,
    startedAt: new Date().toISOString(),
    parts: sortedParts,
    part1Topic,
    part23SubTopic,
    questions,
  }
}

export interface SavedMockAttempt {
  setId: string
  updatedAt: string
  session: BuiltMockSession
  /** Map from questionId -> TalkReviewResult (stored on server & cached locally) */
  results: Record<string, TalkReviewResult>
  /** Map from questionId -> durationSeconds */
  durations: Record<string, number>
}

const ATTEMPTS_STORAGE_KEY = 'practice:speaking-mock:attempts:v1'

export function getSavedMockAttempts(): Record<string, SavedMockAttempt> {
  try {
    const raw = localStorage.getItem(ATTEMPTS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveMockAttempt(attempt: SavedMockAttempt): void {
  if (!attempt.setId) return
  try {
    const all = getSavedMockAttempts()
    all[attempt.setId] = attempt
    localStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(all))
  } catch {
    // ignore storage quota errors
  }
}
