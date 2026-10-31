// Speaking review jobs: a recording of your answer → text (server/speaking-review/stt.ts, on this machine) → fluency
// figures (code) → an examiner review (one AI call, Antigravity): corrections of what you said, the four IELTS criteria
// with estimated bands, and — when you gave the script you planned — what you said against it.
// Corrections are checked against Longman / OZDIC like a Writing review's (nothing unconfirmed is applied). Without a
// script, your ideas (restated by the AI) are kept; on request Speaking ideas writes a model answer from them.
// Saved in progress/speaking-reviews/<id>.json, the recording beside it as <id>.wav.
import { randomBytes } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { checkScript, wordCheck, type ScriptLine } from '../../src/features/practice/speaking-review/scriptCheck.ts'
import type { SpeakingPart } from '../../src/types/speaking.ts'
import {
  overallBand,
  SCRIPT_CRITERIA,
  SCRIPT_DIFF_KINDS,
  TALK_MAX_SECONDS,
  TALK_TARGET,
  type TalkComparison,
  type TalkCriterion,
  type TalkCriterionId,
  type TalkFix,
  type TalkHistoryItem,
  type TalkModelAnswer,
  type TalkPart,
  type TalkReviewJob,
  type TalkReviewRequest,
  type TalkReviewResult,
  type TalkMisheard,
  type TalkScriptPoint,
  type TalkWord,
} from '../../src/types/speakingReview.ts'
import type { WritingFix } from '../../src/types/writingReview.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { readJsonFile, writeJsonFile, writeTextFile } from '../files.ts'
import { creditInBackground } from '../practice/real-use.ts'
import { talkReviews } from '../practice/works.ts'
import { antigravityModel, speakingEffort, speakingJson } from '../speaking/llm.ts'
import { startSuggest } from '../speaking/suggest.ts'
import {
  applyEdits,
  CheckSchema,
  dictionaries,
  ISSUE_KINDS,
  locate,
  proofOf,
  SEVERITIES,
  splitSentences,
  verify,
  type IssueKind,
  type RewriteIssue,
} from '../writing-review/rewrite.ts'
import { measureFluency, UNCLEAR } from './fluency.ts'
import { readWav, transcribe } from './stt.ts'

export const dir = (ctx: Pick<ApiContext, 'rootDir'>) => path.join(ctx.rootDir, 'progress', 'speaking-reviews')
/** json: the review · wav: the recording · pending: what you asked, kept until the review is done (a failed one can be retried). */
const fileOf = (ctx: Pick<ApiContext, 'rootDir'>, id: string, ext: 'json' | 'wav' | 'pending' = 'json') => path.join(dir(ctx), `${id}.${ext}`)
export const validId = (id: string) => /^[a-z0-9-]{6,40}$/.test(id)

// Kept on globalThis: the dev server reloads server modules in-process while running jobs carry on.
const jobs = ((globalThis as { __talkReviewJobs?: Map<string, TalkReviewJob> }).__talkReviewJobs ??= new Map())

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/* ───────────── The examiner call ───────────── */

const Criterion = z.object({
  band: z.number().describe('0-9 in steps of 0.5.'),
  summary: z.string().describe('Vietnamese, ONE sentence (at most 25 words): the main thing keeping this band from going higher.'),
  improve: z.array(z.string()).describe('1-2 items, Vietnamese, one sentence each: a concrete fix quoting their words and a better English version.'),
})

