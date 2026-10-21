// Speaking & Writing ↔ Review (server/practice/*): the phrases of your recent work as review cards, and the mistakes of
// your own writing (Sổ lỗi). Shared by the server and the app; keep imports relative.

/** speaking: a Speaking ideas result · writing: a Writing review · talk: a Speaking review (your recorded answer). */
export type WorkKind = 'speaking' | 'writing' | 'talk'

export const WORK_LABEL: Record<WorkKind, string> = { speaking: 'Speaking', writing: 'Writing', talk: 'Speaking review' }

/** The page of a work. */
export const workPath = (kind: WorkKind, id: string) =>
  `/practice/${kind === 'speaking' ? 'speaking-ideas' : kind === 'talk' ? 'speaking-review' : 'writing-review'}?id=${id}`

/**
 * The three phrase lists of a result page: "Cụm từ trong thư viện" (library), "Cụm ngoài thư viện" (extra) and
 * "Cụm AI tự viết, đã tra từ điển" (wording).
 */
export type PhraseGroup = 'library' | 'extra' | 'wording'

export const PHRASE_GROUP_LABEL: Record<PhraseGroup, string> = {
  library: 'Cụm trong thư viện',
  extra: 'Cụm ngoài thư viện',
  wording: 'Cụm AI tự viết, đã tra từ điển',
}

/** The same in English (the Review page). */
export const PHRASE_GROUP_LABEL_EN: Record<PhraseGroup, string> = {
  library: 'Library phrases',
  extra: 'Phrases outside the library',
  wording: 'AI-written phrases, dictionary-checked',
}

export interface RecentPhrase {
  /** Its review card: a library card, or a "Speaking & Writing" card (written when you create the cards). */
  id: string
  term: string
  group: PhraseGroup
  meaning_vi?: string
  /** The sentence of your work it is in (for an entry written from it). */
  example?: string
  /** The card exists (a "Speaking & Writing" card that is not written yet: false). */
  exists: boolean
}

/** One Speaking result or Writing review of the period and its phrases. */
export interface RecentWork {
  kind: WorkKind
  id: string
  title: string
  at: string
  href: string
  phrases: RecentPhrase[]
}

/** GET /api/practice/recent?days=N */
export interface RecentResponse {
  days: number
  works: RecentWork[]
  /** Every card id of the period, each once. */
  ids: string[]
  /** Phrases whose card is not written yet. */
  missing: number
}

/** A phrase to make a card of (POST /api/practice/cards). */
export interface PhraseCardInput {
  term: string
  meaning_vi?: string
  /** The sentence it is used in. */
  example?: string
  dictionary?: string[]
}

/* ───────────── Sổ lỗi (GET /api/practice/mistakes) ───────────── */

export type MistakeCategory =
  | 'article'
  | 'preposition'
  | 'number'
  | 'collocation'
  | 'word_choice'
  | 'word_form'
  | 'verb_pattern'
  | 'grammar'
  | 'spelling'
  | 'naturalness'
  | 'confusable'
  | 'flagged'

export const MISTAKE_LABEL: Record<MistakeCategory, string> = {
  article: 'Mạo từ (a / an / the)',
  preposition: 'Giới từ',
  number: 'Số ít / số nhiều',
  collocation: 'Kết hợp từ (collocation)',
  word_choice: 'Chọn từ',
  word_form: 'Dạng từ',
  verb_pattern: 'Cấu trúc động từ',
  grammar: 'Ngữ pháp',
  spelling: 'Chính tả',
  naturalness: 'Diễn đạt chưa tự nhiên',
  confusable: 'Từ dễ nhầm',
  flagged: 'Cụm AI thấy đáng ngờ',
}

export interface MistakeItem {
  /** The same mistake made again has the same key ("make research → do research"). */
  key: string
  kind: WorkKind
  /** The Writing review / Speaking result, and where in it (a Speaking answer's index). */
  workId: string
  part?: number
  title: string
  at: string
  href: string
  category: MistakeCategory
  /** error: something wrong; improve: weak wording the review upgraded. */
  severity: 'error' | 'improve'
  /** Your sentence. */
  sentence: string
  wrong: string
  /** The correction ("" for a flagged phrase: no correction was made). */
  right: string
  fixed?: string
  why: string
  dictionary: string[]
}

export interface MistakeGroup {
  key: string
  category: MistakeCategory
  wrong: string
  right: string
  count: number
  /** The review card made of it (custom:so-loi:…). */
  cardId?: string
}

/** Mistakes per 100 words of each Writing review, oldest first. */
export interface MistakeTrendPoint {
  id: string
  at: string
  title: string
  words: number
  errors: number
  per100: number
}

export interface MistakeBook {
  items: MistakeItem[]
  groups: MistakeGroup[]
  categories: { id: MistakeCategory; count: number; errors: number }[]
  trend: MistakeTrendPoint[]
}
