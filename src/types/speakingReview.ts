// Speaking review (Practice → Speaking review): you answer an IELTS Speaking question (or talk freely) out loud, the
// server turns the recording into text on this machine (server/speaking-review/stt.ts, no GPU, nothing sent out), code
// measures the fluency, and the AI reviews it like an examiner. Shared by the server and the app; keep imports relative.
import type { SpeakingPart } from './speaking.ts'
import type { WritingFix } from './writingReview.ts'

/** An IELTS part, or free talk. */
export type TalkPart = SpeakingPart | 'free'

/** How long an answer of each part should last, in seconds (what an examiner expects). */
export const TALK_TARGET: Record<TalkPart, { min: number; max: number; label: string } | null> = {
  1: { min: 20, max: 35, label: '20–35 s' },
  2: { min: 90, max: 120, label: '1.5–2 min' },
  3: { min: 40, max: 70, label: '40–70 s' },
  free: null,
}

/** The longest recording the server takes, in seconds. */
export const TALK_MAX_SECONDS = 300

/** A word as the recognizer heard it: when (seconds into the recording) and how sure it was (0–1). */
export interface TalkWord {
  w: string
  start: number
  end: number
  conf: number
}

/** Fluency measured by code from the word timings. */
export interface TalkFluency {
  /** The recording, seconds. */
  duration: number
  /** From the first word to the last, seconds. */
  speech: number
  words: number
  /** Words per minute over `speech` (pauses included): natural speech is ~120–160. */
  wpm: number
  /** Silences between words of at least 1 s, and of at least 2 s. */
  pauses: number
  longPauses: number
  longestPause: number
  /** Share of `speech` spent in those pauses (0–1). */
  pauseRatio: number
  /** Silences of at least 0.8 s INSIDE a sentence (a search for words), and the longest silence inside one. Older
   * reviews have none: the page falls back to `pauses`. */
  hesitations?: number
  longestHesitation?: number
  /** Silences of at least 1 s between sentences (natural; information only). */
  sentencePauses?: number
  /** Filler words and how often (um, uh, like, you know…). */
  fillers: { word: string; count: number }[]
  fillerCount: number
  /** A word said twice in a row ("I I think"). */
  repeats: number
  /** Different words / all words (0–1), over windows of 50 words so long answers are not penalised. */
  variety: number
  sentences: number
  avgSentenceWords: number
  /** Words the recognizer was unsure of: often an unclear pronunciation. */
  unclear: number
}

export type TalkCriterionId = 'fc' | 'lr' | 'gra' | 'pron'

export const TALK_CRITERIA: { id: TalkCriterionId; label: string; short: string; hint: string }[] = [
  { id: 'fc', label: 'Fluency & Coherence', short: 'FC', hint: 'Nói liền mạch, ít ngập ngừng; ý nối với nhau rõ ràng, có từ nối, có phát triển ý.' },
  {
    id: 'lr',
    label: 'Lexical Resource',
    short: 'LR',
    hint: 'Vốn từ đa dạng, chính xác, có collocation và cách nói tự nhiên; biết diễn đạt lại khi thiếu từ.',
  },
  { id: 'gra', label: 'Grammatical Range & Accuracy', short: 'GRA', hint: 'Dùng nhiều cấu trúc (câu phức, mệnh đề, thì) và ít lỗi ngữ pháp.' },
  {
    id: 'pron',
    label: 'Pronunciation',
    short: 'P',
    hint: 'Phát âm rõ, dễ hiểu; trọng âm, ngữ điệu, nối âm. App chỉ ước lượng từ độ rõ khi máy nghe.',
  },
]

export interface TalkCriterion {
  /** Estimated band, 0–9 in steps of 0.5. */
  band: number
  /** Vietnamese, one sentence: the main thing keeping this band from going higher. */
  summary: string
  /** Vietnamese: what you did well — older reviews only (now empty: the review is about what to improve). */
  good: string[]
  /** Vietnamese: 1–2 concrete fixes, your own words quoted with a better version. */
  improve: string[]
}

