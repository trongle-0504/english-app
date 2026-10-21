// Your review cards in your own writing. A card's phrase used right in a Writing essay — or in a Speaking answer / model
// essay you edited, where you added it (not the AI's words you kept) — moves the card up to "Tự dùng"; used wrong (the
// review corrected it, or flagged it as unnatural) sends it back to "Dùng đúng cụm" and makes it due now. Only cards you
// have studied count. Each text gives each card one verdict (StoredCard.uses keeps it, with your sentence); a text is
// scanned again only when it changed (progress/practice.json).
import { createHash } from 'node:crypto'
import path from 'node:path'
import { STAGES, stageOf } from '../../src/features/review/ladder.ts'
import type { RealUse, ReviewStateDoc, UsageStage } from '../../src/types/review.ts'
import type { WorkKind } from '../../src/types/practice.ts'
import type { AnswerSentence } from '../../src/types/speaking.ts'
import type { WritingReviewResult } from '../../src/types/writingReview.ts'
import type { ApiContext } from '../api.ts'
import { readJsonFile, writeJsonFile } from '../files.ts'
import { readState, withProgress, writeState } from '../review/progress.ts'
import { attempted, findTerm, locate, overlaps, termPatterns, tokenize } from './match.ts'
import { reviewCards, segmentsText, speakingResults, talkReviews, writingReviews, type WorkContext } from './works.ts'

/** A card's verdict in one text. */
interface Finding {
  id: string
  term: string
  ok: boolean
  sentence: string
  wrote?: string
  fixed?: string
  why?: string
}

/** One text of yours: what it is, when, a fingerprint, and the cards it uses. */
interface OwnText {
  ref: string
  at: string
  hash: string
  find: (cards: Candidate[]) => Finding[]
}

interface Candidate {
  id: string
  term: string
  patterns: ReturnType<typeof termPatterns>
}

/** Uses kept per card (the latest). */
const KEEP_USES = 8

const registryFile = (ctx: WorkContext) => path.join(ctx.rootDir, 'progress', 'practice.json')
interface Registry {
  version: 1
  /** Text ref → fingerprint of the text when it was scanned. */
  scanned: Record<string, string>
}

const hash = (...parts: unknown[]) => createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12)

/** One verdict per card in a text: a wrong use wins over a right one (the card needs the work). */
function perCard(findings: Finding[]): Finding[] {
  const byId = new Map<string, Finding>()
  for (const f of findings) if (!byId.has(f.id) || (byId.get(f.id)!.ok && !f.ok)) byId.set(f.id, f)
  return [...byId.values()]
}

/** A corrected text of yours (what a Writing review / Speaking review corrects). */
type Corrected = Pick<WritingReviewResult, 'sentences' | 'correctedSentences' | 'fixes'> & { id: string; createdAt: string; text: string }

/**
 * A Writing essay or a recorded answer: right = in your sentence and untouched by a correction; wrong = a correction
 * put it there or changed it.
 */
function essayText(r: Corrected, ref = `writing:${r.id}:essay`): OwnText {
  return {
    ref,
    at: r.createdAt,
    hash: hash(
      r.text,
      r.fixes.map((f) => f.id),
    ),
    find: (cards) => {
      const findings: Finding[] = []
      r.sentences.forEach((own, i) => {
        const fixed = r.correctedSentences[i] ?? own
        const errors = r.fixes.filter((f) => f.sentenceIndex === i && f.severity !== 'improve')
        const ownToks = tokenize(own)
        const fixedToks = tokenize(fixed)
        for (const card of cards) {
          const used = findTerm(card.patterns, own, ownToks)
          if (used) {
            const broken = errors.find((f) => {
              const at = locate(own, f.original)
              return at && overlaps(at, used)
            })
            // A correction of the phrase itself is a wrong use; a whole sentence rewritten around it says nothing either way.
            if (!broken)
              findings.push({
                id: card.id,
                term: card.term,
                ok: true,
                sentence: own,
              })
            else if (attempted(card.patterns, broken.original))
              findings.push({
                id: card.id,
                term: card.term,
                ok: false,
                sentence: own,
                wrote: broken.original,
                fixed: broken.replacement,
                why: broken.explanation,
              })
            continue
          }
          const needed = findTerm(card.patterns, fixed, fixedToks)
          if (!needed) continue
          // A correction put the phrase there: wrong only when you were reaching for it (not a sentence rewritten).
          const fix = errors.find((f) => {
            const at = locate(fixed, f.replacement)
            return at && overlaps(at, needed) && attempted(card.patterns, f.original)
          })
          if (fix)
            findings.push({
              id: card.id,
              term: card.term,
              ok: false,
              sentence: own,
              wrote: fix.original,
              fixed: fix.replacement,
              why: fix.explanation,
            })
        }
      })
      return perCard(findings)
    },
  }
}

/**
 * A text you edited (Speaking answer, Writing model essay): only phrases you added count — the AI's own text (`aiText`)
 * already had the others. A phrase the analysis flagged as unnatural is a wrong use.
 */
function editedText(ref: string, at: string, edited: string, sentences: AnswerSentence[], aiText: string): OwnText {
  return {
    ref,
    at,
    hash: hash(edited),
    find: (cards) => {
      const findings: Finding[] = []
      const aiToks = tokenize(aiText)
      for (const s of sentences) {
        const sentence = segmentsText(s.segments)
        const toks = tokenize(sentence)
        const flagged: { start: number; end: number; why: string }[] = []
        let offset = 0
        for (const seg of s.segments) {
          if (seg.mark === 'unverified')
            flagged.push({
              start: offset,
              end: offset + seg.text.length,
              why: seg.note ?? '',
            })
          offset += seg.text.length
        }
        for (const card of cards) {
          const used = findTerm(card.patterns, sentence, toks)
          if (!used || findTerm(card.patterns, aiText, aiToks)) continue
          const flag = flagged.find((f) => overlaps(f, used))
          findings.push(
            flag
              ? {
                  id: card.id,
                  term: card.term,
                  ok: false,
                  sentence: sentence.trim(),
                  wrote: sentence.slice(flag.start, flag.end).trim(),
                  why: flag.why,
                }
              : {
                  id: card.id,
                  term: card.term,
                  ok: true,
                  sentence: sentence.trim(),
                },
          )
        }
      }
      return perCard(findings)
    },
  }
}