const ReviewSchema = z.object({
  restored: z
    .array(
      z.object({
        n: z.number().int().describe('Transcript sentence number.'),
        text: z.string().describe('That sentence with ONLY the misheard words restored.'),
      }),
    )
    .describe('Only the sentences where something was misheard; [] when nothing was.'),
  misheard: z
    .array(
      z.object({
        n: z.number().int().describe('Transcript sentence number.'),
        heard: z.string().describe('The misheard words, copied exactly from the transcript sentence.'),
        meant: z.string().describe('What they most likely said.'),
        ipa: z.string().describe('IPA (British) of what they meant.'),
        tip: z.string().describe('Vietnamese, at most 15 words: the sound to fix.'),
      }),
    )
    .describe('One per restored phrase.'),
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
  criteria: z.object({ fc: Criterion, lr: Criterion, gra: Criterion, pron: Criterion }),
  points: z
    .array(
      z.object({
        from: z.number().int().describe('First script sentence (S…) of this idea.'),
        to: z.number().int().describe('Last script sentence (S…) of this idea.'),
        title: z.string().describe('2-5 English words naming the idea.'),
        heard: z.array(z.number().int()).describe('Numbers of the transcript sentences that say it; [] when not said.'),
        idea: z.number().describe('0-100.'),
        details: z.number().describe('0-100.'),
        wording: z.number().describe('0-100.'),
        diffs: z
          .array(
            z.object({
              kind: z.enum(SCRIPT_DIFF_KINDS).catch('weaker'),
              script: z.string().describe('The script’s phrase, a few words; "" for something good they added.'),
              said: z.string().describe('Their phrase, a few words; "" when missing.'),
              note: z.string().describe('Vietnamese, at most 12 words.'),
            }),
          )
          .describe('At most 5.'),
      }),
    )
    .describe('The script idea by idea; [] when there is no script.'),
  idea: z.string().describe('The speaker’s ideas restated in plain English as a short outline.'),
  question: z.string(),
  topic: z.string().describe('1-3 words.'),
})

const PART_RULE: Record<TalkPart, string> = {
  1: 'IELTS Part 1: a short, direct answer of 2-4 sentences (20-35 s) with a reason or a detail.',
  2: 'IELTS Part 2 (long turn): 1.5-2 minutes on the cue card, covering its points, with a clear beginning, development and ending.',
  3: 'IELTS Part 3 (discussion): 40-70 s, an opinion developed with reasons, examples, comparison or consequences.',
  free: 'Free talk: no IELTS part; judge it as connected spoken English on its topic.',
}

