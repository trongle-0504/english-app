// Re-runs the writing review pipeline on saved reviews in progress/writing-reviews/ without overwriting them.
// Usage: node scripts/rereview-writing.ts <id> [<id>...] [--runs N] [--compare] [--copied-errors]
import { existsSync } from 'node:fs'
import path from 'node:path'
import { loadEnv } from '../server/env.ts'
import { readJsonFile, writeJsonFile } from '../server/files.ts'
import { findCopiedErrors } from '../server/writing-review/copied-errors.ts'
import { reviewWriting } from '../server/writing-review/service.ts'
import type { EssayReviewEdit } from '../server/writing-review/writing-essay.ts'
import type { WritingReviewResult } from '../src/types/writingReview.ts'

const rootDir = path.resolve(import.meta.dirname, '..')
loadEnv(rootDir)

function essayToPlainText(sentences?: { segments?: { text: string }[] }[]): string {
  if (!sentences) return ''
  return sentences
    .map((s) => (s.segments ? s.segments.map((g) => g.text).join('') : ''))
    .join(' ')
    .trim()
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = process.argv.slice(2)
  const compare = args.includes('--compare')
  const copiedErrors = args.includes('--copied-errors')
  const runsIdx = args.indexOf('--runs')
  const runs = runsIdx >= 0 && args[runsIdx + 1] ? Number(args[runsIdx + 1]) || 1 : 1
  const tagIdx = args.indexOf('--tag')
  const tag = tagIdx >= 0 && args[tagIdx + 1] ? args[tagIdx + 1] : ''
  const ids = args.filter(
    (a, i) =>
      !a.startsWith('--') &&
      (runsIdx < 0 || (i !== runsIdx + 1 && i !== runsIdx)) &&
      (tagIdx < 0 || (i !== tagIdx + 1 && i !== tagIdx)),
  )

  if (!ids.length) {
    console.error('Usage: node scripts/rereview-writing.ts <id> [<id>...] [--runs N] [--compare] [--copied-errors] [--tag TAG]')
    process.exit(1)
  }

  for (const rawId of ids) {
    let id = rawId.replace(/\.json$/, '')
    let jsonPath = path.join(rootDir, 'progress', 'writing-reviews', `${id}.json`)
    if (rawId.endsWith('.json')) {
      const candidate = path.isAbsolute(rawId) ? rawId : path.resolve(rootDir, rawId)
      if (existsSync(candidate)) {
        jsonPath = candidate
        id = path.basename(rawId, '.json')
      }
    }
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
      const reviewEditsList: EssayReviewEdit[] = []

      const next = await reviewWriting(
        { rootDir },
        {
          text: saved.text,
          prompt: saved.prompt,
          vietnameseText: saved.vietnameseText,
          title: saved.title,
        },
        {
          id: saved.id,
          startedAt: new Date().toISOString(),
          onCall: (c) => {
            callDetails.push({ label: c.step, ms: c.ms ?? 0, thinking: c.thinking })
          },
          onReviewEdits: (edits) => {
            reviewEditsList.push(...edits)
          },
        },
      )

      const outPath = path.join(rootDir, 'cache', 'rereview-writing', `${id}.${tag ? `${tag}.` : ''}${r}.json`)
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

      if (reviewEditsList.length) {
        console.log(`  review-edits: ${reviewEditsList.length}`)
        for (const e of reviewEditsList) {
          console.log(`    [${e.kind}] "${e.original}" → "${e.replacement}" (${e.why})`)
        }
      }

      if (copiedErrors) {
        const essaySentences = next.modelEssay?.sentences?.map((s) => s.segments.map((seg) => seg.text).join('')) ?? []
        const copied = findCopiedErrors(next.sentences, next.fixes ?? [], essaySentences)
        console.log(`  copied-errors: ${copied.length}${copied.length ? ` (${copied.map((c) => c.phrase).join(', ')})` : ' (none)'}`)
        for (const c of copied) {
          console.log(`    [copied-error] "${c.phrase}" in essay sentence: "${c.sentence}"`)
        }
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
}
