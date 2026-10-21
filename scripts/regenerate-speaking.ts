// Runs a saved Speaking result's questions again (same topic, part, ideas and engine) through the whole suggestion
// flow and prints each answer with its phrases and how they were found; nothing is saved unless --save, which writes
// the run as a new result next to the old one. Usage:
//   node scripts/regenerate-speaking.ts <result id> [--save]
import path from 'node:path'
import { loadEnv } from '../server/env.ts'
import type { SpeakingResult } from '../src/types/speaking.ts'

const root = path.join(import.meta.dirname, '..')
loadEnv(root)
const { readJsonFile, writeJsonFile } = await import('../server/files.ts')
const { suggestOnce } = await import('../server/speaking/suggest.ts')

const id = process.argv[2]
if (!id) throw new Error('Usage: node scripts/regenerate-speaking.ts <result id> [--save]')
const ctx = { rootDir: root, contentDir: path.join(root, 'content'), onContentChange() {} }
const old = await readJsonFile<SpeakingResult | null>(path.join(root, 'progress', 'speaking', `${id}.json`), null)
if (!old) throw new Error(`No result ${id}`)

const started = Date.now()
const result = await suggestOnce(ctx as never, {
  topic: old.topic,
  part: old.part,
  mode: old.mode ?? 'answer',
  engine: old.engine,
  questions: old.answers.map((a) => ({ question: a.question, ...(a.idea ? { idea: a.idea } : {}) })),
})
console.log(`${Math.round((Date.now() - started) / 1000)} s`)
for (const a of result.answers) {
  const sentences = a.sentences ?? []
  const empty = sentences.map((s, i) => (s.segments.some((g) => g.mark && g.mark !== 'structure') ? 0 : i + 1)).filter(Boolean)
  const phrases = sentences.flatMap((s) => s.segments.filter((g) => g.mark && g.mark !== 'structure'))
  console.log(`\n=== ${a.question.split('\n')[0]}`)
  for (const [i, s] of sentences.entries()) {
    console.log(`  ${i + 1}. [${s.tool}] ${s.segments.map((g) => (g.mark && g.mark !== 'structure' ? `[${g.mark === 'unverified' ? '?' : ''}${g.text}]` : g.text)).join('')}`)
  }
  console.log(`  ${sentences.length} sentences, ${phrases.length} phrases (${(phrases.length / Math.max(1, sentences.length)).toFixed(2)}/sentence), without any: ${empty.join(', ') || '-'}`)
  console.log(`  orange (suspicious): ${phrases.filter((g) => g.mark === 'unverified').map((g) => g.text).join(' | ') || '-'}`)
  console.log(`  grey (natural, not listed): ${phrases.filter((g) => g.mark === 'natural').length}`)
  console.log(`  polish: ${(a.polish ?? []).map((p) => `"${p.original}" → "${p.replacement}"`).join(' | ') || '-'}`)
  if (a.coverage) console.log(`  coverage: listed ${a.coverage.listed}, not placed ${a.coverage.dropped.length}, scan +${a.coverage.scanned}, asked again ${a.coverage.retried.length}`)
}
if (process.argv.includes('--save')) {
  const newId = `${Date.now().toString(36)}-regen`
  await writeJsonFile(path.join(root, 'progress', 'speaking', `${newId}.json`), { ...result, id: newId })
  console.log(`\nSaved as ${newId}`)
}
