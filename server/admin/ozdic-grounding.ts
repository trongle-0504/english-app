// Dictionary grounding for Admin → Vocabulary and Admin → Notes → Generate. Step 1: what the admin typed is normalised
// (server/admin/headword.ts); a single word without an inflection sign whose Longman page has that exact headword is its
// own base form, otherwise Gemini turns it into its dictionary base form ("decisions" → decision, "made up my mind" →
// make up your mind) and names the headword(s) to look up. Step 2: each headword is looked up in Longman
// (server/writing-review/longman.ts); when Longman has no COLLOCATIONS box for it, or fails, OZDIC (Oxford Collocations,
// server/writing-review/ozdic.ts) is looked up at once. Nothing waits for a rate limit: a source that fails is skipped,
// and when neither has data the entry is written by the AI alone and says so (dictionarySource "none" + a note). The
// entries go into the main prompt, so collocations and patterns the admin wrote wrongly are corrected against them.
import type { ApiContext } from '../api.ts'
import type { ThinkingLevel } from '../gemini.ts'
import { formatLongman, lookupLongman, markPrefetched, type LongmanEntry, type LookupStats } from '../writing-review/longman.ts'
import { lookup as lookupOzdic, lookupLemma, type OzdicEntry } from '../writing-review/ozdic.ts'
import { generateLogged } from './ai.ts'
import { lookupAsTyped, normalizeTerm } from './headword.ts'

/** ADMIN_GENERATE_EFFORT=low|medium|high, low by default: Admin Generate is not pulled up by GEMINI_THINKING. */
export function adminEffort(): ThinkingLevel {
  return (['low', 'medium', 'high'] as const).find((l) => l === process.env.ADMIN_GENERATE_EFFORT) ?? 'low'
}

/** ADMIN_LEMMA_FAST_PATH=off always asks Gemini for the base form. */
export const lemmaFastPathEnabled = () => (process.env.ADMIN_LEMMA_FAST_PATH ?? 'on').toLowerCase() !== 'off'

/** Longman has a page whose headword is exactly this word ("access" also matches "Access"). */
export function longmanHasHeadword(entry: LongmanEntry, word: string): boolean {
  const key = normalizeTerm(word)
  return entry.found && entry.entries.some((h) => normalizeTerm(h.headword) === key)
}

const MAX_HEADWORDS = 2

export interface LemmaResult {
  /** As typed by the admin. */
  input: string
  lemma: string
  /** Single words whose OZDIC entries are looked up ("take responsibility" → responsibility). */
  headwords: string[]
  note_vi: string
  /** The headwords are base forms: from Gemini, or a word Longman lists as typed (no singular forms are tried on OZDIC). */
  baseForms?: boolean
  /** The AI base-form call was skipped: Longman has a page for the word exactly as typed. */
  skipped?: boolean
}

const LEMMA_SCHEMA = {
  type: 'object',
  properties: {
    lemma: { type: 'string', description: 'The dictionary base form of the word or phrase.' },
    headwords: {
      type: 'array',
      items: { type: 'string' },
      description: '1–2 single words (base form, lowercase) whose collocations-dictionary entries are most useful for this entry.',
    },
    note_vi: { type: 'string', description: 'One short Vietnamese sentence on what was changed, or "" when the input was already the base form.' },
  },
  required: ['lemma', 'headwords', 'note_vi'],
}

function lemmaPrompt(word: string, description: string): string {
  return [
    'Convert the word or phrase below to the form a learner\'s dictionary uses as its headword.',
    '- Nouns: singular ("decisions" → "decision"), unless the word only exists in the plural or the notes mean the plural sense ("goods", "arts").',
    '- Verbs: bare infinitive ("went" → "go", "taking" → "take"). Adjectives/adverbs: positive degree ("better" → "good" only when it is a form of good).',
    '- Phrases and idioms: dictionary form with "sb/sth/your" placeholders ("made up my mind" → "make up your mind", "is interested in" → "interested in").',
    '- Keep the spelling variant and capitalisation the admin used (British or American); fix obvious typos only.',
    '- headwords: the single words to look up in a collocations dictionary — the word itself, or for a phrase its key noun/verb/adjective (max 2).',
    'Use the notes only to decide which word class or sense is meant.',
    '',
    `Word or phrase: ${word}`,
    `Notes: ${description.slice(0, 1500) || '(none)'}`,
  ].join('\n')
}