/**
 * A phrase the recognizer heard as other words ("Movie Dust Moonly"), and what you most likely said ("multitasking
 * smoothly") — likely an unclear pronunciation, with where it is in the recording to hear it again.
 */
export interface TalkMisheard {
  /** Your sentence it is in (0-based). */
  sentence: number
  heard: string
  meant: string
  /** IPA of what you meant. */
  ipa: string
  /** Vietnamese, short: the sound to fix. */
  tip: string
  /** Seconds into the recording (both 0 when it could not be placed). */
  start: number
  end: number
}

/** A correction of what you said (the same shape as a Writing review fix). */
export type TalkFix = WritingFix

/** Found by the AI but not confirmed by Longman / OZDIC: shown, never applied. */
export interface TalkWarning {
  phrase: string
  suggestion?: string
  explanation: string
}

/** What you said compared with the script you planned (when you gave one). */
export interface TalkComparison {
  /** Older reviews only: the AI's estimate of the coverage and its summaries of the points said, missed and added. The
   * page now checks the script sentence by sentence in code (features/practice/speaking-review/scriptCheck.ts). */
  coverage?: number
  covered?: string[]
  missed?: { point: string; script: string }[]
  added?: string[]
  /** Older reviews only: where the script says it better than you did (now each point's differences). */
  better?: { said: string; script: string; note: string }[]
  /** Your script idea by idea (the AI groups it: the whole answer for a short one): what you said for each, how well it
   * matches on meaning, and the phrases that differ. */
  points?: TalkScriptPoint[]
  /** The points' match, weighted by their length in the script (0–100). */
  match?: number
  /** Each criterion over the whole script, weighted the same way. */
  overall?: Record<ScriptCriterion, number>
}

/** How a point of the script is matched, each 0–100; the match weighs them 50 / 30 / 20. */
export const SCRIPT_CRITERIA = [
  { id: 'idea', label: 'Idea', weight: 0.5, hint: 'Có nói đúng thông điệp chính của ý trong script không.' },
  { id: 'details', label: 'Details', weight: 0.3, hint: 'Có giữ các chi tiết hỗ trợ (lý do, ví dụ, con số…) không.' },
  { id: 'wording', label: 'Wording', weight: 0.2, hint: 'Có dùng cụm từ, cấu trúc của script, hoặc cách nói tốt và tự nhiên tương đương, không.' },
] as const
export type ScriptCriterion = (typeof SCRIPT_CRITERIA)[number]['id']

/** good: you said it as well or better · weaker: simpler / less precise · wrong: a mistake or unnatural · missing: not said. */
export const SCRIPT_DIFF_KINDS = ['good', 'weaker', 'wrong', 'missing'] as const
export type ScriptDiffKind = (typeof SCRIPT_DIFF_KINDS)[number]

/** A phrase or structure where what you said differs from the script (short: never whole sentences). */
export interface TalkScriptDiff {
  kind: ScriptDiffKind
  /** The script's phrase ("" for something good you added). */
  script: string
  /** Your phrase ("" when missing). */
  said: string
  /** Vietnamese, a few words. */
  note: string
}

/** One idea (or paragraph) of the script against what you said for it. */
export interface TalkScriptPoint {
  /** A few words naming the idea. */
  title: string
  /** The script sentences it covers (0-based, inclusive) and their text. */
  from: number
  to: number
  script: string
  /** Your sentences that say it (0-based indexes into `sentences`) and their text ("" when not said). */
  heard: number[]
  said: string
  scores: Record<ScriptCriterion, number>
  /** idea 50% + details 30% + wording 20%. */
  match: number
  diffs: TalkScriptDiff[]
  /** The AI gave no point for these sentences: paired by code from shared words, scored by the share of words said. */
  byCode?: boolean
}

