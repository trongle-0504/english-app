// Re-runs the writing review pipeline on saved reviews in progress/writing-reviews/ without overwriting them.
// Usage: node scripts/rereview-writing.ts <id> [<id>...] [--runs N] [--compare] [--copied-errors]
import path from 'node:path'
import { loadEnv } from '../server/env.ts'
import { readJsonFile, writeJsonFile } from '../server/files.ts'
import {
  prepare,
  reviewDraft,
  retryUnconfirmed,
  applyAllEdits,
  type RewriteReport,
} from '../server/writing-review/rewrite.ts'
import { chosenHints } from '../server/writing-review/dol.ts'
import { writingLinearGuide, generateWritingModelEssay } from '../server/writing-review/writing-essay.ts'
import { countWords, MIN_WORDS_FOR_SCORING, scoreEssay } from '../server/writing-review/score.ts'
import { writingReviewModel, type CallUsage } from '../server/writing-review/llm.ts'
import { classifyWritingReview, buildResult } from '../server/writing-review/service.ts'
import type { WritingModelEssay, WritingReviewResult, WritingReviewTimings, WritingScore } from '../src/types/writingReview.ts'
import type { WritingReviewTopic, WritingReviewType } from '../src/features/practice/writing-review/categories.ts'

const rootDir = path.resolve(import.meta.dirname, '..')
loadEnv(rootDir)

const args = process.argv.slice(2)
const compare = args.includes('--compare')
const copiedErrors = args.includes('--copied-errors')
const runsIdx = args.indexOf('--runs')
const runs = runsIdx >= 0 && args[runsIdx + 1] ? Number(args[runsIdx + 1]) || 1 : 1
const ids = args.filter((a, i) => !a.startsWith('--') && (runsIdx < 0 || (i !== runsIdx + 1 && i !== runsIdx)))

if (!ids.length) {
  console.error('Usage: node scripts/rereview-writing.ts <id> [<id>...] [--runs N] [--compare] [--copied-errors]')
  process.exit(1)
}

function essayToPlainText(sentences?: { segments?: { text: string }[] }[]): string {
  if (!sentences) return ''
  return sentences
    .map((s) => (s.segments ? s.segments.map((g) => g.text).join('') : ''))
    .join(' ')
    .trim()
}

export interface ReviewWritingOpts {
  rootDir: string
  onStep?: (step: string) => void
  onCall?: (call: CallUsage) => void
}

