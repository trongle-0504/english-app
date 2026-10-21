// Model essays (Practice → Model essays, Admin → Essays). Shared by the server, the content pipeline and the app.
// Keep imports relative — the server loads this file directly with Node.

/** What a highlighted span teaches. */
export type EssayItemKind = 'collocation' | 'vocabulary' | 'linking' | 'frame' | 'paraphrase'

export const ESSAY_ITEM_KINDS: EssayItemKind[] = ['collocation', 'vocabulary', 'paraphrase', 'linking', 'frame']

/** The job a sentence does in its paragraph. */
export type SentenceRole =
  | 'paraphrase'
  | 'position'
  | 'claim'
  | 'explanation'
  | 'example'
  | 'result'
  | 'concession'
  | 'rebuttal'
  | 'summary'

export interface EssayItem {
  /** Unique within the essay (slug of `key`). */
  id: string
  /** Base form used across essays: "reduce poverty", "a sense of belonging". */
  key: string
  /** Exactly as written in the sentence: "reduced poverty". */
  text: string
  kind: EssayItemKind
  meaning_vi: string
  note_vi?: string
  /** kind "frame": the reusable pattern, e.g. "X does not necessarily translate into Y". */
  frame?: string
  /** kind "paraphrase": the wording of the task it replaces, e.g. "already rich". */
  source?: string
  /** kind "linking"/"frame": what it does — concession, contrast, example, result, addition, cause, conclusion… */
  function?: string
  /** Dictionary headword ("poverty") — used to look the item up in Longman/OZDIC. */
  headword?: string
  /** 3 = high-value for IELTS writing, 1 = nice to know. */
  importance: 1 | 2 | 3
  /** Index into Essay.sentences, and the character range of `text` inside that sentence. */
  sentence: number
  start: number
  end: number
}

export interface EssaySentence {
  text: string
  /** Vietnamese translation, for "translate it back" recall. */
  vi: string
  role: SentenceRole
}

export interface EssayParagraph {
  /** "Introduction", "Body 1 — concession + rebuttal", "Conclusion". */
  role: string
  summary_vi: string
  /** Short English bullets of the paragraph's ideas (the "rebuild" prompt). */
  outline: string[]
  /** Indexes into Essay.sentences. */
  sentences: number[]
}

/** A weaker spot in the model essay, to read it critically. */
export interface EssayCritique {
  sentence: number
  text: string
  issue_vi: string
  better: string
}

/** A new task on the same topic for the "use it" step (a 3–4 sentence paragraph). */
export interface EssayTask {
  prompt: string
  hint_vi: string
}

/** content/essays/<id>.json */
export interface Essay {
  id: string
  title: string
  /** "Economy & happiness". */
  topic: string
  /** "Opinion (agree/disagree)". */
  taskType: string
  prompt: string
  createdAt: string
  /** Examiner's band scores when known, e.g. "TR 7 · CC 7 · LR 7 · GR 7". */
  band?: string
  sentences: EssaySentence[]
  paragraphs: EssayParagraph[]
  items: EssayItem[]
  critique: EssayCritique[]
  tasks: EssayTask[]
}

/** /data/essays/<id>.json: the essay plus where its items appear in other essays. */
export interface EssayDoc extends Essay {
  /** item id → other essays that use the same key. */
  related: Record<string, { essayId: string; title: string; sentence: string }[]>
}

export interface EssaySummary {
  id: string
  title: string
  topic: string
  taskType: string
  prompt: string
  createdAt: string
  band?: string
  words: number
  /** Review card ids of the essay's items (for coverage: how many you already know). */
  cardIds: string[]
  counts: Record<EssayItemKind, number>
}

/** /data/essays/index.json */
export interface EssayIndex {
  essays: EssaySummary[]
}

/** /data/essays/phrases.json: every item key across essays, most frequent first. */
export interface PhraseBankEntry {
  key: string
  kind: EssayItemKind
  meaning_vi: string
  function?: string
  frame?: string
  occurrences: { essayId: string; title: string; itemId: string; text: string; sentence: string }[]
}

export interface PhraseBank {
  phrases: PhraseBankEntry[]
}

export const essayCardId = (essayId: string, itemId: string) => `essay:${essayId}:${itemId}`

/** The same phrase used twice in an essay ("For instance" in two paragraphs) shares the first one's review card. */
export function itemCardId(essay: Pick<Essay, 'id' | 'items'>, item: EssayItem): string {
  const first = essay.items.find((i) => i.kind === item.kind && i.key.toLowerCase() === item.key.toLowerCase()) ?? item
  return essayCardId(essay.id, first.id)
}

/** Items that get a review card (first use of each phrase). */
export const cardItems = (essay: Pick<Essay, 'id' | 'items'>) => essay.items.filter((i) => itemCardId(essay, i) === essayCardId(essay.id, i.id))

/* ───────────── Practice feedback (POST /api/essays/rebuild, /api/essays/transfer) ───────────── */

export type TargetStatus = 'correct' | 'incorrect' | 'missing'

export interface TargetCheck {
  itemId: string
  status: TargetStatus
  note_vi: string
}

export interface EssayFeedback {
  /** 0–10: how well the paragraph does its job with natural English. */
  score: number
  summary_vi: string
  targets: TargetCheck[]
  corrections: { wrong: string; right: string; why_vi: string }[]
  /** The learner's text with only the needed fixes. */
  corrected: string
  usage: { model: string; total: number }
}
