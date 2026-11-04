// Writing review, Claude edition. Claude edits the paragraph like an IELTS examiner-editor: it fixes every error and
// also upgrades weak wording to a band 7-8 level, keeping the writer's ideas and structure (no new ideas). Every edit
// comes back as a span with its replacement, so the page can list it and mark it in the new version.
//
// Nothing a dictionary has not confirmed reaches the essay. Code — not the AI — checks each edit:
// - no new content word (deleted / reordered words, function words, word forms): nothing to look up;
// - spelling / grammar / word form: every new word must exist in Longman or OZDIC;
// - collocation / word choice / naturalness: every new word combination must be listed in Longman's collocations box
//   or in OZDIC (Oxford Collocations).
// An edit that fails goes back to Claude once with the dictionaries' own lists and Longman's definitions of the new
// words: it picks a listed wording, or points at the Longman definition that matches the meaning it wants (checked
// against the entry by code). Still unconfirmed: reported under "Cần xem lại", never applied.
import { z } from 'zod'
import { check, itemForms, type Evidence, type Pattern, type Usage } from './checker.ts'
import type { LlmProvider } from './llm-types.ts'
import { longmanAsEntry, lookupLongman, type LongmanEntry } from './longman.ts'
import { lookupLemma, type OzdicEntry } from './ozdic.ts'
import type { DolHint, FormattedIdea } from '../../src/types/speaking.ts'
import type { WritingModelEssay, WritingSuggestedPhrase } from '../../src/types/writingReview.ts'
import { chosenHints, dolHints as lookupDol, dolHintsForText, dolIndex, dolPromptBlock, numberHints, viChunkRule } from './dol.ts'

const ChunkSchema = z.object({ chunks: z.array(z.string()).describe('Collocation-sized Vietnamese chunks, copied as written.') })
import { findRelevantTopicCollocations } from '../topic-collocations.ts'

const PATTERNS = [
  'verb + noun',
  'adjective + noun',
  'noun + verb',
  'noun + noun',
  'preposition',
  'adverb',
  'quantifier',
  'phrase',
] as const satisfies readonly Pattern[]
export const ISSUE_KINDS = ['spelling', 'grammar', 'word_form', 'collocation', 'word_choice', 'naturalness'] as const
export type IssueKind = (typeof ISSUE_KINDS)[number]
/** error = something wrong; improve = correct but weak wording an examiner would mark down. Both go into the new version. */
export const SEVERITIES = ['error', 'improve'] as const
export type Severity = (typeof SEVERITIES)[number]
/** Kinds whose new words must form combinations a collocation dictionary lists. */
const LEXICAL = new Set<IssueKind>(['collocation', 'word_choice', 'naturalness'])

export const CheckSchema = z.object({
  base: z.string().describe('Lemma of the headword whose dictionary entry lists the combination.'),
  collocate: z.string().describe('Lemma of the partner word.'),
  pattern: z.enum(PATTERNS).catch('phrase'),
})
export type DictionaryCheck = z.infer<typeof CheckSchema>

const DiagnoseSchema = z.object({
  edits: z.array(
    z.object({
      sentence: z.number().int().describe('Sentence number.'),
      original: z.string().describe('Shortest exact substring of that sentence that the edit replaces.'),
      replacement: z.string(),
      kind: z.enum(ISSUE_KINDS).catch('naturalness'),
      severity: z.enum(SEVERITIES).catch('improve'),
      why: z.string().describe('Vietnamese, max 30 words.'),
      checks: z.array(CheckSchema),
    }),
  ),
})

export const RetrySchema = z.object({
  answers: z.array(
    z.object({
      n: z.number().int(),
      replacement: z.string().describe('"" when nothing listed fits.'),
      why: z.string().describe('Vietnamese, max 30 words.'),
      checks: z.array(CheckSchema),
      sense: z.string().describe('The Longman definition line (copied exactly) whose meaning the new word has here; "" if none.'),
    }),
  ),
})

const DIAGNOSE_SYSTEM = `You are an experienced IELTS Writing examiner and editor. The writer is a Vietnamese learner.
Edit their text into a polished band 7-8 version WITHOUT changing their ideas, arguments, examples or structure: never add new ideas, examples, names or details, and never remove an idea.

Make two kinds of edits:
- severity "error": anything wrong — spelling ("axious"), grammar (agreement, articles, tense, a missing verb, verb patterns such as "allow sb to do", singular/plural), word_form (wrong word class: "entertainment contain" -> "entertainment content"), collocation ("significantly expensive", "give raise to"), word_choice (the meaning does not fit: "compromise" a schedule), naturalness (not how an educated writer would say it: "break hours").
- severity "improve": correct but weak wording an examiner would mark down — vague, repetitive, informal or wordy ("free time" -> "leisure time", "help" -> "enable", "which can give rise to" -> "thereby giving rise to", "TV" -> "television"); use kind naturalness, or word_choice / collocation when that is what changes.
Use precise, natural academic English, keep the writer's voice, and leave wording that is already good.

For each edit:
- sentence: its number; original: the SHORTEST exact substring of that sentence the edit replaces (a whole clause only when it must be restructured), copied character for character; edits must not overlap;
- replacement: the new wording of exactly that substring;
- kind, severity; why: in Vietnamese, at most 30 words (the rule, or what the words really mean);
- checks: ONLY the new word combinations the replacement creates (a new content word with its partner), for a collocation dictionary: base = lemma of the headword whose entry lists it (the noun for verb+noun, adjective+noun, noun+noun and noun+verb; the verb for verb+preposition; the adjective for adverb+adjective), collocate = lemma of the partner word, pattern. Never check combinations the writer already wrote and you keep. Spelling, grammar and word_form edits: [].`

