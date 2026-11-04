import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { classifyWritingReview } from '../server/writing-review/service.ts'
import { writingReviewModel } from '../server/writing-review/llm.ts'
import type { WritingReviewResult } from '../src/types/writingReview.ts'

const root = process.cwd()
const dir = path.join(root, 'progress', 'writing-reviews')
const files = (await readdir(dir)).filter((file) => file.endsWith('.json'))
const llm = writingReviewModel()
let updated = 0
let skipped = 0

for (const file of files) {
  const filePath = path.join(dir, file)
  const review = JSON.parse(await readFile(filePath, 'utf8')) as WritingReviewResult
  if (review.topic && review.questionType) {
    skipped++
    continue
  }
  const classification = await classifyWritingReview(llm, review.text, review.prompt)
  await writeFile(
    filePath,
    JSON.stringify({ ...review, ...classification }, null, 1),
  )
  updated++
  console.log(`[writing-review] classified ${file}: ${classification.topic} / ${classification.questionType}`)
}

console.log(`[writing-review] classification complete: ${updated} updated, ${skipped} already classified`)
