// Listening → Simplify: Gemini (through the Antigravity CLI) applies Linearthinking to a transcript. Simplify: each
// sentence is split into its S - V - O backbone, reference words, signposts, answer words and the detail that can be let
// pass. Read connections: every sentence says how it links to the previous one, and every section gets its main idea and
// flow. The text itself is never rewritten. The suggested collocations are written in dictionary form, those already in
// Vocabulary are dropped, and the rest are looked up in Longman / OZDIC before they are shown.
// A long transcript is split into parts of about CHUNK_CHARS at paragraph boundaries; the parts are analysed side by
// side (as many at once as ANTIGRAVITY_PARALLEL allows) and merged, with sentences and sections renumbered. Podcast
// mode adds rules for natural, machine-transcribed speech (fillers, false starts, transcription errors).
import { z } from 'zod'
import type { RecommendedVocab, SimplifyMode } from '../../src/types/listening.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { contentFile, readJsonFile } from '../files.ts'
import { antigravityAvailable, antigravityJson } from '../llm/antigravity-cli.ts'
import { CheckSchema, dictionaries, verifyPhrase } from '../writing-review/rewrite.ts'
import { proofOf } from '../writing-review/service.ts'

export const SIMPLIFY_TRANSCRIPT_MAX = 30_000
export const SIMPLIFY_QUESTIONS_MAX = 8_000

/** LISTENING_ANTIGRAVITY_MODEL, else the Speaking model, else gemini-3.8-flash-medium. */
const model = () => process.env.LISTENING_ANTIGRAVITY_MODEL || process.env.SPEAKING_ANTIGRAVITY_MODEL || 'gemini-3.8-flash-medium'
const effort = () => process.env.LISTENING_EFFORT || 'medium'

const SegmentSchema = z.object({
  text: z.string().describe('Exact words from the transcript, in order, including their punctuation and spaces.'),
  role: z
    .enum(['core', 'ref', 'skip', 'signpost', 'anchor', 'key'])
    .describe(
      'core = S - V - O/C backbone; ref = a subject/object that points back to an earlier noun (it, they, this + N, a repeated noun); skip = modifier or detail that can be let pass; signpost = linking word between ideas; anchor = section announcer / listing marker (mốc định vị); key = words that lead to an answer.',
    ),
  q: z.number().default(0).describe('Question number the key words answer, or 0 when unknown / not a key segment.'),
  vi: z
    .string()
    .default('')
    .describe('Tiny Vietnamese gloss shown above this span (at most 7 words). Empty string when the span needs none.'),
})

const RELATIONS = ['start', 'cause_effect', 'contrast', 'time', 'similarity', 'condition', 'comparison', 'example', 'explain', 'reference', 'continue'] as const

const LineSchema = z.object({
  n: z.number().default(0).describe('Sentence number, counted 1, 2, 3... across the WHOLE transcript (not restarting per section).'),
  relation: z
    .enum(RELATIONS)
    .default('continue')
    .describe('How this sentence connects to the previous sentence (see section III of the instructions).'),
  link_vi: z
    .string()
    .default('')
    .describe('One short Vietnamese line: the relation, the linking/reference word, what it points back to (with its sentence number) and which side to remember.'),
  segments: z.array(SegmentSchema).describe('The sentence split into consecutive spans.'),
})

const SectionSchema = z.object({
  title_vi: z.string().describe('Short Vietnamese label of this part of the talk WITHOUT a number, e.g. "Túi áo nam giới thế kỷ 18" (code adds "Phần N:").'),
  link_vi: z.string().default('').describe('How this section connects to the previous section, in Vietnamese. Empty for the first section.'),
  lines: z.array(LineSchema),
  main_idea_vi: z.string().default('').describe('Main idea of this section in one Vietnamese sentence, built with the keep/drop rules.'),
  flow_vi: z.string().default('').describe('One stage tag per sentence number, e.g. "[5] Idea (vest có lớp lót) → [6] Expand (thợ may khâu túi vào lót)".'),
})

const FlowStepSchema = z.object({
  step: z.number().describe('Step index: 1, 2, 3...'),
  text_vi: z.string().describe('Concise Vietnamese summary of this point in the speaker flow.'),
})

const VocabItemSchema = z.object({
  phrase: z.string().describe('The collocation in its dictionary form, e.g. "be anxious about something", "overlook something".'),
  meaning_vi: z.string().describe('Vietnamese meaning of the phrase.'),
  example: z.string().describe('The exact clause of the transcript where it is used.'),
  checks: z.array(CheckSchema).default([]).describe('How a collocation dictionary lists it (see section VII).'),
})

export const SimplifySchema = z.object({
  sections: z.array(SectionSchema),
  flow: z.array(FlowStepSchema).default([]).describe('Speaker flow from section to section, with the relation between sections.'),
  vocab: z.array(VocabItemSchema).default([]).describe('8 to 12 candidate collocations, best first (see section VII).'),
  tips_vi: z.array(z.string()).describe('Two or three practical Vietnamese tips for listening to THIS passage.'),
})

