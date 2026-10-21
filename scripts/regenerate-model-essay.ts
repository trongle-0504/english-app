// Writes the model essay of a saved writing review again (same corrected draft, library candidates and DOL entries) and prints it
// with its marks and the unlisted wording that was replaced; --save stores it in the review. Usage:
//   node scripts/regenerate-model-essay.ts <review id> [--save]
import path from 'node:path'
import { loadEnv } from '../server/env.ts'
import type { WritingReviewResult } from '../src/types/writingReview.ts'

const root = path.join(import.meta.dirname, '..')
loadEnv(root)
const { readJsonFile, writeJsonFile } = await import('../server/files.ts')
const { writingReviewModel } = await import('../server/writing-review/llm.ts')
const { writingLinearGuide, generateWritingModelEssay } = await import('../server/writing-review/writing-essay.ts')

const id = process.argv[2]
if (!id) throw new Error('Usage: node scripts/regenerate-model-essay.ts <review id> [--save]')
const file = path.join(root, 'progress', 'writing-reviews', `${id}.json`)
const result = await readJsonFile<WritingReviewResult | null>(file, null)
if (!result) throw new Error(`No review ${id}`)

const candidates = (result.suggestedPhrases ?? []).map((c) => ({
  id: c.cardId,
  term: c.term,
  meaning_vi: c.meaning_vi,
  origin: c.origin,
  example: c.example,
  isTopicCollocation: true,
}))
const { dolRefs: _, unlistedFixes, reviewEdits, plan, ...essay } = await generateWritingModelEssay(
  {
    text: result.text,
    vietnameseText: result.vietnameseText,
    correctedSentences: result.correctedSentences,
    candidates,
    guide: await writingLinearGuide({ rootDir: root }),
    dolHints: result.dolHints ?? [],
    onStep: (step) => console.log(`… ${step}`),
  },
  writingReviewModel(),
)

console.log('Plan:')
for (const d of plan.draft) console.log(`  ${d.n}. [${d.verdict}] ${d.problems}`)
console.log(`Develop: ${plan.develop.join(' | ') || '-'}\nPicks: ${plan.picks.map((p) => p.ref).join(', ') || '-'}\n`)
const MARK = { library: 'LIB', extra: 'NEW', unverified: '??', checked: 'OK', natural: 'NAT', structure: '' } as const
for (const s of essay.sentences) {
  console.log(s.segments.map((g) => (g.mark && g.mark !== 'structure' ? `[${MARK[g.mark]}: ${g.text}]` : g.text)).join(''))
}
console.log('\nExaminer review edits:')
for (const e of reviewEdits) console.log(`  [${e.kind}] "${e.original}" → "${e.replacement}" — ${e.why}`)
console.log('\nReplaced (not in Longman / OZDIC):')
for (const f of unlistedFixes) console.log(`  "${f.original}" → "${f.replacement}" (${f.source})`)
const empty = essay.sentences.map((s, i) => (s.segments.some((g) => g.mark && g.mark !== 'structure') ? 0 : i + 1)).filter(Boolean)
const phrases = essay.sentences.flatMap((s) => s.segments.filter((g) => g.mark && g.mark !== 'structure'))
console.log(`${essay.sentences.length} sentences, ${phrases.length} phrases (${(phrases.length / Math.max(1, essay.sentences.length)).toFixed(2)}/sentence), without any: ${empty.join(', ') || '-'}`)
if (essay.coverage) console.log(`coverage: listed ${essay.coverage.listed}, not placed ${essay.coverage.dropped.length}, scan +${essay.coverage.scanned}, asked again ${essay.coverage.retried.length}`)
console.log(`Still unconfirmed: ${essay.wording.filter((w) => !w.verified).map((w) => w.text).join(', ') || '(none)'}`)

if (process.argv.includes('--save')) {
  result.modelEssay = essay
  await writeJsonFile(file, result)
  console.log(`\nSaved to ${file}`)
}
