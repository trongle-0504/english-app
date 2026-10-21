// The header lookup beyond your library (server/lookup.ts): topic collocations and the DOL Vietnamese → English
// dictionary. Shared by the server and the app; keep imports relative.

/** A topic collocation (content/topic-collocations). */
export interface TopicHit {
  id: string
  /** How well it matched (src/features/lookup/match.ts: lower is better). */
  rank: number
  term: string
  meaning_vi: string
  pronunciation?: string
  part_of_speech?: string
  topic: string
  subTopic?: string
  group?: string
  examples: { en: string; vi?: string }[]
}

/** A Vietnamese headword of the DOL dictionary; `en` / `pos` when its entry is already cached on this machine. */
export interface DolHit {
  vi: string
  url: string
  en?: string
  pos?: string[]
}

/** GET /api/lookup?q= */
export interface LookupExtra {
  topic: TopicHit[]
  dol: DolHit[]
  /** False when the DOL word list is not on this machine yet (it is being downloaded). */
  dolReady: boolean
}

/* ───────────── DOL health (GET /api/dol/status) ───────────── */

/** What of DOL the app uses: the word list (read from a page's Next.js data), an entry, the search, an entry's note. */
export type DolPart = 'list' | 'entry' | 'search' | 'note'
/** network: DOL unreachable · blocked: DOL refused (403/429) · http: another error status · format: DOL answered but its
 * structure changed (a field the app reads is gone) — the code must be fixed. */
export type DolFailure = 'network' | 'blocked' | 'http' | 'format'

export interface DolProblem {
  part: DolPart
  kind: DolFailure
  /** DOL-FORMAT-ENTRY, DOL-NETWORK-SEARCH…: what a user reports. */
  code: string
  message: string
  at: string
}

export interface DolStatus {
  /** DOL_LOOKUP=off: DOL is not used at all. */
  enabled: boolean
  /** The parts whose last attempt failed (a later success clears it). */
  problems: DolProblem[]
  lastOk: Partial<Record<DolPart, string>>
  /** The latest failures, newest first. */
  recent: DolProblem[]
}

/** A piece of a DOL note: text with its look, or the ✅ that starts a synonym. */
export interface DolNoteRun {
  text: string
  bold?: boolean
  italic?: boolean
  /** "Phân biệt:", "Ví dụ:" — underlined in red on DOL. */
  label?: boolean
  check?: boolean
}

/** A DOL note ("Ghi chú": the synonyms told apart, with examples), line by line. */
export type DolNote = DolNoteRun[][]

/** GET /api/lookup/dol?url= : a DOL entry. */
export interface DolEntryView {
  url: string
  /** The entry's page on tudien.dolenglish.vn. */
  page: string
  vi: string
  en: string
  pos: string[]
  pronounce?: string
  definitionVi?: string
  sameVi?: string
  sameEn?: string
  examples: { vi: string; en: string }[]
  note?: DolNote
}