/** Gemini call #1. Falls back to the input as typed when the call fails, so generating never depends on it. */
export async function toLemma(ctx: ApiContext, word: string, description: string): Promise<{ result: LemmaResult; usage?: unknown; error?: string }> {
  const fallback: LemmaResult = { input: word, lemma: word, headwords: word.includes(' ') ? [] : [word.toLowerCase()], note_vi: '' }
  try {
    const res = await generateLogged<{ lemma?: string; headwords?: string[]; note_vi?: string }>(ctx, `vocabulary lemma: ${word}`, {
      prompt: lemmaPrompt(word, description),
      schema: LEMMA_SCHEMA,
      thinking: adminEffort(),
      retries: 2,
    })
    const lemma = (res.value.lemma ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) || word
    const headwords = [...new Set((res.value.headwords ?? []).map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z][a-z'-]*$/.test(h)))].slice(0, MAX_HEADWORDS)
    return {
      result: {
        input: word,
        lemma,
        headwords: (headwords.length ? headwords : fallback.headwords).map((h) => normalizeTerm(h)),
        note_vi: lemma === word ? '' : (res.value.note_vi ?? '').trim(),
        baseForms: headwords.length > 0,
      },
      usage: res.usage,
    }
  } catch (error) {
    return { result: fallback, error: (error as Error).message }
  }
}

const NOTE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'The item(s) the note is about, in dictionary base form; "A vs B" for a comparison.' },
    headwords: {
      type: 'array',
      items: { type: 'string' },
      description: '1–3 single words (base form, lowercase) whose collocations-dictionary entries are most useful for this note.',
    },
    note_vi: { type: 'string', description: 'One short Vietnamese sentence on what was changed to reach the base form, or "".' },
  },
  required: ['title', 'headwords', 'note_vi'],
}

function noteLemmaPrompt(input: string): string {
  return [
    'Below is an admin\'s raw input for a study note: a word, phrase, idiom or structure, often with meanings and examples — or two items to compare ("affect vs effect").',
    'Find the item(s) the note is about and give them in the form a learner\'s dictionary uses as its headword:',
    '- nouns singular, verbs bare infinitive ("took sth for granted" → "take sth for granted"), phrases with "sb/sth/your" placeholders; keep the admin\'s spelling variant; fix obvious typos only.',
    '- It is a comparison ONLY when the input explicitly compares two items ("A vs B", "A and B khác nhau", "compare A with B"): keep both, "Affect vs Effect" → "affect vs effect".',
    '- Otherwise the note is about ONE item — usually the first line; bullet lines below it are its patterns, collocations or related phrases, not items to compare. Include its preposition or placeholder when the input does ("paid attention on" → "pay attention to sth": give the item, the main note will correct wrong prepositions).',
    '- headwords: the single words to look up in a collocations dictionary — the key noun/verb/adjective of each item (max 3; both words of a comparison).',
    '',
    `Input: ${input.slice(0, 3000)}`,
  ].join('\n')
}