const SYSTEM = `You are an experienced IELTS Speaking examiner and coach. The speaker is a Vietnamese learner.
You get an automatic transcript of their recorded answer — a speech recognizer wrote it: it adds punctuation and capitals itself, may drop filler sounds and may mishear a word (the words it was unsure of are listed) — with fluency figures measured from the timing, the question and the part.

0. restored and misheard — FIRST, before anything else. The recognizer hears an unclear pronunciation as real but wrong words (“Movie Dust Moonly” for “multitasking smoothly”, “A on IPOs” for “8 or 9 points”, “effort dictionary” for “Oxford dictionary”, “can” where the meaning needs “can't”). Restore what they most likely SAID, from the question, the script (if any), the words around, the words the recognizer was unsure of, and how close the sounds are.
- restored: for each transcript sentence that has misheard words, the sentence with ONLY those words restored. Keep everything else exactly as heard — every grammar mistake, wrong word form, wrong word choice, simple wording and filler stays: no upgrades, no fixes (the edits do that). When you cannot tell what they meant, leave the words as heard.
- misheard: one item per restored phrase: n, heard (copied exactly from the transcript sentence), meant, ipa of what they meant, tip (the sound or stress to fix, in Vietnamese).
Everything below works on the RESTORED sentences (a sentence not restored stays as heard).

1. edits: correct what they SAID (the restored sentences), as spoken English (never formal written style):
- severity "error": grammar (tense, agreement, articles, plurals, verb patterns), word_form, collocation, word_choice (meaning does not fit), naturalness (not how a fluent speaker would say it);
- severity "improve": correct but basic or repetitive wording an examiner would mark down for Lexical Resource, upgraded to natural band 7-8 SPOKEN English (common idiomatic phrases, collocations, less common words — not academic writing).
Never edit punctuation, capitals, filler words, repetitions or false starts (that is fluency, measured separately). Keep their ideas.
For each edit: sentence number; original = the SHORTEST exact substring of that RESTORED sentence the edit replaces, copied character for character; edits must not overlap; replacement; kind; severity; why in Vietnamese (at most 30 words); checks = ONLY the new word combinations the replacement creates, for a collocation dictionary (base = lemma of the headword whose entry lists it: the noun for verb+noun / adjective+noun / noun+noun / noun+verb, the verb for verb+preposition, the adjective for adverb+adjective; collocate = lemma of the partner; pattern). Spelling, grammar and word_form edits: checks [].

2. criteria: a band for each, following the public IELTS Speaking band descriptors:
- fc (Fluency & Coherence): use the figures (speed — about 120-160 words a minute is natural —, pauses, fillers, repeats) AND coherence: linking, how ideas are developed, relevance to the question, length against what the part expects;
- lr (Lexical Resource), gra (Grammatical Range & Accuracy): from the RESTORED sentences (range of structures and words, and the errors) — never mark down words the recognizer misheard;
- pron (Pronunciation): you cannot hear the audio. Base it on the misheard phrases (each is most likely an unclear pronunciation: the more and the worse, the lower), then the share of unclear words, speed and pauses; be conservative (at most 7 unless almost nothing was misheard or unclear), say in the summary that it is an estimate from the recognizer, and in improve name the sounds behind the misheard phrases.
Each, in Vietnamese and SHORT — about two sentences in all, about what to improve, never general praise or a description of the answer:
- summary: ONE sentence naming the main weakness that keeps this criterion's band from going higher (for a strong criterion: what the next band needs);
- improve: 1-2 concrete fixes, one sentence each, quoting their own words and giving a better English version (bạn nói “…” → nói “…”).
In every text you write, quote words with curly quotes “ ” — never straight double quotes, which would break the JSON.

3. points: only when a planned script is given — the script idea by idea, judging by MEANING how well what they said matches each.
Group the numbered script sentences (S…) into points: one per main idea or paragraph, consecutive sentences, covering all of them in order with no gaps or overlaps (from, to). A short script (Part 1, or under ~60 words) is ONE point; Part 3 usually 2-4; Part 2 usually 3-6. title = a few words naming the idea.
heard = the numbers of the transcript sentences (T…) that say that point: any of them, in any order; a paraphrase with the same meaning counts; [] when it was not said. Each script sentence comes with code's guess from shared words ("hint") — it may be wrong: decide yourself.
Scores 0-100:
- idea: 100 = the same message; 60 = the main point but weakened or changed; 20 = a different message; 0 = not said;
- details: the supporting details kept (reasons, examples, numbers…): 100 all, 50 some, 0 none or not said; 100 when the point has none;
- wording: 100 = the script's key phrases and structures, or equally precise and natural ones; 50 = simpler but correct; 0 = wrong or unnatural, or not said.
Compare with the SCRIPT, not with ideal English: what they said word for word as the script (or nearly) scores 100 on all three, even where the script itself is awkward or wrong.
diffs: at most 5 per point, the phrases or structures that matter — NEVER whole sentences, a few words each side:
- good: they said it as well as or better than the script (script = the script's phrase, or "" for a good addition);
- weaker: simpler or less precise than the script's phrase;
- wrong: a mistake or an unnatural phrase where the script has it right;
- missing: a script phrase or detail they left out (said "").
note: a few Vietnamese words (at most 12): why it matters or what to say. Compare the RESTORED sentences: misheard words are not their wording. With no script: [].

4. idea: their ideas restated in plain English as a short outline (what they meant, mistakes fixed, nothing new added) — a model answer will be written from it. question: the question they answered (as given; for free talk, an IELTS-style question their talk answers). topic: a short topic name.`

/** One line of fluency figures for the prompt. */
function figures(r: ReturnType<typeof measureFluency>, part: TalkPart): string {
  const target = TALK_TARGET[part]
  return [
    `recording ${r.duration}s, speaking ${r.speech}s${target ? ` (expected ${target.label})` : ''}`,
    `${r.words} words, ${r.wpm} words/minute`,
    `${r.hesitations ?? 0} hesitations (silences ≥0.8 s inside a sentence, longest ${r.longestHesitation ?? 0}s); ${r.sentencePauses ?? 0} pauses ≥1 s between sentences (natural); ${Math.round(r.pauseRatio * 100)}% of the time in silences ≥1 s`,
    `fillers: ${r.fillerCount ? r.fillers.map((f) => `${f.word} ×${f.count}`).join(', ') : 'none heard'}`,
    `repeated words: ${r.repeats}`,
    `word variety ${Math.round(r.variety * 100)}%`,
    `${r.sentences} sentences, ${r.avgSentenceWords} words each on average`,
    `unclear words: ${r.unclear} of ${r.words}`,
  ].join('; ')
}

