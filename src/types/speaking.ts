// Speaking ideas (Practice → Speaking ideas): shared by the server (server/speaking/*) and the app.
// The library (lesson collocations, vocabulary words, their collocations, notes) is tagged once by Claude with the
// speaking functions and topics each item serves; the tags live in content/speaking/index.json and are kept in step
// with the library by the page's Sync button. A suggestion run matches a topic's questions against those tags.

/** What the speaker is doing in an answer: IELTS Speaking questions come in a handful of these kinds. */
export const SPEAKING_FUNCTIONS = [
  { id: 'preference', label: 'Likes & preferences', hint: 'what you like, love, prefer, cannot stand' },
  { id: 'habit', label: 'Habits & frequency', hint: 'how often, routines, what you usually do' },
  { id: 'ability', label: 'Ability & skill', hint: 'being good or bad at something, learning a skill' },
  { id: 'childhood', label: 'Childhood & the past', hint: 'when you were a child, used to, school days' },
  { id: 'experience', label: 'Experiences & events', hint: 'have you ever, a time when, telling what happened' },
  { id: 'describe_person', label: 'Describing people', hint: 'appearance, character, behaviour' },
  { id: 'describe_place', label: 'Describing places', hint: 'cities, buildings, nature, atmosphere' },
  { id: 'describe_thing', label: 'Describing things & activities', hint: 'objects, works, events, activities' },
  { id: 'feelings', label: 'Feelings & reactions', hint: 'emotions, how something made you feel' },
  { id: 'opinion', label: 'Opinions', hint: 'giving, hedging, agreeing or disagreeing with a view' },
  { id: 'benefit', label: 'Benefits', hint: 'advantages, why something is good or useful' },
  { id: 'problem', label: 'Problems & drawbacks', hint: 'disadvantages, difficulties, risks' },
  { id: 'cause_effect', label: 'Causes & effects', hint: 'reasons, results, influence, impact' },
  { id: 'trend', label: 'Change & popularity', hint: 'trends, how popular something is, changes over time' },
  { id: 'compare', label: 'Comparing', hint: 'differences, similarities, past vs present' },
  { id: 'future', label: 'Plans & the future', hint: 'plans, hopes, wishes, predictions' },
  { id: 'solution', label: 'Suggestions & solutions', hint: 'what should be done, advice, policies' },
  { id: 'degree', label: 'Emphasis & degree', hint: 'intensifiers and quantity: deeply, highly, a great deal' },
] as const
export type SpeakingFunction = (typeof SPEAKING_FUNCTIONS)[number]['id']
export const SPEAKING_FUNCTION_IDS = SPEAKING_FUNCTIONS.map((f) => f.id) as [SpeakingFunction, ...SpeakingFunction[]]

/** IELTS Speaking topics. General = fits any topic ("a matter of opinion", "free time"). */
export const SPEAKING_TOPICS = [
  'General',
  'Art',
  'Music',
  'Film & TV',
  'Books & reading',
  'Photography',
  'Sport & exercise',
  'Health',
  'Food & cooking',
  'Travel & tourism',
  'Transport',
  'Environment',
  'Nature & animals',
  'Weather',
  'Work & jobs',
  'Education & study',
  'Technology & internet',
  'Media & news',
  'Advertising',
  'Shopping & money',
  'Business & economy',
  'Family',
  'Friends & relationships',
  'People & personality',
  'Home & housing',
  'Cities & places',
  'Culture & traditions',
  'Celebrations & gifts',
  'Society & government',
  'Crime & law',
  'History',
  'Science',
  'Fashion & appearance',
  'Hobbies & leisure',
  'Language & communication',
  'Daily life & time',
] as const
export type SpeakingTopic = (typeof SPEAKING_TOPICS)[number]

/** Where an item sounds natural: in conversation, anywhere, or only in formal writing (never suggested for speaking). */
export const SPEAKING_USES = ['speaking', 'both', 'writing'] as const
export type SpeakingUse = (typeof SPEAKING_USES)[number]

/** Library sources that are tagged (essay phrases are left out). */
export const SPEAKING_SOURCES = ['collocation', 'vocabulary', 'word-collocation', 'note'] as const