/** The model answer written from your ideas by Speaking ideas (when you gave no script). */
export interface TalkModelAnswer {
  /** The Speaking ideas suggestion (GET /api/speaking?id=). */
  jobId?: string
  topic: string
  question: string
  /** Your ideas as the AI understood them (English): what the model answer is built on. */
  idea: string
  part: SpeakingPart
  /** Why it could not start (another suggestion running…): POST /api/speaking-review/model starts it again. */
  error?: string
}

export interface TalkReviewResult {
  id: string
  createdAt: string
  /** Processing time, ms. */
  durationMs: number
  part: TalkPart
  question: string
  topic?: string
  script?: string
  source?: TalkSource
  /** The recording is kept (GET /api/speaking-review/audio?id=). */
  audio: boolean
  transcript: string
  words: TalkWord[]
  /** Your sentences with what the recognizer misheard restored by the AI (your own mistakes kept): what is corrected,
   * graded and compared with the script. `heardSentences` keeps them as heard, when anything was restored. */
  sentences: string[]
  heardSentences?: string[]
  correctedSentences: string[]
  /** What the recognizer misheard, and what you most likely said: evidence for Pronunciation. */
  misheard?: TalkMisheard[]
  corrected: string
  fixes: TalkFix[]
  warnings: TalkWarning[]
  fluency: TalkFluency
  criteria: Record<TalkCriterionId, TalkCriterion>
  /** The four bands averaged and rounded the IELTS way. */
  overall: number
  /** Older reviews only (no longer asked or shown): the three things to work on first, and strengths. */
  priorities?: string[]
  strengths?: string[]
  comparison?: TalkComparison
  model?: TalkModelAnswer
  /** The AI model that reviewed it. */
  reviewer: string
}

export type TalkStep = 'transcribe' | 'analyze' | 'dictionary' | 'model'

export const TALK_STEPS: { id: TalkStep; label: string }[] = [
  { id: 'transcribe', label: 'Speech to text' },
  { id: 'analyze', label: 'Examiner review' },
  { id: 'dictionary', label: 'Dictionary check' },
]

export interface TalkReviewJob {
  id: string
  status: 'running' | 'done' | 'error'
  startedAt: string
  step?: TalkStep
  error?: string
  /** Failed, but the recording is kept: POST /api/speaking-review/retry reviews it again. */
  retryable?: boolean
  result?: TalkReviewResult
}

/** Where the question came from: a Speaking ideas suggestion and the answer's place in it (when picked there). */
export interface TalkSource {
  suggestionId: string
  /** Index in the suggestion's answers when picked (questions deleted later shift it: match `question` too). */
  answerIndex: number
  /** The question as it was in Speaking ideas. */
  question: string
  /** Whether a model answer was sent as the script. */
  withModel: boolean
}

/** POST /api/speaking-review */
export interface TalkReviewRequest {
  part: TalkPart
  question?: string
  topic?: string
  script?: string
  source?: TalkSource
  /** 16 kHz mono 16-bit WAV, base64. */
  audio: string
}

export interface TalkHistoryItem {
  id: string
  createdAt: string
  part: TalkPart
  question: string
  overall: number
  duration: number
  words: number
  topic?: string
  /** The four criteria's bands. */
  bands: Record<TalkCriterionId, number>
  /** Seconds from the first word to the last. */
  speech: number
  wpm: number
  /** Pauses ≥ 1 s and fillers per minute, unclear words as a share of all (0–100). */
  pausesPerMin: number
  fillersPerMin: number
  unclearPct: number
  fixes: number
  script: boolean
  source?: Pick<TalkSource, 'suggestionId' | 'answerIndex' | 'question'>
}

/** IELTS rounding of the four criteria: to the nearest half band, .25 going up to .5 and .75 up to the next band. */
export function overallBand(bands: number[]): number {
  if (!bands.length) return 0
  return Math.round((bands.reduce((a, b) => a + b, 0) / bands.length) * 2) / 2
}

export const talkPartLabel = (part: TalkPart) => (part === 'free' ? 'Free talk' : `Part ${part}`)