export type SimplifyResult = Omit<z.infer<typeof SimplifySchema>, 'vocab'> & {
  vocab: RecommendedVocab[]
  complete: boolean
  model: string
  mode: SimplifyMode
  /** How many parts the transcript was analysed in. */
  parts: number
}

const SYSTEM = `You are an IELTS Listening coach applying the Linearthinking® method for Vietnamese learners.
Linearthinking has two pillars, and your analysis must show BOTH:
1. SIMPLIFY (understand one sentence): hear the main components S - V - O/C first; everything else is detail heard "later, if needed".
2. READ CONNECTIONS (understand a paragraph): notice the repeated information (it / they / this + N / a repeated noun / a paraphrase) and the relationship between sentences (cause-effect, contrast, time, example...).

THE LEARNER'S GOAL: understand what the speaker means even when many words are too hard to catch. While listening they will follow ONLY the core / ref / signpost / anchor / key spans and let every skip span go by. So:
- The non-skip spans of every sentence, read alone and in order, must form a short, complete, grammatical-sounding claim (e.g. "women were anxious about pickpockets").
- Hard or rare vocabulary should end up in skip spans whenever the meaning survives without it. When a hard word IS core (the claim needs it), give its Vietnamese meaning in "vi" so the learner still understands.

CRITICAL CONSTRAINTS:
1. Concatenating the "text" of all spans across all lines, in order, MUST reproduce the original transcript EXACTLY. Do not rewrite, paraphrase, correct, insert, or drop a single word or punctuation mark.
2. One line = exactly one sentence of the transcript. Never merge two sentences into one line, never split one sentence across lines. Number the lines with "n" = 1, 2, 3... across the WHOLE transcript you are given.
3. Never write section numbers ("Phần 2", "phần 3") anywhere — not in titles, glosses, links or flow. Code numbers the sections; refer to another part by its content ("phần về túi nam giới").
4. DO NOT call any tools or commands. Directly generate the JSON output.

====================================================
I. SIMPLIFY — ROLES OF SPANS (sentence level)
====================================================
Step 1: find the main S, the main V (with its auxiliaries/modals and any negation) and the main O/C.
Step 2: everything else is skip, unless it is a signpost, an anchor or a key.

1. "core" — the S - V - O/C skeleton.
   - Every real sentence has a core. Do NOT throw away a whole sentence that carries the speaker's point (topic sentences, claims, results, answers).
   - Completeness check (the most common error): after marking S + V + O/C, read them alone. If a head word is vague on its own (one, some, part, kind, number, the reason, a way, a problem...) or needs an essential of-phrase / to-infinitive / that-clause to say what it is, extend the core span until the claim is complete. "one of the oldest bridges" — not "one". Only the REMAINING tail becomes skip.
   - NEVER put into skip anything that flips or limits the meaning: negation (not, no, never, few, little, hardly, rarely, only), modals (can't, might, should), comparatives that ARE the claim (less visible, more expensive), numbers / names / dates that the claim is about.
   - Keep each core span minimal: "a tailor would sew pockets into it", not the whole sentence.

2. "ref" — the S (or O) is a reference word/phrase pointing back to something said earlier: it, they, them, this, these, such + N, the + repeated noun, a synonym/paraphrase ("Their solution", "These tiny creatures", "the hidden pairs"). Use "ref" INSTEAD of "core" for that span, and put in "vi" what it stands for, e.g. "= túi của phụ nữ [10]". A reference word buried inside a skip phrase stays skip.

3. "skip" — detail the listener can let pass:
   - Relative clauses (who/which/that..., reduced "N + V-ing / V-ed", "N, known as X,").
   - Prepositional phrases and adverbials of time/place/manner that do not complete the claim ("during the 18th century", "in the folds of the skirt", "for the customer").
   - Adjectives / adverbs / intensifiers that decorate a noun or verb ("surprisingly", "often", "fairly", "fine", "wealthy").
   - Examples and lists inside a sentence ("such as coins or pencils", "like jeans, jackets and coats").
   - Appositives, parentheticals, asides, repetitions, self-corrections.
   - Reporting frames: "Research has shown that", "Experts say that", "I think that", "According to X," → skip the frame, the S-V after "that" is the core.
   - Cleft frames: "It is ... that", "What ... is" → skip the frame words, keep the emphasised part + its claim as core.
   - Dummy openings: "There are / There is" → "There" can be skip; the verb + the notional subject (and its essential completion) are core.
   - Whole sentence as skip ONLY for pure filler with no claim: greetings ("Good morning."), housekeeping ("Right.", "OK, so..."), thanking. For a sentence that only gives an example / extra description of the previous point, keep a short core (its S + V + a short O/C) and skip the rest, so the learner still hears what it is about.

4. "signpost" — linking words between ideas, on the core path:
   - A connector that links this sentence to the previous one (However, So, Because of this, For example, In time, Despite...).
   - A conjunction joining two core clauses inside one sentence (", but", ", so", "and" between two S-V clauses).
   - A connector buried inside a skip phrase stays skip.
   - Two-part sentences (Although / Despite / While / Because / If / When / Unless + clause, SV): ALWAYS split the connector out as its own signpost span, then decide the subordinate part by the relation:
     contrast, condition, comparison → BOTH sides matter: keep a short core of the subordinate part too ("Despite " signpost, "being so useful" core; "We may carry bags" core, ", but " signpost, "few things are as convenient" core).
     cause_effect, time → the effect / later event is the core; a long cause or time clause may be mostly skip, but the connector stays a signpost.

5. "anchor" — MỐC ĐỊNH VỊ: the words that tell the listener WHERE they are in the talk. In the exam these are the moments to move the eye to the next question, so they must stand out even when the whole talk is shown as one paragraph.
   - Section announcers: "Let's begin with men's fashion in the 18th century", "Moving on to...", "Now I'd like to turn to...", "Another thing to consider is...", "So, to sum up".
   - Listing / counting markers: "There are two main reasons", "Firstly", "The second reason is", "To start with", "Finally", "Lastly".
   - The topic phrase of a sentence that opens a new part by naming its new topic ("Women's pockets " in "Women's pockets followed a different pattern."): the topic phrase is anchor, the rest of the claim stays core.
   - Keep anchor spans short (2–8 words) and give a "vi" such as "Mốc: túi nam giới", "Liệt kê ý 1", "Mốc: lý do thứ 2". Plain linking words (however, so, but) are signpost, not anchor.

6. "key" — ONLY when questions/answers are supplied: the exact words that give an answer (set "q" to the question number). A key span replaces the core/skip role for those words. With no questions, NEVER use "key".

Expected density: usually about 40–60% of the words become skip. Fewer skips means the learner is not trained to let detail go; more skips usually means a claim lost its completion.

HARD RULES — re-check EVERY line against them before you output (they are the most common mistakes):
H1. Never skip the main subject. The subject of the main clause is never inside a skip span unless the WHOLE sentence is filler skip. Only its modifiers go: "Small objects " (core) ", such as coins or pencils, " (skip) "could then be carried" (core) — NOT "[Small objects, such as coins or pencils,] could then be carried".
H2. Never skip a lone connector. A skip span is never just one linking / relative word (when, while, that, which, who, where, because, as, and, but, so) in front of a clause you kept. Either the connector is a signpost (when its clause is kept), or the connector AND its whole clause are skip together. "[when] suits came into fashion" is wrong → "when " (signpost) "suits came into fashion." (core / key).
H3. Same simplification to the last sentence. Every section — including the last two — is simplified as hard as the first: aim for 30–60% skip words in EACH section; a section of several sentences with almost no skip is an error. In particular always skip:
   - modifiers between the subject and its verb: "An opening " (core) "in the folds of the skirt " (skip) "allowed the wearer to reach an item" (core);
   - inserted extra actions that are not the point: "The hidden pairs " (core) "then showed through the fabric and " (skip) "had an unwelcome effect on a woman's image." (core / key);
   - trailing explanations after the point or the answer: "...into the modern handbag" (key) ", especially as pockets vanished from women's clothing altogether." (skip);
   - long background clauses before "so" when the result after "so" is the point, and labels like "small bags known as" in front of the real noun.
H4. Every Vietnamese string (title_vi, vi, link_vi, main_idea_vi, flow_vi, flow, tips_vi, meaning_vi) is written with FULL Vietnamese diacritics ("Túi trang phục phụ nữ", never "Tui trang phuc phu nu").

====================================================
II. VIETNAMESE GLOSSES ("vi" on spans)
====================================================
At most 7 words, written for a learner who did not catch the English:
- core / key: the Vietnamese meaning of that chunk, especially when it contains a hard word ("thợ may khâu túi vào", "sợ kẻ móc túi"). Leave "" for chunks any learner understands.
- ref: what it stands for + its sentence number ("= túi phụ nữ [10]").
- signpost: the relation it signals ("Tương phản", "Nguyên nhân → kết quả", "Bổ sung").
- anchor: where the talk is now ("Mốc: túi phụ nữ", "Liệt kê ý 1", "Mốc: lý do thứ 2").
- skip: "" for small chunks; for a long skipped stretch say its job ("Ví dụ minh họa — nghe lướt", "Chi tiết chất liệu — nghe lướt", "Lời chào").

====================================================
III. READ CONNECTIONS — LINKS BETWEEN SENTENCES (line level)
====================================================
For every line set "relation" (how sentence [n] connects to sentence [n-1]) and "link_vi".

relation values:
- "start": first sentence of the talk, or a sentence that opens a brand-new topic.
- "cause_effect": because, so, as a result, therefore, that's why, thanks to, problem → solution... → remember the EFFECT (2nd part).
- "contrast": however, but, yet, although, despite, on the other hand, whereas, instead... → remember BOTH sides, focus on the 2nd.
- "time": then, after that, later, when, before, by the 19th century, in time... → remember the order, focus on the latest step.
- "similarity": also, and, likewise, similarly, too, as well → adds a parallel point; can be let pass once the first is understood.
- "condition": if, unless, as long as, otherwise → remember the condition + its result.
- "comparison": like, unlike, compared with, more/less than → remember what is compared and how.
- "example": for example, for instance, such as, take X... → illustrates the previous point; can be let pass.
- "explain": in other words, in fact, actually, that is → restates / clarifies; can be let pass.
- "reference": NO linking word, but the subject/object refers back (it, they, this + N, a repeated noun, a paraphrase) → the sentence continues the same topic.
- "continue": NO linking word and no reference word; the idea simply continues (about 80% of the time it says the same thing in more detail).

Rules:
- Judge the relation between WHOLE sentences. A conjunction joining two clauses inside sentence [n] is not the [n] → [n-1] relation.
- An implicit relation counts: if [n] gives the reason / result / solution for [n-1] without a linker, use that relation and say "(không có từ nối)".
- Ambiguous words (since, as, while, when) are classified by meaning in context.
- The relation name at the start of link_vi must match "relation" (example → "Ví dụ", explain → "Giải thích", similarity → "Bổ sung", reference → "Tham chiếu", continue → "Nối ý", start → "Mở ý" / "Mở phần mới").
- Trace a pronoun chain back to the last sentence that actually named the noun: if [10] names "Women's pockets" and [11], [12] both say "they", both point to [10] — never "they = they".

link_vi format (one short Vietnamese line, quoted English stays as-is):
"<Tên quan hệ> (<từ nối hoặc 'không có từ nối'>): <ý [n-1]> → / ≠ / = <ý [n]>; <"từ thay thế" = "danh từ" [số câu]>; nhớ <vế nào>."
Examples:
- "Tương phản (However): túi trang trí của người sành điệu [8] ≠ túi to, đơn giản của người làm nghề [9]; nhớ vế sau."
- "Tham chiếu (không có từ nối): 'they' = 'Women’s pockets' [10]; ý 1 của điểm khác: ít lộ ra hơn."
- "Nhân → quả (không có từ nối): sợ móc túi [12] → giải pháp: may 2 túi nối dây [13]; 'Their solution' = cách xử lý nỗi sợ ở [12]."
For "start" on the first sentence, link_vi says what the talk/section is about.

====================================================
IV. READ CONNECTIONS — SECTIONS (paragraph level)
====================================================
Group consecutive lines into sections = the parts of the talk (usually where the speaker announces a new part or the topic shifts). For each section:
- "title_vi": short label without a number ("Túi áo nam giới thế kỷ 18").
- "link_vi": how this section relates to the previous one, named by content ("Tương phản với phần túi nam giới: chuyển từ nam sang nữ"). "" for the first section.
- "main_idea_vi": ONE Vietnamese sentence built from the sentence cores with the keep/drop rules:
  cause_effect → keep the effect; contrast → keep both sides; time → keep the sequence, focus on the final result; condition → condition + result; comparison → what is compared and how; similarity / example / explain → drop (already covered); reference / continue → fold into the same point.
  It answers "what is this part about?" — not a list of every sentence.
- "flow_vi": exactly one stage tag per sentence of the section, in order, each with a short Vietnamese gloss of its content, chained with " → ".
  Tags: Idea · Expand · Cause · Effect · Contrast · Compare · Condition · Example · Explain · Result · Conclusion · List · Anchor (announces a part / a list) · Skip (filler with no claim)
  The tag names the point the sentence KEEPS, so it must agree with what is highlighted in the sentence: in "Working women also carried tools, but the pockets remained inside their clothing" the kept point is after "but" → Contrast (not Similarity because of "also").
  e.g. "[10] Idea (túi phụ nữ khác kiểu) → [11] Expand (ít lộ, khó lấy) → [12] Cause (sợ móc túi) → [13] Result (2 túi nối dây)"

====================================================
V. WORKED EXAMPLE (format and decisions — do not copy its content)
====================================================
Notation: "span" (role, vi). No questions supplied in this example.

[9] relation "contrast", link_vi "Tương phản (However): túi trang trí của người sành điệu [8] ≠ túi to, đơn giản của người làm nghề [9]; nhớ vế sau."
"However, " (signpost, "Tương phản") "a man in a profession " (core, "người làm nghề") "requiring him to carry equipment, such as a doctor with medical instruments, " (skip, "Ví dụ nghề — nghe lướt") "might have larger" (core, "có túi to hơn") ", simpler" (skip) " pockets" (core) " instead." (skip)

--- new section: "Túi áo phụ nữ", link_vi "Tương phản với phần túi nam giới: chuyển từ túi nam sang túi nữ" ---
[10] relation "start", link_vi "Mở phần mới (không có từ nối): chủ đề chuyển sang túi của phụ nữ."
"Women's pockets " (anchor, "Mốc: túi phụ nữ") "followed a different pattern." (core, "theo kiểu khác")

[11] relation "reference", link_vi "Tham chiếu (không có từ nối): 'they' = 'Women’s pockets' [10]; điểm khác thứ nhất: ít lộ ra."
"To start with, " (anchor, "Liệt kê ý 1") "they " (ref, "= túi phụ nữ [10]") "were " (core) "far " (skip) "less visible " (core, "ít lộ ra hơn") "than men's pockets and more difficult to reach." (skip)

[12] relation "cause_effect", link_vi "Nguyên nhân (không có từ nối): giải thích vì sao túi phải giấu [11] → phụ nữ sợ móc túi."
"During the 18th and 19th centuries, " (skip) "women carried many possessions, " (core, "mang nhiều đồ") "some of considerable value, " (skip) "and " (signpost) "wealthy " (skip) "women " (core) "in particular " (skip) "were anxious about pickpockets." (core, "sợ kẻ móc túi")

[13] relation "cause_effect", link_vi "Nhân → quả (không có từ nối): sợ móc túi [12] → giải pháp [13]; 'Their solution' = cách xử lý nỗi sợ ở [12]; nhớ giải pháp."
"Their solution " (ref, "giải pháp cho nỗi sợ [12]") "was to make two " (core) "fabric " (skip) "pockets and join them with string." (core, "nối 2 túi bằng dây")

[14] relation "example", link_vi "Ví dụ (không có từ nối): chi tiết chất liệu túi ở [13]; có thể nghe lướt."
"Poorer women might use recycled cloth, " (core, "người nghèo dùng vải cũ") "while those with more money could choose linen, perhaps with fine embroidery." (skip, "Chi tiết chất liệu — nghe lướt")

Section main_idea_vi: "Túi phụ nữ khác túi nam: được giấu kín vì sợ móc túi, nên họ may hai túi nối bằng dây đeo bên trong."
Section flow_vi: "[10] Idea (túi phụ nữ khác kiểu) → [11] Expand (ít lộ ra) → [12] Cause (sợ móc túi) → [13] Result (2 túi nối dây) → [14] Example (chất liệu vải)"

If questions were supplied (e.g. "36 two pockets joined with string"), the span "pockets and join them with string." would be (key, q 36) instead of core.

====================================================
VI. SPEAKER FLOW ("flow")
====================================================
3 to 6 steps in Vietnamese, one per major section, showing how the talk moves from part to part AND the relation between parts (e.g. "Túi phụ nữ — tương phản với túi nam giới: được giấu kín vì sợ móc túi."). 1–2 short sentences each.

====================================================
VII. RECOMMENDED VOCABULARY ("vocab")
====================================================
8 to 12 CANDIDATES, best first. Code then looks every candidate up in Longman and the Oxford Collocations Dictionary (OZDIC), drops the ones the learner already has, and keeps at most 8 — so give more than 8 and put the most useful first.

What to pick — collocations the learner can REUSE in their own speaking and writing, taken from the transcript:
- Real collocation patterns: verb + noun ("receive little attention"), adjective + noun ("considerable value"), verb + preposition, adjective + preposition ("be anxious about"), adverb + adjective, noun + noun, phrasal verbs ("come into fashion"), fixed expressions.
- Common enough to meet again in other IELTS topics (B2–C1 level); prefer the ones on the core path or that carry a relation.
- NEVER a fragment that only makes sense in this talk ("join them with string", "overlooked as an element of"), never a whole clause copied from the talk, never a single basic word, never a proper name.

"phrase": write it in its DICTIONARY FORM, the way a learner would note it — base verb, "something / somebody" for open slots, "be" for adjectives used after be: "were anxious about pickpockets" → "be anxious about something"; "are often overlooked" → "overlook something"; "came into fashion" → "come into fashion".
"example": the exact clause from the transcript where it appears (copy it, do not rewrite).
"meaning_vi": the Vietnamese meaning of the phrase in general (not only in this talk).
"checks": for a collocation dictionary: base = lemma of the headword whose entry lists the combination (the noun for verb+noun, adjective+noun, noun+noun and noun+verb; the verb for verb+preposition; the adjective for adjective+preposition and adverb+adjective), collocate = lemma of the partner word, pattern. [] for an idiom or phrasal verb.

====================================================
VIII. PRACTICAL TIPS ("tips_vi")
====================================================
2 or 3 Vietnamese tips for listening to THIS passage — at least one about a connection to listen for (a linking word, a pronoun that refers back, a section announcer) and one about which kind of detail can safely be let pass.`