/** One library item's tags, keyed by its review card id in the index. */
export interface SpeakingTag {
  term: string
  /** Fingerprint of the item's wording when it was tagged: a changed item is tagged again. */
  hash: string
  functions: SpeakingFunction[]
  topics: SpeakingTopic[]
  use: SpeakingUse
  /** How to drop it into a sentence when that differs from the term ("be a keen admirer of + N"). */
  slot?: string
  /** CEFR level for using it actively (tags made before levels were asked have none). */
  level?: SpeakingLevel
  /** collocation = a reusable phrase; word = one word; fragment = a piece of one essay's sentence, not reusable as is. */
  kind?: PhraseKind
  tagged_at: string
}

export const SPEAKING_LEVELS = ['B1', 'B2', 'C1', 'C2'] as const
export type SpeakingLevel = (typeof SPEAKING_LEVELS)[number]
export const PHRASE_KINDS = ['collocation', 'word', 'fragment'] as const
export type PhraseKind = (typeof PHRASE_KINDS)[number]

/** content/speaking/index.json */
export interface SpeakingIndexDoc {
  version: 1
  updated_at: string
  entries: Record<string, SpeakingTag>
}

export interface SpeakingSyncJob {
  status: 'running' | 'done' | 'error' | 'stopped'
  startedAt: string
  finishedAt?: string
  /** Items to tag in this run, and how many are done. */
  total: number
  done: number
  /** Items whose batch failed (left for the next sync). */
  failed: number
  removed: number
  error?: string
}

export interface SpeakingSyncStatus {
  /** Library items that can be tagged. */
  library: number
  tagged: number
  /** New items without tags. */
  pending: number
  /** Items edited since they were tagged. */
  changed: number
  /** Tags whose item is gone from the library. */
  removed: number
  updatedAt?: string
  /** The topic collocations (content/topic-collocations), tagged the same way into content/speaking/topic-tags.json. */
  topic?: { total: number; tagged: number; pending: number; changed: number; removed: number }
  job?: SpeakingSyncJob
  ready: boolean
}

export const SPEAKING_PARTS = [1, 2, 3] as const
export type SpeakingPart = (typeof SPEAKING_PARTS)[number]

/** IELTS answer length per part, in words: Part 1 ≈ 20–30 s, Part 2 = 1.5–2 min, Part 3 ≈ 40–60 s. */
export const ANSWER_WORDS: Record<SpeakingPart, { min: number; max: number; sentences: string }> = {
  1: { min: 45, max: 75, sentences: '3-4 sentences' },
  2: { min: 220, max: 320, sentences: 'about 270 words' },
  3: { min: 60, max: 100, sentences: '4-6 sentences' },
}

export interface SpeakingQuestionInput {
  question: string
  /** The learner's own idea or outline for the answer (optional, any language). */
  idea?: string
}

/** answer: phrases + a model answer (Claude writes and edits it); phrases: only the library phrases found for each
 * question (Claude reads the questions, code ranks the library) — quicker, for learners who write their own answer. */
export type SpeakingMode = 'answer' | 'phrases'
export type SpeakingEngine = 'claude' | 'antigravity'

export interface SpeakingRequest {
  topic: string
  part: SpeakingPart
  questions: SpeakingQuestionInput[]
  mode?: SpeakingMode
  engine?: SpeakingEngine
}

/** What a question asks the speaker to do, its topics and the words a good answer contains (from the analysis). */
export interface QuestionAnalysis {
  functions: SpeakingFunction[]
  topics: SpeakingTopic[]
  keywords: string[]
  /** Words of the learner's own idea (in English): they weigh most when ranking the library. */
  ideaKeywords?: string[]
}

/** A library item found for a question ("Phrases only"), best match first. */
export interface SpeakingCandidate {
  cardId: string
  term: string
  slot?: string
  meaning_vi: string
  example?: string
  origin: string
  href?: string
  inReview: boolean
  learning: boolean
  functions: SpeakingFunction[]
  topics: SpeakingTopic[]
  isTopicCollocation?: boolean
}

