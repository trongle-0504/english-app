// Review progress, stored by the local server in progress/review.json (+ progress/review-log.jsonl).
// Shared by the server (server/review/*) and the app (src/features/review/*); keep imports relative.

/** FSRS card state as JSON (dates are ISO strings). Mirrors ts-fsrs `Card`. */
export interface SchedulerCard {
  due: string
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  /** 0 New · 1 Learning · 2 Review · 3 Relearning */
  state: 0 | 1 | 2 | 3
  last_review?: string
}

export interface StoredCard {
  /** When the card was added to reviews. */
  added: string
  fsrs: SchedulerCard
  /**
   * Study day the card should be learned on (words just created in Admin). While it is still new, it is
   * introduced first, even beyond the daily limit of new cards.
   */
  learnDay?: string
  /** Set when the learner marks the card as done (known): it leaves the schedule until moved back. */
  done?: string
  /**
   * Usage stage (see src/features/review/ladder.ts): how the card is practised — recognise it, recall it, use the right
   * collocation, rewrite a sentence with it, use it in your own sentence. Missing on older cards (derived from the FSRS
   * state).
   */
  stage?: UsageStage
  /**
   * `false` = usage ladder switched off for this card (a word you only need to recognise): it is only practised at the
   * "recognise" stage and its stage is kept, so ticking it again carries on where it was. Missing = on.
   */
  ladder?: false
  /** Study day of the last "Luyện dùng từ" practice (at most once a day per card). */
  usedOn?: string
  /** The card's phrase in your own Writing / Speaking (server/practice/real-use.ts), latest last. */
  uses?: RealUse[]
}

/**
 * The card's phrase found in your own text — a Writing essay, or a Speaking answer / model essay you edited. Right:
 * the card goes up to "Tự dùng"; wrong (the review corrected it): back to "Dùng đúng cụm" and due now. Once per text.
 */
export interface RealUse {
  /** The text: speaking:<id>:<answer index>, writing:<id>:essay, writing:<id>:model. */
  ref: string
  term: string
  at: string
  ok: boolean
  /** Your sentence. */
  sentence: string
  /** Wrong use: what you wrote, the correction and why (Vietnamese). */
  wrote?: string
  fixed?: string
  why?: string
  /** The usage stage it moved from and to (none when it did not move). */
  from?: UsageStage
  to?: UsageStage
}

/** One answer in a "Luyện dùng từ" session (progress/usage-log.jsonl): only the stage changes, never the FSRS schedule. */
export interface UsageLogEntry {
  at: string
  id: string
  mode: ReviewMode
  rating: 1 | 2 | 3 | 4
  verdict?: ProduceVerdict
  from: UsageStage
  to: UsageStage
}

/** Usage ladder: knowing a word → being able to use it. */
export type UsageStage = 'recognize' | 'recall' | 'collocate' | 'paraphrase' | 'produce'

/**
 * Error kinds of a written sentence ("Viết lại câu" / "Tự dùng"); they decide which stage the card drops back to.
 * `changed_meaning` only for rewrites: the target is fine but the sentence no longer says what the original said.
 */
export type ProduceVerdict = 'ok' | 'missing' | 'wrong_meaning' | 'wrong_collocation' | 'wrong_form' | 'changed_meaning'

/** How the front of a card is shown ("fix": a mistake card from the Sổ lỗi — correct your own sentence). */
export type ReviewMode = 'recognize' | 'recall' | 'listen' | 'collocate' | 'paraphrase' | 'produce' | 'fix'

/** Modes that can be switched on in Settings ("listen" = dictation of a short sentence; the ladder adds the rest). */
export type BasicReviewMode = 'recognize' | 'recall' | 'listen'

export interface ReviewSettings {
  /** New cards introduced per day. */
  newPerDay: number
  /** Words and notes saved in Admin are added to reviews automatically, to be learned the same day. */
  autoAddFromAdmin: boolean
  /** FSRS target retention (0.7–0.97). Higher = more frequent reviews. */
  retention: number
  /** Modes used in a session; several = each card gets one at random. */
  modes: BasicReviewMode[]
  /** Usage ladder: cards move from recognising to using the word (collocations, own sentences). */
  ladder: boolean
  /** IANA time zone and hour at which a new study day starts. */
  timeZone: string
  dayStartHour: number
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  newPerDay: 20,
  autoAddFromAdmin: true,
  retention: 0.9,
  modes: ['recognize'],
  ladder: true,
  timeZone: 'Asia/Ho_Chi_Minh',
  dayStartHour: 4,
}

