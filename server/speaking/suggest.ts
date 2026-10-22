// Speaking ideas: for a topic's questions (and the learner's own ideas), suggest library phrases, example sentences,
// a few dictionary-checked phrases from outside the library, and a model answer that uses them.
//
// 1. analyze (Claude, low effort): each question's speaking functions, topics, the keywords a good answer contains, and
//    the Vietnamese terms of the learner's idea.
// 2. match (code): the tagged library (content/speaking/index.json) is scored against each question — functions,
//    topics, keywords in the item or its questions — with a boost for items the learner is still learning; the best
//    25-40 per question (one shared pool, at most 150) become the candidates. Items tagged "writing" are never offered.
//    The idea's Vietnamese terms are looked up in the DOL dictionary (Vietnamese → English) at the same time.
// 3. suggest (Claude): restates the learner's idea in plain English, then picks among the candidates only (checked by
//    code), writes examples and the model answer with the Linearthinking guide — plain spoken English with a few
//    highlight phrases, preferring the DOL wording for the idea — and may add outside phrases.
// 4. polish (Claude): an examiner-editor pass fixes wording that does not say exactly what the learner means, that a
//    native speaker would not use, or that is over-written. Best effort: a failure keeps the draft.
// 5. dictionary (server/annotate.ts, shared with Writing): on the final answer, the phrases are listed sentence by
//    sentence, looked up in Longman / OZDIC (and DOL), completed by a dictionary scan and a coverage check, and what
//    the AI wrote that no dictionary lists becomes a listed combination where an examiner would mark it down.
import { randomBytes } from 'node:crypto'
import { readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { ReviewCard } from '../../src/types/content.ts'
import {
  ANSWER_WORDS,
  LINEAR_TOOLS,
  SPEAKING_FUNCTION_IDS,
  SPEAKING_FUNCTIONS,
  SPEAKING_TOPICS,
  type AnswerSegment,
  type AnswerSentence,
  type CheckedWording,
  type DolHint,
  type LinearTool,
  type PolishEdit,
  type SpeakingAnswer,
  type SpeakingExtra,
  type SpeakingHistoryItem,
  type SpeakingJob,
  type SpeakingPick,
  type SpeakingRequest,
  type SpeakingResult,
  type SpeakingTag,
  type SpeakingTopic,
  type SpeakingUsage,
} from '../../src/types/speaking.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { requestContext, userPath } from '../paths.ts'
import { readJsonFile, writeJsonFile } from '../files.ts'
import { readState } from '../review/progress.ts'
import { annotate, dolProof, replaceInMarked, type JsonModel } from '../annotate.ts'
import { formatIdea } from '../format-idea.ts'
import { CheckSchema, dictionaries, newContentWords, verifyPhrase, type DictionaryCheck, type RewriteIssue } from '../writing-review/rewrite.ts'
import { proofOf } from '../writing-review/service.ts'
import { chosenHints, DOL_RULE, dolHints, dolIndex, dolPromptBlock, numberHints, viChunkRule } from '../writing-review/dol.ts'
import { loadTopicCollocationItems, topicCard, topicItemUsable, topicTags } from '../topic-collocations.ts'
import { loadLibrary, readIndex } from './library.ts'
import { polishEffort, speakingEffort, speakingJson } from './llm.ts'

export const MAX_QUESTIONS = 8
/**
 * Candidates per question: 40 for one or two questions, down to 25 for six or more — one shared pool of at most 150
 * (~5k tokens). Measured on real runs: the phrases Claude picks sit anywhere from rank 1 to rank 29 of the code's
 * ranking (median ~12, 45% below rank 15), and a quarter come from another question's list.
 */
const perQuestion = (questions: number) => Math.min(40, Math.max(25, Math.ceil(120 / questions)))
const MAX_CANDIDATES = 150
/** A card is "being learned" until its memory is this stable (days). */
const LEARNED_STABILITY = 21

export const dir = (ctx: ApiContext) => userPath(ctx, 'progress', 'speaking')
export const fileOf = (ctx: ApiContext, id: string) => userPath(ctx, 'progress', 'speaking', `${id}.json`)
type TrackedSpeakingJob = SpeakingJob & { userId?: string }
export const validId = (id: string) => /^[a-z0-9-]{6,40}$/.test(id)

/* ───────────── Words ───────────── */

/** Lower-case words with simple endings removed, so "paintings", "painted" and "painting" meet "paint". */
function stems(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+/g) ?? []).map((w) => (w.length <= 4 ? w : w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') || w))
}
const STOP = new Set(stems('a an the to of in on at for by with from as and or but is are be do does it its you your sb sth one'))
const contentStems = (text: string) => stems(text).filter((w) => !STOP.has(w) && w.length > 1)

/* ───────────── 1. analyze ───────────── */

const AnalyzeFields = {
  q: z.number().int().describe('1-based question number (1 for the first question in the list, 2 for the second, etc.).'),
  // A value outside the list becomes undefined (dropped below) instead of failing the whole run.
  functions: z.array(z.enum(SPEAKING_FUNCTION_IDS).catch(undefined as never)).describe('1-3.'),
  topics: z.array(z.enum(SPEAKING_TOPICS).catch(undefined as never)).describe('1-3, never General.'),
  keywords: z.array(z.string()).describe('8-15 single lower-case English words.'),
  idea_keywords: z.array(z.string()).describe('0-10 single lower-case English words from the idea.'),
  vi_terms: z.array(z.string()).describe('0-15 collocation-sized Vietnamese chunks (2-6 words) from the idea; [] when the idea is not in Vietnamese.'),
}
const AnalyzeSchema = z.object({ questions: z.array(z.object(AnalyzeFields)) })
/** "Phrases only" also asks for vocabulary to say the learner's idea. */
const AnalyzePhrasesSchema = z.object({
  questions: z.array(
    z.object({
      ...AnalyzeFields,
      idea_phrases: z.array(
        z.object({
          phrase: z.string(),
          meaning_vi: z.string(),
          example: z.string(),
          checks: z.array(CheckSchema),
        }),
      ),
    }),
  ),
})
/** How many words / collocations "Phrases only" proposes per question (each is looked up in Longman / OZDIC). */
const IDEA_PHRASES = 6

const ANALYZE_SYSTEM = `You classify IELTS Speaking questions so a coach can find phrases for the answers.
For each question return:
- q: the 1-based question number from the list (1 for the first question, 2 for the second, etc.).
- functions: 1-3 things the answer must do:
${SPEAKING_FUNCTIONS.map((f) => `  ${f.id}: ${f.hint}`).join('\n')}
- topics: 1-3 topics from the list (never General);
- keywords: 8-15 single lower-case English words a good answer would likely contain: the topic's key nouns and verbs, their word forms (art, artist, artistic) and closely related words (painting, gallery, exhibition);
- idea_keywords: when the candidate gives an idea, up to 10 single lower-case English words for what it is about (translated when written in Vietnamese: "sông rạch chằng chịt" → river, canal, waterway); [] with no idea.
- vi_terms: when the idea is written in Vietnamese, ${viChunkRule(15)}. [] otherwise.`

const IDEA_PHRASES_RULE = `
- idea_phrases: ${IDEA_PHRASES} words or collocations a band 7-8 speaker would use to say the candidate's idea in English (with no idea: a simple, typical answer) — the specific vocabulary of the idea ("a dense network of rivers and canals", "lush fruit orchards", "be located in the south of"), not proper names. Each with meaning_vi (Vietnamese), one short natural example sentence about the idea, and checks for a collocation dictionary: base = lemma of the headword whose entry lists the combination (the noun for verb+noun, adjective+noun, noun+noun and noun+verb; the verb for verb+preposition; the adjective for adverb+adjective), collocate = lemma of the partner word, pattern; [] for one word.`

/* ───────────── 2. match ───────────── */

interface Entry {
  card: ReviewCard
  tag: SpeakingTag
  /** Words of the item, its examples and its questions. */
  words: Set<string>
  /** Words of the item itself (term and slot): where the learner's idea counts most. */
  termWords: Set<string>
  inReview: boolean
  learning: boolean
}

interface Analysis {
  functions: string[]
  topics: string[]
  keywords: string[]
  ideaKeywords: string[]
}

function score(entry: Entry, q: Analysis): number {
  const { tag } = entry
  const functions = tag.functions.filter((f) => q.functions.includes(f)).length
  const topics = tag.topics.filter((t) => t !== 'General' && q.topics.includes(t)).length
  const general = tag.topics.includes('General')
  const hits = (words: string[], within: Set<string>, cap: number) => Math.min(cap, new Set(words.flatMap(stems).filter((k) => within.has(k))).size)
  const keywords = hits(q.keywords, entry.words, 3)
  // The learner's own idea weighs most — in the item itself ("fast-flowing river"), much less in an example that merely
  // mentions the word ("the river was filthy"); with an idea, an item that shares none of its words drops back.
  const ideaInTerm = hits(q.ideaKeywords, entry.termWords, 2)
  const idea = hits(q.ideaKeywords, entry.words, 3)
  if (!topics && !keywords && !idea && !(general && functions)) return 0
  return (
    3 * functions +
    2.5 * topics +
    2 * keywords +
    8 * ideaInTerm +
    idea -
    (q.ideaKeywords.length && !idea ? 3 : 0) +
    (general ? 0.5 : 0) +
    (tag.use === 'speaking' ? 0.5 : 0) +
    // Everyday and common topic language first: a C1 item has to match better to make the list.
    (tag.level === 'C1' ? -1.5 : 0) +
    (entry.learning ? 2 : entry.inReview ? 0.5 : 0)
  )
}

/** Each question's best items, best first. */
function rankPerQuestion(entries: Entry[], analyses: Analysis[]): Entry[][] {
  return analyses.map((q) =>
    entries
      .map((entry) => ({ entry, score: score(entry, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, perQuestion(analyses.length))
      .map((x) => x.entry),
  )
}

/** One shared pool: question 1's best, question 2's best, … up to the cap. */
function matchCandidates(ranked: Entry[][]): Entry[] {
  const PER_QUESTION = Math.max(0, ...ranked.map((list) => list.length))
  const chosen = new Map<string, Entry>()
  for (let rank = 0; rank < PER_QUESTION && chosen.size < MAX_CANDIDATES; rank++) {
    for (const list of ranked) {
      const entry = list[rank]
      if (entry && chosen.size < MAX_CANDIDATES) chosen.set(entry.card.id, entry)
    }
  }
  return [...chosen.values()]
}

const TOPIC_COLLOCATION_MAP: Record<string, SpeakingTopic[]> = {
  Advertisement: ['Advertising', 'Business & economy'],
  Architecture: ['Cities & places', 'Home & housing', 'Art'],
  'Business & Economics': ['Business & economy', 'Shopping & money', 'Work & jobs'],
  Crime: ['Crime & law', 'Society & government'],
  Education: ['Education & study'],
  Entertainment: ['Art', 'Music', 'Film & TV', 'Hobbies & leisure'],
  Environment: ['Environment', 'Nature & animals', 'Weather'],
  Family: ['Family', 'Friends & relationships', 'People & personality'],
  'Food & Drinks': ['Food & cooking', 'Health'],
  Government: ['Society & government'],
  Health: ['Health', 'Sport & exercise'],
  Lifestyle: ['Daily life & time', 'Hobbies & leisure', 'Fashion & appearance'],
  'Science & Energy': ['Science', 'Environment'],
  'Social Issues': ['Society & government'],
  Sport: ['Sport & exercise', 'Hobbies & leisure'],
  Technology: ['Technology & internet', 'Science'],
  Tourism: ['Travel & tourism'],
  Transport: ['Transport'],
  Work: ['Work & jobs', 'Business & economy'],
  'General Speaking': ['General'],
  'Daily Life': ['Daily life & time'],
  'Media & Entertainment': ['Media & news', 'Film & TV', 'Music'],
  Relationships: ['Friends & relationships', 'People & personality'],
  Celebrities: ['People & personality', 'Film & TV'],
  'Shopping & Money': ['Shopping & money'],
  Travel: ['Travel & tourism'],
  'Cities & Housing': ['Cities & places', 'Home & housing'],
  'Leisure Time': ['Hobbies & leisure'],
}

const LISTENING_SUBTOPIC_MAP: Record<string, SpeakingTopic[]> = {
  EDUCATION: ['Education & study'],
  LIFESTYLE: ['Daily life & time', 'Hobbies & leisure'],
  WORK: ['Work & jobs', 'Business & economy'],
  ENTERTAINMENT: ['Art', 'Music', 'Film & TV', 'Hobbies & leisure'],
  ENVIRONMENT: ['Environment', 'Nature & animals'],
  TECHNOLOGY: ['Technology & internet', 'Science'],
  'SOCIAL ISSUES': ['Society & government'],
  CRIME: ['Crime & law', 'Society & government'],
  GOVERNMENT: ['Society & government'],
  ADVERTISEMENT: ['Advertising'],
  SPORT: ['Sport & exercise', 'Hobbies & leisure'],
  TRANSPORT: ['Transport'],
  'FOOD & DRINKS': ['Food & cooking', 'Health'],
  BUSINESS: ['Business & economy'],
  HEALTH: ['Health', 'Sport & exercise'],
  'SCIENCE & ENERGY': ['Science', 'Environment'],
  TOURISM: ['Travel & tourism'],
  FAMILY: ['Family', 'Friends & relationships'],
  ARCHITECTURE: ['Cities & places', 'Home & housing'],
  HISTORY: ['History'],
  ART: ['Art'],
  ECONOMICS: ['Business & economy'],
  'PLANTS & ANIMALS': ['Nature & animals'],
  'ACADEMIC & ABSTRACT LANGUAGE': ['General', 'Education & study'],
  'DESCRIBING PEOPLE & BEHAVIOUR': ['People & personality', 'Friends & relationships'],
  'COMMUNICATION & LANGUAGE': ['Language & communication'],
  'TIME, QUANTITY & MEASUREMENT': ['General', 'Daily life & time'],
  'PLACES, OBJECTS & EVERYDAY THINGS': ['Cities & places', 'Daily life & time'],
}

function getFunctionsForGroup(group?: string): (typeof SPEAKING_FUNCTION_IDS)[number][] {
  if (group === 'Bối cảnh & Nguyên nhân') return ['cause_effect', 'opinion', 'describe_thing']
  if (group === 'Tác động & Hậu quả' || group === 'Kết quả & Tác động') return ['cause_effect', 'benefit', 'problem', 'trend']
  if (group === 'Giải pháp & Hành động' || group === 'Vấn đề & Giải pháp') return ['solution', 'problem', 'opinion']
  if (group === 'Cảm xúc & Trải nghiệm') return ['feelings', 'experience']
  if (group === 'Giải thích & Làm rõ') return ['opinion', 'cause_effect']
  if (group === 'So sánh & Đối lập') return ['compare']
  if (group === 'Ví dụ & Minh họa') return ['describe_thing', 'experience']
  if (group === 'Ý kiến & Quan điểm') return ['opinion', 'preference']
  if (group === 'Thói quen & Hoạt động') return ['habit', 'describe_thing']
  if (group === 'Xu hướng & Thay đổi') return ['trend', 'compare']
  if (group === 'Mô tả & Đặc điểm') return ['describe_thing', 'describe_person', 'describe_place']
  if (group === 'Mẫu câu & Diễn đạt') return ['opinion', 'preference', 'describe_thing']
  return ['describe_thing', 'experience', 'opinion']
}

function getTopicsForItem(topic: string, subTopic?: string): SpeakingTopic[] {
  if (topic === 'Listening' && subTopic) {
    const key = subTopic.trim().toUpperCase()
    if (LISTENING_SUBTOPIC_MAP[key]) return LISTENING_SUBTOPIC_MAP[key]
  }
  return TOPIC_COLLOCATION_MAP[topic] ?? ['General']
}

let cachedTopicCollocations: { tagsAt: string; entries: Entry[] } | null = null

/**
 * The topic collocations as library entries. Once Library sync has tagged them (content/speaking/topic-tags.json),
 * their own functions, topics and slot are used, and fragments of one essay's sentence, C2 rarities and wording that
 * only suits writing are left out (topicItemUsable). Until then, functions and topics are guessed from the group and
 * topic names. Re-built when the tags change (a running sync saves after every batch).
 */
async function loadTopicCollocations(ctx: ApiContext): Promise<Entry[]> {
  const tags = await topicTags(ctx.rootDir)
  if (cachedTopicCollocations?.tagsAt === tags.updated_at) return cachedTopicCollocations.entries
  const entries: Entry[] = []
  for (const it of await loadTopicCollocationItems(ctx.rootDir)) {
    if (!it.term?.trim()) continue
    const tagged = tags.entries[it.id]
    if (!topicItemUsable(tagged, 'speaking')) continue
    const card = topicCard(it)
    const tag: SpeakingTag = tagged ?? {
      term: it.term,
      hash: it.id,
      functions: getFunctionsForGroup(it.group),
      topics: getTopicsForItem(it.topic, it.subTopic),
      use: 'both',
      tagged_at: '2026-10-15',
    }
    entries.push({
      card,
      tag,
      termWords: new Set(contentStems(`${card.term} ${tag.slot ?? ''}`)),
      words: new Set(contentStems([card.term, tag.slot ?? '', ...card.examples.slice(0, 3).map((e) => e.en)].join(' '))),
      inReview: false,
      learning: false,
    })
  }
  cachedTopicCollocations = { tagsAt: tags.updated_at, entries }
  return entries
}

async function loadEntries(ctx: ApiContext): Promise<Entry[]> {
  const [doc, state] = [await readIndex(ctx), await readState(ctx)]
  const entries: Entry[] = []
  const userTerms = new Set<string>()
  for (const card of loadLibrary(ctx)) {
    const tag = doc.entries[card.id]
    if (!tag || tag.use === 'writing') continue
    const progress = state.cards[card.id]
    const words = new Set(
      contentStems(
        [
          card.term,
          tag.slot ?? '',
          ...card.examples.slice(0, 3).map((e) => e.en),
          ...(card.use_prompts ?? []).map((p) => `${p.context} ${p.question}`),
        ].join(' '),
      ),
    )
    userTerms.add(card.term.trim().toLowerCase())
    entries.push({
      card,
      tag,
      termWords: new Set(contentStems(`${card.term} ${tag.slot ?? ''}`)),
      words,
      inReview: Boolean(progress),
      learning: Boolean(progress) && (progress.fsrs.state !== 2 || progress.fsrs.stability < LEARNED_STABILITY),
    })
  }

  // Include topic collocations (unadded library items for candidate retrieval)
  const topicEntries = await loadTopicCollocations(ctx)
  for (const te of topicEntries) {
    if (!userTerms.has(te.card.term.trim().toLowerCase())) {
      entries.push(te)
    }
  }

  return entries
}

/* ───────────── 3. suggest ───────────── */

const SuggestSchema = z.object({
  answers: z.array(
    z.object({
      q: z.number().int().describe('1-based question number: 1 for the 1st question, 2 for the 2nd question, etc.'),
      meaning: z
        .string()
        .describe(
          "Candidate's idea in English structured as a concise outline using arrows (→) to show logical flow (e.g. 'Main point → cause/detail → effect/result'). For multi-part answers or essays, separate each section/paragraph with a newline.",
        ),
      dol: z
        .array(z.string())
        .describe('Refs (d1, d2…) of the "Dictionary entries (DOL)" that say part of the idea exactly, used or not; [] when none were listed.'),
      picks: z.array(
        z.object({
          ref: z.string().describe('Candidate ref, e.g. "k12".'),
          how: z.string().describe('Vietnamese, max 20 words.'),
          example: z.string(),
        }),
      ),
      extras: z.array(
        z.object({
          phrase: z.string(),
          meaning_vi: z.string(),
          example: z.string(),
          checks: z.array(CheckSchema),
        }),
      ),
      sentences: z.array(
        z.object({
          tool: z.enum(LINEAR_TOOLS).catch('description'),
          text: z.string().describe('One sentence; phrases in [[ ]], guide structures / markers in {{ }}.'),
        }),
      ),
      structures: z.array(
        z.object({
          pattern: z.string().describe('As written in the guide, e.g. "The best part about N is that SV".'),
          text: z.string().describe('The words used in the answer.'),
          tool: z.enum(LINEAR_TOOLS).catch('description'),
          from_guide: z.boolean(),
        }),
      ),
    }),
  ),
})

const words = (part: SpeakingRequest['part']) => `${ANSWER_WORDS[part].sentences}, ${ANSWER_WORDS[part].min}-${ANSWER_WORDS[part].max} words`
const LENGTH: Record<SpeakingRequest['part'], string> = {
  1: `${words(1)} (about 20-30 seconds): the direct answer, then 2-3 Linear tools (3-4 sentences total)`,
  2: `${words(2)} (1.5-2 minutes), in the Part 2 Linear framework: lead_in (the guide's lead-in marker), introduction (each cue in order, told simply), the body (what happened / the answer to the main question, expanded with Linear tools — a story that flows, each sentence following on from the one before), and ONE conclusion sentence that sums up the feeling or the reason in the speaker's own words`,
  3: `${words(3)} (about 40-60 seconds): specify the question when it is broad, the direct answer, Linear tools, and an example ("Take me as an example") when it helps`,
}

/**
 * How the answer should sound. Real contrast pairs (an over-written AI answer vs. the natural one the learner wanted)
 * teach the register better than rules alone; they are about style only, so the model is told not to reuse their words.
 */
const STYLE = `How the answer must sound (second only to the meaning):
- Like a confident band 7-8 candidate TALKING, not an essay read aloud: mostly plain, everyday words in clear sentences of varied length; contractions are fine; let sentences follow on from each other ("He had worked really hard for this because…", "All his hard work eventually paid off.").
- No fixed number of highlight phrases (picks or extras): use every one that is simply the best way to say a point of the candidate's idea — a long answer about a rich idea naturally carries more. The test for each one is whether a native speaker would say exactly that, right there; a sentence that is better plain stays plain (a plain sentence is not a weakness), and one highlight per sentence is usually enough.
- Never pile words up: rarely an intensifier (really, truly, incredibly, genuinely, extremely), never two in a sentence; no stacked adjectives ("exceptionally stiff competition", "extraordinary perseverance"); no written or formal words a speaker would not use ("underprivileged", "institution", "the sole applicant", "against overwhelming odds", "grueling", "immense pride"); no clichés squeezed in.
- Frames from the guide are tools, not decoration: use one only where a speaker would naturally say it. Leave out empty openers and sign-offs ("To tell you a little bit about…", "That's all I have to say. Thank you.") unless they genuinely help.
Contrast pairs (style only — never copy their words or content into an answer):
  ✗ "The main reason for my immense pride is that he gained admission to a prestigious university for engineering against overwhelming odds."
  ✓ "He found out that he had been accepted into a prestigious university to study engineering, which made our whole family incredibly proud."
  ✗ "However, since we lived in an underprivileged countryside area, he had no access to well-equipped test preparation centers."
  ✓ "However, we grew up in the countryside, where he had limited access to good test preparation centers."
  ✗ "His extraordinary perseverance truly filled me with admiration throughout those grueling months."
  ✓ "Despite these difficulties, he never gave up."
  ✗ "Anyway, all in all, we will always take pride in his discipline and resilience, and that's all I have to say. Thank you."
  ✓ "All in all, what makes me proudest is not just his success, but also his determination and willingness to work hard for his family."`

/** The Linearthinking method guide (content/speaking/linearthinking-skill.md), read on every run so edits apply at once. */
export async function linearGuide(ctx: ApiContext): Promise<string> {
  try {
    return (await readFile(path.join(ctx.contentDir, 'speaking', 'linearthinking-skill.md'), 'utf8')).trim()
  } catch {
    return ''
  }
}

const suggestSystem = (
  part: SpeakingRequest['part'],
  guide: string,
) => `You coach a Vietnamese IELTS candidate aiming for band 7+ in Speaking Part ${part}.
Model answers follow the Linearthinking method in the guide below: the direct answer first, then Linear tools that expand it, one tool per sentence.
Priorities, in this order: 1. say exactly what the candidate means; 2. sound like a natural, educated native speaker talking; 3. the Linearthinking flow and frames; 4. using the suggested phrases. Never bend the meaning or the naturalness to fit a phrase or a frame in.
Be flexible, as the guide's "Be flexible" section says: let each question and the candidate's idea decide which tools to use and in what order (tools may repeat; do not give every question the same flow), use the guide's structures where they fit naturally and extend them freely with other natural spoken frames — never force a stiff one. Always keep the IELTS length for the part.

${STYLE}

${DOL_RULE}

For each question:
- q: the 1-based question number from the list (1 for the first question, 2 for the second, etc.). Note: Question 1 MUST have q = 1, regardless of any labels in the question text.
- meaning: first, think in English as a concise outline using arrows (→) to show the logical flow:
  * Format: "Main point → detail / reason → result / impact" (use concise phrases or short clauses, not long dense paragraphs).
  * If the answer covers multiple sections or paragraphs (especially for Part 2 with Intro, Body, Conclusion; or multi-point answers), separate each section onto its own line with a newline (\\n):
    Example for Part 2:
    Intro: favorite gadget → received as birthday gift
    Body: high-performance laptop → enables smooth multitasking for design tasks → boosts productivity
    Conclusion: essential device for daily study and work
    Example for Part 1 / Part 3:
    Direct answer: prefer morning workouts → fresh atmosphere and quiet streets → feel energized for the whole working day
  * Faithfully restate the candidate's idea (often in Vietnamese). With no idea given, provide a concise believable outline. The model answer must say exactly this.
- picks: candidates (by ref) genuinely worth learning for THIS question with the candidate's idea — ones a speaker would really use when talking about it (usually 3-8; quality over quantity, never a phrase that only loosely fits). Prefer natural spoken phrases over formal written ones; when two fit equally well, prefer ones marked * (the candidate is learning them). Avoid repeating an item across questions unless it is clearly the best. Picks are a study list: listing one does NOT mean the answer has to use it. Refs are only for this field: never write them in any text.
- how: in Vietnamese, at most 20 words: where it fits in this answer (which Linear tool).
- example: one natural spoken sentence using the phrase, about the candidate's idea, first person where natural.
- extras: 0-3 natural phrases NOT among the candidates that a band 7-8 speaker could use here (suggestions to learn; use one in the answer only where it is the most natural wording) — common, dictionary-listed combinations, no forced idioms. checks: the word combinations inside the phrase for a collocation dictionary: base = lemma of the headword whose entry lists it (the noun for verb+noun, adjective+noun, noun+noun and noun+verb; the verb for verb+preposition; the adjective for adverb+adjective), collocate = lemma of the partner word, pattern. A one-word extra: checks [].
- sentences: the model answer, ${LENGTH[part]}; each sentence with its tool: answer = the direct answer (the first sentence, unless it specifies the question); description = specifies what / how / who / when / where; cause = why (motive, reason, positive / negative effect, opinion); effect = what follows (feeling, wish, action, habit); example = a concrete case ("For instance…", "Take me as an example…"); specify = splits a broad question into cases ("When it comes to…"); Part 2 also lead_in, introduction, conclusion. Natural spoken English (contractions are fine). Say exactly what "meaning" says — keep the candidate's opinion and story, adding only natural detail. Use as many of the picks / extras as fit the idea naturally (no fixed number), spread out, each only where it is simply the most natural way to say that part; wrap each one used in [[ ]] exactly as it appears (inflected forms are fine). Unused picks and extras are still worth learning: never squeeze one in — if it does not sound like something a native speaker would say right there, leave it out. Wrap ALL the fixed words of each structure or marker (from the guide or extended) in {{ }}: the complete frame, e.g. {{It's highly unlikely that}} not {{it's highly}}, {{That's why}}, {{It would be}}, {{allows me to}}, {{If I remember correctly,}}, {{What I like most about}} ... {{is that}}; a frame with a gap in the middle gets one {{ }} per fixed part: {{The main reason for}} choosing this job {{is that}}; never nest or overlap [[ ]] and {{ }}, no other brackets. Plain sentences without any marked phrase or frame are normal and good; only mark what is really there.
- structures: every structure / marker framing a sentence of the answer: the pattern (as written in the guide, or in the same placeholder style when you extended it), the words used exactly as in the answer (all the fixed words; "…" where the frame has a gap), the tool of its sentence, and from_guide (false for an extended one). List every frame you actually used (sentence frames, transitional linkers, adverbial openers such as "If I remember correctly, ...", "That's why ...", "What I like most about ... is that ..."); never add a frame to the answer just to have one to list.

<linearthinking_guide>
${guide || '(guide missing: use a direct answer followed by Description, Cause and Effect sentences)'}
</linearthinking_guide>`

const PolishSchema = z.object({
  answers: z.array(
    z.object({
      q: z.number().int(),
      edits: z.array(
        z.object({
          sentence: z.number().int(),
          original: z.string().describe('Shortest exact substring of that sentence, as printed without brackets.'),
          replacement: z.string(),
          kind: z.enum(['meaning', 'natural', 'dictionary']).catch('natural'),
          why: z.string().describe('Vietnamese, max 25 words.'),
          checks: z.array(CheckSchema),
        }),
      ),
    }),
  ),
})

const POLISH_SYSTEM = `You are a strict IELTS Speaking examiner and a native-speaker editor. You get model answers a coach wrote for a Vietnamese candidate: the question, the candidate's idea (often in Vietnamese), what it means in plain English, and the answer sentence by sentence ([[ ]] = suggested phrases from the candidate's library, {{ }} = Linearthinking frames).
Edit only what an examiner would mark down:
- meaning: wording that does not say exactly what the candidate means, or that changes it (customers "keep track of logistics trends" when the chatbot lets them track their deliveries → "track their deliveries"); details that change or contradict the candidate's story — who did what, where, how — or that cannot be true in it (a face "lit up" seen during a phone call; "recorded lectures" when the idea says listening to teachers in class). Compare every sentence with the candidate's idea;
- natural: wording an educated native speaker would not use — odd collocations ("make deliveries smoother" → "make the delivery process smoother"), stiff or squeezed-in phrases ("it always gives me pleasure to see" → "it's really satisfying to see"), unnatural word order or register;
- natural, over-written: the answer must sound like someone talking, not an essay. Simplify wording that piles up intensifiers or adjectives ("his extraordinary perseverance truly filled me with admiration" → "he never gave up"; "exceptionally stiff competition" → "very tough competition"), formal or written words in speech ("an underprivileged countryside area" → "the countryside"; "the sole applicant" → "the only student"), fancy phrases where a plain one is clearer, and empty sign-offs ("That's all I have to say. Thank you." → drop it). A few strong phrases in a plain answer sound best;
Keep the frames that sound natural, the flow, the length (±15%) and everything that is already precise and natural. Dropping a suggested [[ ]] phrase or a frame is fine when it is what sounds wrong (replacement may then be plain words). Do not edit for the sake of it: an answer with no edits is fine.
For each edit: the sentence number; original = the shortest exact substring of that sentence as printed (without brackets); replacement; kind; why in Vietnamese (at most 25 words); checks = the new word combinations in the replacement for a collocation dictionary (base = lemma of the headword whose entry lists it: the noun for verb+noun, adjective+noun, noun+noun and noun+verb; the verb for verb+preposition; the adjective for adverb+adjective; collocate = lemma of the partner word; for verb + object + adjective, check the adjective with the noun), [] when there is none.`

const candidateLine = (entry: Entry, ref: string) =>
  [
    `${ref}${entry.learning ? '*' : ''}`,
    entry.card.term,
    entry.tag.slot ?? '',
    entry.card.meaning_vi.replace(/\s+/g, ' ').slice(0, 60),
    (entry.card.examples[0]?.en ?? '').slice(0, 90),
  ].join('|')

/* ───────────── The model answer's marks ───────────── */

interface Span {
  start: number
  end: number
  mark: NonNullable<AnswerSegment['mark']>
  note?: string
}

/**
 * One sentence of the model answer, marked. [[ ]] are suggested phrases (tagged library / extra by what they most likely
 * are); {{ }} are structures. Claude sometimes wraps only part of a frame ("{{it's highly}} unlikely that"), so the
 * structures it lists for the answer are also found in the sentence and their full words marked, each fixed part of a
 * gapped frame ("The main reason for … is that") on its own — never over a suggested phrase.
 */
/** Hover note of a combination no dictionary lists that was judged natural in its sentence. */
const NATURAL_NOTE = 'Longman và OZDIC không liệt kê cụm này, nhưng AI đánh giá đây là cách nói tự nhiên.'

export function markSentence(
  raw: string,
  extras: SpeakingExtra[],
  structureTexts: string[],
  wording: CheckedWording[] = [],
  picks: SpeakingPick[] = [],
  /** The hover note of wording the dictionaries do not list (Speaking: Claude wrote it). */
  unlistedNote: (text: string) => string = () => 'Longman và OZDIC không liệt kê cụm này: Claude tự viết.',
): AnswerSegment[] {
  const overlap = (a: string, b: string) => {
    const x = contentStems(a)
    const y = new Set(contentStems(b))
    return x.length ? x.filter((w) => y.has(w)).length / Math.min(x.length, y.size || 1) : 0
  }
  /** Not listed in the dictionaries: natural when judged so, else unconfirmed (with whose words and any reason). */
  const unlisted = (w: { natural?: boolean; why?: string }, text: string) =>
    w.natural
      ? { mark: 'natural' as const, note: NATURAL_NOTE }
      : { mark: 'unverified' as const, note: `${unlistedNote(text)}${w.why ? ` Lưu ý: ${w.why}` : ''}` }
  let plain = ''
  const phrases: Span[] = []
  let frames: Span[] = []
  for (const part of raw.split(/(\[\[[\s\S]*?\]\]|\{\{[\s\S]*?\}\})/).filter(Boolean)) {
    const wrapped = (open: string, close: string) => part.startsWith(open) && part.endsWith(close)
    const text = wrapped('[[', ']]') || wrapped('{{', '}}') ? part.slice(2, -2) : part.replace(/\[\[|\]\]|\{\{|\}\}/g, '')
    const span = { start: plain.length, end: plain.length + text.length }
    if (wrapped('{{', '}}')) {
      frames.push({ ...span, mark: 'structure' })
    } else if (wrapped('[[', ']]')) {
      const extra = extras.find(
        (e) =>
          overlap(text, e.phrase) >= 0.4 ||
          e.phrase.toLowerCase().includes(text.toLowerCase()) ||
          text.toLowerCase().includes(e.phrase.toLowerCase()),
      )
      if (extra) {
        phrases.push({ ...span, ...(extra.verified ? { mark: 'extra' as const } : unlisted(extra, text)) })
      } else {
        const pick = picks.find(
          (p) =>
            overlap(text, p.term) >= 0.4 ||
            (p.slot && overlap(text, p.slot) >= 0.4) ||
            p.term.toLowerCase().includes(text.toLowerCase()) ||
            text.toLowerCase().includes(p.term.toLowerCase()),
        )
        if (pick) {
          phrases.push({ ...span, mark: 'library' })
        } else {
          const w = wording.find(
            (item) =>
              overlap(text, item.text) >= 0.4 ||
              item.text.toLowerCase().includes(text.toLowerCase()) ||
              text.toLowerCase().includes(item.text.toLowerCase()),
          )
          if (w) {
            phrases.push({ ...span, ...(w.verified ? { mark: 'checked' as const, note: w.dictionary[0] } : unlisted(w, w.text)) })
          } else {
            phrases.push({ ...span, mark: picks.length ? 'checked' : 'library' })
          }
        }
      }
    }
    plain += text
  }

  const lower = plain.toLowerCase()
  const clash = (a: { start: number; end: number }) => phrases.some((p) => a.start < p.end && p.start < a.end)
  for (const text of structureTexts) {
    for (const piece of text.split(/\s*(?:…|\.\.\.)\s*/)) {
      const words = piece.trim().replace(/^[,.;:]+|[,.;:]+$/g, '')
      if (words.length < 3) continue
      const at = lower.indexOf(words.toLowerCase())
      const span = { start: at, end: at + words.length, mark: 'structure' as const }
      if (at >= 0 && !clash(span)) frames.push(span)
    }
  }
  // Partial and overlapping frames merge into one.
  frames = frames
    .sort((a, b) => a.start - b.start)
    .reduce<Span[]>((out, f) => {
      const last = out.at(-1)
      if (last && f.start <= last.end) last.end = Math.max(last.end, f.end)
      else out.push({ ...f })
      return out
    }, [])
    .filter((f) => !clash(f))

  // Claude's own wording, looked up in the dictionaries: wherever it does not cross a phrase or a frame.
  const own: Span[] = []
  for (const w of wording) {
    const at = lower.indexOf(w.text.toLowerCase())
    const span: Span = {
      start: at,
      end: at + w.text.length,
      ...(w.verified ? { mark: 'checked' as const, note: w.dictionary[0] } : unlisted(w, w.text)),
    }
    const free = (a: Span) => !own.some((o) => a.start < o.end && o.start < a.end) && !frames.some((f) => a.start < f.end && f.start < a.end)
    if (at >= 0 && !clash(span) && free(span)) own.push(span)
  }

  const spans = [...phrases, ...frames, ...own].sort((a, b) => a.start - b.start)
  const out: AnswerSegment[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) out.push({ text: plain.slice(cursor, span.start) })
    out.push({ text: plain.slice(span.start, span.end), mark: span.mark, ...(span.note ? { note: span.note } : {}) })
    cursor = span.end
  }
  if (cursor < plain.length) out.push({ text: plain.slice(cursor) })
  return out
}

/** What a sentence's opening words say its Linear tool is; undefined when they say nothing clear. */
function toolFromOpening(sentence: string): LinearTool | undefined {
  const text = sentence.trim().toLowerCase().replace(/[’]/g, "'")
  if (/^(that's why|that is why|as a result|as a consequence|therefore|consequently|because of this|this means|which is why)\b/.test(text))
    return 'effect'
  const opening = text.replace(/^((and|but|also|now|well|plus|besides|so)\b,?\s*)+/, '')
  if (/^(for (instance|example)|take (me|.{1,40}?) as an example|a (good|typical|great) example)/.test(opening)) return 'example'
  if (
    /^(this is because|that is because|it's because|because|the (main |simple |biggest |real )?reason|part of the reason|a big part of the reason|for the simple reason)/.test(
      opening,
    )
  )
    return 'cause'
  if (
    /^(when it comes to|if (you look at|we're talking about|we talk about)|it (totally |really |all )?depends on|i'd like to (think|talk) about)/.test(
      opening,
    )
  )
    return 'specify'
  return undefined
}

/**
 * The tool shown for a sentence: the first sentence is the answer (Part 1 / 3, unless it specifies the question),
 * a clear opening ("For instance", "This is because", "That's why", "When it comes to") decides the rest, and
 * otherwise Claude's label stands. Part 2's framework parts (lead-in, introduction, conclusion) are kept.
 */
export function sentenceTool(tool: LinearTool, plain: string, index: number, part: SpeakingRequest['part']): LinearTool {
  if (part === 2 && (tool === 'lead_in' || tool === 'introduction' || tool === 'conclusion')) return tool
  const opening = toolFromOpening(plain)
  if (index === 0 && part !== 2) return opening === 'specify' || tool === 'specify' ? 'specify' : 'answer'
  return opening ?? tool
}

/* ───────────── Alternatives for unlisted wording ───────────── */

const AlternativesSchema = z.object({
  items: z.array(
    z.object({
      n: z.number().int(),
      alternatives: z.array(z.object({ phrase: z.string(), example: z.string(), checks: z.array(CheckSchema) })),
    }),
  ),
})

/** Alternatives Claude proposes per unlisted wording; each is looked up and the first one a dictionary lists wins. */
const ALTERNATIVES = 5

const ALTERNATIVES_SYSTEM = `You help a coach keep a model IELTS Speaking answer dictionary-safe. Each item is wording that neither Longman nor the Oxford Collocations Dictionary (OZDIC) lists.
For each item give up to ${ALTERNATIVES} alternative wordings that say the same thing and fit the same place in the sentence (same grammar, so one can replace the wording word for word), the most natural in speech first. Prefer plain, common combinations a collocation dictionary lists (adjective + noun, verb + noun, verb + preposition, adverb + adjective); never the original wording.
Only give alternatives that are just as natural and just as precise here. When the original already is the natural, exact way to say it — an idiom, a phrasal verb ("take them down"), a fixed expression, or the precise word ("the gateway to the region", "islets") — return no alternatives: it stays as it is.
Each with a short natural example sentence using it, and checks for a collocation dictionary: base = lemma of the headword whose entry lists the combination (the noun for verb+noun, adjective+noun, noun+noun and noun+verb; the verb for verb+preposition; the adjective for adverb+adjective), collocate = lemma of the partner word, pattern; for verb + object + adjective check the adjective with the noun; [] for one word.`

interface Unlisted {
  /** Where it is used (the sentence, or its example). */
  context: string
  text: string
  meaning?: string
}

interface Alternative {
  phrase: string
  example: string
  issue: RewriteIssue
}

/**
 * Wording no dictionary lists: Claude lists up to five alternatives per item (most natural first), each is looked up in
 * Longman then OZDIC, and the first confirmed one is returned (undefined when none is).
 */
async function confirmedAlternatives(
  items: Unlisted[],
  dict: ReturnType<typeof dictionaries>,
  usage: SpeakingUsage,
  engine?: SpeakingRequest['engine'],
): Promise<(Alternative | undefined)[]> {
  if (!items.length) return []
  const proposed = await speakingJson({
    label: 'speaking: alternatives',
    system: ALTERNATIVES_SYSTEM,
    prompt: items
      .map((it, i) =>
        [`${i + 1}. Sentence: ${it.context}`, `   Wording: "${it.text}"`, ...(it.meaning ? [`   Meaning: ${it.meaning}`] : [])].join('\n'),
      )
      .join('\n'),
    schema: AlternativesSchema,
    effort: 'low',
    engine,
  })
  addUsage(usage, proposed)
  return Promise.all(
    items.map(async (it, i) => {
      for (const a of (proposed.value.items.find((x) => x.n === i + 1)?.alternatives ?? []).slice(0, ALTERNATIVES)) {
        const phrase = a.phrase.trim()
        if (!phrase || phrase.toLowerCase() === it.text.toLowerCase() || !newContentWords('', phrase).length) continue
        const issue = await verifyPhrase(phrase, a.checks, dict)
        if (issue.verified) return { phrase, example: a.example.trim(), issue }
      }
      return undefined
    }),
  )
}

/** An outside phrase looked up: in Longman / OZDIC, else as the DOL translation of the learner's idea. */
async function checkedExtra(
  p: { phrase: string; meaning_vi: string; example: string; checks: DictionaryCheck[] },
  dict: ReturnType<typeof dictionaries>,
  hints: DolHint[],
): Promise<SpeakingExtra> {
  const issue = await verifyPhrase(p.phrase, p.checks, dict)
  const dol = issue.verified ? null : dolProof(p.phrase, hints)
  const proof = issue.verified ? proofOf(issue) : (dol ?? { dictionary: [], sources: [] })
  return {
    phrase: p.phrase,
    meaning_vi: p.meaning_vi,
    example: p.example,
    verified: issue.verified || Boolean(dol),
    dictionary: proof.dictionary ?? [],
    sources: proof.sources ?? [],
  }
}

/** An outside phrase replaced by its confirmed alternative (same meaning, new wording and proof). */
function replaceExtra(extra: SpeakingExtra, alt: Alternative): void {
  const proof = proofOf(alt.issue)
  Object.assign(extra, {
    original: extra.phrase,
    phrase: alt.phrase,
    example: alt.example || extra.example,
    verified: true,
    dictionary: proof.dictionary ?? [],
    sources: proof.sources ?? [],
  })
}

/* ───────────── Jobs ───────────── */

// Kept on globalThis: the dev server reloads server modules in-process when they change, while running jobs carry on in
// the old instance — the page must still find them.
export const jobs = ((globalThis as { __speakingJobs?: Map<string, SpeakingJob> }).__speakingJobs ??= new Map())

function addUsage(usage: SpeakingUsage, call: { model: string; usage: { input: number; output: number; thinking: number } }) {
  usage.model = call.model
  usage.input += call.usage.input
  usage.output += call.usage.output
  usage.thinking += call.usage.thinking
}

async function suggest(ctx: ApiContext, job: SpeakingJob, request: SpeakingRequest): Promise<SpeakingResult> {
  const started = Date.now()
  const usage: SpeakingUsage = { model: '', input: 0, output: 0, thinking: 0 }
  const cleanQuestionTitle = (title: string) => title.replace(/^(Q\d+|Question\s*\d+|\d+)[\.\s:–-]+\s*/i, '').trim()

  const questionList = request.questions
    .map((q, i) => `${i + 1}. ${cleanQuestionTitle(q.question) || q.question}${q.idea?.trim() ? `\n   Candidate's idea: ${q.idea.trim()}` : ''}`)
    .join('\n')

  job.step = 'analyze'
  // The learner's ideas laid out for reading (spelling, punctuation, paragraphs), side by side with everything else.
  const ideaModel: JsonModel = {
    json: (call) =>
      speakingJson({ ...call, effort: call.effort ?? speakingEffort(), engine: request.engine }).then((r) => {
        addUsage(usage, r)
        return r
      }),
  }
  const ideasLaidOut = Promise.all(request.questions.map((q) => (q.idea?.trim() ? formatIdea(q.idea, ideaModel, 'speaking') : Promise.resolve(undefined))))
  const ideaOf = async (q: SpeakingRequest['questions'][number]) => {
    const idea = q.idea?.trim()
    const formatted = (await ideasLaidOut)[request.questions.indexOf(q)]
    return idea ? { idea, ...(formatted?.blocks.length ? { ideaFormatted: formatted } : {}) } : {}
  }
  const entriesLoading = loadEntries(ctx)
  // The DOL word list loads (or starts downloading) while the questions are analysed.
  void dolIndex()
  const phrasesOnly = request.mode === 'phrases'
  const analyzed = await speakingJson({
    label: 'speaking: analyze',
    system: ANALYZE_SYSTEM + (phrasesOnly ? IDEA_PHRASES_RULE : ''),
    prompt: `Topics: ${SPEAKING_TOPICS.filter((t) => t !== 'General').join(', ')}\n\nTopic: ${request.topic}\nQuestions:\n${questionList}`,
    schema: phrasesOnly ? AnalyzePhrasesSchema : AnalyzeSchema,
    effort: 'low',
    engine: request.engine,
  })
  addUsage(usage, analyzed)
  const found = request.questions.map(
    (_, i) =>
      analyzed.value.questions.find((x) => x.q === i + 1) ??
      (analyzed.value.questions.length === request.questions.length ? analyzed.value.questions[i] : undefined) ??
      analyzed.value.questions[i] ??
      analyzed.value.questions[0],
  )
  // Values outside the lists came back as undefined (see AnalyzeFields): dropped here.
  for (const a of found) {
    if (!a) continue
    a.functions = a.functions.filter(Boolean)
    a.topics = a.topics.filter(Boolean)
  }
  const analyses = found.map((a): Analysis => ({
    functions: a?.functions ?? [],
    topics: a?.topics ?? [],
    keywords: [...(a?.keywords ?? []), ...stems(request.topic)],
    ideaKeywords: a?.idea_keywords ?? [],
  }))

  job.step = 'match'
  // English for the Vietnamese terms of each idea, from the DOL dictionary (no hint is fine: never fails the job).
  // Exact matches and up to 5 "near" neighbours per chunk, numbered for the answer call to choose from.
  const dolLoading = Promise.all(found.map((a) => dolHints(a?.vi_terms ?? [], { max: 40, near: 5 }).then(numberHints).catch(() => [])))
  const entries = await entriesLoading
  if (!entries.length) throw new ApiError(409, 'The speaking library is empty: run Sync first.')
  const ranked = rankPerQuestion(entries, analyses)
  const dol = await dolLoading

  // "Phrases only": each question's library items, best first, and vocabulary for the idea looked up — no model answer.
  if (phrasesOnly) {
    job.step = 'dictionary'
    const dict = dictionaries()
    const ideaPhrases = await Promise.all(
      found.map((a, i) =>
        Promise.all(
          ((a && 'idea_phrases' in a ? a.idea_phrases : []) as { phrase: string; meaning_vi: string; example: string; checks: DictionaryCheck[] }[])
            .filter((p) => newContentWords('', p.phrase).length > 0)
            .slice(0, IDEA_PHRASES)
            .map((p) => checkedExtra(p, dict, chosenHints(dol[i], undefined))),
        ),
      ),
    )
    // Idea vocabulary no dictionary lists: alternatives, looked up, the first confirmed one takes its place.
    const unlistedIdeas = ideaPhrases.flat().filter((p) => !p.verified)
    if (unlistedIdeas.length) {
      job.step = 'alternatives'
      const alts = await confirmedAlternatives(
        unlistedIdeas.map((p) => ({ context: p.example, text: p.phrase, meaning: p.meaning_vi })),
        dict,
        usage,
        request.engine,
      ).catch((error: Error) => {
        console.warn(`[speaking] alternatives skipped: ${error.message}`)
        return [] as (Alternative | undefined)[]
      })
      unlistedIdeas.forEach((p, k) => alts[k] && replaceExtra(p, alts[k]))
    }
    const ideas = await Promise.all(request.questions.map(ideaOf))
    return {
      id: job.id,
      createdAt: job.startedAt,
      durationMs: Date.now() - started,
      topic: request.topic,
      part: request.part,
      mode: 'phrases',
      engine: request.engine ?? 'claude',
      answers: request.questions.map((q, i) => ({
        question: q.question,
        ...ideas[i],
        picks: [],
        extras: [],
        answer: [],
        analysis: {
          functions: found[i]?.functions ?? [],
          topics: found[i]?.topics ?? [],
          keywords: found[i]?.keywords ?? [],
          ideaKeywords: found[i]?.idea_keywords ?? [],
        },
        // Confirmed by a dictionary first.
        ideaPhrases: [...ideaPhrases[i]].sort((x, y) => Number(y.verified) - Number(x.verified)),
        // No answer call to choose here: the exact matches only.
        ...(chosenHints(dol[i], undefined).length ? { dol: chosenHints(dol[i], undefined) } : {}),
        candidates: ranked[i].map((e) => ({
          cardId: e.card.id,
          term: e.card.term,
          ...(e.tag.slot ? { slot: e.tag.slot } : {}),
          meaning_vi: e.card.meaning_vi,
          ...(e.card.examples[0]?.en ? { example: e.card.examples[0].en } : {}),
          origin: e.card.origin,
          href: e.card.href,
          inReview: e.inReview,
          learning: e.learning,
          functions: e.tag.functions,
          topics: e.tag.topics,
          isTopicCollocation: e.card.id.startsWith('topic-'),
        })),
      })),
      candidates: new Set(ranked.flat().map((e) => e.card.id)).size,
      usage,
    }
  }

  const candidates = matchCandidates(ranked)
  const byRef = new Map(candidates.map((entry, i) => [`k${i + 1}`, entry]))
  // A ref that slips into the text ("dùng thay k30") becomes the phrase it stands for.
  const unref = (text: string) => text.replace(/\bk\d+\*?/g, (ref) => byRef.get(ref.replace('*', ''))?.card.term ?? ref)

  // The questions again, each with the DOL dictionary's English for its idea's Vietnamese terms.
  const suggestQuestionList = request.questions
    .map((q, i) =>
      [
        `${i + 1}. ${cleanQuestionTitle(q.question) || q.question}`,
        ...(q.idea?.trim() ? [`   Candidate's idea: ${q.idea.trim()}`] : []),
        ...(dol[i].length ? [`   Dictionary entries (DOL):\n${dolPromptBlock(dol[i]).replace(/^/gm, '     ')}`] : []),
      ].join('\n'),
    )
    .join('\n')

  job.step = 'suggest'
  const suggested = await speakingJson({
    label: 'speaking: suggest',
    system: suggestSystem(request.part, await linearGuide(ctx)),
    prompt: `Topic: ${request.topic}\nQuestions:\n${suggestQuestionList}\n\nCandidates (ref|phrase|how to use|meaning|example):\n${[...byRef].map(([ref, e]) => candidateLine(e, ref)).join('\n')}`,
    schema: SuggestSchema,
    effort: speakingEffort(),
    engine: request.engine,
  })
  addUsage(usage, suggested)

  const dict = dictionaries()
  const drafts = await Promise.all(
    request.questions.map(async (q, i) => {
      const raw =
        suggested.value.answers.find((a) => a.q === i + 1) ??
        (suggested.value.answers.length === request.questions.length ? suggested.value.answers[i] : undefined) ??
        suggested.value.answers[i] ??
        suggested.value.answers[0]
      const seen = new Set<string>()
      const picks: SpeakingPick[] = []
      for (const p of raw?.picks ?? []) {
        const entry = byRef.get(p.ref.trim().replace(/\*$/, ''))
        if (!entry || seen.has(entry.card.id)) continue
        seen.add(entry.card.id)
        picks.push({
          cardId: entry.card.id,
          term: entry.card.term,
          ...(entry.tag.slot ? { slot: entry.tag.slot } : {}),
          meaning_vi: entry.card.meaning_vi,
          origin: entry.card.origin,
          href: entry.card.href,
          how: unref(p.how),
          example: unref(p.example),
          inReview: entry.inReview,
          learning: entry.learning,
          isTopicCollocation: entry.card.id.startsWith('topic-'),
        })
      }
      // The DOL entries the answer call said fit the idea (exact matches when it chose none).
      const chosen = chosenHints(dol[i], raw?.dol)
      const lines = (raw?.sentences ?? []).filter((x) => x.text.trim()).map((x) => ({ tool: x.tool, text: unref(x.text.trim()) }))
      return { q, raw, picks, lines, chosen }
    }),
  )

  // The editing pass first: the answers' words are final before their phrases are found and checked.
  job.step = 'polish'
  const blocks = drafts.map((d, i) =>
    [
      `Q${i + 1}. ${d.q.question}`,
      `Candidate's idea: ${d.q.idea?.trim() || '(none)'}`,
      `Meaning: ${d.raw?.meaning ?? ''}`,
      'Sentences:',
      ...d.lines.map((x, n) => `${n + 1}. [${x.tool}] ${x.text}`),
    ].join('\n'),
  )
  // It only improves a finished draft: when it fails, the answer is still worth showing.
  const polished = await speakingJson({
    label: 'speaking: polish',
    system: POLISH_SYSTEM,
    prompt: blocks.join('\n\n'),
    schema: PolishSchema,
    effort: polishEffort(),
    engine: request.engine,
  }).catch((error: Error) => {
    console.warn(`[speaking] polish skipped: ${error.message}`)
    return null
  })
  if (polished) addUsage(usage, polished)
  const edits = new Map<number, PolishEdit[]>()
  for (const [idx, answer] of (polished?.value.answers ?? []).entries()) {
    const draft =
      drafts[answer.q - 1] ??
      (polished!.value.answers.length === drafts.length ? drafts[idx] : undefined) ??
      drafts[0]
    if (!draft) continue
    const done: PolishEdit[] = []
    for (const edit of answer.edits) {
      const line = draft.lines[edit.sentence - 1]
      const original = edit.original.replace(/\[\[|\]\]|\{\{|\}\}/g, '').trim()
      const replacement = edit.replacement.replace(/\[\[|\]\]|\{\{|\}\}/g, '').trim()
      if (!line || !original || original === replacement) continue
      const next = replaceInMarked(line.text, original, replacement)
      if (next === null) continue
      // A dropped phrase must not leave double spaces or a space before punctuation; a sentence left empty is removed below.
      line.text = next
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([.,!?;:])/g, '$1')
        .replace(/^[\s,;:]+/, '')
        .trim()
      // Shown with the edit: whether a dictionary lists the new combination (the answer's phrases are checked below).
      const fresh = newContentWords(original, replacement).length > 0 && edit.checks.length > 0
      const issue = fresh ? await verifyPhrase(replacement, edit.checks, dict) : null
      const proof = issue?.verified ? proofOf(issue) : { dictionary: [], sources: [] }
      done.push({
        original,
        replacement,
        kind: edit.kind,
        why: edit.why,
        verified: issue ? issue.verified : true,
        dictionary: proof.dictionary ?? [],
        sources: proof.sources ?? [],
      })
    }
    // Keyed by the draft actually edited (the model's q can be off when it numbers questions its own way).
    edits.set(drafts.indexOf(draft), [...(edits.get(drafts.indexOf(draft)) ?? []), ...done])
  }

  // Every phrase of the final answers found and checked; what the AI wrote that no dictionary lists (outside phrases
  // and its own wording) becomes a listed combination where an examiner would mark it down (server/annotate.ts).
  job.step = 'dictionary'
  const model: JsonModel = {
    json: (call) =>
      speakingJson({ ...call, effort: call.effort ?? speakingEffort(), engine: request.engine }).then((r) => {
        addUsage(usage, r)
        return r
      }),
  }
  const annotations = await Promise.all(
    drafts.map((d) =>
      annotate(
        {
          sentences: d.lines.map((x) => x.text),
          picks: d.picks,
          extras: d.raw?.extras ?? [],
          learnerText: [d.q.idea ?? ''],
          mode: 'model',
          kind: `an IELTS Speaking Part ${request.part} model answer (natural spoken English)`,
          dolHints: d.chosen,
          effort: speakingEffort(),
          label: 'speaking',
        },
        model,
      ),
    ),
  )

  const ideas = await Promise.all(drafts.map(({ q }) => ideaOf(q)))
  const answers: SpeakingAnswer[] = drafts.map(({ q, raw, picks, lines, chosen }, index) => {
    const a = annotations[index]
    const structureTexts = (raw?.structures ?? []).map((x) => x.text)
    const sentences: AnswerSentence[] = a.sentences
      .map((text, n) => {
        const marked = markSentence(text, a.extras, structureTexts, a.perSentence[n], picks, a.note)
        return { tool: sentenceTool(lines[n].tool, marked.map((g) => g.text).join(''), n, request.part), segments: marked }
      })
      .filter((x) => /[a-z]/i.test(x.segments.map((g) => g.text).join('')))
    // The whole answer as one run of segments (for copying, and for pages that show it as a paragraph).
    const answer = sentences.flatMap((x, n) => (n ? [{ text: ' ' }, ...x.segments] : x.segments))
    return {
      question: q.question,
      ...ideas[index],
      picks,
      extras: a.extras,
      answer: answer.filter((x) => x.text),
      sentences,
      structures: (raw?.structures ?? [])
        .filter((x) => x.pattern.trim() && x.text.trim())
        .map(({ from_guide, ...x }) => ({ ...x, fromGuide: from_guide })),
      wording: a.wording,
      coverage: a.report,
      ...(raw?.meaning?.trim() ? { meaning: raw.meaning.trim() } : {}),
      polish: edits.get(index) ?? [],
      ...(chosen.length ? { dol: chosen } : {}),
    }
  })

  return {
    id: job.id,
    createdAt: job.startedAt,
    durationMs: Date.now() - started,
    topic: request.topic,
    part: request.part,
    mode: request.mode ?? 'answer',
    engine: request.engine ?? 'claude',
    answers,
    candidates: candidates.length,
    usage,
  }
}

/** One suggestion run outside the job queue, for scripts: nothing is saved. */
export async function suggestOnce(ctx: ApiContext, request: SpeakingRequest): Promise<SpeakingResult> {
  const job: SpeakingJob = {
    id: `script-${Date.now().toString(36)}`,
    status: 'running',
    startedAt: new Date().toISOString(),
    step: 'analyze',
    mode: request.mode ?? 'answer',
    engine: request.engine ?? 'claude',
  }
  return suggest(ctx, job, request)
}

export function startSuggest(ctx: ApiContext, request: SpeakingRequest): SpeakingJob {
  if ([...jobs.values()].some((j) => j.status === 'running')) throw new ApiError(429, 'Another suggestion is still running — please wait for it.')
  const job: SpeakingJob = {
    id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
    status: 'running',
    startedAt: new Date().toISOString(),
    step: 'analyze',
    mode: request.mode ?? 'answer',
    engine: request.engine ?? 'claude',
  }
  ;(job as TrackedSpeakingJob).userId = ctx.user.id
  jobs.set(job.id, job)
  void requestContext.run({ userId: ctx.user.id, userDir: ctx.userDir }, async () => {
    try {
      job.result = await suggest(ctx, job, request)
      job.status = 'done'
      job.step = undefined
      await writeJsonFile(fileOf(ctx, job.id), job.result)
    } catch (error) {
      job.status = 'error'
      job.error = (error as Error).message
      console.error('[speaking]', error)
    } finally {
      setTimeout(() => jobs.delete(job.id), job.status === 'error' ? 10 * 60_000 : 60_000).unref()
    }
  })
  return job
}

export async function getSuggestion(ctx: ApiContext, id: string): Promise<SpeakingJob | null> {
  if (!validId(id)) return null
  const live = jobs.get(id) as TrackedSpeakingJob | undefined
  if (live) return live.userId === ctx.user.id ? live : null
  const result = await readJsonFile<SpeakingResult | null>(fileOf(ctx, id), null)
  return result ? { id, status: 'done', startedAt: result.createdAt, result } : null
}

export async function deleteSuggestion(ctx: ApiContext, id: string): Promise<void> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  await rm(fileOf(ctx, id), { force: true })
  const live = jobs.get(id) as TrackedSpeakingJob | undefined
  if (!live || live.userId === ctx.user.id) jobs.delete(id)
}

export async function deleteQuestion(
  ctx: ApiContext,
  id: string,
  answerIndex: number,
): Promise<{ ok: true; deletedSession: boolean; result?: SpeakingResult }> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  const file = fileOf(ctx, id)
  const result = await readJsonFile<SpeakingResult | null>(file, null)
  if (!result || !result.answers) throw new ApiError(404, 'Suggestion not found.')
  if (answerIndex < 0 || answerIndex >= result.answers.length) throw new ApiError(400, 'Invalid answer index.')

  if (result.answers.length <= 1) {
    await rm(file, { force: true })
    jobs.delete(id)
    return { ok: true, deletedSession: true }
  }

  result.answers.splice(answerIndex, 1)
  await writeJsonFile(file, result)

  const live = jobs.get(id)
  if (live) live.result = result

  return { ok: true, deletedSession: false, result }
}

export async function updateAnswerUserEdit(ctx: ApiContext, id: string, answerIndex: number, userEdited: string): Promise<SpeakingResult> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  const file = fileOf(ctx, id)
  const result = await readJsonFile<SpeakingResult | null>(file, null)
  if (!result || !result.answers) throw new ApiError(404, 'Suggestion not found.')
  if (answerIndex < 0 || answerIndex >= result.answers.length) throw new ApiError(400, 'Invalid answer index.')

  result.answers[answerIndex].userEdited = userEdited.trim() || undefined
  await writeJsonFile(file, result)

  const live = jobs.get(id)
  if (live) live.result = result

  return result
}

/** Saved suggestions, newest first, optionally only those created in [from, to) (ISO dates or times). */
export async function listSuggestions(ctx: ApiContext, { from, to }: { from?: string; to?: string } = {}): Promise<SpeakingHistoryItem[]> {
  let files: string[] = []
  try {
    files = (await readdir(dir(ctx))).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const items: SpeakingHistoryItem[] = []
  for (const file of files) {
    const result = await readJsonFile<SpeakingResult | null>(path.join(dir(ctx), file), null).catch(() => null)
    if (!result?.answers) continue
    if ((from && result.createdAt < from) || (to && result.createdAt >= to)) continue
    items.push({
      id: result.id,
      createdAt: result.createdAt,
      topic: result.topic,
      part: result.part,
      mode: result.mode ?? 'answer',
      engine: result.engine ?? 'claude',
      questions: result.answers.map((a) => a.question),
    })
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