/** Gemini call #1 for a note. Falls back to no headwords (the note is generated as before) when the call fails. */
export async function noteLemma(ctx: ApiContext, input: string): Promise<{ result: LemmaResult; usage?: unknown; error?: string }> {
  const firstLine = input.trim().split('\n')[0].slice(0, 120)
  try {
    const res = await generateLogged<{ title?: string; headwords?: string[]; note_vi?: string }>(ctx, `note lemma: ${firstLine.slice(0, 60)}`, {
      prompt: noteLemmaPrompt(input),
      schema: NOTE_SCHEMA,
      thinking: adminEffort(),
      retries: 2,
    })
    const title = (res.value.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 200)
    const headwords = [...new Set((res.value.headwords ?? []).map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z][a-z'-]*$/.test(h)))].slice(0, 3)
    return {
      result: { input: firstLine, lemma: title || firstLine, headwords: headwords.map((h) => normalizeTerm(h)), note_vi: (res.value.note_vi ?? '').trim(), baseForms: true },
      usage: res.usage,
    }
  } catch (error) {
    return { result: { input: firstLine, lemma: firstLine, headwords: [], note_vi: '' }, error: (error as Error).message }
  }
}

interface LemmaStep {
  result: LemmaResult
  usage?: unknown
  error?: string
}

/**
 * Step 1 with the fast path: a single word without an inflection sign ("decision", not "decisions" or "took") is looked
 * up in Longman as typed (cached, else fetched); when Longman has that exact headword it is the base form and Gemini is
 * not asked. Anything else — a phrase, an inflected form, a word Longman does not list — goes to Gemini first, and only
 * the headwords it returns are looked up (never the form as typed: its page almost never exists).
 */
async function withFastPath(typed: string, stats: LookupStats, ai: () => Promise<LemmaStep>): Promise<LemmaStep & { lemmaMs: number }> {
  const word = normalizeTerm(typed)
  if (lemmaFastPathEnabled() && lookupAsTyped(word)) {
    const entry = await lookupLongman(word, { wait: false, stats })
    if (longmanHasHeadword(entry, word)) {
      const lemma = normalizeTerm(typed, { lower: false })
      return { result: { input: typed, lemma, headwords: [word], note_vi: '', baseForms: true, skipped: true }, lemmaMs: 0 }
    }
  }
  const aiStarted = Date.now()
  const step = await ai()
  return { ...step, lemmaMs: Date.now() - aiStarted }
}

/** Vocabulary step 1: the fast path, else `toLemma`. `lemmaMs` is the AI call only (0 when skipped). */
export function resolveLemma(ctx: ApiContext, word: string, description: string, stats: LookupStats) {
  return withFastPath(word, stats, () => toLemma(ctx, word, description))
}

/**
 * Notes step 1: the fast path only when the whole first line is one word (a note is usually a phrase or a comparison,
 * which Gemini must read), else `noteLemma`.
 */
export function resolveNoteLemma(ctx: ApiContext, input: string, stats: LookupStats) {
  const firstLine = input.trim().split('\n')[0].slice(0, 120)
  return withFastPath(firstLine, stats, () => noteLemma(ctx, input))
}

export interface OzdicSource {
  dictionary: 'ozdic' | 'longman'
  word: string
  url: string
  /** Reliable data was sent to Gemini (Oxford Collocations on OZDIC; a Longman entry). */
  oxford: boolean
  /** oxford/no_oxford: OZDIC; collocations/senses_only/not_found: Longman (senses_only = no COLLOCATIONS box). */
  status: 'oxford' | 'no_oxford' | 'collocations' | 'senses_only' | 'not_found' | 'unavailable' | 'error'
  /** Why the lookup failed ("HTTP 429", "timeout"…), when status is unavailable. */
  reason?: string
}

/** Oxford Collocations entry as plain text for the prompt: every sense, every group, a few examples each (optional). */
function formatEntry(entry: OzdicEntry, withExamples: boolean): string {
  const lines = [`## ${entry.word}${entry.pos.length ? ` (${entry.pos.join(', ')})` : ''}`]
  for (const def of (entry.definitions ?? []).slice(0, 4)) lines.push(`Definition (${def.pos}): ${def.gloss}`)
  entry.senses.forEach((sense, n) => {
    lines.push(`Sense ${n + 1}: ${sense.gloss || '(no gloss)'}`)
    for (const group of sense.groups) {
      const examples = (withExamples ? group.examples : []).slice(0, 2).map((e) => `"${e}"`).join('; ')
      lines.push(`- ${group.category}: ${group.items.join(', ')}${examples ? ` — e.g. ${examples}` : ''}`)
    }
  })
  return lines.join('\n')
}

export type DictionarySource = 'longman' | 'ozdic' | 'both' | 'none'

export interface DictionaryReference {
  text: string
  /** Only the listed combinations (no definitions or examples), to check what Gemini says it took from a dictionary. */
  lexicon: string
  sources: OzdicSource[]
  /** How many collocations the reference lists: few (< 6) means Gemini may add well-known ones of its own. */
  collocationCount: number
  /** Which dictionaries gave data; saved on the entry. */
  dictionarySource: DictionarySource
  /** Vietnamese note for the admin when a headword (or every one) had no dictionary data; '' when all had some. */
  dictionaryNote: string
  /** Why Longman failed for a headword, if it did ("HTTP 429", "timeout"…). */
  longmanError?: string
}

const longmanReason = (entry: LongmanEntry) => (entry.unavailable ? entry.reason || 'không truy cập được' : 'không có trang')
const ozdicReason = (entry: OzdicEntry) => (entry.unavailable ? entry.reason || 'không truy cập được' : entry.found ? 'không có dữ liệu Oxford' : 'không có trang')

const AI_ONLY = 'nội dung do AI tự tạo, nên kiểm tra lại collocations.'

/**
 * Looks every headword up side by side: Longman first; when Longman has no COLLOCATIONS box for it (no page, senses
 * only) or fails (429/503/403, challenge, timeout, network, paused), OZDIC (Oxford Collocations) at once. Longman
 * requests still go out one every LONGMAN_GAP_MS (an OZDIC page can be fetched in between); nothing sleeps for a
 * Retry-After. Never throws: a missing or blocked entry only means less grounding, reported in `dictionaryNote`.
 * `examples: false` leaves dictionary example sentences out (notes copy them too eagerly). `baseForms`: the headwords
 * are already base forms, so no singular forms are tried on OZDIC.
 */
export async function dictionaryReference(
  headwords: string[],
  { examples = true, baseForms = false, stats }: { examples?: boolean; baseForms?: boolean; stats?: LookupStats } = {},
): Promise<DictionaryReference> {
  const looked = await Promise.all(
    headwords.map(async (word) => {
      const sources: OzdicSource[] = []
      const blocks: string[] = []
      const items: string[] = []
      let count = 0
      const longman = await lookupLongman(word, { wait: false, stats })
      const collocates = longman.entries.flatMap((h) => h.collocations.flatMap((c) => c.collocates.map((x) => x.phrase)))
      const inline = longman.entries.flatMap((h) => h.senses.flatMap((x) => x.inline))
      sources.push({
        dictionary: 'longman',
        word: longman.word,
        url: longman.url,
        oxford: longman.found,
        status: longman.unavailable ? 'unavailable' : !longman.found ? 'not_found' : collocates.length ? 'collocations' : 'senses_only',
        ...(longman.unavailable ? { reason: longmanReason(longman) } : {}),
      })
      if (longman.found) {
        // Senses are kept even without a collocations box: they are clear learner definitions.
        blocks.push(`# Longman (LDOCE)\n${formatLongman(longman, examples)}`)
        items.push(...collocates, ...inline)
        count += collocates.length + inline.length
      }
      let ozdic: OzdicEntry | undefined
      if (!collocates.length) {
        ozdic = await (baseForms ? lookupOzdic : lookupLemma)(word, { wait: false, stats })
        const status = ozdic.unavailable ? 'unavailable' : ozdic.oxford && ozdic.senses.length ? 'oxford' : 'no_oxford'
        sources.push({
          dictionary: 'ozdic',
          word: ozdic.word || word,
          url: ozdic.url || `https://ozdic.com/word/${encodeURIComponent(word)}`,
          oxford: status === 'oxford',
          status,
          ...(ozdic.unavailable ? { reason: ozdicReason(ozdic) } : {}),
        })
        if (status === 'oxford') {
          blocks.push(`# OZDIC (Oxford Collocations)\n${formatEntry(ozdic, examples)}`)
          for (const sense of ozdic.senses) {
            for (const group of sense.groups) {
              items.push(group.category, ...group.items)
              count += group.items.length
            }
          }
        }
      }
      const fromOzdic = sources.some((src) => src.dictionary === 'ozdic' && src.oxford)
      return {
        word,
        sources,
        blocks,
        items,
        count,
        longman: longman.found,
        ozdic: fromOzdic,
        longmanError: longman.unavailable ? longmanReason(longman) : undefined,
        missing: !longman.found && !fromOzdic ? `Longman (${longmanReason(longman)}) và OZDIC (${ozdic ? ozdicReason(ozdic) : 'không tra'})` : '',
      }
    }),
  )
  const usedLongman = looked.some((l) => l.longman)
  const usedOzdic = looked.some((l) => l.ozdic)
  const dictionarySource: DictionarySource = usedLongman && usedOzdic ? 'both' : usedLongman ? 'longman' : usedOzdic ? 'ozdic' : 'none'
  const missing = looked.filter((l) => l.missing)
  const dictionaryNote = !looked.length
    ? `Không có từ khoá nào để tra từ điển: ${AI_ONLY}`
    : dictionarySource === 'none'
      ? looked.length === 1
        ? `Không lấy được ${missing[0].missing}: ${AI_ONLY}`
        : `Không lấy được từ điển cho ${missing.map((m) => `«${m.word}»: ${m.missing}`).join('; ')}: ${AI_ONLY}`
      : missing.length
        ? `Không có dữ liệu từ điển cho ${missing.map((m) => `«${m.word}»: ${m.missing}`).join('; ')}.`
        : ''
  return {
    text: looked.flatMap((l) => l.blocks).join('\n\n'),
    lexicon: looked.flatMap((l) => l.items).join('\n'),
    sources: looked.flatMap((l) => l.sources),
    collocationCount: looked.reduce((n, l) => n + l.count, 0),
    dictionarySource,
    dictionaryNote,
    longmanError: looked.find((l) => l.longmanError)?.longmanError,
  }
}

/** Sent when neither dictionary had data, so the model does not claim anything comes "from Longman" or "from OZDIC". */
const NO_REFERENCE_PROMPT = [
  '',
  '### NO DICTIONARY REFERENCE',
  'Longman and OZDIC could not be used for this item, so there is NO dictionary reference. Work from the notes and your own knowledge; never say or imply that anything comes from Longman, OZDIC, Oxford or any other dictionary. Keep only combinations you are certain are standard and frequent.',
].join('\n')

const REFERENCE_INTRO = [
  'Longman (LDOCE) is the main dictionary: numbered senses (with bold combinations used in them, "[in use: …]") and a COLLOCATIONS box listing whole combinations, often with a gloss "(= …)".',
  'OZDIC (Oxford Collocations) appears only for words Longman has no collocations box for: categories read like "VERB + DECISION" (verbs used before the noun), "ADJ." (adjectives before it), "PREP." (prepositions), "PHRASES". Both are reliable; together they are the DICTIONARY REFERENCE.',
]

/** Main-prompt section with the dictionary data and how to use it; says plainly that there is none when neither dictionary had data. */
export function ozdicPrompt(reference: string): string {
  if (!reference) return NO_REFERENCE_PROMPT
  return [
    '',
    '### DICTIONARY REFERENCE (Longman, then OZDIC / Oxford Collocations)',
    ...REFERENCE_INTRO,
    'Use this reference to make the entry accurate for the meaning in the user\'s notes and images:',
    '- Choose the senses that match what the user means; the dictionary senses and examples give context for definitions, usage notes and examples.',
    '- CHECK every collocation and pattern the user provided against it. When one is wrong or unnatural ("do a decision", "interested about"), replace it with the combination from the reference that is CLOSEST in meaning to what the user meant ("do a decision" → "make a decision", "strong decision" meaning determined → "firm decision"). The dictionary is not exhaustive: a combination a careful native speaker would keep ("a big problem", "online learning") stays as the user wrote it even when it is not listed — correct only real errors.',
    '- Patterns (Rule 7) stay user-input only. Collocations the user provided: correct them as above, do not add others to them.',
    '- When you add collocations because the user gave none (see COLLOCATIONS WHEN THE USER GAVE NONE), take them FROM THIS REFERENCE: copy each combination as listed, adding only the headword and articles/"sth/sb" ("make a decision", "a difficult decision", "decision on sth", "strongly recommend sth"). Only when the reference lists fewer than 3 that suit the sense may you add standard, frequent ones of your own to reach 3.',
    '- Write examples that use the corrected combinations naturally.',
    '- List in "ozdic_corrections" every change you made because of the reference that appears in the final entry (not items dropped by the word-class rule) (original as the user wrote it, corrected form, a short Vietnamese reason citing the category). Use [] when nothing needed correcting.',
    '',
    reference,
  ].join('\n')
}

/**
 * Always added to the vocabulary prompt: tell example sentences from collocations in the notes, and add 3–4 common IELTS
 * collocations when the user gave none — from the dictionary reference when there is one, otherwise from the model's knowledge.
 */
export function collocationRulesPrompt(grounded: boolean): string {
  // grounded = a dictionary reference follows (see ozdicPrompt).
  return [
    '',
    '### READING THE USER NOTES (do this before applying Rules 7, 12 and 14)',
    'Sort every line or item of the notes into "notes_breakdown":',
    '- "examples": full sentences (a subject and a finite verb, usually ending with . ! ?), e.g. "Consistent GDP growth has been accompanied by rising income inequality." A sentence is ALWAYS an example — never a collocation or a pattern, even though it contains the target word with other words. Use it as an example of the matching sense, with the target phrase in **bold**.',
    '- "collocations": short word combinations written on their own, not inside a sentence ("heavy rain", "make a decision", "be accompanied by sth").',
    '- "patterns": structures with placeholders ("depend on + N", "interested in + V-ing").',
    '- Meanings, IPA and other remarks go in none of the three.',
    'Only what is listed under "collocations"/"patterns" counts as user-provided collocations/patterns for Rules 7 and 12. When notes_breakdown.patterns is empty, every sense\'s "patterns" stays [] (Rule 7) — describe structures in usage_notes_vi instead.',
    '',
    '### COLLOCATIONS WHEN THE USER GAVE NONE (overrides Rules 12 and 14 for this case only)',
    'If notes_breakdown.collocations is empty, add 3–4 collocations for the sense(s) the user means, for EVERY word class — verbs included:',
    '- nouns: verb + noun, adjective + noun, noun + preposition; adjectives: adverb + adjective, adjective + noun/preposition; verbs: adverb + verb, verb + object noun, verb + preposition, typical passive use ("be accompanied by sth", "strongly recommend sth").',
    '- Choose the ones most common in IELTS Speaking and Writing (education, work, environment, health, technology, society, the economy) — not rare, literary, technical or old-fashioned ones. Prefer different kinds.',
    '- Start from the sense of the user\'s example sentences: at least two collocations should fit that sense and topic (for "growth has been accompanied by rising inequality": "be accompanied by sth", "be often accompanied by sth"). Avoid vague ones such as "accompany a person".',
    grounded
      ? '- Take them from the DICTIONARY REFERENCE below (see its rules).'
      : '- There is no dictionary reference for this word: use only combinations you are certain are standard and frequent in educated English (a careful native speaker would use them in an IELTS essay). They will be shown to the admin as "not verified by a dictionary".',
    '- Give each one simple, natural IELTS-style example(s) with the whole collocation in **bold** (Rules 5 and 16), plus meaning_vi and pronunciation as usual. Inflect it to fit the sentence and bold the inflected words ("is often accompanied by", never "is often be accompanied by"); re-read every example for grammar.',
    '- List their "text" values in "auto_collocations". When the user provided collocations, "auto_collocations" is [].',
  ].join('\n')
}

/** Structured view of the notes (see collocationRulesPrompt); shown to the admin, not saved. */
export const BREAKDOWN_PROPERTY = {
  type: 'object',
  properties: {
    examples: { type: 'array', items: { type: 'string' } },
    collocations: { type: 'array', items: { type: 'string' } },
    patterns: { type: 'array', items: { type: 'string' } },
  },
  required: ['examples', 'collocations', 'patterns'],
}

/** Main-prompt section for a note: the same dictionary data, used to correct the admin's input and ground the note. */
export function ozdicNotePrompt(reference: string, title: string): string {
  return [
    '',
    '### BASE FORM',
    `Use "${title}" as the "title" (dictionary base form of the item; keep "A vs B" for a comparison) unless the input clearly names another item.`,
    ...(reference
      ? [
          '',
          '### DICTIONARY REFERENCE (Longman, then OZDIC / Oxford Collocations)',
          ...REFERENCE_INTRO,
          'Use it together with the input (the input keeps priority for WHAT the note covers):',
          '- CHECK every collocation, pattern, formula and example in the input against it. When one is wrong or unnatural ("do a decision", "responsibility of sth"), write the corrected form in the note — the combination from the reference CLOSEST in meaning to what the admin meant — and fix the example sentences that use it. A combination a careful native speaker would keep ("a big problem") stays even when the reference does not list it — correct only real errors.',
          '- Use the senses to write accurate meanings and usage context; for a comparison, use each word\'s entry to explain the difference.',
          `- Every example must use the note\'s item or that pattern, in the sense the note is about: the top-level "examples" must contain "${title.split(' vs ')[0]}"${title.includes(' vs ') ? ' or the other compared item' : ''}. The reference lists combinations; it is not a source of example sentences.`,
          '- When rule 1 lets you add minimal knowledge (the input lacks a pattern\'s example, a meaning, a related item), prefer what the reference lists over your own ideas.',
          '- List in "ozdic_corrections" every change you made because of the reference (original as the admin wrote it, corrected form, a short Vietnamese reason citing the category). Use [] when nothing needed correcting.',
          '',
          reference,
        ]
      : [NO_REFERENCE_PROMPT]),
  ].join('\n')
}

/** Added to the vocabulary response schema (not saved): collocations added because the user gave none. */
export const ADDED_PROPERTY = {
  type: 'array',
  items: { type: 'string' },
  description: 'The "text" of every collocation added because the user provided none; [] otherwise.',
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v ?? '').trim()).filter(Boolean) : []
}