const FIX_TYPE: Record<IssueKind, WritingFix['type']> = {
  spelling: 'spelling',
  grammar: 'grammar',
  word_form: 'word form',
  collocation: 'collocation',
  word_choice: 'word choice',
  naturalness: 'naturalness',
}

const band = (n: number) => Math.min(9, Math.max(0, Math.round((Number.isFinite(n) ? n : 0) * 2) / 2))
const few = (list: string[], max: number) =>
  list
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max)

/* ───────────── What you most likely said ───────────── */

type Graded = z.infer<typeof ReviewSchema>
const plainWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}']/gu, ''))
    .filter(Boolean)

/**
 * Your sentences with the misheard words restored. A restored sentence must still be mostly yours (half of its words
 * kept, about the same length): one the AI rewrote more than that stays as heard.
 */
function restore(sentences: string[], restored: Graded['restored']): string[] {
  return sentences.map((sentence, i) => {
    const text = restored.find((r) => r.n === i + 1)?.text.trim()
    if (!text || text === sentence) return sentence
    const before = plainWords(sentence)
    const after = plainWords(text)
    const kept = before.filter((w) => after.includes(w)).length
    const mostlyYours = before.length <= 4 || kept / before.length >= 0.5
    const sameLength = after.length >= before.length * 0.5 && after.length <= before.length * 1.8 + 2
    if (mostlyYours && sameLength) return text
    console.warn(`[speaking-review] restored sentence ${i + 1} rewritten too much, kept as heard: "${text}"`)
    return sentence
  })
}

/**
 * The misheard phrases, each placed in your sentences and in the recording (by the words' timings) so it can be heard
 * again. A phrase not found in the transcript is dropped.
 */
function placeMisheard(items: Graded['misheard'], sentences: string[], words: TalkWord[]): TalkMisheard[] {
  const spoken = words.map((w) => plainWords(w.w).join(''))
  // Where each of your sentences starts among the recognizer's words.
  const starts: number[] = []
  sentences.reduce((at, s) => (starts.push(at), at + s.split(/\s+/).filter(Boolean).length), 0)
  const find = (phrase: string[], from: number, to: number) => {
    for (let i = Math.max(0, from); i + phrase.length <= Math.min(spoken.length, to); i++) if (phrase.every((p, k) => spoken[i + k] === p)) return i
    return -1
  }
  const out: TalkMisheard[] = []
  for (const m of items) {
    const phrase = plainWords(m.heard)
    if (!phrase.length || !m.meant.trim()) continue
    let sentence = m.n - 1
    if (!(sentence >= 0 && sentence < sentences.length && plainWords(sentences[sentence]).join(' ').includes(phrase.join(' '))))
      sentence = sentences.findIndex((s) => plainWords(s).join(' ').includes(phrase.join(' ')))
    if (sentence < 0) continue
    const near = find(phrase, starts[sentence] - 3, (starts[sentence + 1] ?? spoken.length) + 3)
    const at = near >= 0 ? near : find(phrase, 0, spoken.length)
    out.push({
      sentence,
      heard: m.heard.trim(),
      meant: m.meant.trim(),
      ipa: m.ipa.trim(),
      tip: clip(m.tip.trim(), 120),
      start: at >= 0 ? words[at].start : 0,
      end: at >= 0 ? words[at + phrase.length - 1].end : 0,
    })
  }
  return out
}

/* ───────────── Script ───────────── */

const score = (n: number) => Math.min(100, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)))
/** A script sentence whose words you said at least this much is "word for word". */
const WORD_FOR_WORD = 0.9
/** The script goes to the AI sentence by sentence up to this many (passages of sentences beyond: a very long script). */
const MAX_SCRIPT_SENTENCES = 40