/** A library item suggested for a question. */
export interface SpeakingPick {
  cardId: string
  term: string
  slot?: string
  meaning_vi: string
  origin: string
  href?: string
  /** Vietnamese: where it fits in this answer. */
  how: string
  example: string
  /** In the review queue, and still being learned (not yet stable). */
  inReview: boolean
  learning: boolean
  isTopicCollocation?: boolean
}

/** A phrase from outside the library, checked against Longman / OZDIC. */
export interface SpeakingExtra {
  phrase: string
  /** Claude's first wording, when no dictionary listed it and a listed alternative took its place. */
  original?: string
  meaning_vi: string
  example: string
  verified: boolean
  /** Not listed in Longman / OZDIC, but judged natural in its sentence. */
  natural?: boolean
  /** Not listed and judged suspicious: why (Vietnamese). */
  why?: string
  /** Dictionary lines that confirm it. */
  dictionary: string[]
  sources: { name: 'Longman' | 'OZDIC' | 'DOL'; url: string }[]
}

/** A piece of the model answer; `mark` = a suggested phrase, or a NeuralSymbolic structure / marker, used there. */
export interface AnswerSegment {
  text: string
  /** checked: confirmed by Longman / OZDIC; unverified: not listed and judged suspicious (or not judged); natural: not listed but judged natural. */
  mark?: 'library' | 'extra' | 'unverified' | 'structure' | 'checked' | 'natural'
  /** Shown on hover: the dictionary line that confirms it, or why it is not confirmed. */
  note?: string
}

/** One block of a learner's idea as the AI laid it out: a heading, a paragraph or a bullet, with an optional bold label. */
export interface IdeaBlock {
  kind: 'heading' | 'paragraph' | 'bullet'
  /** Shown in bold before the text ("Ý 1", "Khó khăn"); none for a heading. */
  label?: string
  text: string
}

/**
 * A learner's idea laid out for reading (server/format-idea.ts): spelling, punctuation, paragraphs and labels fixed,
 * the ideas unchanged. `blocks` is empty when the AI's layout changed the ideas and was dropped: the page then shows
 * the text as typed.
 */
export interface FormattedIdea {
  blocks: IdeaBlock[]
}

/**
 * What finding and checking a text's phrases did (server/annotate.ts): combinations listed, ones that could not be
 * placed in the text, ones the dictionary scan added, sentences asked about again, sentences still without any (0-based),
 * and network lookups the scan made.
 */
export interface CoverageReport {
  listed: number
  dropped: string[]
  scanned: number
  retried: number[]
  uncovered: number[]
  fetches: number
}

/** A collocation / verb pattern Claude wrote itself in the model answer, looked up in Longman / OZDIC. */
export interface CheckedWording {
  text: string
  /** Claude's first wording, when the dictionaries did not list it and Claude picked a listed one instead. */
  original?: string
  meaning_vi?: string
  verified: boolean
  /** Not listed in Longman / OZDIC, but judged natural in its sentence. */
  natural?: boolean
  /** Not listed and judged suspicious: why (Vietnamese). */
  why?: string
  /** A library phrase marked in the text in another form (the page lists it here): its library card is the card. */
  library?: boolean
  dictionary: string[]
  sources: { name: 'Longman' | 'OZDIC' | 'DOL'; url: string }[]
}

/**
 * The NeuralSymbolic role of a sentence in the model answer (content/speaking/linearthinking-skill.md): the direct
 * answer, a Linear tool that expands it, or a Part 2 framework part.
 */
export const LINEAR_TOOLS = ['answer', 'description', 'cause', 'effect', 'example', 'specify', 'lead_in', 'introduction', 'conclusion'] as const
export type LinearTool = (typeof LINEAR_TOOLS)[number]

export interface AnswerSentence {
  tool: LinearTool
  segments: AnswerSegment[]
}

/** A structure or marker from the NeuralSymbolic guide used in the model answer. */
export interface UsedStructure {
  /** As written in the guide, e.g. "The best part about N is that SV". */
  pattern: string
  /** The words in the answer. */
  text: string
  tool: LinearTool
  /** false: a natural frame Claude extended beyond the guide's own list. */
  fromGuide?: boolean
}

export interface OriginalAnswerBackup {
  answer: AnswerSegment[]
  sentences?: AnswerSentence[]
  structures?: UsedStructure[]
  wording?: CheckedWording[]
}

