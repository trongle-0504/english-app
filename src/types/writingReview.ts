import type {
  AnswerSentence,
  CheckedWording,
  CoverageReport,
  DolHint,
  FormattedIdea,
  OriginalAnswerBackup,
  SpeakingExtra,
  SpeakingPick,
  UsedStructure,
} from './speaking.ts'
import type { WritingReviewTopic, WritingReviewType } from '../features/practice/writing-review/categories.ts'
import { overallBand } from './speakingReview.ts'

export { overallBand }

export type WritingCriterionId = 'tr' | 'cc' | 'lr' | 'gra'

export const WRITING_CRITERIA: { id: WritingCriterionId; label: string; short: string; hint: string }[] = [
  { id: 'tr', label: 'Task Response', short: 'TR', hint: 'Trả lời đủ các phần của đề, quan điểm rõ và nhất quán, ý được phát triển và có dẫn chứng.' },
  { id: 'cc', label: 'Coherence & Cohesion', short: 'CC', hint: 'Bố cục logic, mỗi đoạn một ý chính, liên kết câu và đoạn tự nhiên, dùng từ nối và từ thay thế linh hoạt.' },
  { id: 'lr', label: 'Lexical Resource', short: 'LR', hint: 'Vốn từ đa dạng và chính xác, collocation tự nhiên, đúng văn phong học thuật, ít lỗi chính tả và cấu tạo từ.' },
  { id: 'gra', label: 'Grammatical Range & Accuracy', short: 'GRA', hint: 'Dùng nhiều cấu trúc câu (câu phức, mệnh đề) và ít lỗi ngữ pháp, dấu câu.' },
]

/** Task 1: the same four slots, with `tr` holding Task Achievement. */
export const WRITING_TASK1_CRITERIA: typeof WRITING_CRITERIA = WRITING_CRITERIA.map((c) =>
  c.id === 'tr'
    ? {
        id: 'tr',
        label: 'Task Achievement',
        short: 'TA',
        hint: 'Có overview rõ (xu hướng / so sánh chính), chọn và làm nổi bật đặc điểm chính, số liệu chính xác, có so sánh khi cần.',
      }
    : c,
)

/** The criterion labels of a review's task (no task = Task 2). */
export const criteriaFor = (task?: WritingTask) => (task === 1 ? WRITING_TASK1_CRITERIA : WRITING_CRITERIA)

export type WritingTask = 1 | 2

/** Which Writing Mock Test question a review came from (no task = Task 2 or a free review). */
export interface WritingReviewSource {
  task?: WritingTask
  /** Task 1 question id ("bar-001"). */
  promptId?: string
}

/** Why there is no band: under 150 words, the score call failed, or ('task1') a Task 1 review made before Task 1 scoring. */
export type WritingScoreSkipped = 'short' | 'error' | 'task1'

/** Parts of a review still running (only on a running job's in-memory result). */
export type WritingReviewPending = 'retry' | 'modelEssay' | 'score' | 'compare'

/** What the agent read from the Task 1 chart picture(s). */
export interface WritingTask1Chart {
  kind: string
  subject: string
  unit: string
  period: string
  categories: string[]
  overview: string[]
  keyFeatures: string[]
  figures: { label: string; value: string }[]
}

/** The Task 1 checks of a review (Vietnamese notes). */
export interface WritingTask1Review {
  /** No chart picture: TA was rated from the question text, figures were not checked. */
  noChart: boolean
  chart?: WritingTask1Chart
  overview: { status: 'clear' | 'unclear' | 'missing'; note: string }
  keyFeatures: { covered: string[]; missed: string[] }
  /** `sentence` is 0-based. */
  dataErrors: { sentence: number; quote: string; wrote: string; correct: string }[]
  /** The Vietnamese plan held against the chart; absent when there was no plan. */
  ideaCheck?: { summary: string; matched: string[]; missing: string[]; wrong: string[] }
}

export type WritingTask1CompareArea = 'intro' | 'overview' | 'grouping' | 'comparison' | 'data' | 'language'