const RETRY_SYSTEM = `You edit a learner's wording with a dictionary. For each item, a new word combination in your edit is NOT listed in Longman or OZDIC.
Either: pick a listed partner (from the dictionary lists given) that says the same thing, keeping everything else and the meaning — give checks only for the new combination(s);
or, when the edit is about one word's meaning and that word is right: keep the replacement and copy into "sense" the Longman definition line (exactly as given) that matches the meaning it has here.
If neither works, return replacement "".`

export interface CheckedCombination {
  check: DictionaryCheck
  ok: boolean
  /** The dictionary that lists it (when ok), else the most useful one to show. */
  evidence?: Evidence
  /** Every dictionary's lists for this headword (for the retry prompt and the page). */
  lists: Evidence[]
}

const dictionaryName = (c: CheckedCombination) => (c.evidence?.source === 'longman' ? 'Longman' : 'OZDIC')

/** "Longman · ADJ + EXPENSIVE: extremely, hugely, … (✓ extremely)" — the dictionary line that confirms a combination. */
function dictionaryLine(c: CheckedCombination): string {
  const e = c.evidence
  if (!e?.matched) return ''
  const group = e.relevant.find((r) => r.category === e.matched!.category)
  return `${dictionaryName(c)} · ${e.matched.category}: ${(group?.items ?? [e.matched.item]).slice(0, 12).join(', ')} (✓ ${e.matched.item})`
}

/** How the page shows an applied edit's proof: badge, dictionary lines, links, headword. */
export function proofOf(issue: RewriteIssue): {
  evidence: 'longman' | 'collocation' | 'meaning' | 'word' | 'grammar' | 'model'
  dictionary: string[]
  sources?: { name: 'Longman' | 'OZDIC'; url: string }[]
  word: string
} {
  switch (issue.basis) {
    case 'collocation': {
      const confirmed = issue.checks.filter((c) => c.ok)
      const sources = new Map<string, { name: 'Longman' | 'OZDIC'; url: string }>()
      for (const c of confirmed) if (c.evidence?.url) sources.set(c.evidence.url, { name: dictionaryName(c), url: c.evidence.url })
      return {
        evidence: confirmed.some((c) => c.evidence?.source === 'longman') ? 'longman' : 'collocation',
        dictionary: confirmed.map(dictionaryLine).filter(Boolean),
        sources: [...sources.values()],
        word: confirmed[0]?.check.base ?? '',
      }
    }
    case 'meaning':
      return {
        evidence: 'meaning',
        dictionary: issue.sense ? [`Longman · ${issue.sense.definition}`] : [],
        sources: issue.sense ? [{ name: 'Longman', url: issue.sense.url }] : [],
        word: issue.sense?.word ?? '',
      }
    case 'word':
      return {
        evidence: 'word',
        dictionary: (issue.words ?? []).map((w) => `${w.source} có mục từ “${w.word}”`),
        sources: (issue.words ?? []).map((w) => ({ name: w.source, url: w.url })),
        word: issue.words?.[0]?.word ?? '',
      }
    default:
      return { evidence: 'grammar', dictionary: [], sources: [], word: '' }
  }
}

/** What confirms an applied edit. */
export type Basis =
  /** No new content word: nothing to look up. */
  | 'none'
  /** The new word(s) exist in Longman or OZDIC (spelling, grammar, word form). */
  | 'word'
  /** Every new combination is listed in Longman or OZDIC. */
  | 'collocation'
  /** The new word's Longman definition matches the meaning (checked against the entry). */
  | 'meaning'

export interface RewriteIssue {
  sentenceIndex: number
  original: string
  replacement: string
  kind: IssueKind
  severity: Severity
  why: string
  checks: CheckedCombination[]
  verified: boolean
  basis?: Basis
  /** basis "word": the dictionary pages of the new words. */
  words?: { word: string; source: 'Longman' | 'OZDIC'; url: string }[]
  /** basis "meaning": the Longman definition and its page. */
  sense?: { word: string; definition: string; url: string }
}

export interface RewriteReport {
  sentences: string[]
  /** Index of the first sentence of each paragraph after the first. */
  paragraphStarts: number[]
  correctedSentences: string[]
  /** Applied to the essay (errors and improvements). */
  fixed: RewriteIssue[]
  /** Found, but not confirmed by Longman/OZDIC: reported, never applied. */
  unconfirmed: RewriteIssue[]
  suggestedPhrases?: WritingSuggestedPhrase[]
  dolHints?: DolHint[]
  modelEssay?: WritingModelEssay
  /** The Vietnamese idea laid out for reading (spelling, punctuation, paragraphs); the ideas unchanged. */
  vietnameseFormatted?: FormattedIdea
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .filter(Boolean)
}