export interface SpeakingAnswer {
  question: string
  idea?: string
  /** The idea laid out for reading (spelling, punctuation, paragraphs, labels); the ideas unchanged. */
  ideaFormatted?: FormattedIdea
  picks: SpeakingPick[]
  extras: SpeakingExtra[]
  /** The whole model answer (copy text; older results only have this). */
  answer: AnswerSegment[]
  /** The model answer sentence by sentence, each with its Linear tool. */
  sentences?: AnswerSentence[]
  structures?: UsedStructure[]
  wording?: CheckedWording[]
  /** The learner's idea restated in plain English before writing ("Think in English"). */
  meaning?: string
  /** What the editing pass changed so the answer says exactly what the learner means, naturally. */
  polish?: PolishEdit[]
  /** How the phrases of the answer were found and checked (to trace a missed one). */
  coverage?: CoverageReport
  /** The learner's own customized revision of the answer, if they edited it. */
  userEdited?: string
  /** Backup of original AI model answer before user formatted their edit. */
  originalAnswer?: OriginalAnswerBackup
  /** "Phrases only": the analysis and the library items found, best first (no model answer). */
  analysis?: QuestionAnalysis
  candidates?: SpeakingCandidate[]
  /** "Phrases only": words and collocations Claude proposes for the learner's idea, looked up in Longman / OZDIC. */
  ideaPhrases?: SpeakingExtra[]
  /** The learner's Vietnamese terms and their English in the DOL dictionary (given to the AI as preferred wording). */
  dol?: DolHint[]
}

/** A Vietnamese word or phrase and its English in the DOL dictionary (tudien.dolenglish.vn). */
export interface DolHint {
  /** As the learner wrote it. */
  query: string
  /** The dictionary's headword. */
  vi: string
  en: string
  /** The dictionary's English synonym ("intense competition" / "fierce rivalry"). */
  alt?: string
  pos?: string
  /** Vietnamese definition (shortened). */
  definitionVi?: string
  example?: { vi: string; en: string }
  /** The dictionary page. */
  url: string
  /** exact = the dictionary's words are the learner's; near = a related entry the search found (the AI keeps it only
   * when it says the learner's idea). */
  match?: 'exact' | 'near'
  /** DOL's note, shortened: how the entry differs from its synonyms (formal, figurative…), examples left out. */
  note?: string
  /** Its number in a prompt (d1, d2…), only while the AI chooses. */
  ref?: string
}

/** One change of the editing pass: meaning = it did not say what the learner means; natural = a native speaker would not
 * say it; dictionary = Longman / OZDIC list a better combination. */
export interface PolishEdit {
  original: string
  replacement: string
  kind: 'meaning' | 'natural' | 'dictionary'
  /** Vietnamese. */
  why: string
  /** The new wording's dictionary check (verified with no lines = no new word combination to look up). */
  verified: boolean
  dictionary: string[]
  sources: { name: 'Longman' | 'OZDIC' | 'DOL'; url: string }[]
}

export interface SpeakingUsage {
  model: string
  input: number
  output: number
  thinking: number
}

export interface SpeakingResult {
  id: string
  createdAt: string
  durationMs: number
  topic: string
  part: SpeakingPart
  mode?: SpeakingMode
  engine?: SpeakingEngine
  answers: SpeakingAnswer[]
  /** Library items shown to Claude (after matching tags). */
  candidates: number
  usage: SpeakingUsage
}

/** One saved suggestion in the history list. */
export interface SpeakingHistoryItem {
  id: string
  createdAt: string
  topic: string
  part: SpeakingPart
  mode?: SpeakingMode
  engine?: SpeakingEngine
  questions: string[]
  /** Same order as `questions`: whether that question has a model answer (used by the question picker in Speaking review). */
  answered?: boolean[]
}

export interface SpeakingJob {
  id: string
  mode?: SpeakingMode
  engine?: SpeakingEngine
  status: 'running' | 'done' | 'error'
  startedAt: string
  step?: 'analyze' | 'match' | 'suggest' | 'dictionary' | 'alternatives' | 'polish'
  error?: string
  result?: SpeakingResult
}
