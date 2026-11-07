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

/** The examiner-style estimate (Task 2). */
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

export interface WritingReviewResult {
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
  /** The IELTS Task 2 score estimate. */
  score?: WritingScore
  /** Reason why scoring was skipped: under 150 words or error during score call. */
  scoreSkipped?: 'short' | 'error'
  /** Only present on a running job's in-memory result; never written to disk. */
  pending?: ('retry' | 'modelEssay' | 'score')[]
  usage: WritingUsage
}

export interface WritingReviewJob {
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

export interface WritingReviewSummary {
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
