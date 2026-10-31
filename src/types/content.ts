// Shapes of the JSON documents served under /data/*. Produced by content-pipeline/, consumed by the app.
import type { WorkKind } from './practice.ts'

/* ───────────── Vocabulary (also used for collocation entries) ───────────── */

export interface VocabSense {
  definition_vi: string
  examples: string[]
  patterns: string[]
  usage_notes_vi?: string
}

export interface VocabRelation {
  text: string
  pronunciation?: string
  meaning_vi?: string
  type?: string
  examples?: string[]
}

export interface WordRoots {
  origin?: string
  roots: { root: string; meaning_vi: string }[]
  mnemonic_vi?: string
}

/** Dictation (Review → "Nghe chép"): a short, simple sentence with the word or one of its collocations. */
export interface DictationLine {
  /** The word itself or a collocation text, as in `collocations`. */
  target: string
  text: string
}

/** "Viết lại câu" (Review): a plain sentence without the target, to be rewritten with it, and a model answer. */
export interface ParaphraseTask {
  /** The word itself or a collocation text, as in `collocations`. */
  target: string
  source: string
  model: string
}

/**
 * A question to answer in one sentence with the word (Review → usage stage "Tự dùng"). Gemini writes 3 per word, in 3
 * different contexts, when the word is created in Admin; `fits` lists the word's collocations that also suit it.
 */
export interface UsePrompt {
  /** Short IELTS topic, e.g. "Work". */
  context: string
  question: string
  /** Collocations of the word (texts as in `collocations`) a natural answer could use. */
  fits: string[]
}

export interface VocabWord {
  id: string
  word: string
  pronunciation: string
  image?: string
  /** Source of the picture ("Pixabay · Hans"), shown as its tooltip. */
  image_credit?: string
  part_of_speech: string[]
  senses: VocabSense[]
  collocations: VocabRelation[]
  synonyms: VocabRelation[]
  antonyms: VocabRelation[]
  word_family: string[]
  word_roots?: WordRoots
  mnemonic_vi?: string
  use_prompts?: UsePrompt[]
  dictation?: DictationLine[]
  paraphrase?: ParaphraseTask[]
  /** Only on collocation entries, normalised to e.g. "adjective+noun". */
  collocation_type?: string
  created_at?: string
}

export interface VocabSubTopicSummary {
  id: string
  name: string
  description_vi?: string
  wordCount: number
  preview: string[]
}

export interface VocabTopicSummary {
  id: string
  name: string
  description_vi?: string
  /** Distinct words across the topic's sub-topics. */
  wordCount: number
  /** Several sub-topics: /vocabulary/<topic>/all combines them. */
  hasAllLesson: boolean
  subTopics: VocabSubTopicSummary[]
}

export interface VocabIndex {
  totalWords: number
  topics: VocabTopicSummary[]
}

/** /data/vocabulary/<topicId>/<subTopicId>.json (subTopicId "all" = every word of the topic) */
export interface VocabLesson {
  /** Display title: the topic name when it has a single sub-topic. */
  title: string
  topic: { id: string; name: string }
  subTopic: { id: string; name: string; description_vi?: string }
  words: VocabWord[]
}

/* ───────────── Collocations ───────────── */

export interface CollocationLessonSummary {
  id: string
  title: string
  wordCount: number
  sessionCount: number
}

export interface CollocationTopicSummary {
  id: string
  name: string
  lessons: CollocationLessonSummary[]
}

export interface CollocationIndex {
  totalLessons: number
  totalWords: number
  topics: CollocationTopicSummary[]
}

export interface CollocationSession {
  id: string
  title: string
  description_vi?: string
  wordIds: string[]
}

/** /data/collocations/<lessonId>.json */
export interface CollocationLesson {
  id: string
  title: string
  topic: { id: string; name: string }
  pdf?: string
  markdown: string
  sessions: CollocationSession[]
  words: Record<string, VocabWord>
}

/* ───────────── Grammar ───────────── */

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'

export interface GrammarLesson {
  slug: string
  title: string
  level: CefrLevel
  brief_description_vi: string
  structures: { type: 'affirmative' | 'negative' | 'question' | 'other'; formula: string; example: string }[]
  usages: { explanation_vi: string; examples: { en: string; vi: string }[] }[]
  signals: string[]
  notes_and_exceptions: string[]
}

export interface GrammarTopicSummary {
  id: string
  name: string
  description_vi?: string
  lessons: { slug: string; title: string; level: CefrLevel; brief_description_vi: string }[]
}