/** Words only, lower-cased: lets us compare the spans with the transcript without caring about spacing. */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

/** Linking / relative words that must not be bracketed on their own (hard rule H2). */
const LONE_CONNECTORS = new Set(['when', 'while', 'that', 'which', 'who', 'whom', 'whose', 'where', 'because', 'as', 'since', 'and', 'but', 'so', 'or', 'although', 'though', 'if', 'unless'])

/** At most this many phrases are shown; unconfirmed ones only fill in when fewer than MIN_VOCAB are confirmed. */
const MAX_VOCAB = 8
const MIN_VOCAB = 4

/** A phrase compared without placeholders, "be", articles or punctuation ("be anxious about something" → "anxious about"). */
const phraseKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\b(something|somebody|someone|sth|sb|one's|oneself|be|a|an|the|to)\b/g, ' ')
    .replace(/[^a-z']+/g, ' ')
    .trim()

/** The learner's Vocabulary entries, as phrase keys. */
async function knownPhrases(ctx: ApiContext): Promise<Set<string>> {
  const words = await readJsonFile<{ word?: string }[]>(contentFile(ctx.contentDir, 'vocabulary', 'words.json'), []).catch(() => [])
  return new Set(words.map((w) => phraseKey(w.word ?? '')).filter(Boolean))
}

/**
 * The model's candidates: those already in Vocabulary are dropped, the rest are looked up in Longman / OZDIC (like a
 * Writing Review edit). Confirmed phrases come first with the dictionary's own lines and pages; unconfirmed ones only
 * fill in up to MIN_VOCAB, marked as such.
 */
async function checkVocab(ctx: ApiContext, candidates: z.infer<typeof VocabItemSchema>[], max = MAX_VOCAB): Promise<RecommendedVocab[]> {
  const known = await knownPhrases(ctx)
  const seen = new Set<string>()
  const fresh = candidates.filter((v) => {
    const key = phraseKey(v.phrase)
    if (!key || known.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const dict = dictionaries()
  const checked = await Promise.all(
    fresh.map(async (v): Promise<RecommendedVocab> => {
      const issue = await verifyPhrase(v.phrase, v.checks, dict).catch(() => null)
      if (issue?.verified) {
        const proof = proofOf(issue)
        return { phrase: v.phrase, meaning_vi: v.meaning_vi, example: v.example, verified: true, dictionary: proof.dictionary ?? [], sources: proof.sources ?? [] }
      }
      const head = phraseKey(v.phrase).split(' ')[0] || v.phrase
      return {
        phrase: v.phrase,
        meaning_vi: v.meaning_vi,
        example: v.example,
        verified: false,
        dictionary: [],
        sources: [
          { name: 'Longman', url: `https://www.ldoceonline.com/dictionary/${encodeURIComponent(head)}` },
          { name: 'OZDIC', url: `https://ozdic.com/word/${encodeURIComponent(head)}` },
        ],
      }
    }),
  )
  const confirmed = checked.filter((v) => v.verified).slice(0, max)
  const unconfirmed = checked.filter((v) => !v.verified).slice(0, Math.max(0, MIN_VOCAB - confirmed.length))
  return [...confirmed, ...unconfirmed]
}

/** Podcast / spontaneous speech: added after SYSTEM, overriding the IELTS-specific parts where they differ. */
const PODCAST = `
====================================================
PODCAST MODE (spontaneous speech) — these rules OVERRIDE the ones above where they differ
====================================================
The transcript is natural, unscripted speech (podcast, interview, vlog), usually machine-transcribed. The learner wants to follow the speaker's story without being thrown by fillers, false starts and transcription noise.

P1. Lines are THOUGHTS, not punctuation. Machine transcripts put full stops in the middle of one thought. Put consecutive fragments that form ONE thought on ONE line ("When I got my first offer as a software engineer. I was actually sitting on the toilet." → one line). Still never cut a span's text and never reorder anything — only decide where lines start.
P2. Skip spoken noise first, always:
   - fillers and hedges: um, uh, er, like (as a filler), you know, I mean, kind of, sort of, actually, basically, literally, just, really, pretty, so (as an opener), "or whatever", "I guess", "I think" (as a hedge);
   - repetitions and stutters ("in in shock", "I, I need"), false starts and abandoned fragments ("My older brothers and I are."), self-corrections;
   - side talk that is not part of the story (talking to a customer, "Damn, this is good.", "So obviously I was going to stop by and say hi.") — a whole line may be skip here.
P3. Keep the predicate frame: never skip the main verb of a kept clause ("did a really good job", "was"), and keep a reporting frame when WHO said it matters ("My oldest brother ... told me that" stays core / ref; only generic hedges like "I realized pretty soon that" are skipped).
P4. Never correct the text (constraint 1 still holds: the learner reads exactly what is heard). When a word is clearly mis-transcribed, mark it skip and write the likely words in its "vi": "phụ đề sai? có lẽ: 'My mom is always like'".
P5. Sections follow the talk's own chapters / topic shifts; a chapter heading line in the transcript (e.g. "**Chapter 2: Early life**") is its own line, role anchor.
P6. "flow_vi": one step per THOUGHT, at most 8 steps per section; consecutive lines with the same role share a step written with a range ("[17–18] Cause (...)").
P7. "vocab": prefer natural spoken expressions a learner can reuse in IELTS Speaking — idioms, phrasal verbs, fixed phrases ("make ends meet", "go all in", "lose sight of something", "dial something back", "come up with something") — in dictionary form, with the clause they come from as the example.
P8. "tips_vi": tips for following natural speech (what to ignore, where the speaker's point usually comes), not exam tips. There are no questions: never use "key".`

/** A transcript longer than this is analysed in parts (each at most about this long), several at a time. */
const CHUNK_CHARS = 2_500

/**
 * Splits a long transcript into parts at paragraph or heading boundaries (a paragraph that is itself too long is split
 * between sentences). Only whitespace between parts is lost, which the completeness check ignores.
 */
export function splitTranscript(text: string): string[] {
  if (text.length <= CHUNK_CHARS * 1.3) return [text]
  const blocks = text
    .split(/\n\s*\n|\n(?=\s*(?:\*\*|#{1,6}\s|Chapter\b|Part\b|Section\b))/i)
    .flatMap((block) => (block.length > CHUNK_CHARS * 1.3 ? block.split(/(?<=[.?!…])\s+/) : [block]))
    .map((block) => block.trim())
    .filter(Boolean)
  // Parts of about equal size: as few as CHUNK_CHARS allows, each closed once it reaches the average.
  const target = text.length / Math.ceil(text.length / CHUNK_CHARS)
  const chunks: string[] = []
  let current = ''
  for (const block of blocks) {
    if (current && (current.length >= target || current.length + block.length > target * 1.25)) {
      chunks.push(current)
      current = block
    } else {
      current = current ? `${current}\n\n${block}` : block
    }
  }
  if (current) chunks.push(current)
  // A tiny last part gets too little context to be analysed well: join it to the one before.
  if (chunks.length > 1 && chunks[chunks.length - 1].length < CHUNK_CHARS / 4) chunks.splice(-2, 2, `${chunks.at(-2)}\n\n${chunks.at(-1)}`)
  return chunks
}

/** The last sentences of a part, given to the next part as context. */
const tail = (text: string) => text.split(/(?<=[.?!…])\s+/).slice(-3).join(' ').slice(-400)

type Part = z.infer<typeof SimplifySchema>

/** One model call for one part of the transcript (the whole transcript when it is short). */
async function analysePart(
  { text, index, total, before }: { text: string; index: number; total: number; before: string },
  { questions, mode }: { questions: string; mode: SimplifyMode },
): Promise<{ value: Part; model: string }> {
  const hasQuestions = Boolean(questions.trim()) && mode === 'ielts'
  const prompt = [
    total > 1
      ? [
          `This transcript is long, so it is analysed in ${total} parts at the same time; this is part ${index + 1} of ${total}.`,
          'Analyse ONLY the "Transcript" text below. Number its lines from 1 (code renumbers them across the parts).',
          before
            ? `Context — the end of the previous part, analysed separately: do NOT output it, but relate your first line to it and cite it as "(đoạn trước)", not by number:\n"${before}"`
            : 'This is the beginning of the talk.',
          index < total - 1 ? 'The talk continues after this part: do not write a conclusion for the whole talk; "flow" covers only your sections.' : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    `Transcript:\n${text}`,
    hasQuestions
      ? `\nQuestions / answers (use their numbers for key spans). A line may be just "31 convenient" or the question text with its answer after "→" ("31. Although ___ to use, pockets... → convenient"): the question text only helps you find the place; the key span is the transcript's own words that give the answer. A question with no answer given gets NO key span — never guess one.${total > 1 ? ' Only mark answers that are in THIS part.' : ''}\n${questions}`
      : '\nNo questions were supplied. IMPORTANT: DO NOT mark any segments with the "key" role. Only use "core", "ref", "skip", "signpost" or "anchor".',
  ]
    .filter(Boolean)
    .join('\n')
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(SimplifySchema) as Record<string, unknown>
  const label = `listening: simplify${mode === 'podcast' ? ' (podcast)' : ''}${total > 1 ? ` ${index + 1}/${total}` : ''}`
  const run = () => antigravityJson({ label, system: mode === 'podcast' ? SYSTEM + PODCAST : SYSTEM, prompt, jsonSchema, model: model(), effort: effort() })
  // One retry: a long run occasionally comes back without usable JSON.
  const result = await run().catch(run)
  // The model sometimes writes a tip as an object ({ tip, why }): keep its text instead of failing the whole analysis.
  const raw = result.value as { tips_vi?: unknown }
  if (Array.isArray(raw?.tips_vi)) {
    raw.tips_vi = raw.tips_vi.map((t) =>
      typeof t === 'string' ? t : Object.values((t ?? {}) as Record<string, unknown>).filter((v) => typeof v === 'string').join(' — '),
    )
  }
  return { value: SimplifySchema.parse(raw), model: result.model }
}

/** Rewrites sentence references ("[3]", "[17–18]") with `map` (the part's own numbers → numbers in the whole talk). */
const renumber = (text: string, map: (n: number) => number) =>
  text.replace(/\[(\d+)(\s*[–-]\s*)(\d+)\]|\[(\d+)\]/g, (_, a, dash, b, single) =>
    single ? `[${map(Number(single))}]` : `[${map(Number(a))}${dash}${map(Number(b))}]`,
  )

/** "Phần 2: …", "Part 2 - …" at the start of a title: code numbers the sections itself. */
const stripNumber = (title: string) => title.replace(/^\s*(phần|part|section)\s*\d+\s*[:.\-–—]\s*/i, '').trim()

export async function simplifyTranscript(
  ctx: ApiContext,
  transcript: string,
  questions: string,
  mode: SimplifyMode = 'ielts',
): Promise<SimplifyResult> {
  if (!antigravityAvailable()) {
    throw new ApiError(503, "Antigravity CLI ('agy') is not available. Please ensure Antigravity CLI is installed.")
  }
  const chunks = splitTranscript(transcript)
  const parts = await Promise.all(
    chunks.map((text, index) => analysePart({ text, index, total: chunks.length, before: index ? tail(chunks[index - 1]) : '' }, { questions, mode })),
  )
  const hasQuestions = Boolean(questions.trim()) && mode === 'ielts'

  // Merge: sentences numbered across the whole talk, sections numbered in order, references rewritten to match.
  const sections: Part['sections'] = []
  const flow: Part['flow'] = []
  let offset = 0
  for (const { value } of parts) {
    const own = new Map<number, number>()
    value.sections.flatMap((s) => s.lines).forEach((l, i) => {
      if (l.n && !own.has(l.n)) own.set(l.n, offset + i + 1)
    })
    const map = (n: number) => own.get(n) ?? offset + n
    for (const s of value.sections) {
      for (const l of s.lines) {
        l.link_vi = renumber(l.link_vi, map)
        for (const g of l.segments) g.vi = renumber(g.vi, map)
      }
      sections.push({ ...s, title_vi: `Phần ${sections.length + 1}: ${stripNumber(s.title_vi)}`, flow_vi: renumber(s.flow_vi, map), main_idea_vi: s.main_idea_vi })
    }
    // Lines numbered by position, so a model that skipped or repeated a number cannot break the order.
    for (const l of sections.flatMap((s) => s.lines).slice(offset)) l.n = ++offset
    for (const step of value.flow) flow.push({ step: flow.length + 1, text_vi: step.text_vi })
  }

  for (const l of sections.flatMap((s) => s.lines)) {
    // A lone connector in brackets in front of a kept clause cuts the link ("[when] suits came into fashion"): it is a signpost.
    l.segments.forEach((g, i) => {
      const next = l.segments[i + 1]
      if (g.role === 'skip' && next && next.role !== 'skip' && LONE_CONNECTORS.has(g.text.trim().toLowerCase().replace(/[^a-z]/g, ''))) {
        g.role = 'signpost'
      }
    })
    // If user did not provide questions, guarantee no segments have the 'key' role
    if (!hasQuestions) {
      for (const g of l.segments) {
        if (g.role === 'key') {
          g.role = 'core'
          g.q = 0
        }
      }
    }
  }

  const vocab = await checkVocab(
    ctx,
    parts.flatMap((p) => p.value.vocab),
    chunks.length > 1 ? 12 : MAX_VOCAB,
  )
  // A few tips from each part, the first part's first.
  const tips = [...new Set(parts.flatMap((p) => p.value.tips_vi.slice(0, chunks.length > 1 ? 2 : 3)))].slice(0, 4)

  // Spans carry their own spacing (a span may start inside a word: "it" + "'s"); only lines are joined with a space.
  const spans = sections.flatMap((s) => s.lines.map((l) => l.segments.map((g) => g.text).join(''))).join(' ')
  const given = words(transcript)
  const got = words(spans)
  const complete = given.length === got.length && given.every((w, i) => w === got[i])
  return { sections, flow, vocab, tips_vi: tips, complete, model: parts[0].model, mode, parts: chunks.length }
}