const FILLER = new Set("a an the sb sth somebody something someone sb's one's your do doing v-ing n".split(' '))

/**
 * Checks that a collocation Gemini says it took from OZDIC really is there: every word except the headword and
 * filler ("a", "sth"…) must appear in the listed combinations (`lexicon`). Guards against invented combinations.
 */
export function inReference(collocation: string, headwords: string[], lexicon: string): boolean {
  const ref = lexicon.toLowerCase()
  const heads = headwords.map((h) => h.toLowerCase())
  const words = collocation.toLowerCase().replace(/[^a-z' -]/g, ' ').split(/\s+/).filter(Boolean)
  const rest = words.filter((w) => !FILLER.has(w) && !heads.some((h) => w === h || w.startsWith(h.slice(0, Math.max(4, h.length - 2)))))
  return rest.length > 0 && rest.every((w) => new RegExp(`\\b${w}`).test(ref))
}

/** Added to the vocabulary response schema; removed from the entry before it is saved. */
export const CORRECTIONS_PROPERTY = {
  type: 'array',
  description: 'Collocations/patterns from the user notes that were corrected using the dictionary reference.',
  items: {
    type: 'object',
    properties: {
      original: { type: 'string' },
      corrected: { type: 'string' },
      reason_vi: { type: 'string' },
    },
    required: ['original', 'corrected', 'reason_vi'],
  },
}

export interface OzdicCorrection {
  original: string
  corrected: string
  reason_vi: string
}

export function corrections(value: unknown): OzdicCorrection[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
    .map((c) => ({ original: String(c.original ?? '').trim(), corrected: String(c.corrected ?? '').trim(), reason_vi: String(c.reason_vi ?? '').trim() }))
    .filter((c) => c.original && c.corrected && c.original.toLowerCase() !== c.corrected.toLowerCase())
}

/**
 * Warms the dictionary cache for a word the admin has typed (the "Word" field lost focus): Longman, and OZDIC when
 * Longman has no collocations box. Only a single word without an inflection sign, through the same polite gap; never
 * calls the AI nor starts agy. Returns false when the word is not looked up.
 */
export function prefetchDictionary(typed: string): { word: string; started: boolean } {
  const word = normalizeTerm(typed)
  if (!lookupAsTyped(word)) return { word, started: false }
  void (async () => {
    const stats: LookupStats = { requests: 0, cacheHits: 0, waitMs: 0 }
    const entry = await lookupLongman(word, { wait: false, stats })
    if (stats.requests) markPrefetched(word)
    const collocates = entry.entries.some((h) => h.collocations.length)
    if (!collocates) await lookupOzdic(word, { wait: false })
  })().catch((error) => console.warn(`[admin-generate] prefetch ${word}:`, (error as Error).message))
  return { word, started: true }
}