export interface WritingTask1Comparison {
  summary: string
  points: {
    area: WritingTask1CompareArea
    /** The answer's words; '' when the answer has nothing for the point. */
    yours: string
    model: string
    why: string
    try: string
  }[]
}

export type WritingTask1VocabCategory = 'trend' | 'comparison' | 'proportion' | 'approximation' | 'overview' | 'sequence' | 'other'

export interface WritingTask1VocabItem {
  phrase: string
  category: WritingTask1VocabCategory
  meaning_vi: string
  example: string
  /** The answer already uses it. */
  used: boolean
  /** Confirmed in Longman / OZDIC. */
  verified: boolean
  dictionary: string[]
  sources: { name: string; url: string }[]
}

/** What the answer can learn from the learner's own model essay. */
export interface WritingTask1ModelLesson {
  modelUpdatedAt: string
  modelWords: number
  comparison?: WritingTask1Comparison
  vocab: WritingTask1VocabItem[]
}

/** A place in the essay to improve for one criterion. */
export interface WritingCriterionIssue {
  /** 0-based index into the review's sentences. */
  sentence: number
  quote: string
  /** Vietnamese. */
  problem: string
  better: string
}

export interface WritingCriterion {
  /** Whole band 0-9 (IELTS examiners give whole bands per criterion). */
  band: number
  /** Vietnamese, one sentence: what the essay needs for the next band. */
  summary: string
  /** English notes with short quotes. */
  strengths: string[]
  gaps: string[]
  issues: WritingCriterionIssue[]
}

/** The examiner-style estimate. For Task 1, the `tr` slot holds Task Achievement (labels: criteriaFor(task)). */
export interface WritingScore {
  criteria: Record<WritingCriterionId, WritingCriterion>
  /** The four bands averaged and rounded the IELTS way (overallBand). */
  overall: number
  words: number
  /** false: no question was given; TR was rated against the question the AI inferred. */
  questionGiven: boolean
  reviewer: string
}

/** One change made to the essay. */
export interface WritingFix {
  id: string
  sentenceIndex: number
  /** As written by the learner, e.g. "make a lot of research", "adapt". */
  original: string
  /** The fix, e.g. "do a lot of research", "adopt". */
  replacement: string
  /** spelling / grammar / word form / naturalness: Claude reviews; confusable / verb pattern: older reviews. */
  type: 'spelling' | 'grammar' | 'word form' | 'collocation' | 'word choice' | 'naturalness' | 'confusable' | 'verb pattern'
  /** Claude reviews: "error" = something wrong, "improve" = weak wording upgraded. Both are in the corrected text. */
  severity?: 'error' | 'improve'
  /** Vietnamese explanation. */
  explanation: string
  /**
   * What supports the fix: a combination listed in Longman (`longman`) or OZDIC (`collocation`), a dictionary sense of
   * the new word (`meaning`), the new word's dictionary entry (`word`: spelling, word form), nothing new to look up
   * (`grammar`), or the model only (older reviews).
   */
  evidence: 'longman' | 'collocation' | 'meaning' | 'word' | 'grammar' | 'model'
  /** Dictionary lines shown with the fix, e.g. "VERB + RESEARCH: carry out, conduct, do". */
  dictionary: string[]
  meaning?: { original?: string; replacement?: string }
  /** Headword to open on ozdic.com. */
  word: string
  /** Dictionary pages that confirm the fix (Claude reviews). */
  sources?: { name: 'Longman' | 'OZDIC'; url: string }[]
  /** An "improve" fix whose original wording the model essay still uses: a style option, not a mistake. */
  keptInEssay?: boolean
}

/** Doubtful but not changed. */
export interface WritingWarning {
  phrase: string
  explanation: string
  suggestion?: string
  word: string
}

/** Acceptable wording with a more precise choice that OZDIC lists — never applied automatically. */
export interface WritingUpgrade {
  sentenceIndex: number
  original: string
  replacement: string
  reason: string
  /** Combinations OZDIC confirms for the replacement, e.g. "highly effective". */
  confirmed: string[]
  word: string
}

/** A change the model wanted but code refused because OZDIC confirms the original. */
export interface WritingProtected {
  original: string
  candidates: string[]
  reason: string
}

