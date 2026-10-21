/** ielts: a test recording (questions optional); podcast: natural, machine-transcribed speech. */
export type SimplifyMode = 'ielts' | 'podcast'

/** One span of a simplified transcript line. */
export type SimplifyRole = 'core' | 'ref' | 'skip' | 'signpost' | 'anchor' | 'key'

/** How a sentence connects to the one before it. */
export type SimplifyRelation =
  | 'start'
  | 'cause_effect'
  | 'contrast'
  | 'time'
  | 'similarity'
  | 'condition'
  | 'comparison'
  | 'example'
  | 'explain'
  | 'reference'
  | 'continue'

export interface SimplifySegment {
  text: string
  role: SimplifyRole
  /** Question the key words answer; 0 when unknown. */
  q: number
  /** Tiny Vietnamese gloss shown above the span (absent in results saved by an older version). */
  vi?: string
}

export interface SimplifyLine {
  /** Sentence number across the whole transcript (absent in results saved by an older version). */
  n?: number
  relation?: SimplifyRelation
  /** How this sentence links to the previous one, in Vietnamese. */
  link_vi?: string
  segments: SimplifySegment[]
}

export interface SimplifySection {
  title_vi: string
  /** How this section links to the previous one, in Vietnamese. */
  link_vi?: string
  lines: SimplifyLine[]
  main_idea_vi?: string
  flow_vi?: string
}

export interface SpeakerFlowStep {
  step: number
  text_vi: string
}

export interface RecommendedVocab {
  phrase: string
  meaning_vi: string
  example: string
  verified?: boolean
  dictionary?: string[]
  sources?: { name: 'Longman' | 'OZDIC'; url: string }[]
  original?: string
}

export interface SimplifyResult {
  sections: SimplifySection[]
  flow?: SpeakerFlowStep[]
  vocab?: RecommendedVocab[]
  tips_vi: string[]
  /** False when the spans do not add up to the whole transcript. */
  complete: boolean
  model: string
  /** Absent in results saved before Podcast mode: ielts. */
  mode?: SimplifyMode
  /** How many parts a long transcript was analysed in (1 or absent: in one go). */
  parts?: number
}

/** One analysis kept in progress/listening/<id>.json. */
export interface ListeningSaved {
  id: string
  createdAt: string
  transcript: string
  questions: string
  result: SimplifyResult
}

/** GET /api/listening/simplify/history: one row per saved analysis, newest first. */
export interface ListeningHistoryItem {
  id: string
  createdAt: string
  /** Title of the first section. */
  title: string
  /** The start of the transcript. */
  preview: string
  /** Titles of all sections. */
  sections: string[]
  sentences: number
  hasQuestions: boolean
  mode: SimplifyMode
  model: string
}