export interface GrammarIndex {
  topics: GrammarTopicSummary[]
}

/* ───────────── Notes ───────────── */

export type NoteType = 'Structure' | 'Idiom' | 'Collocation' | 'Vocabulary' | 'Other'

export interface NoteExample {
  en: string
  vi: string
}

export interface Note {
  id: string
  title: string
  type: NoteType
  meaning_vi: string
  usage_context?: string
  formula?: string
  pronunciation?: string
  image?: string
  image_credit?: string
  image_source?: string
  image_query?: string
  patterns: { pattern: string; meaning_vi: string; examples: NoteExample[] }[]
  examples: NoteExample[]
  related_notes: string[]
  created_at: string
  /** Review drills, as on vocabulary words (targets: the title or one of the patterns). */
  use_prompts?: UsePrompt[]
  dictation?: DictationLine[]
  paraphrase?: ParaphraseTask[]
}

/* ───────────── Practice ───────────── */

export interface QuizQuestion {
  id: string
  type: 'multiple_choice' | 'short_answer'
  sentence: string
  options: { id: string; text: string }[]
  correct_answer: string
  explanation: string
  hint?: string
  collocation_type?: string
}

export interface QuizSet {
  id: string
  title: string
  questions: QuizQuestion[]
}

export interface FillBlankTask {
  taskId: string
  taskType: 'fill_in_the_blank'
  title: string
  content: { passage: string; options: string[]; correctAnswers: Record<string, string> }
}

export interface GuidedWritingTask {
  taskId: string
  taskType: 'guided_writing'
  title: string
  content: {
    prompt: string
    outlineEnglish: string
    vietnameseText: string
    fullEnglish: string
    englishSentences: string[]
  }
}

export type WritingTask = FillBlankTask | GuidedWritingTask

export interface WritingSet {
  id: string
  title: string
  tasks: WritingTask[]
}

export interface PracticeIndex {
  quizzes: { id: string; title: string; total: number; multipleChoice: number; shortAnswer: number }[]
  writing: { id: string; title: string; taskCount: number }[]
}

/* ───────────── Speaking Mock Test ───────────── */

export interface SpeakingMockPart1Topic {
  id: string
  topic: string
  questions: string[]
}

export interface SpeakingMockPart23SubTopic {
  id: string
  categoryId: string
  category: string
  subTopic: string
  part2: {
    topic: string
    cueCard: string[]
  }
  part3: {
    questions: string[]
  }
}

export interface SpeakingMockCategory {
  id: string
  category: string
  subTopics: SpeakingMockPart23SubTopic[]
}

export interface SpeakingMockDataset {
  part1Topics: SpeakingMockPart1Topic[]
  part23Categories: SpeakingMockCategory[]
}

/* ───────────── Blog ───────────── */

export interface BlogPostMeta {
  /** URL-safe slug used in routes and /data/blog/<slug>.json */
  slug: string
  /** Slug as stored in content/blog (file name of the markdown), used by the admin editor. */
  sourceSlug: string
  title: string
  topicId: string
  topic: string
  subTopicId: string
  subTopic: string
  excerpt: string
  createdAt: string
  updatedAt?: string
  readingMinutes: number
}

export interface BlogIndex {
  topics: {
    id: string
    name: string
    description_vi?: string
    subTopics: { id: string; name: string; count: number }[]
    count: number
  }[]
  posts: BlogPostMeta[]
}

export interface BlogHeading {
  id: string
  text: string
  depth: 2 | 3 | 4
}

/** /data/blog/<slug>.json */
export interface BlogPost extends BlogPostMeta {
  markdown: string
  headings: BlogHeading[]
}

/* ───────────── Word lookup ───────────── */

/**
 * /data/lookup.json for the header lookup: vocabulary words (with a link to their lesson), collocations
 * from the Collocations lessons, and notes. Collocations nested inside vocabulary words are read from
 * `vocabulary[].word.collocations`.
 */
export interface LookupIndex {
  vocabulary: { word: VocabWord; href: string }[]
  collocations: { word: VocabWord; lesson: string; lessonId: string; href: string }[]
  notes: Note[]
}

/* ───────────── Review (spaced repetition) ───────────── */

