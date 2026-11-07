// Re-runs the speaking review pipeline on saved recordings in progress/speaking-reviews/ without overwriting them.
// Usage: node scripts/rereview-speaking.ts <id> [<id>...] [--script-from-saved]
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnv } from '../server/env.ts'
import { readJsonFile, writeJsonFile } from '../server/files.ts'
import { reviewRecording, type Input } from '../server/speaking-review/review.ts'
import { readWav } from '../server/speaking-review/stt.ts'
import type { TalkReviewResult } from '../src/types/speakingReview.ts'

const rootDir = path.resolve(import.meta.dirname, '..')
loadEnv(rootDir)

const args = process.argv.slice(2)
const scriptFromSaved = args.includes('--script-from-saved')
const ids = args.filter((a) => !a.startsWith('--'))

if (!ids.length) {
  console.error('Usage: node scripts/rereview-speaking.ts <id> [<id>...] [--script-from-saved]')
  process.exit(1)
}

const fmtBands = (r: TalkReviewResult) =>
  `FC:${r.criteria.fc.band} LR:${r.criteria.lr.band} GRA:${r.criteria.gra.band} PRON:${r.criteria.pron.band}`

for (const rawId of ids) {
  const id = rawId.replace(/\.json$/, '')
  const jsonPath = path.join(rootDir, 'progress', 'speaking-reviews', `${id}.json`)
  const wavPath = path.join(rootDir, 'progress', 'speaking-reviews', `${id}.wav`)
  const saved = await readJsonFile<TalkReviewResult | null>(jsonPath, null)
  if (!saved) {
    console.error(`${id} | missing ${jsonPath}`)
    continue
  }
  const wav = await readFile(wavPath)
  const input: Input = {
    part: saved.part,
    question: saved.question ?? '',
    topic: saved.topic ?? '',
    script: scriptFromSaved ? (saved.script || saved.corrected || '') : (saved.script ?? ''),
    ...(saved.source ? { source: saved.source } : {}),
  }

  let droppedEdits = 0
  const next = await reviewRecording({ rootDir }, input, readWav(wav), {
    id,
    onStats: (s) => {
      droppedEdits = s.droppedEdits
    },
  })
  const outPath = path.join(rootDir, 'cache', 'rereview', `${id}.json`)
  await writeJsonFile(outPath, next)

  const t = next.timings
  const aiSummary = t
    ? Object.entries(t.ai)
        .map(([k, v]) => `${k}=${Math.round(v / 100) / 10}s`)
        .join(',')
    : ''
  const matchInfo =
    saved.comparison || next.comparison
      ? ` | match ${saved.comparison?.match ?? '-'}% → ${next.comparison?.match ?? '-'}%`
      : ''
  console.log(
    `${id} | ${saved.overall.toFixed(1)} → ${next.overall.toFixed(1)} | ${fmtBands(saved)} → ${fmtBands(next)} | fixes ${saved.fixes.length}→${next.fixes.length} (dropped ${droppedEdits})${matchInfo} | total=${t ? (t.total / 1000).toFixed(1) : '?'}s (stt=${t ? (t.transcribe / 1000).toFixed(1) : '?'}s ai=[${aiSummary}] dict=${t ? (t.dictionary / 1000).toFixed(1) : '?'}s)`,
  )
}