/** Every text of yours in a Writing review: the essay, and the model essay once you edited it. */
function writingTexts(r: WritingReviewResult): OwnText[] {
  const texts = [essayText(r)]
  const m = r.modelEssay
  if (m?.userEdited && m.sentences?.length) {
    const ai = m.originalAnswer?.sentences?.map((s) => segmentsText(s.segments)).join(' ') || segmentsText(m.originalAnswer?.answer)
    texts.push(editedText(`writing:${r.id}:model`, r.createdAt, m.userEdited, m.sentences, ai))
  }
  return texts
}

async function allTexts(ctx: WorkContext, only?: { kind: WorkKind; id: string }): Promise<OwnText[]> {
  const texts: OwnText[] = []
  if (!only || only.kind === 'talk')
    for (const r of await talkReviews(ctx)) if (r.sentences && (!only || r.id === only.id)) texts.push(essayText({ ...r, text: r.transcript }, `talk:${r.id}`))
  if (!only || only.kind === 'writing') for (const r of await writingReviews(ctx)) if (!only || r.id === only.id) texts.push(...writingTexts(r))
  if (!only || only.kind === 'speaking') {
    for (const r of await speakingResults(ctx)) {
      if (only && r.id !== only.id) continue
      r.answers.forEach((a, i) => {
        if (!a.userEdited || !a.sentences?.length) return
        const ai = a.originalAnswer?.sentences?.map((s) => segmentsText(s.segments)).join(' ') || segmentsText(a.originalAnswer?.answer)
        texts.push(editedText(`speaking:${r.id}:${i}`, r.createdAt, a.userEdited, a.sentences, ai))
      })
    }
  }
  return texts
}

const patternCache = new Map<string, ReturnType<typeof termPatterns>>()

/** The cards you have studied (not done), with their phrase as patterns; mistake cards are not phrases. */
function candidates(ctx: WorkContext, state: ReviewStateDoc): Candidate[] {
  const out: Candidate[] = []
  for (const card of reviewCards(ctx)) {
    const stored = state.cards[card.id]
    if (!stored || stored.done || stored.fsrs.state === 0 || card.mistake) continue
    // A short everyday word (make, use, feel) in your text proves nothing.
    if (!/\s/.test(card.term.trim()) && card.term.trim().length <= 4) continue
    let patterns = patternCache.get(card.term)
    if (!patterns) patternCache.set(card.term, (patterns = termPatterns(card.term)))
    if (patterns.length) out.push({ id: card.id, term: card.term, patterns })
  }
  return out
}

const at = (stage: UsageStage) => STAGES.indexOf(stage)

/**
 * Scans the texts (all of them, or one work's) not scanned yet or changed since, and records what they show on the
 * cards. Returns the new uses.
 */
export async function creditRealUse(ctx: ApiContext, only?: { kind: WorkKind; id: string }): Promise<RealUse[]> {
  const registry = await readJsonFile<Registry>(registryFile(ctx), {
    version: 1,
    scanned: {},
  })
  const texts = (await allTexts(ctx, only)).filter((t) => registry.scanned[t.ref] !== t.hash)
  if (!texts.length) return []
  const added: RealUse[] = []
  await withProgress(async () => {
    const state = await readState(ctx)
    const cards = candidates(ctx, state)
    const now = new Date()
    for (const text of texts) {
      for (const f of text.find(cards)) {
        const card = state.cards[f.id]
        if (!card || card.uses?.some((u) => u.ref === text.ref)) continue
        const ladder = state.settings.ladder && card.ladder !== false
        const from = stageOf(card)
        let to = from
        if (f.ok && ladder && at(from) < at('produce')) to = 'produce'
        if (!f.ok && ladder && at(from) > at('collocate')) to = 'collocate'
        if (to !== from) card.stage = to
        // Used wrong: the card comes back today.
        if (!f.ok && card.fsrs.state === 2 && Date.parse(card.fsrs.due) > now.getTime()) card.fsrs = { ...card.fsrs, due: now.toISOString() }
        const use: RealUse = {
          ref: text.ref,
          term: f.term,
          at: text.at,
          ok: f.ok,
          sentence: f.sentence,
          ...(f.wrote ? { wrote: f.wrote } : {}),
          ...(f.fixed ? { fixed: f.fixed } : {}),
          ...(f.why ? { why: f.why } : {}),
          ...(to !== from ? { from, to } : {}),
        }
        card.uses = [...(card.uses ?? []), use].slice(-KEEP_USES)
        added.push(use)
      }
      registry.scanned[text.ref] = text.hash
    }
    if (added.length) await writeState(ctx, state)
    await writeJsonFile(registryFile(ctx), registry)
  })
  if (added.length) console.log(`[practice] ${added.length} use(s) of review cards found in your own text`)
  return added
}

/** Runs after a Writing review or an edit is saved: never fails the request it follows. */
export function creditInBackground(ctx: ApiContext, kind: WorkKind, id: string): void {
  creditRealUse(ctx, { kind, id }).catch((error) => console.warn('[practice] real-use scan failed:', (error as Error).message))
}