/** A card written by hand in content/review/<deck>.json; see content/schema/review_card_schema.json. */
export interface ReviewCardInput {
  id?: string
  term: string
  pronunciation?: string
  part_of_speech?: string[]
  meaning_vi?: string
  meaning_en?: string
  examples?: (string | { en: string; vi?: string })[]
  collocations?: { text: string; meaning_vi?: string; example?: string }[]
  synonyms?: string[]
  antonyms?: string[]
  usage_note_vi?: string
  mnemonic_vi?: string
  tags?: string[]
  /** A mistake of yours (Sổ lỗi): the card asks you to correct your own sentence. */
  mistake?: CardMistake
  /** A phrase from a Speaking answer / Writing model essay: which list it was in and its dictionary check. */
  phrase?: CardPhrase
  /** The Writing review / Speaking answer the card was made from (the card links to it). */
  from?: { kind: WorkKind; id: string; title?: string }
}

/**
 * Where a "Speaking & Writing" card's phrase comes from. A phrase of the result pages' three lists keeps its own facts
 * here — the library cards (Vocabulary, Collocations, Notes) have theirs in the library: a phrase already there uses
 * that card instead of getting one of its own.
 */
export interface CardPhrase {
  /** library: a reference-bank phrase (not in your library); extra: "Cụm ngoài thư viện"; wording: "Cụm AI tự viết". */
  group: 'library' | 'extra' | 'wording'
  /** Listed in Longman / OZDIC. */
  verified: boolean
  /** Not listed, but judged natural in its sentence. */
  natural?: boolean
  /** The dictionary lines that confirm it, and the pages. */
  dictionary: string[]
  sources: { name: string; url: string }[]
}

/** A sentence you wrote, the wrong words and their correction (from a Writing review). */
export interface CardMistake {
  /** Your sentence as written. */
  sentence: string
  wrong: string
  right: string
  /** The corrected sentence. */
  fixed?: string
  /** Why (Vietnamese). */
  why?: string
  /** Dictionary lines that back the correction. */
  dictionary?: string[]
}

/** content/review/<deck>.json */
export interface ReviewDeckFile {
  name?: string
  description?: string
  cards: ReviewCardInput[]
}

export type ReviewSource = 'vocabulary' | 'collocation' | 'word-collocation' | 'note' | 'custom' | 'essay'

/**
 * The one card shape the review module works with. Every source (vocabulary words, lesson collocations,
 * collocations inside words, notes, your own cards) is normalised to it by content-pipeline/review.ts.
 * Field names follow review_card_schema.json; `id`, `source`, `href` and the optional extras are added.
 */
export interface ReviewCard {
  /** Stable across edits: vocab:<word>, colloc:<lesson>:<phrase>, wcolloc:<word>:<phrase>, note:<id>, custom:<deck>:<id>, essay:<essay>:<item>. */
  id: string
  source: ReviewSource
  term: string
  pronunciation?: string
  part_of_speech: string[]
  meaning_vi: string
  meaning_en?: string
  examples: { en: string; vi?: string }[]
  collocations: { text: string; meaning_vi?: string; example?: string }[]
  synonyms: string[]
  antonyms: string[]
  usage_note_vi?: string
  mnemonic_vi?: string
  tags: string[]
  /** Grammar patterns of the word ("responsibility for + N/V-ing"); for a collocation card, the parent's that contain it. */
  patterns?: string[]
  /** Notes only: the structure's formula. */
  formula?: string
  image?: string
  /** Questions for "Tự dùng" (vocabulary words and their collocations); without them a general IELTS topic is used. */
  use_prompts?: UsePrompt[]
  /** Dictation sentence for this card's term; without it the shortest fitting example (or the term) is read. */
  dictation?: string
  /** Rewrite tasks for this card's term (a word card: also those of its collocations). */
  paraphrase?: ParaphraseTask[]
  /** Your own mistake (custom cards from the Sổ lỗi): practised by correcting the sentence. */
  mistake?: CardMistake
  /** A phrase from your Speaking / Writing ("Speaking & Writing" cards): its list and dictionary check. */
  phrase?: CardPhrase
  /** Where the card comes from, e.g. "Weather" or "Collocation of: negotiate". */
  origin: string
  /** Page showing the full entry. */
  href?: string
}

export interface ReviewDeck {
  id: string
  source: ReviewSource
  /** Group heading in the deck list, e.g. "IELTS-5" or "Travel and the environment". */
  group: string
  name: string
  description?: string
  cardIds: string[]
}

/** /data/review/index.json */
export interface ReviewIndex {
  cards: ReviewCard[]
  decks: ReviewDeck[]
}