/** progress/review.json */
export interface ReviewStateDoc {
  version: 1
  settings: ReviewSettings
  cards: Record<string, StoredCard>
}

/** One line of progress/review-log.jsonl. */
export interface ReviewLogEntry {
  id: string
  /** 1 Again · 2 Hard · 3 Good · 4 Easy */
  rating: 1 | 2 | 3 | 4
  mode: ReviewMode
  review: string
  /** Study day (settings.timeZone / dayStartHour), e.g. "2026-09-26". */
  day: string
  durationMs?: number
  /** Card state before this review, so it can be undone. */
  prev: SchedulerCard
  /** Usage stage before this review (undo restores it). */
  prevStage?: UsageStage
}

/** GET /api/review/state */
export interface ReviewStateResponse {
  settings: ReviewSettings
  cards: Record<string, StoredCard>
  today: { day: string; newStudied: number; reviewed: number }
}

/* ───────────── "Use it" sentences (POST /api/review/produce) ───────────── */

export interface ProduceItem {
  /** Card id. */
  id: string
  /** What must be used: the word, or one of its collocations ("take responsibility for"). */
  target: string
  /** Short Vietnamese meaning of the target, so the check knows which sense is meant. */
  meaning: string
  /** IELTS topic and question the sentence answers. */
  topic: string
  question: string
  /** "Viết lại câu": the sentence to rewrite with the target ("" for an own sentence). */
  source: string
  /**
   * Dictionary data of the target from the card (collocations, patterns, an example; checked against Longman/OZDIC when
   * the word was added), so the check does not rely on the model's memory alone. "" when the card has none.
   */
  ref: string
  sentence: string
}

export interface ProduceResult {
  id: string
  verdict: ProduceVerdict
  /** The target is used correctly but sounds forced. */
  natural: boolean
  /** The learner's sentence with only the target part corrected ("" when it is right). */
  fixed: string
  /** Short Vietnamese reason ("" when right and natural). */
  why: string
  /** A natural model sentence on the same topic (only when something was wrong or forced). */
  better: string
  /** Other mistakes in the sentence, not about the target — shown, never graded. */
  other: string
  /**
   * The judgment is backed by the REF data: the usage that was right, or the correction of a wrong one, is listed there
   * (false: judged from the model's own knowledge only).
   */
  refBacked: boolean
}

export interface ProduceResponse {
  results: ProduceResult[]
  usage: { model: string; total: number }
}

/** GET /api/review/history: one item per saved review, oldest first. */
export interface ReviewHistoryEntry {
  id: string
  day: string
  rating: 1 | 2 | 3 | 4
  review: string
}

/** GET /api/review/stats */
export interface ReviewStats {
  today: { day: string; reviewed: number; newStudied: number; minutes: number }
  /** The study day before today, to compare with. */
  yesterday: { reviewed: number; newStudied: number; minutes: number }
  /** Retention of the 30 days before the last 30 (to compare with retention30). */
  retentionPrev30: number | null
  /**
   * Cards you have studied (not done), by usage stage (src/features/review/ladder.ts); `off`: ladder switched off for the
   * card (only recognised).
   */
  ladder: Record<UsageStage | 'off', number>
  /** Reviews per study day, last 365 days. */
  heatmap: Record<string, number>
  streak: { current: number; best: number }
  /** Share of reviews (of cards already in Review state) answered Hard/Good/Easy, last 30 days. */
  retention30: number | null
  /** Cards due per day for the next 14 days (index 0 = today, includes overdue). */
  forecast: { day: string; count: number }[]
  /** Cards still being learned, by FSRS state (done cards are counted separately). */
  byState: { new: number; learning: number; review: number; relearning: number }
  done: number
  /** Cards forgotten most often. */
  hardest: { id: string; lapses: number }[]
  totalReviews: number
}