export async function reviewWriting(
  saved: WritingReviewResult,
  opts: ReviewWritingOpts,
): Promise<WritingReviewResult> {
  const started = Date.now()
  const timings: WritingReviewTimings = {
    total: 0,
    steps: {},
  }
  const calls: { step: string; input: number; output: number; thinking: number; ms?: number }[] = []
  let totalInput = 0
  let totalOutput = 0
  let totalThinking = 0

  const llm = writingReviewModel({
    onCall: (call) => {
      opts.onCall?.(call)
      calls.push({ step: call.label, input: call.input, output: call.output, thinking: call.thinking, ms: call.ms })
      totalInput += call.input
      totalOutput += call.output
      totalThinking += call.thinking
    },
  })

  // 0. Format idea in parallel
  const ideaPromise = saved.vietnameseText?.trim()
    ? import('../server/format-idea.ts').then((m) => m.formatIdea(saved.vietnameseText!, llm, 'writing')).catch(() => undefined)
    : Promise.resolve(undefined)

  // 1. Score lane
  const wordsCount = countWords(saved.text)
  let scoreResult: WritingScore | undefined
  let scoreTopic: WritingReviewTopic | undefined
  let scoreType: WritingReviewType | undefined
  let scoreSkippedReason: 'short' | 'error' | undefined

  const scoreLane = (async () => {
    if (wordsCount < MIN_WORDS_FOR_SCORING) {
      scoreSkippedReason = 'short'
      return
    }
    const tScore = Date.now()
    try {
      const res = await scoreEssay(llm, { text: saved.text, prompt: saved.prompt, vietnameseText: saved.vietnameseText })
      timings.steps['score'] = Date.now() - tScore
      scoreResult = res.score
      scoreTopic = res.topic
      scoreType = res.questionType
    } catch (err) {
      console.warn(`[writing-review] score call failed: ${(err as Error).message}`)
      scoreSkippedReason = 'error'
    }
  })()

  // 2. Prepare shared collocations + DOL
  const tPrep = Date.now()
  const prepared = await prepare(saved.text, llm, {
    vietnameseText: saved.vietnameseText,
    rootDir: opts.rootDir,
    onStep: opts.onStep,
  })
  timings.steps['prepare'] = Date.now() - tPrep

  let draftResult: any = null
  let writtenEssay: any = null

  // 3. Corrections lane
  const correctionsLane = (async () => {
    const tDraft = Date.now()
    const draft = await reviewDraft(prepared, llm, {
      prompt: saved.prompt,
      vietnameseText: saved.vietnameseText,
      onStep: opts.onStep,
    })
    timings.steps['diagnose_dict'] = Date.now() - tDraft
    timings.firstResult = Date.now() - started
    draftResult = draft

    if (draft.failed.length) {
      const tRetry = Date.now()
      await retryUnconfirmed(draft.failed, prepared.sentences, draft.dict, llm, opts.onStep)
      timings.steps['retry'] = Date.now() - tRetry
    }
  })()

  // 4. Essay lane
  const essayLane = (async () => {
    const tEssay = Date.now()
    const written = await generateWritingModelEssay(
      {
        text: saved.text,
        vietnameseText: saved.vietnameseText,
        candidates: prepared.suggestedPhrases.map((c) => ({
          id: c.cardId,
          term: c.term,
          meaning_vi: c.meaning_vi,
          origin: c.origin,
          example: c.example,
          isTopicCollocation: true,
        })),
        guide: await writingLinearGuide({ rootDir: opts.rootDir }),
        dolHints: prepared.dolHints,
        onStep: opts.onStep,
      },
      llm,
    ).catch((err) => {
      console.error('Failed to generate writing model essay:', err)
      return undefined
    })
    timings.steps['essay'] = Date.now() - tEssay
    writtenEssay = written
  })()

  await Promise.all([correctionsLane, essayLane, scoreLane])

  const { correctedSentences, fixed, unconfirmed } = applyAllEdits(prepared.sentences, draftResult.issues)

  let finalTopic = scoreTopic
  let finalType = scoreType
  if (!finalTopic || !finalType) {
    const classification = await classifyWritingReview(llm, saved.text, saved.prompt).catch(() => ({
      topic: 'Other' as const,
      questionType: 'Other' as const,
    }))
    finalTopic ??= classification.topic
    finalType ??= classification.questionType
  }

  const { dolRefs, unlistedFixes: _unlistedFixes, reviewEdits: _reviewEdits, plan: _plan, ...modelEssay } = writtenEssay ?? {}
  const shownDol = chosenHints(prepared.dolHints, dolRefs)

  const report: RewriteReport = {
    sentences: prepared.sentences,
    paragraphStarts: prepared.paragraphStarts,
    correctedSentences,
    fixed,
    unconfirmed,
    suggestedPhrases: prepared.suggestedPhrases,
    dolHints: shownDol,
    modelEssay: writtenEssay ? (modelEssay as WritingModelEssay) : undefined,
    vietnameseFormatted: await ideaPromise,
  }

  const usage = {
    model: llm.model,
    calls,
    input: totalInput,
    output: totalOutput,
    thinking: totalThinking,
    total: totalInput + totalOutput + totalThinking,
  }

  timings.total = Date.now() - started
  const result = buildResult(
    saved.id,
    new Date().toISOString(),
    saved.text,
    report,
    usage,
    timings.total,
    saved.title,
    saved.prompt,
    saved.vietnameseText,
    { topic: finalTopic, questionType: finalType },
    timings,
  )
  if (scoreResult) result.score = scoreResult
  if (scoreSkippedReason) result.scoreSkipped = scoreSkippedReason

  return result
}

