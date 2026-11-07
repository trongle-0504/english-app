// Calibration script: evaluates scoreEssay against examiner-scored essays in progress/writing-reviews/ground-truth/
// Usage: node scripts/writing-calibration.ts [--runs N]
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { loadEnv } from '../server/env.ts'
import { readJsonFile } from '../server/files.ts'
import { writingReviewModel } from '../server/writing-review/llm.ts'
import { scoreEssay } from '../server/writing-review/score.ts'
import type { WritingScore } from '../src/types/writingReview.ts'

const rootDir = path.resolve(import.meta.dirname, '..')
loadEnv(rootDir)

const args = process.argv.slice(2)
const runsIdx = args.indexOf('--runs')
const runs = runsIdx >= 0 && args[runsIdx + 1] ? Number(args[runsIdx + 1]) || 3 : 3

interface GroundTruthItem {
  prompt?: string
  text: string
  vietnameseText?: string
  expected: {
    overall: number
    tr: number
    cc: number
    lr: number
    gra: number
  }
  source?: string
}

async function main() {
  const gtDir = path.join(rootDir, 'progress', 'writing-reviews', 'ground-truth')
  let files: string[] = []
  try {
    files = (await readdir(gtDir)).filter((f) => f.endsWith('.json'))
  } catch {
    console.warn(`[writing-calibration] Folder not found or empty: ${gtDir}`)
    console.log('Place examiner-scored essays in progress/writing-reviews/ground-truth/<name>.json')
    return
  }

  if (!files.length) {
    console.log(`[writing-calibration] No ground-truth files found in ${gtDir}`)
    console.log('Place examiner-scored essays in progress/writing-reviews/ground-truth/<name>.json')
    return
  }

  console.log(`\n==================================================`)
  console.log(`Writing Calibration: ${files.length} essay(s), ${runs} run(s) each`)
  console.log(`WRITING_SCORE_EFFORT=${process.env.WRITING_SCORE_EFFORT || '(default: low)'}`)
  console.log(`==================================================\n`)

  const llm = writingReviewModel()

  interface RunResult {
    file: string
    expected: GroundTruthItem['expected']
    scores: WritingScore[]
    ms: number[]
  }

  const results: RunResult[] = []

  for (const file of files) {
    const item = await readJsonFile<GroundTruthItem | null>(path.join(gtDir, file), null)
    if (!item?.text) continue

    console.log(`Evaluating ${file} (source: ${item.source || 'unknown'})…`)
    const scores: WritingScore[] = []
    const msList: number[] = []

    for (let r = 1; r <= runs; r++) {
      const t0 = Date.now()
      const { score } = await scoreEssay(llm, {
        text: item.text,
        prompt: item.prompt,
        vietnameseText: item.vietnameseText,
      })
      const elapsed = Date.now() - t0
      scores.push(score)
      msList.push(elapsed)
      console.log(
        `  Run ${r}: overall=${score.overall} (TR:${score.criteria.tr.band} CC:${score.criteria.cc.band} LR:${score.criteria.lr.band} GRA:${score.criteria.gra.band}) [${(elapsed / 1000).toFixed(1)}s]`,
      )
    }

    results.push({
      file,
      expected: item.expected,
      scores,
      ms: msList,
    })
  }

  // Summary table
  console.log(`\n==================================================`)
  console.log(`Summary & Calibration Metrics`)
  console.log(`==================================================`)
  console.log(`File | Expected (TR/CC/LR/GRA/Over) | Mean Run (TR/CC/LR/GRA/Over) | Over Range | Avg Sec`)

  const criteriaKeys = ['tr', 'cc', 'lr', 'gra', 'overall'] as const
  const errors: Record<string, number[]> = { tr: [], cc: [], lr: [], gra: [], overall: [] }
  const signedErrors: Record<string, number[]> = { tr: [], cc: [], lr: [], gra: [], overall: [] }

  for (const res of results) {
    const meanTr = res.scores.reduce((sum, s) => sum + s.criteria.tr.band, 0) / runs
    const meanCc = res.scores.reduce((sum, s) => sum + s.criteria.cc.band, 0) / runs
    const meanLr = res.scores.reduce((sum, s) => sum + s.criteria.lr.band, 0) / runs
    const meanGra = res.scores.reduce((sum, s) => sum + s.criteria.gra.band, 0) / runs
    const meanOver = res.scores.reduce((sum, s) => sum + s.overall, 0) / runs

    const minOver = Math.min(...res.scores.map((s) => s.overall))
    const maxOver = Math.max(...res.scores.map((s) => s.overall))
    const overRange = maxOver - minOver
    const avgSec = (res.ms.reduce((a, b) => a + b, 0) / runs / 1000).toFixed(1)

    errors.tr.push(Math.abs(meanTr - res.expected.tr))
    errors.cc.push(Math.abs(meanCc - res.expected.cc))
    errors.lr.push(Math.abs(meanLr - res.expected.lr))
    errors.gra.push(Math.abs(meanGra - res.expected.gra))
    errors.overall.push(Math.abs(meanOver - res.expected.overall))

    signedErrors.tr.push(meanTr - res.expected.tr)
    signedErrors.cc.push(meanCc - res.expected.cc)
    signedErrors.lr.push(meanLr - res.expected.lr)
    signedErrors.gra.push(meanGra - res.expected.gra)
    signedErrors.overall.push(meanOver - res.expected.overall)

    const expStr = `${res.expected.tr}/${res.expected.cc}/${res.expected.lr}/${res.expected.gra}/${res.expected.overall}`
    const meanStr = `${meanTr.toFixed(1)}/${meanCc.toFixed(1)}/${meanLr.toFixed(1)}/${meanGra.toFixed(1)}/${meanOver.toFixed(1)}`

    console.log(`${res.file} | ${expStr} | ${meanStr} | ${overRange.toFixed(1)} | ${avgSec}s`)
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

  console.log(`\n--- Metric Summary ---`)
  for (const k of criteriaKeys) {
    const mae = avg(errors[k]).toFixed(2)
    const bias = avg(signedErrors[k]).toFixed(2)
    console.log(`${k.toUpperCase().padEnd(7)}: MAE = ${mae.padEnd(5)} | Bias = ${bias}`)
  }
}

void main()
