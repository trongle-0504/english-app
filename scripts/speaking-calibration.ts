// Calibrates Speaking review bands against recordings with known examiner bands.
// Reads cache/calibration/speaking.json (or a path passed as the first argument):
// [{ "wav": "cache/calibration/a1.wav", "part": 3, "question": "...", "script": "", "expected": { "overall": 7, "fc": 7, "lr": 7, "gra": 6.5, "pron": 7 }, "source": "..." }]
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnv } from '../server/env.ts'
import { readJsonFile, writeJsonFile } from '../server/files.ts'
import { reviewRecording } from '../server/speaking-review/review.ts'
import { readWav } from '../server/speaking-review/stt.ts'
import type { TalkCriterionId, TalkPart } from '../src/types/speakingReview.ts'

const rootDir = path.resolve(import.meta.dirname, '..')
loadEnv(rootDir)

interface CalibrationItem {
  id?: string
  wav: string
  part: TalkPart
  question?: string
  topic?: string
  script?: string
  expected: {
    overall: number
    fc: number
    lr: number
    gra: number
    pron: number
  }
  source?: string
}

const fileArg = process.argv[2] || path.join('cache', 'calibration', 'speaking.json')
const specPath = path.resolve(rootDir, fileArg)
const items = await readJsonFile<CalibrationItem[] | null>(specPath, null)

if (!items?.length) {
  console.error(
    `No calibration items found at ${specPath}.\nCreate ${fileArg} with:\n[\n  { "wav": "cache/calibration/a1.wav", "part": 3, "question": "...", "script": "", "expected": { "overall": 7, "fc": 7, "lr": 7, "gra": 6.5, "pron": 7 }, "source": "..." }\n]`,
  )
  process.exit(1)
}

const KEYS: ('overall' | TalkCriterionId)[] = ['overall', 'fc', 'lr', 'gra', 'pron']
const diffs: Record<'overall' | TalkCriterionId, number[]> = {
  overall: [],
  fc: [],
  lr: [],
  gra: [],
  pron: [],
}

for (let i = 0; i < items.length; i++) {
  const item = items[i]!
  const id = item.id || path.basename(item.wav, path.extname(item.wav)) || `cal-${i + 1}`
  const wavBuf = await readFile(path.resolve(rootDir, item.wav))
  const res = await reviewRecording(
    { rootDir },
    {
      part: item.part,
      question: item.question ?? '',
      topic: item.topic ?? '',
      script: item.script ?? '',
    },
    readWav(wavBuf),
    { id },
  )
  await writeJsonFile(path.join(rootDir, 'cache', 'calibration', 'results', `${id}.json`), res)

  const got = {
    overall: res.overall,
    fc: res.criteria.fc.band,
    lr: res.criteria.lr.band,
    gra: res.criteria.gra.band,
    pron: res.criteria.pron.band,
  }
  for (const k of KEYS) {
    diffs[k].push(got[k] - item.expected[k])
  }
  const pairs = KEYS.map((k) => `${k.toUpperCase()} ${item.expected[k].toFixed(1)}→${got[k].toFixed(1)}`).join(' | ')
  const scoreSec = res.timings?.ai.score ? `${(res.timings.ai.score / 1000).toFixed(1)}s` : '?'
  console.log(`${id} | ${pairs} | score=${scoreSec}`)
}

const round2 = (n: number) => Math.round(n * 100) / 100
console.log('\nSummary (got - expected):')
for (const k of KEYS) {
  const list = diffs[k]
  const mae = list.reduce((s, d) => s + Math.abs(d), 0) / list.length
  const bias = list.reduce((s, d) => s + d, 0) / list.length
  console.log(`  ${k.toUpperCase().padEnd(7)} MAE=${round2(mae).toFixed(2)}  bias=${bias >= 0 ? '+' : ''}${round2(bias).toFixed(2)}`)
}