type GradedPoint = z.infer<typeof ReviewSchema>['points'][number]
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, '')}…` : s)

/**
 * The script idea by idea. The AI groups the script sentences into points, pairs each with your sentences (by number),
 * scores it and lists the phrases that differ; code checks the numbers, makes the points cover every sentence once (a
 * stretch the AI left out becomes a point of its own, paired by shared words), takes your sentences' words as what you
 * said, and weights the scores into one match.
 */
function scriptComparison(aligned: ScriptLine[], graded: GradedPoint[], spoken: string[]): TalkComparison {
  const last = aligned.length - 1
  const valid = (ns: number[]) => [...new Set(ns.filter((n) => n >= 0 && n < spoken.length))].sort((a, b) => a - b)
  // The AI's points in order, 0-based, inside the script; later ones start after earlier ones end.
  const spans: { from: number; to: number; g?: GradedPoint }[] = []
  let cursor = 0
  for (const g of [...graded].sort((a, b) => a.from - b.from)) {
    const from = Math.max(cursor, Math.min(last, g.from - 1))
    const to = Math.min(last, g.to - 1)
    if (to < from) continue
    if (from > cursor) spans.push({ from: cursor, to: from - 1 })
    spans.push({ from, to, g })
    cursor = to + 1
  }
  if (cursor <= last) spans.push({ from: cursor, to: last })

  const points = spans.map(({ from, to, g }): TalkScriptPoint => {
    const script = aligned
      .slice(from, to + 1)
      .map((l) => l.sentence)
      .join(' ')
    const heard = g ? valid(g.heard.map((n) => n - 1)) : valid(aligned.slice(from, to + 1).flatMap((l) => l.heard))
    const said = heard.map((n) => spoken[n]).join(' ')
    const share = wordCheck(script, said).share
    const words = score(share * 100)
    // Said (nearly) word for word: no criterion scores below the share of its words said, whatever the AI thought of
    // the script itself. Below that, the AI's reading of the meaning stands (a paraphrase can score high).
    const floor = share >= WORD_FOR_WORD ? words : 0
    const scores = g
      ? { idea: Math.max(floor, score(g.idea)), details: Math.max(floor, score(g.details)), wording: Math.max(floor, score(g.wording)) }
      : { idea: words, details: words, wording: words }
    return {
      title: g?.title.trim() || clip(script, 40),
      from,
      to,
      script,
      heard,
      said,
      scores,
      match: score(SCRIPT_CRITERIA.reduce((sum, c) => sum + scores[c.id] * c.weight, 0)),
      diffs: (g?.diffs ?? [])
        .map((d) => ({ kind: d.kind, script: clip(d.script.trim(), 90), said: clip(d.said.trim(), 90), note: clip(d.note.trim(), 120) }))
        .filter((d) => d.script || d.said)
        .slice(0, 5),
      ...(g ? {} : { byCode: true }),
    }
  })
  // Longer points weigh more in the whole.
  const weight = points.map((p) => Math.max(1, p.script.split(/\s+/).length))
  const total = weight.reduce((a, b) => a + b, 0)
  const weighted = (value: (p: TalkScriptPoint) => number) => score(points.reduce((s, p, i) => s + value(p) * weight[i], 0) / total)
  return {
    points,
    match: points.length ? weighted((p) => p.match) : 0,
    overall: {
      idea: points.length ? weighted((p) => p.scores.idea) : 0,
      details: points.length ? weighted((p) => p.scores.details) : 0,
      wording: points.length ? weighted((p) => p.scores.wording) : 0,
    },
  }
}

/* ───────────── Model answer (Speaking ideas) ───────────── */

/** Starts Speaking ideas on your ideas; the result keeps its id (or why it could not start). */
function startModel(ctx: ApiContext, model: TalkModelAnswer): TalkModelAnswer {
  const { jobId: _old, error: _error, ...rest } = model
  try {
    const job = startSuggest(ctx, {
      topic: model.topic || 'General',
      part: model.part,
      questions: [{ question: model.question, idea: model.idea }],
      mode: 'answer',
      engine: 'antigravity',
    })
    return { ...rest, jobId: job.id }
  } catch (error) {
    return { ...rest, error: (error as Error).message }
  }
}

/* ───────────── The job ───────────── */

interface Input {
  part: TalkPart
  question: string
  topic: string
  script: string
}

/** What a review was asked (`<id>.pending`), with the error when it failed. */
interface Pending extends Input {
  error?: string
  at: string
}

async function run(ctx: ApiContext, job: TalkReviewJob, input: Input, audio: ReturnType<typeof readWav>) {
  const started = Date.now()
  try {
    job.step = 'transcribe'
    const heard = await transcribe(ctx.rootDir, audio)
    if (heard.words.length < 3) throw new ApiError(422, 'Không nghe được lời nói nào trong bản ghi — kiểm tra micro rồi thử lại.')
    const sentences = splitSentences(heard.text)
    const fluency = measureFluency(heard.words, heard.duration, sentences)
    const unclear = [...new Set(heard.words.filter((w) => w.conf < UNCLEAR).map((w) => w.w.replace(/[^\p{L}\p{N}'-]/gu, '')))].filter(Boolean)

    // Each script sentence with the stretch of the answer that shares most of its words (code); the AI then judges the
    // match by meaning — and may point at other words when the sentence was said elsewhere or in other words.
    const aligned = input.script ? checkScript(input.script, sentences, MAX_SCRIPT_SENTENCES).lines : []

    job.step = 'analyze'
    const { value, model } = await speakingJson({
      label: 'speaking review',
      engine: 'antigravity',
      effort: speakingEffort(),
      system: SYSTEM,
      schema: ReviewSchema,
      prompt: [
        PART_RULE[input.part],
        `Question: ${input.question || '(none given — free talk)'}`,
        ...(input.topic ? [`Topic: ${input.topic}`] : []),
        `Fluency figures: ${figures(fluency, input.part)}`,
        `Words the recognizer was unsure of: ${unclear.length ? unclear.join(', ') : 'none'}`,
        `Transcript, one sentence per line (the edits refer to these numbers; T${1}… in the script check):\n${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
        ...(input.script
          ? [
              `The script they planned to say, sentence by sentence (S…), with code's guess of the transcript sentences that say it:\n${aligned
                .map((l, i) => `S${i + 1}. ${l.sentence}\n    hint: ${l.heard.length ? l.heard.map((n) => `T${n + 1}`).join(', ') : 'none found'}`)
                .join('\n')}`,
            ]
          : ['No script was given.']),
      ].join('\n\n'),
    })

    // What you most likely said: misheard words restored (your own mistakes kept) — what is corrected, graded and
    // compared with the script. As heard stays for the timings (fluency, the words on the page).
    const said = restore(sentences, value.restored)
    const misheard = placeMisheard(value.misheard, sentences, heard.words)

    job.step = 'dictionary'
    const dict = dictionaries()
    const issues: RewriteIssue[] = await Promise.all(
      value.edits
        .filter((raw) => {
          const sentence = said[raw.sentence - 1]
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
    const fixed: RewriteIssue[] = []
    const unconfirmed = issues.filter((i) => !i.verified)
    const correctedSentences = said.map((sentence, index) => {
      const result = applyEdits(
        sentence,
        issues.filter((i) => i.verified && i.sentenceIndex === index),
      )
      fixed.push(...result.applied)
      unconfirmed.push(...result.skipped)
      return result.text
    })
    const fixes: TalkFix[] = fixed
      .map((issue, n): TalkFix => ({
        id: `f${n + 1}`,
        sentenceIndex: issue.sentenceIndex,
        original: issue.original,
        replacement: issue.replacement,
        type: FIX_TYPE[issue.kind],
        severity: issue.severity,
        explanation: issue.why,
        ...proofOf(issue),
      }))
      .sort((a, b) => a.sentenceIndex - b.sentenceIndex)

    const criteria = Object.fromEntries(
      (['fc', 'lr', 'gra', 'pron'] as const).map((id) => {
        const c = value.criteria[id]
        return [id, { band: band(c.band), summary: c.summary.trim(), good: [] as string[], improve: few(c.improve, 2) } satisfies TalkCriterion]
      }),
    ) as Record<TalkCriterionId, TalkCriterion>

    const question = input.question || value.question.trim()
    const topic = input.topic || value.topic.trim()
    // Your ideas, ready for a model answer: Speaking ideas writes it only when you ask (six AI calls, ~90k tokens).
    let modelAnswer: TalkModelAnswer | undefined
    if (!input.script) {
      const part: SpeakingPart = input.part === 'free' ? (fluency.speech >= 75 ? 2 : 3) : input.part
      modelAnswer = { topic, question, idea: value.idea.trim(), part }
    }

    const result: TalkReviewResult = {
      id: job.id,
      createdAt: job.startedAt,
      durationMs: Date.now() - started,
      part: input.part,
      question,
      ...(topic ? { topic } : {}),
      ...(input.script ? { script: input.script } : {}),
      audio: true,
      transcript: heard.text,
      words: heard.words,
      sentences: said,
      ...(said.some((s, i) => s !== sentences[i]) ? { heardSentences: sentences } : {}),
      correctedSentences,
      ...(misheard.length ? { misheard } : {}),
      corrected: correctedSentences.join(' '),
      fixes,
      warnings: unconfirmed.map((issue) => ({
        phrase: issue.original,
        ...(issue.replacement ? { suggestion: issue.replacement } : {}),
        explanation: `${issue.why} (AI đề xuất; Longman/OZDIC chưa xác nhận cách sửa nên không tự sửa.)`,
      })),
      fluency,
      criteria,
      overall: overallBand(Object.values(criteria).map((x) => x.band)),
      ...(input.script
        ? {
            comparison: scriptComparison(aligned, value.points, said),
          }
        : {}),
      ...(modelAnswer ? { model: modelAnswer } : {}),
      reviewer: model || antigravityModel(),
    }
    await writeJsonFile(fileOf(ctx, job.id), result)
    job.result = result
    job.status = 'done'
    job.step = undefined
    // Review cards you used yourself in what you said (right: up to "Tự dùng"; wrong: back to practise).
    creditInBackground(ctx, 'talk', job.id)
    await rm(fileOf(ctx, job.id, 'pending'), { force: true })
  } catch (error) {
    job.status = 'error'
    job.error = (error as Error).message
    // The recording stays: "Try again" reviews it again without recording it again.
    job.retryable = true
    await writeJsonFile(fileOf(ctx, job.id, 'pending'), { ...input, at: job.startedAt, error: job.error } satisfies Pending).catch(() => {})
    console.error('[speaking-review]', error)
  } finally {
    setTimeout(() => jobs.delete(job.id), job.status === 'error' ? 10 * 60_000 : 60_000).unref()
  }
}

const PARTS: TalkPart[] = [1, 2, 3, 'free']

/** POST /api/speaking-review */
export async function startTalkReview(ctx: ApiContext, body: unknown): Promise<TalkReviewJob> {
  const b = (body ?? {}) as Partial<Record<keyof TalkReviewRequest, unknown>>
  const part = PARTS.find((p) => p === b.part) ?? 'free'
  const wav = typeof b.audio === 'string' ? Buffer.from(b.audio, 'base64') : Buffer.alloc(0)
  const audio = readWav(wav)
  const seconds = audio.samples.length / audio.sampleRate
  if (seconds < 2) throw new ApiError(400, 'The recording is too short.')
  if (seconds > TALK_MAX_SECONDS + 5) throw new ApiError(400, `Recordings can be at most ${TALK_MAX_SECONDS / 60} minutes.`)
  const input: Input = { part, question: text(b.question, 1500), topic: text(b.topic, 80), script: text(b.script, 6000) }
  const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  await writeTextFile(fileOf(ctx, id, 'wav'), wav)
  return launch(ctx, id, input, audio)
}

function launch(ctx: ApiContext, id: string, input: Input, audio: ReturnType<typeof readWav>): TalkReviewJob {
  if ([...jobs.values()].filter((j) => j.status === 'running').length >= 6)
    throw new ApiError(429, 'Another review is still running — please wait for it to finish.')
  const job: TalkReviewJob = { id, status: 'running', startedAt: new Date().toISOString(), step: 'transcribe' }
  jobs.set(id, job)
  void writeJsonFile(fileOf(ctx, id, 'pending'), { ...input, at: job.startedAt } satisfies Pending).catch(() => {})
  void run(ctx, job, input, audio)
  return job
}

/** POST /api/speaking-review/retry { id }: review a failed recording again (no new recording needed). */
export async function retryTalkReview(ctx: ApiContext, id: string): Promise<TalkReviewJob> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  const pending = await readJsonFile<Pending | null>(fileOf(ctx, id, 'pending'), null)
  if (!pending) throw new ApiError(404, 'Nothing to retry: the review is done or was deleted.')
  const { error: _error, at: _at, ...input } = pending
  return launch(ctx, id, input, readWav(await talkAudio(ctx, id)))
}