export interface WritingCall {
  /** Pipeline step: diagnose, retry (Claude); extract, judge, context, meaning, rewrite, recheck, upgrades (older reviews). */
  step: string
  input: number
  output: number
  /** "Thinking" tokens (Gemini 2.5): billed as output, reported separately. */
  thinking: number
  ms?: number
}

export interface WritingUsage {
  model: string
  /** Effort the review ran with: Claude effort level (older Gemini reviews: Gemini 3 thinkingLevel). */
  thinkingLevel?: string
  calls: WritingCall[]
  input: number
  output: number
  thinking: number
  total: number
}

export interface WritingSuggestedPhrase {
  cardId: string
  term: string
  meaning_vi: string
  example?: string
  origin: string
  href?: string
  isTopicCollocation?: boolean
}

export interface WritingModelEssay {
  meaning?: string
  sentences: AnswerSentence[]
  structures: UsedStructure[]
  wording: CheckedWording[]
  picks: SpeakingPick[]
  extras: SpeakingExtra[]
  /** How the essay's phrases were found and checked (to trace a missed one). */
  coverage?: CoverageReport
  userEdited?: string
  originalAnswer?: OriginalAnswerBackup
}

export interface WritingReviewTimings {
  firstResult?: number
  total: number
  steps: Record<string, number>
}

export interface WritingReviewResult extends WritingReviewSource {
  id: string
  createdAt: string
  title?: string
  durationMs: number
  prompt?: string
  topic?: WritingReviewTopic
  questionType?: WritingReviewType
  text: string
  vietnameseText?: string
  /** The Vietnamese idea laid out for reading (spelling, punctuation, paragraphs); the ideas unchanged. */
  vietnameseFormatted?: FormattedIdea
  sentences: string[]
  /** Index of the first sentence of each paragraph after the first (Claude reviews; older ones are one block). */
  paragraphStarts?: number[]
  correctedSentences: string[]
  corrected: string
  fixes: WritingFix[]
  warnings: WritingWarning[]
  /** Not in the dictionary but clearly natural ("social media") — hidden by default. */
  natural: string[]
  upgrades: WritingUpgrade[]
  protected: WritingProtected[]
  /** Combinations of the corrected sentences that OZDIC does not list (for information). */
  recheck: { sentenceIndex: number; phrases: string[] }[]
  /** How many word combinations were checked, and how many OZDIC confirmed directly. */
  checked: { total: number; confirmed: number }
  suggestedPhrases?: WritingSuggestedPhrase[]
  /** Phrases of the Vietnamese text and their English in the DOL dictionary (given to the AI as preferred wording). */
  dolHints?: DolHint[]
  modelEssay?: WritingModelEssay
  timings?: WritingReviewTimings
  /** The IELTS score estimate (Task 1: TA in the tr slot). */
  score?: WritingScore
  /** Reason why scoring was skipped. */
  scoreSkipped?: WritingScoreSkipped
  /** Task 1: chart reading and Task 1 checks. */
  task1?: WritingTask1Review
  /** Task 1: comparison with the learner's model essay and its vocabulary. */
  task1Model?: WritingTask1ModelLesson
  /** Only present on a running job's in-memory result; never written to disk. */
  pending?: WritingReviewPending[]
  usage: WritingUsage
}

export interface WritingReviewJob extends WritingReviewSource {
  id: string
  status: 'running' | 'done' | 'error'
  startedAt: string
  title?: string
  prompt?: string
  topic?: WritingReviewTopic
  questionType?: WritingReviewType
  vietnameseText?: string
  /** Current step while running ("lookup" = OZDIC lookups). */
  step?: string
  usage: WritingUsage
  error?: string
  result?: WritingReviewResult
}

export interface WritingReviewSummary extends WritingReviewSource {
  id: string
  createdAt: string
  title?: string
  prompt?: string
  topic?: WritingReviewTopic
  questionType?: WritingReviewType
  overall?: number
  excerpt: string
  vietnameseExcerpt?: string
  fixes: number
  tokens: number
}