/** Sentences of the whole text, and where each paragraph (a line break in the text) starts. */
export function splitParagraphs(text: string): { sentences: string[]; paragraphStarts: number[] } {
  const sentences: string[] = []
  const paragraphStarts: number[] = []
  for (const paragraph of text.split(/\n+/).filter((p) => p.trim())) {
    if (sentences.length) paragraphStarts.push(sentences.length)
    sentences.push(...splitSentences(paragraph))
  }
  return { sentences, paragraphStarts }
}

/* ───────────── Dictionary access (cached per review) ───────────── */

const OK = new Set(['confirmed', 'listed_elsewhere'])
export const FUNCTION_WORDS = new Set(
  'a an the to of in on at for by with from as and or but nor so yet if than that this these those it its they them their there here is are was were be been being am do does did done have has had having can could may might must shall should will would not no more most less least very much many some any each every such which who whom whose what when where while thus therefore however also too just only own same other another both either neither all'.split(
    ' ',
  ),
)
const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z]+(?:['-][a-z]+)*/g) ?? []
/** Content words of the replacement the writer did not write ("entertainment content" for "entertainment contain" → content). */
export function newContentWords(original: string, replacement: string): string[] {
  const had = new Set(tokens(original))
  return [...new Set(tokens(replacement).filter((w) => !had.has(w) && !FUNCTION_WORDS.has(w) && w.length > 1))]
}
/** Past forms of common irregular verbs → the verb ("paid off" is looked up as "pay off"). */
const IRREGULAR = new Map(
  (
    'arose:arise awoke:awake was:be were:be been:be bore:bear borne:bear beat:beat became:become began:begin begun:begin bent:bend ' +
    'bet:bet bound:bind bit:bite bitten:bite bled:bleed blew:blow blown:blow broke:break broken:break bred:breed brought:bring ' +
    'built:build burnt:burn burst:burst bought:buy caught:catch chose:choose chosen:choose came:come cost:cost crept:creep cut:cut ' +
    'dealt:deal dug:dig did:do done:do drew:draw drawn:draw dreamt:dream drank:drink drunk:drink drove:drive driven:drive ate:eat ' +
    'eaten:eat fell:fall fallen:fall fed:feed felt:feel fought:fight found:find fled:flee flew:fly flown:fly forbade:forbid ' +
    'forgot:forget forgotten:forget forgave:forgive forgiven:forgive froze:freeze frozen:freeze got:get gotten:get gave:give ' +
    'given:give went:go gone:go grew:grow grown:grow hung:hang had:have heard:hear hid:hide hidden:hide hit:hit held:hold ' +
    'hurt:hurt kept:keep knew:know known:know laid:lay led:lead learnt:learn left:leave lent:lend let:let lay:lie lain:lie lit:light ' +
    'lost:lose made:make meant:mean met:meet overcame:overcome paid:pay put:put quit:quit read:read rode:ride ridden:ride rang:ring ' +
    'rung:ring rose:rise risen:rise ran:run said:say saw:see seen:see sought:seek sold:sell sent:send set:set shook:shake ' +
    'shaken:shake shone:shine shot:shoot showed:show shown:show shut:shut sang:sing sung:sing sank:sink sat:sit slept:sleep ' +
    'slid:slide spoke:speak spoken:speak spent:spend spun:spin split:split spread:spread stood:stand stole:steal stolen:steal ' +
    'stuck:stick stung:sting struck:strike strove:strive swore:swear sworn:swear swept:sweep swam:swim swum:swim swung:swing ' +
    'took:take taken:take taught:teach tore:tear torn:tear told:tell thought:think threw:throw thrown:throw understood:understand ' +
    'undertook:undertake undertaken:undertake woke:wake woken:wake wore:wear worn:wear won:win wound:wind withdrew:withdraw ' +
    'withdrawn:withdraw wrote:write written:write'
  )
    .split(' ')
    .map((pair) => pair.split(':') as [string, string]),
)

/** Dictionary forms to try for an inflected word. */
export const lemmaCandidates = (w: string) =>
  [
    ...new Set([
      w,
      ...(IRREGULAR.has(w) ? [IRREGULAR.get(w)!] : []),
      w.replace(/ies$/, 'y'),
      w.replace(/es$/, ''),
      w.replace(/s$/, ''),
      w.replace(/ied$/, 'y'),
      w.replace(/ed$/, ''),
      w.replace(/ed$/, 'e'),
      w.replace(/ing$/, ''),
      w.replace(/ing$/, 'e'),
      // A doubled consonant before -ed / -ing: "stopped", "planning".
      w.replace(/([b-df-hj-np-tv-z])\1(ed|ing)$/, '$1'),
      w.replace(/ly$/, ''),
    ]),
  ].filter((x) => x.length > 1)

export function dictionaries() {
  const longmanCache = new Map<string, Promise<LongmanEntry | null>>()
  const longman = (word: string) => {
    let entry = longmanCache.get(word)
    if (!entry) {
      entry = lookupLongman(word).catch((error: Error) => {
        console.warn(`[writing-review] Longman ${word}: ${error.message}`)
        return null
      })
      longmanCache.set(word, entry)
    }
    return entry
  }
  // One OZDIC lookup per word and run: checks of the same headword run side by side and would otherwise each read
  // (or fetch) the page.
  const ozdicCache = new Map<string, Promise<OzdicEntry>>()
  const ozdic = (word: string) => {
    let entry = ozdicCache.get(word)
    if (!entry) {
      entry = lookupLemma(word)
      ozdicCache.set(word, entry)
    }
    return entry
  }
  /** The first of a word's dictionary forms already cached (no network): "studies" finds a cached "study" at once. */
  const cachedForm = async (w: string) => {
    for (const form of lemmaCandidates(w)) {
      const entry = await lookupLongman(form, { offline: true })
      if (entry.found) return { word: form, source: 'Longman' as const, url: entry.url }
    }
    for (const form of lemmaCandidates(w)) {
      const entry = await lookupLemma(form, { offline: true })
      if (entry.found) return { word: form, source: 'OZDIC' as const, url: entry.url }
    }
    return null
  }
  /** A word's Longman entry under its first dictionary form that has one: cached pages first, then the network. */
  const longmanEntry = async (w: string): Promise<{ form: string; entry: LongmanEntry } | null> => {
    for (const form of lemmaCandidates(w)) {
      if ((await lookupLongman(form, { offline: true })).found) {
        const entry = await longman(form)
        if (entry?.found) return { form, entry }
      }
    }
    for (const form of lemmaCandidates(w)) {
      const entry = await longman(form)
      if (entry?.found) return { form, entry }
    }
    return null
  }
  const combos = new Map<string, Promise<Evidence[]>>()
  const listsOf = (c: DictionaryCheck): Promise<Evidence[]> => {
    const usage: Usage = {
      id: '',
      sentence: '',
      phrase: `${c.collocate} ${c.base}`,
      base: c.base,
      basePos: '',
      collocate: c.collocate,
      pattern: c.pattern,
    }
    const key = `${c.base.toLowerCase()}|${c.collocate.toLowerCase()}|${c.pattern}`
    let found = combos.get(key)
    if (!found) {
      found = (async () => {
        const out: Evidence[] = []
        const entry = await longman(c.base.toLowerCase())
        const asOzdic = entry ? longmanAsEntry(entry) : null
        if (asOzdic) out.push({ ...check(usage, asOzdic), source: 'longman' })
        out.push({ ...check(usage, await ozdic(c.base.toLowerCase())), source: 'ozdic' })
        return out
      })()
      combos.set(key, found)
    }
    return found
  }
  return {
    async combination(c: DictionaryCheck): Promise<CheckedCombination> {
      const lists = await listsOf(c)
      const ok = lists.find((e) => OK.has(e.status))
      return { check: c, ok: Boolean(ok), evidence: ok ?? lists.find((e) => e.relevant.length) ?? lists[0], lists }
    },
    /** The word (or its dictionary form) has a Longman or OZDIC entry. */
    async word(w: string): Promise<{ word: string; source: 'Longman' | 'OZDIC'; url: string } | null> {
      const cached = await cachedForm(w)
      if (cached) return cached
      for (const form of lemmaCandidates(w)) {
        const entry = await longman(form)
        if (entry?.found) return { word: form, source: 'Longman', url: entry.url }
      }
      for (const form of lemmaCandidates(w)) {
        const entry = await ozdic(form)
        if (entry.found) return { word: form, source: 'OZDIC', url: entry.url }
      }
      return null
    },
    /** Longman definition lines of a word ("word (noun): definition"), for the retry prompt and the meaning check. */
    async definitions(w: string): Promise<{ word: string; url: string; lines: string[] } | null> {
      const found = await longmanEntry(w)
      if (!found) return null
      const { form, entry } = found
      const lines = entry.entries.flatMap((h) => h.senses.slice(0, 6).map((s) => `${h.headword || form} (${h.pos[0] ?? '?'}): ${s.definition}`))
      return lines.length ? { word: form, url: entry.url, lines } : null
    },
    /**
     * An idiom, phrasal verb or fixed phrase that one of the phrase's words points to in Longman ("easy on the eye/ear",
     * "take somebody/something down", "bring yourself to do something"), or prints in bold. Not a two-word collocation,
     * so the collocation lists cannot confirm it.
     */
    async phrase(text: string): Promise<{ word: string; source: 'Longman'; url: string } | null> {
      const target = phraseTokens(text)
      if (target.length < 2) return null
      // Every dictionary form of every content word: "paid" has an entry of its own (the adjective), "pay off" is
      // under "pay". The phrase matching the most words wins ("take part in" over "take in").
      let best: { word: string; url: string; size: number; gap: number } | null = null
      const forms = [...new Set(newContentWords('', text).flatMap(lemmaCandidates))]
      for (const form of forms) {
        let entry = await longman(form)
        if (!entry?.found) continue
        // Cached before idioms and phrasal verbs were kept: read the page again.
        if (entry.entries.some((h) => !Array.isArray(h.phrases))) entry = await lookupLongman(form, { refresh: true }).catch(() => entry)
        if (!entry) continue
        const printed = entry.entries.flatMap((h) => [
          ...(h.phrases ?? []),
          ...h.senses.flatMap((sense) => sense.inline),
          ...h.collocations.flatMap((section) => section.collocates.map((c) => c.phrase)),
        ])
        for (const item of printed) {
          for (const variant of itemForms(item)) {
            const words = phraseTokens(variant)
            const span = phraseSpan(words, target)
            if (span === null) continue
            const gap = span - words.length
            // More of its words in the wording, then fewer words between them ("take part" over "take … in").
            if (!best || words.length > best.size || (words.length === best.size && gap < best.gap)) best = { word: item, url: entry.url, size: words.length, gap }
          }
        }
      }
      return best ? { word: best.word, source: 'Longman', url: best.url } : null
    },
  }
}

/** Words of a phrase without placeholders, pronouns, articles, be and do ("take them down" → take, down). */
const PHRASE_FILLERS = new Set(
  "a an the be is are was were been being do does did doing sb sth somebody something someone one one's your my his her its our their them it him me us you".split(
    ' ',
  ),
)
/** A reflexive pronoun is one word whoever it is: "teach himself" ~ "teach yourself", "bring myself to" ~ "bring yourself to". */
const REFLEXIVE = /^(myself|yourself|himself|herself|itself|ourselves|yourselves|themselves|oneself)$/
const phraseTokens = (s: string) =>
  (
    s
      .toLowerCase()
      .replace(/[’]/g, "'")
      .match(/[a-z]+(?:'[a-z]+)?/g) ?? []
  )
    .filter((w) => !PHRASE_FILLERS.has(w))
    .map((w) => (REFLEXIVE.test(w) ? 'oneself' : w))

/** The same word in another form: "giving" ~ "give", "paid" ~ "pay", "steps" ~ "step". */
const sameForm = (a: string, b: string) => a === b || lemmaCandidates(a).includes(b) || lemmaCandidates(b).includes(a)

/**
 * How many words of the wording the dictionary phrase spans: its words appear in order (in any form), with at most
 * three other words around or between them ("take those certificates down" ~ "take somebody/something down"; "turned him into" ~ "turn
 * somebody/something into something"; "paid off" ~ "pay off"). Null when they do not.
 */
function phraseSpan(item: string[], target: string[]): number | null {
  if (item.length < 2 || target.length - item.length > 3 || item.length > target.length) return null
  let at = -1
  let first = -1
  for (const word of item) {
    at = target.findIndex((t, k) => k > at && sameForm(t, word))
    if (at < 0) return null
    if (first < 0) first = at
  }
  return at - first + 1
}

/* ───────────── Applying edits ───────────── */

/** Index of `original` in the sentence: exact first, then ignoring case. */
export function locate(sentence: string, original: string, from = 0): number {
  const exact = sentence.indexOf(original, from)
  return exact >= 0 ? exact : sentence.toLowerCase().indexOf(original.toLowerCase(), from)
}

const lastWord = (s: string) => s.trimEnd().split(/\s+/).pop()?.toLowerCase() ?? ''
const firstWord = (s: string) => (s.trimStart().split(/\s+/)[0] ?? '').replace(/[.,;:!?)]+$/, '').toLowerCase()

/**
 * Claude sometimes repeats the word just outside the span in its fix ("compromising…" → "without interrupting…" while
 * "without" already stands before it): such an echoed edge word is dropped so the essay never reads "without without".
 */
export function trimEchoedEdges(sentence: string, at: number, original: string, replacement: string): string {
  let words = replacement.trim().split(/\s+/)
  const before = lastWord(sentence.slice(0, at))
  if (words.length > 1 && before && words[0].toLowerCase() === before && firstWord(original) !== before) words = words.slice(1)
  const after = firstWord(sentence.slice(at + original.length))
  if (
    words.length > 1 &&
    after &&
    words
      .at(-1)!
      .replace(/[.,;:!?]+$/, '')
      .toLowerCase() === after &&
    lastWord(original) !== after
  )
    words = words.slice(0, -1)
  return words.join(' ')
}

/** Applies the edits of one sentence, left to right; an edit overlapping an earlier one is skipped (and reported). */
export function applyEdits(sentence: string, issues: RewriteIssue[]): { text: string; applied: RewriteIssue[]; skipped: RewriteIssue[] } {
  const placed = issues
    .map((issue) => ({ issue, at: locate(sentence, issue.original) }))
    .filter((p) => p.at >= 0)
    .sort((a, b) => a.at - b.at)
  const applied: RewriteIssue[] = []
  const skipped: RewriteIssue[] = issues.filter((i) => !placed.some((p) => p.issue === i))
  let text = ''
  let cursor = 0
  for (const { issue, at } of placed) {
    if (at < cursor) {
      skipped.push(issue)
      continue
    }
    issue.replacement = trimEchoedEdges(sentence, at, issue.original, issue.replacement)
    const before = sentence.slice(cursor, at)
    const after = sentence.charAt(at + issue.original.length)
    // A span that started or ended with a space/comma must not glue words together ("posts" + "and" → "postsand").
    const lead = /[A-Za-z0-9]$/.test(text + before) && /^[A-Za-z0-9]/.test(issue.replacement) ? ' ' : ''
    const tail = /[A-Za-z0-9]$/.test(issue.replacement) && /^[A-Za-z0-9]/.test(after) ? ' ' : ''
    text += before + lead + issue.replacement + tail
    cursor = at + issue.original.length
    applied.push(issue)
  }
  return { text: text + sentence.slice(cursor), applied, skipped }
}

/** A headword's dictionary lists, one line per category (for a retry prompt). */
export const listLines = (lists: Evidence[]) =>
  lists
    .flatMap((e) =>
      e.relevant
        .slice(0, 4)
        .map((r) => `${e.source === 'longman' ? 'Longman' : 'OZDIC'} ${e.base} · ${r.category}: ${r.items.slice(0, 25).join(', ')}`),
    )
    .join('\n')

const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
/** The definition Claude quoted is this Longman line (it may leave out the "word (pos):" prefix or the punctuation). */
export function sameDefinition(line: string, quoted: string): boolean {
  const definition = plain(line.slice(line.indexOf(':') + 1))
  const q = plain(quoted)
  return definition.length > 0 && q.length >= 12 && (q.includes(definition) || definition.includes(q))
}

/* ───────────── The review ───────────── */

export type Dictionaries = ReturnType<typeof dictionaries>

/** Dictionary headword of a plural noun ("platforms" → "platform"); other words unchanged. */
const singular = (w: string) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w)

/** Nearest content word on each side of `index` (function words in between are skipped). */
function neighbours(words: string[], index: number): string[] {
  const out: string[] = []
  for (const step of [-1, 1]) {
    for (let i = index + step; i >= 0 && i < words.length; i += step) {
      if (!FUNCTION_WORDS.has(words[i])) {
        out.push(words[i])
        break
      }
    }
  }
  return out
}

/**
 * For each new word, a combination with a neighbouring word that a dictionary lists under the right category
 * ("leisure time": TIME · ADJ: leisure). Only `confirmed` counts here — this route is code's guess, so it stays strict.
 * Returns one check per new word it could confirm.
 */
async function derivedChecks(replacement: string, fresh: string[], dict: Dictionaries): Promise<CheckedCombination[]> {
  const words = tokens(replacement)
  const found: CheckedCombination[] = []
  for (const word of fresh) {
    const at = words.indexOf(word)
    let hit: CheckedCombination | undefined
    search: for (const other of at >= 0 ? neighbours(words, at) : []) {
      for (const [base, collocate] of [
        [other, word],
        [word, other],
      ]) {
        for (const pattern of PATTERNS) {
          const c = await dict.combination({ base: singular(base), collocate, pattern })
          if (c.evidence?.status === 'confirmed') {
            hit = c
            break search
          }
        }
      }
    }
    if (hit) found.push(hit)
  }
  return found
}

/** Letters to add, drop or change to turn one word into the other. */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = keep
    }
  }
  return row[b.length]
}

