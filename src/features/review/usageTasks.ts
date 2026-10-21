// Exercises of the usage ladder, built from a card's own data (no AI):
// - "collocate": a sentence with the PARTNER word(s) of a collocation blanked ("The aim is to ___ poverty").
// - "produce": what to use in a sentence of your own (the word or one of its collocations) and an IELTS question.
import type { ReviewCard } from '@/types/content'
import { phraseKey } from '@/lib/wordDrills'
import type { CardAbilities } from './ladder'

const PLACEHOLDER = /\b(sb|sth|somebody|something|someone|one's|sb's|n|v|v-ing|ving|adj|to-v)\b|\+|~|\([^)]*\)/gi
const ARTICLES = new Set(['a', 'an', 'the'])
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(PLACEHOLDER, ' ')
    .match(/[a-z]+(?:['-][a-z]+)*/g) ?? []
const stem = (w: string) => w.replace(/(ies|es|s|ed|ing)$/, '').slice(0, Math.max(3, w.length - 3))
const sameWord = (a: string, b: string) => a === b || (a.length > 3 && b.length > 3 && stem(a) === stem(b))
const plain = (s: string) =>
  s
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export interface CollocateTask {
  /** The whole collocation, e.g. "reduce poverty". */
  phrase: string
  meaning?: string
  /** Sentence around the blank (`after` may be ""); `before`+answer+`after` = the original sentence. */
  before: string
  after: string
  /** Accepted partners ("take", "accept" for "take/accept responsibility"); the first one is shown as the answer. */
  answers: string[]
}

/** Headword of a card: the word itself, or the parent word of a collocation card ("Collocation of: poverty"). */
function headwordOf(card: ReviewCard): string | null {
  const parent = /^Collocation of:\s*(.+)$/.exec(card.origin)?.[1]
  if (parent) return parent
  if (card.source === 'vocabulary' || card.source === 'note' || card.source === 'custom') return card.term
  return null
}

/** "take/accept responsibility for sth" → ["take responsibility for sth", "accept responsibility for sth"]. */
function variants(phrase: string): string[] {
  const m = /(\S+)\/(\S+)/.exec(phrase)
  if (!m) return [phrase]
  return [...variants(phrase.replace(m[0], m[1])), ...variants(phrase.replace(m[0], m[2]))]
}

/** The partner of `head` inside a phrase ("live in poverty" → "live in"), or null when it is not a clean blank. */
function partnerOf(phrase: string, head: string | null, type?: string): string | null {
  const tokens = words(phrase)
  if (tokens.length < 2) return null
  let partner: string[]
  if (head) {
    const headTokens = words(head)
    partner = tokens.filter((t) => !headTokens.some((h) => sameWord(t, h)) && !ARTICLES.has(t))
  } else {
    // No headword (collocation lessons, essay phrases): the verb/adjective comes first, a preposition comes last.
    const content = tokens.filter((t) => !ARTICLES.has(t))
    partner = /prep/i.test(type ?? '') ? content.slice(-1) : content.slice(0, 1)
  }
  if (!partner.length || partner.length > 3 || partner.length === tokens.length) return null
  return partner.join(' ')
}

/** Finds the partner in a sentence (first word may be inflected: "reduced poverty"). */
function blankIn(sentence: string, partner: string): { before: string; after: string; written: string } | null {
  const parts = partner.split(' ')
  const re = new RegExp(
    `\\b(${stem(parts[0])}[a-z]*${parts
      .slice(1)
      .map((p) => `\\s+${p}`)
      .join('')})\\b`,
    'i',
  )
  const m = re.exec(sentence)
  if (!m) return null
  return { before: sentence.slice(0, m.index), after: sentence.slice(m.index + m[0].length), written: m[0] }
}

/** Every collocation exercise the card can give (best first: with a real sentence). */
export function collocateTasks(card: ReviewCard): CollocateTask[] {
  const head = headwordOf(card)
  const sources: { phrase: string; meaning?: string; examples: string[] }[] = card.collocations.length
    ? card.collocations.map((c) => ({
        phrase: c.text,
        meaning: c.meaning_vi,
        examples: [c.example, ...card.examples.map((e) => e.en)].filter((x): x is string => Boolean(x)),
      }))
    : /collocation/i.test(card.part_of_speech.join(' ')) || card.source === 'word-collocation' || card.source === 'collocation'
      ? [{ phrase: card.term, meaning: card.meaning_vi.split('\n')[0], examples: card.examples.map((e) => e.en) }]
      : []
  const type = card.part_of_speech.join(' ')
  const tasks: CollocateTask[] = []
  for (const s of sources) {
    const forms = variants(s.phrase)
    const answers = [...new Set(forms.map((f) => partnerOf(f, head, type)).filter((p): p is string => Boolean(p)))]
    if (!answers.length) continue
    let task: CollocateTask | null = null
    for (const ex of s.examples) {
      for (const a of answers) {
        const hit = blankIn(plain(ex), a)
        if (hit) {
          // The form written in the sentence ("reduced") is the answer shown; base forms are accepted too.
          task = {
            phrase: s.phrase,
            meaning: s.meaning,
            before: hit.before,
            after: hit.after,
            answers: [...new Set([hit.written.toLowerCase(), ...answers])],
          }
          break
        }
      }
      if (task) break
    }
    if (!task) {
      // No sentence: blank the partner in the phrase itself ("___ poverty").
      const hit = blankIn(forms[0], answers[0])
      if (hit)
        task = {
          phrase: s.phrase,
          meaning: s.meaning,
          before: hit.before,
          after: hit.after,
          answers: [...new Set([hit.written.toLowerCase(), ...answers])],
        }
    }
    if (task) tasks.push(task)
  }
  return tasks.sort((a, b) => Number(b.before.length + b.after.length > 25) - Number(a.before.length + a.after.length > 25))
}

export interface CollocateAnswer {
  typed: string
  correct: boolean
  hinted: boolean
}

/** Suggested grade: right → Good (Hard with the first-letter hint), wrong → Again. */
export const collocateRating = (a: CollocateAnswer): 1 | 2 | 3 | 4 => (a.correct ? (a.hinted ? 2 : 3) : 1)

/** Typed partner vs the accepted ones; inflections count ("reduces" for "reduce"). */
export function isPartnerCorrect(typed: string, answers: string[]): boolean {
  const t = words(typed)
  return answers.some((a) => {
    const w = words(a)
    return w.length === t.length && w.every((x, i) => sameWord(x, t[i]))
  })
}

/** "reduce" → "r_____" (one hint, makes the grade Hard at best). */
export const hintOf = (answer: string) => answer.replace(/\B[a-z]/gi, '_')

/* ───────────── "Use it in your own sentence" ───────────── */

export const PRODUCE_TOPICS: { topic: string; questions: string[] }[] = [
  { topic: 'Education', questions: ['Should university education be free?', 'Is online learning as effective as classroom learning?'] },
  { topic: 'Work', questions: ['Is working from home better than working in an office?', 'Should people stay in one job for life?'] },
  { topic: 'Health', questions: ['What can governments do to make people healthier?', 'Is fast food a serious problem today?'] },
  { topic: 'Environment', questions: ['Who should protect the environment: individuals or governments?', 'How can cities reduce air pollution?'] },
  { topic: 'Technology', questions: ['Do smartphones do more harm than good?', 'Will artificial intelligence replace many jobs?'] },
  { topic: 'Society', questions: ['Why are young people moving to big cities?', 'How can we reduce the gap between rich and poor?'] },
  { topic: 'Crime', questions: ['Is prison the best way to reduce crime?', 'Why do some teenagers commit crimes?'] },
  { topic: 'Media', questions: ['Do social media influencers set a good example?', 'Should news be free for everyone?'] },
  { topic: 'Travel', questions: ['Does tourism help or harm local communities?', 'Is it better to travel alone or in a group?'] },
  { topic: 'Family', questions: ['Should elderly parents live with their children?', 'Do parents spend enough time with their children?'] },
  { topic: 'Economy', questions: ['Should governments spend more on public transport?', 'Is economic growth always a good thing?'] },
]

/** A sentence to write: "Viết lại câu" (rewrite `source` with the target) or "Tự dùng" (answer `question`). */
export interface WritingTask {
  kind: 'paraphrase' | 'produce'
  target: string
  meaning: string
  /** Tự dùng only ("" for a rewrite). */
  topic: string
  question: string
  /** Viết lại câu only ("" for an own sentence): the sentence to rewrite, and a model answer shown afterwards. */
  source: string
  model?: string
  /** An example of the target, behind the "show example" hint. */
  example?: string
  /** Dictionary data sent with the sentence (see ProduceItem.ref). */
  ref: string
}

const REF_MAX = 320

/**
 * "collocations: take responsibility; accept responsibility | patterns: responsibility for + N/V-ing | e.g. …" — the
 * card's own data for the target, kept short (it is sent with every sentence). For a collocation target only the
 * patterns containing it are given.
 */
function refFor(card: ReviewCard, c: ReviewCard['collocations'][number] | null): string {
  const target = c?.text ?? card.term
  const patterns = [...(card.patterns ?? []), ...(card.formula ? [card.formula] : [])].filter((p) => !c || phraseKey(p).includes(phraseKey(target)))
  const example = plain(c?.example ?? card.examples[0]?.en ?? '')
  const parts = [
    c
      ? ''
      : card.collocations.length
        ? `collocations: ${card.collocations
            .slice(0, 6)
            .map((x) => x.text)
            .join('; ')}`
        : '',
    patterns.length ? `patterns: ${patterns.slice(0, 4).join('; ')}` : '',
    example ? `e.g. ${example}` : '',
  ].filter(Boolean)
  return parts.join(' | ').slice(0, REF_MAX)
}

const firstMeaning = (s: string) =>
  s
    .split('\n')[0]
    .replace(/^\d+[.)]\s*/, '')
    .split(' - ')[0]
    .trim()

/** A general IELTS question, used when the card has no questions of its own (older words, notes, essay phrases). */
function bankQuestion(card: ReviewCard, recent: string[], pick: <T>(xs: T[]) => T): { topic: string; question: string } {
  const fresh = PRODUCE_TOPICS.filter((t) => !recent.includes(t.topic))
  // Half the time a topic the card belongs to ("Environment > Conservation"), otherwise any topic not used lately.
  const about = `${card.origin} ${card.tags.join(' ')}`.toLowerCase()
  const related = fresh.filter((t) => about.includes(t.topic.toLowerCase()))
  const t = pick(related.length && Math.random() < 0.5 ? related : fresh.length ? fresh : PRODUCE_TOPICS)
  return { topic: t.topic, question: pick(t.questions) }
}

/**
 * What to use and which question to answer. A word alternates between itself and one of its collocations; the question
 * is one of the word's own (Admin writes 3, each listing the collocations it suits), in a context not used lately.
 * When the word has its own questions, only collocations one of them suits are chosen — never a question that does not
 * fit the collocation. Cards without questions use the general topic bank.
 */
export function produceTask(card: ReviewCard, recent: string[], pick: <T>(xs: T[]) => T): WritingTask {
  const prompts = card.use_prompts ?? []
  const suiting = (phrase: string) => prompts.filter((p) => p.fits.some((f) => phraseKey(f) === phraseKey(phrase)))
  const usable = card.collocations.filter((c) => c.text.trim() && !/\+\s*(n|v)/i.test(c.text))
  const candidates = prompts.length ? usable.filter((c) => suiting(c.text).length) : usable.slice(0, 6)
  const c = candidates.length && Math.random() < 0.5 ? pick(candidates) : null
  const own = c ? suiting(c.text) : prompts
  const freshOwn = own.filter((p) => !recent.includes(p.context))
  const q = own.length ? pick(freshOwn.length ? freshOwn : own) : null
  const { topic, question } = q ? { topic: q.context, question: q.question } : bankQuestion(card, recent, pick)
  return {
    kind: 'produce',
    target: c ? c.text : card.term,
    meaning: c ? (c.meaning_vi ?? '') : firstMeaning(card.meaning_vi || card.meaning_en || ''),
    topic,
    question,
    source: '',
    example: plain(c?.example ?? card.examples[0]?.en ?? '') || undefined,
    ref: refFor(card, c),
  }
}

/** One of the card's rewrite tasks (a word card also has those of its collocations); null when it has none. */
export function paraphraseTask(card: ReviewCard, pick: <T>(xs: T[]) => T): WritingTask | null {
  const tasks = card.paraphrase ?? []
  if (!tasks.length) return null
  const t = pick(tasks)
  const c = card.collocations.find((x) => phraseKey(x.text) === phraseKey(t.target)) ?? null
  return {
    kind: 'paraphrase',
    target: t.target,
    meaning: c ? (c.meaning_vi ?? '') : firstMeaning(card.meaning_vi || card.meaning_en || ''),
    topic: '',
    question: '',
    source: t.source,
    model: t.model,
    example: plain(c?.example ?? card.examples[0]?.en ?? '') || undefined,
    ref: refFor(card, c),
  }
}

/** The sentence task for a card at a writing stage (a rewrite when it has one, else an own sentence). */
export function writingTask(card: ReviewCard, kind: WritingTask['kind'] | null, recent: string[], pick: <T>(xs: T[]) => T): WritingTask {
  return (kind === 'paraphrase' && paraphraseTask(card, pick)) || produceTask(card, recent, pick)
}

/** The last topics used, so the next sentences are about something else. */
const TOPICS_KEY = 'review.produceTopics'
export function recentTopics(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TOPICS_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
export function rememberTopics(topics: string[]) {
  try {
    localStorage.setItem(TOPICS_KEY, JSON.stringify([...new Set([...topics, ...recentTopics()])].slice(0, 4)))
  } catch {
    // Storage blocked: topics are simply not remembered.
  }
}

/* ───────────── Nghe chép (dictation) ───────────── */

const DICTATION_MAX_WORDS = 14
const tokens = (s: string) => s.toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) ?? []

/** The sentence read aloud: the card's own short sentence, else its shortest example with the term, else the term. */
export function dictationText(card: ReviewCard): string {
  if (card.dictation) return card.dictation
  const key = phraseKey(card.term)
  const fitting = card.examples
    .map((e) => plain(e.en))
    .filter((s) => phraseKey(s).includes(key) && tokens(s).length <= DICTATION_MAX_WORDS)
    .sort((a, b) => a.length - b.length)
  return fitting[0] ?? card.term
}

/** Words missing, extra or wrong between what was typed and the sentence (word-level edit distance via LCS). */
export function dictationErrors(typed: string, text: string): number {
  const a = tokens(typed)
  const b = tokens(text)
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) lcs[i][j] = a[i - 1] === b[j - 1] ? lcs[i - 1][j - 1] + 1 : Math.max(lcs[i - 1][j], lcs[i][j - 1])
  return Math.max(a.length, b.length) - lcs[a.length][b.length]
}

/** Suggested grade: every word right → Good; one or two slips in a sentence → Hard; more → Again. */
export function dictationRating(errors: number, text: string): 1 | 2 | 3 {
  if (!errors) return 3
  return errors <= 2 && tokens(text).length >= 5 ? 2 : 1
}

/* ───────────── What a card can practise ───────────── */

const taskCache = new WeakMap<ReviewCard, CollocateTask[]>()

/** collocateTasks, computed once per card object (the session asks on every render). */
export function cardCollocateTasks(card: ReviewCard): CollocateTask[] {
  let tasks = taskCache.get(card)
  if (!tasks) taskCache.set(card, (tasks = collocateTasks(card)))
  return tasks
}

/**
 * A short word or phrase with a meaning can be used in a sentence; a whole sentence or formula cannot. Neither can a
 * phrase card from your Speaking / Writing (it has no questions of its own: add the phrase to Vocabulary / Notes to
 * practise using it) nor a mistake card (corrected, not used).
 */
export function canProduce(card: ReviewCard): boolean {
  if (card.phrase || card.mistake) return false
  const n = words(card.term).length
  return n >= 1 && n <= 6 && Boolean(card.meaning_vi || card.meaning_en)
}

export function abilitiesOf(card: ReviewCard): CardAbilities {
  return { collocate: cardCollocateTasks(card).length > 0, paraphrase: Boolean(card.paraphrase?.length), produce: canProduce(card) }
}