for (const rawId of ids) {
  const id = rawId.replace(/\.json$/, '')
  const jsonPath = path.join(rootDir, 'progress', 'writing-reviews', `${id}.json`)
  const saved = await readJsonFile<WritingReviewResult | null>(jsonPath, null)
  if (!saved) {
    console.error(`${id} | missing ${jsonPath}`)
    continue
  }

  console.log(`\n==================================================`)
  console.log(`Evaluating: ${id} (${runs} run(s))`)
  console.log(`Title: ${saved.title || '(none)'}`)
  console.log(`==================================================`)

  for (let r = 1; r <= runs; r++) {
    const started = Date.now()
    const callDetails: { label: string; ms: number; thinking: number }[] = []

    const next = await reviewWriting(saved, {
      rootDir,
      onCall: (c) => {
        callDetails.push({ label: c.label, ms: c.ms ?? 0, thinking: c.thinking })
      },
    })

    const outPath = path.join(rootDir, 'cache', 'rereview-writing', `${id}.${r}.json`)
    await writeJsonFile(outPath, next)

    const totalSec = ((Date.now() - started) / 1000).toFixed(1)
    const firstResultSec = next.timings?.firstResult ? (next.timings.firstResult / 1000).toFixed(1) : '-'
    const savedEssayText = essayToPlainText(saved.modelEssay?.sentences)
    const nextEssayText = essayToPlainText(next.modelEssay?.sentences)
    const savedEssayWords = savedEssayText ? savedEssayText.split(/\s+/).filter(Boolean).length : 0
    const nextEssayWords = nextEssayText ? nextEssayText.split(/\s+/).filter(Boolean).length : 0

    console.log(
      `[${id} run ${r}/${runs}] total=${totalSec}s (firstResult=${firstResultSec}s) | fixes ${saved.fixes?.length ?? 0} → ${next.fixes?.length ?? 0} (unconfirmed ${saved.warnings?.length ?? 0} → ${next.warnings?.length ?? 0}) | essay words ${savedEssayWords} → ${nextEssayWords}`,
    )
    if (next.score) {
      console.log(`  band: TR=${next.score.criteria.tr.band} CC=${next.score.criteria.cc.band} LR=${next.score.criteria.lr.band} GRA=${next.score.criteria.gra.band} | OVERALL=${next.score.overall}`)
    } else if (next.scoreSkipped) {
      console.log(`  band: skipped (${next.scoreSkipped})`)
    }

    const callSummary = callDetails.map((c) => `${c.label}=${(c.ms / 1000).toFixed(1)}s(thk:${c.thinking})`).join(' | ')
    console.log(`  calls: ${callSummary}`)

    if (copiedErrors) {
      const copied: string[] = []
      for (const fix of next.fixes || []) {
        const orig = fix.original.trim()
        if (orig && nextEssayText.includes(orig)) {
          copied.push(orig)
        }
      }
      console.log(`  copied-errors: ${copied.length} (${copied.join(', ') || 'none'})`)
    }

    if (compare && r === 1) {
      console.log(`\n--- Fixes comparison (saved vs new run 1) ---`)
      const maxF = Math.max(saved.fixes?.length || 0, next.fixes?.length || 0)
      for (let i = 0; i < maxF; i++) {
        const sf = saved.fixes?.[i]
        const nf = next.fixes?.[i]
        const sStr = sf ? `[câu ${sf.sentenceIndex + 1}] "${sf.original}" → "${sf.replacement}"` : '(none)'
        const nStr = nf ? `[câu ${nf.sentenceIndex + 1}] "${nf.original}" → "${nf.replacement}"` : '(none)'
        console.log(`  ${i + 1}. SAVED: ${sStr}`)
        console.log(`     NEW:   ${nStr}`)
      }

      console.log(`\n--- Model essay (saved vs new run 1) ---`)
      const sEssay = savedEssayText || '(no saved model essay)'
      const nEssay = nextEssayText || '(no new model essay)'
      console.log(`SAVED ESSAY:\n${sEssay}\n`)
      console.log(`NEW ESSAY:\n${nEssay}\n`)
    }
  }
}