/** Exactly one word changed, into a word spelled almost the same (raise/rise, advice/advise, affect/effect). */
function lookAlikeSwap(original: string, replacement: string): boolean {
  const before = tokens(original)
  const after = tokens(replacement)
  const gone = before.filter((w) => !after.includes(w))
  const added = after.filter((w) => !before.includes(w))
  return gone.length === 1 && added.length === 1 && editDistance(gone[0], added[0]) <= 2
}

/** Decides, in code, whether an edit is confirmed (and by what). */
export async function verify(issue: RewriteIssue, dict: Dictionaries): Promise<void> {
  const fresh = newContentWords(issue.original, issue.replacement)
  if (!fresh.length) {
    Object.assign(issue, { verified: true, basis: 'none' })
    return
  }
  if (LEXICAL.has(issue.kind)) {
    if (issue.checks.length > 0 && issue.checks.every((c) => c.ok)) {
      Object.assign(issue, { verified: true, basis: 'collocation' })
      return
    }
    // Claude named no combination, or a wrong one: look the new words up next to their neighbours in the replacement.
    const derived = await derivedChecks(issue.replacement, fresh, dict)
    if (derived.length === fresh.length) {
      Object.assign(issue, { verified: true, basis: 'collocation', checks: derived })
      return
    }
    // A look-alike swap ("give raise to" -> "give rise to", affect/effect) is a word-form slip: the new word must exist.
    if (!lookAlikeSwap(issue.original, issue.replacement)) return
  }
  const words = await Promise.all(fresh.map((w) => dict.word(w)))
  const ok = words.every(Boolean)
  Object.assign(issue, { verified: ok, basis: ok ? 'word' : undefined, words: ok ? words : undefined })
}