export async function talkReview(ctx: Pick<ApiContext, 'rootDir'>, id: string): Promise<TalkReviewResult | null> {
  if (!validId(id)) return null
  return readJsonFile<TalkReviewResult | null>(fileOf(ctx, id), null).catch(() => null)
}

/** GET /api/speaking-review?id= */
export async function getTalkReview(ctx: ApiContext, id: string): Promise<TalkReviewJob | null> {
  if (!validId(id)) return null
  const live = jobs.get(id)
  if (live) return live
  const result = await talkReview(ctx, id)
  if (result) return { id, status: 'done', startedAt: result.createdAt, result }
  // A review that failed earlier (or was cut off by a restart): its recording can be reviewed again.
  const pending = await readJsonFile<Pending | null>(fileOf(ctx, id, 'pending'), null).catch(() => null)
  return pending
    ? { id, status: 'error', startedAt: pending.at, error: pending.error ?? 'The review was interrupted (the server restarted).', retryable: true }
    : null
}

/** The recording, as saved. */
export async function talkAudio(ctx: ApiContext, id: string): Promise<Buffer> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  try {
    return await readFile(fileOf(ctx, id, 'wav'))
  } catch {
    throw new ApiError(404, 'Recording not found.')
  }
}

/** POST /api/speaking-review/model { id }: Speaking ideas writes the model answer from your ideas (when you ask, or again). */
export async function restartModel(ctx: ApiContext, id: string): Promise<TalkReviewResult> {
  const result = await talkReview(ctx, id)
  if (!result?.model) throw new ApiError(404, 'Review not found.')
  result.model = startModel(ctx, result.model)
  if (result.model.error) throw new ApiError(429, result.model.error)
  await writeJsonFile(fileOf(ctx, id), result)
  return result
}