/**
 * A phrase Claude suggests from outside the app's library (Speaking ideas), checked like a Writing Review edit that
 * adds it: one new content word must exist in Longman or OZDIC; several must form combinations a dictionary lists.
 */
export async function verifyPhrase(phrase: string, checks: DictionaryCheck[], dict: Dictionaries): Promise<RewriteIssue> {
  const single = newContentWords('', phrase).length <= 1
  const issue: RewriteIssue = {
    sentenceIndex: 0,
    original: '',
    replacement: phrase,
    kind: single ? 'word_form' : 'collocation',
    severity: 'improve',
    why: '',
    checks: single ? [] : await Promise.all(checks.map((c) => dict.combination(c))),
    verified: false,
  }
  await verify(issue, dict)
  // An idiom or phrasal verb is not a two-word collocation: Longman may still list it.
  if (!issue.verified) {
    const hit = await dict.phrase(phrase)
    if (hit) Object.assign(issue, { verified: true, basis: 'word', words: [hit] })
  }
  return issue
}

export async function rewriteReview(
  text: string,
  llm: LlmProvider,
  {
    prompt,
    vietnameseText,
    rootDir,
    onStep,
  }: {
    prompt?: string
    vietnameseText?: string
    rootDir?: string
    onStep?: (step: string) => void
  } = {},
): Promise<RewriteReport> {
  const { sentences, paragraphStarts } = splitParagraphs(text)
  if (vietnameseText?.trim()) void dolIndex()
  // The Vietnamese idea laid out for reading, side by side with the review (it never fails: see formatIdea).
  const ideaLaidOut = vietnameseText?.trim() ? import('../format-idea.ts').then((m) => m.formatIdea(vietnameseText, llm, 'writing')) : Promise.resolve(undefined)

  // 1. Retrieve relevant collocations from the 4,886 topic collocations library
  let suggestedPhrases: WritingSuggestedPhrase[] = []
  let collocationsPrompt = ''
  if (rootDir) {
    onStep?.('retrieve')
    try {
      const candidates = await findRelevantTopicCollocations(rootDir, text, vietnameseText, 15)
      if (candidates.length) {
        suggestedPhrases = candidates.map((c) => ({
          cardId: c.id,
          term: c.term,
          meaning_vi: c.meaning_vi,
          example: c.examples?.[0]?.en,
          origin: c.origin,
          href: '/blog?topic=collocations-by-topic',
          isTopicCollocation: true,
        }))
        collocationsPrompt = `\n\nHigh-value collocations from the topic library that you can naturally incorporate to improve lexical resource:\n${candidates
          .map((c) => `- "${c.term}": ${c.meaning_vi}`)
          .join('\n')}`
      }
    } catch (err) {
      console.error('Failed to retrieve topic collocations for writing:', err)
    }
  }

  // The DOL dictionary's English for the phrases of the writer's Vietnamese (best effort: none when it is not ready).
  // The AI cuts the Vietnamese into collocation-sized chunks first (a small low-effort call, ~6-10 s): it knows where a
  // phrase begins and ends far better than cutting at punctuation. If that call fails, code cuts it instead.
  let dolHints: DolHint[] = []
  if (vietnameseText?.trim()) {
    onStep?.('dol')
    const chunks = await llm
      .json({
        label: 'chunk',
        system: `You prepare dictionary lookups for an IELTS Writing coach. The text is a Vietnamese learner's essay idea. Return chunks: ${viChunkRule(20)}.`,
        prompt: vietnameseText.trim(),
        schema: ChunkSchema,
        effort: 'low',
      })
      .then((r) => r.value.chunks)
      .catch((error: Error) => {
        console.warn(`[writing-review] chunking skipped (${error.message}); cutting at punctuation instead`)
        return null
      })
    // Exact matches plus up to 5 "near" neighbours per chunk, numbered: the model essay call says which ones fit.
    dolHints = numberHints(
      await (chunks?.length ? lookupDol(chunks, { max: 40, near: 5 }) : dolHintsForText(vietnameseText)).catch(() => []),
    )
  }
  const dolPrompt = dolHints.length
    ? `\n\nDictionary entries (DOL) for the writer's Vietnamese — "exact" ones are the dictionary's words for that chunk, "near" ones are related phrases the search found and may not mean the same thing; when the draft says one of these ideas awkwardly or wrongly, prefer the wording of an entry that means exactly what the writer means:\n${dolPromptBlock(dolHints)}`
    : ''

  onStep?.('diagnose')
  const viPrompt = vietnameseText?.trim()
    ? `\n\nWriter's intended meaning in Vietnamese (Ground Truth):\n"${vietnameseText.trim()}"\n\nUse this Vietnamese text to understand exactly what the writer intended to convey. When the English text has distorted or mistranslated the meaning or sounds unnatural, correct the wording so that the English reflects the intended Vietnamese meaning accurately, naturally and academically.`
    : ''

  const { value } = await llm.json({
    label: 'diagnose',
    system: DIAGNOSE_SYSTEM,
    prompt: `${prompt?.trim() ? `IELTS Writing Task 2 question:\n"${prompt.trim()}"\n\n` : ''}Text, one sentence per line:\n${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}${viPrompt}${dolPrompt}${collocationsPrompt}`,
    schema: DiagnoseSchema,
  })

  const dict = dictionaries()
  onStep?.('dictionary')
  // All edits are checked at once (in order): cached pages answer at once, and the dictionaries space out their own
  // network requests.
  const issues: RewriteIssue[] = await Promise.all(
    value.edits
      .filter((raw) => {
        const sentence = sentences[raw.sentence - 1]
        return sentence && raw.original.trim() && raw.original !== raw.replacement && locate(sentence, raw.original) >= 0
      })
      .map(async (raw) => {
        const issue: RewriteIssue = {
          sentenceIndex: raw.sentence - 1,
          original: raw.original,
          replacement: raw.replacement,
          kind: raw.kind,
          severity: raw.severity,
          why: raw.why,
          checks: await Promise.all(raw.checks.map((c) => dict.combination(c))),
          verified: false,
        }
        await verify(issue, dict)
        return issue
      }),
  )

  // One more pass for edits the dictionaries do not confirm, with their own lists and definitions in hand.
  const failed = issues.filter((i) => !i.verified)
  if (failed.length) {
    onStep?.('retry')
    const blocks = await Promise.all(
      failed.map(async (issue, n) => {
        const lists = listLines(issue.checks.flatMap((c) => c.lists))
        const senses = (await Promise.all(newContentWords(issue.original, issue.replacement).map((w) => dict.definitions(w)))).filter(Boolean)
        return [
          `${n + 1}. Sentence: ${sentences[issue.sentenceIndex]}`,
          `Edit: "${issue.original}" -> "${issue.replacement}" (${issue.kind}, ${issue.severity}) — ${issue.why}`,
          lists ? `Collocation lists:\n${lists}` : 'Collocation lists: (none for these headwords)',
          senses.length ? `Longman definitions:\n${senses.flatMap((s) => s!.lines).join('\n')}` : 'Longman definitions: (none)',
        ].join('\n')
      }),
    )
    // Best effort: when the retry call fails, those edits simply stay unconfirmed.
    const retry = await llm
      .json({ label: 'retry', system: RETRY_SYSTEM, prompt: blocks.join('\n\n'), schema: RetrySchema })
      .then((r) => r.value)
      .catch((error: Error) => {
        console.warn(`[writing-review] retry skipped: ${error.message}`)
        return { answers: [] }
      })
    await Promise.all(retry.answers.map(async (answer) => {
      const issue = failed[answer.n - 1]
      if (!issue || !answer.replacement.trim() || answer.replacement === issue.original) return
      const candidate: RewriteIssue = {
        ...issue,
        replacement: answer.replacement,
        why: answer.why || issue.why,
        checks: await Promise.all(answer.checks.map((c) => dict.combination(c))),
        verified: false,
      }
      await verify(candidate, dict)
      // The meaning route: the definition Claude points at must really be one of the new word's Longman senses.
      if (!candidate.verified && answer.sense.trim()) {
        for (const w of newContentWords(candidate.original, candidate.replacement)) {
          const defs = await dict.definitions(w)
          const line = defs?.lines.find((l) => sameDefinition(l, answer.sense))
          if (defs && line) {
            Object.assign(candidate, { verified: true, basis: 'meaning', sense: { word: defs.word, definition: line, url: defs.url } })
            break
          }
        }
      }
      if (candidate.verified) Object.assign(issue, candidate)
    }))
  }

  const fixed: RewriteIssue[] = []
  const unconfirmed: RewriteIssue[] = issues.filter((i) => !i.verified)
  const correctedSentences = sentences.map((sentence, index) => {
    const result = applyEdits(
      sentence,
      issues.filter((i) => i.verified && i.sentenceIndex === index),
    )
    fixed.push(...result.applied)
    unconfirmed.push(...result.skipped)
    return result.text
  })

  // 2. The upgraded NeuralSymbolic model essay starts from the corrected draft (the review's confirmed fixes), so it
  // waits for the review: quality over time. Its own steps (plan, write, review, dictionary) report through onStep.
  const { writingLinearGuide, generateWritingModelEssay } = await import('./writing-essay.ts')
  const written = await generateWritingModelEssay(
    {
      text,
      vietnameseText,
      correctedSentences,
      candidates: suggestedPhrases.map((c) => ({
        id: c.cardId,
        term: c.term,
        meaning_vi: c.meaning_vi,
        origin: c.origin,
        example: c.example,
        isTopicCollocation: true,
      })),
      guide: await writingLinearGuide({ rootDir: rootDir || process.cwd() }),
      dolHints,
      onStep,
    },
    llm,
  ).catch((err) => {
    console.error('Failed to generate writing model essay:', err)
    return undefined
  })
  const { dolRefs, unlistedFixes, reviewEdits, plan: _plan, ...modelEssay } = written ?? {}
  for (const edit of reviewEdits ?? []) console.info(`[writing-review] essay review (${edit.kind}): "${edit.original}" → "${edit.replacement}"`)
  for (const fix of unlistedFixes ?? []) console.info(`[writing-review] not in Longman / OZDIC: "${fix.original}" → "${fix.replacement}" (${fix.source})`)
  // Shown on the page: the DOL entries the essay call said fit the writer's ideas (exact matches when it chose none).
  const shownDol = chosenHints(dolHints, dolRefs)

  return {
    sentences,
    paragraphStarts,
    correctedSentences,
    fixed,
    unconfirmed,
    suggestedPhrases,
    dolHints: shownDol,
    modelEssay: written ? (modelEssay as WritingModelEssay) : undefined,
    vietnameseFormatted: await ideaLaidOut,
  }
}