export async function deleteTalkReview(ctx: ApiContext, id: string): Promise<void> {
  if (!validId(id)) throw new ApiError(400, 'Invalid id.')
  await rm(fileOf(ctx, id), { force: true })
  await rm(fileOf(ctx, id, 'wav'), { force: true })
  await rm(fileOf(ctx, id, 'pending'), { force: true })
  jobs.delete(id)
}

/** GET /api/speaking-review/history */
export async function listTalkReviews(ctx: ApiContext): Promise<TalkHistoryItem[]> {
  return (await talkReviews(ctx))
    .filter((r) => r.sentences)
    .map((r): TalkHistoryItem => {
      const f = r.fluency
      const perMin = (n: number) => (f.speech > 0 ? Math.round((n / f.speech) * 600) / 10 : 0)
      return {
        id: r.id,
        createdAt: r.createdAt,
        part: r.part,
        question: r.question,
        ...(r.topic ? { topic: r.topic } : {}),
        overall: r.overall,
        bands: { fc: r.criteria.fc.band, lr: r.criteria.lr.band, gra: r.criteria.gra.band, pron: r.criteria.pron.band },
        duration: f.duration,
        speech: f.speech,
        words: f.words,
        wpm: f.wpm,
        pausesPerMin: perMin(f.pauses),
        fillersPerMin: perMin(f.fillerCount),
        unclearPct: f.words ? Math.round((f.unclear / f.words) * 100) : 0,
        fixes: r.fixes.length,
        script: Boolean(r.script),
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
