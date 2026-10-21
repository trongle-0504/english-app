// How well a saved result's phrases are found and checked: runs the shared annotation (server/annotate.ts) again on
// the same text — nothing is saved — and compares it with what the result holds: sentences without any marked phrase,
// combinations per sentence, and, for results listed in scripts/annotation-gold.json, how many of the phrases a person
// expects were found. Works for Speaking results (progress/speaking) and Writing reviews (progress/writing-reviews).
// Usage:
//   node scripts/check-annotation.ts <id> [<id> …] [--show]   (--show prints each sentence with its phrases)
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { loadEnv } from '../server/env.ts'
import type { AnswerSegment, AnswerSentence, SpeakingExtra, SpeakingPick, SpeakingResult } from '../src/types/speaking.ts'
import type { WritingReviewResult } from '../src/types/writingReview.ts'

const root = path.join(import.meta.dirname, '..')
loadEnv(root)
const { annotate } = await import('../server/annotate.ts')
const { markSentence } = await import('../server/speaking/suggest.ts')
const { writingReviewModel } = await import('../server/writing-review/llm.ts')

const gold: Record<string, string[]> = JSON.parse(readFileSync(path.join(import.meta.dirname, 'annotation-gold.json'), 'utf8'))
const llm = writingReviewModel()

/** A marked sentence back from its segments: frames in {{ }}, library / outside phrases in [[ ]]; looked-up wording plain. */
const markedOf = (segments: AnswerSegment[]) =>
  segments.map((s) => (s.mark === 'structure' ? `{{${s.text}}}` : s.mark && !s.note ? `[[${s.text}]]` : s.text)).join('')
const marked = (s: AnswerSentence) => s.segments.filter((g) => g.mark && g.mark !== 'structure').map((g) => g.text)
const words = (t: string) => (t.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => w.length > 2).map((w) => w.replace(/(ies|es|s|ed|ing)$/, ''))

function measure(sentences: AnswerSentence[], expected: string[] | undefined) {
  const empty = sentences.map((s, i) => (marked(s).length ? -1 : i + 1)).filter((i) => i > 0)
  const all = sentences.flatMap(marked)
  const found = (g: string) => {
    const want = words(g)
    return all.some((m) => {
      const have = new Set(words(m))
      return m.toLowerCase().includes(g.toLowerCase()) || (want.length > 0 && want.filter((w) => have.has(w)).length / want.length >= 0.6)
    })
  }
  const missing = expected?.filter((g) => !found(g)) ?? []
  const count = (mark: string) => sentences.flatMap((s) => s.segments).filter((g) => g.mark === mark).length
  return {
    marks: `cam ${count('unverified')} · xám ${count('natural')} · đã tra ${count('checked')} · thư viện ${count('library')} · cụm mới ${count('extra')}`,
    empty,
    phrases: all.length,
    perSentence: (all.length / Math.max(1, sentences.length)).toFixed(2),
    recall: expected ? `${expected.length - missing.length}/${expected.length} (${Math.round((100 * (expected.length - missing.length)) / expected.length)}%)` : '-',
    missing,
  }
}

async function check(label: string, item: { sentences: AnswerSentence[]; picks: SpeakingPick[]; extras: SpeakingExtra[] }, learnerText: string[], kind: string, expected?: string[]) {
  const before = measure(item.sentences, expected)
  const started = Date.now()
  const a = await annotate(
    {
      sentences: item.sentences.map((s) => markedOf(s.segments)),
      picks: item.picks,
      keepWrapped: item.extras.map((e) => e.phrase),
      learnerText,
      mode: 'model',
      fix: false,
      kind,
      effort: 'medium',
      label: 'check',
    },
    llm,
  )
  const after = measure(
    item.sentences.map((s, i) => ({ tool: s.tool, segments: markSentence(a.sentences[i], item.extras, [], a.perSentence[i], item.picks, a.note) })),
    expected,
  )
  console.log(`\n=== ${label} (${item.sentences.length} sentences, ${Math.round((Date.now() - started) / 1000)} s)`)
  console.log(`  sentences without a phrase: ${before.empty.length} → ${after.empty.length}   [now: ${after.empty.join(', ') || '-'}]`)
  console.log(`  phrases per sentence:       ${before.perSentence} → ${after.perSentence}`)
  console.log(`  expected phrases found:     ${before.recall} → ${after.recall}`)
  console.log(`  marks before: ${before.marks}`)
  console.log(`  marks after:  ${after.marks}`)
  if (process.argv.includes('--show')) {
    const orange = a.wording.filter((w) => !w.verified && !w.natural)
    console.log(`  still orange: ${orange.map((w) => `${w.text}${w.why ? ` (${w.why})` : ''}`).join(' | ') || '-'}`)
  }
  if (after.missing.length) console.log(`  still missing: ${after.missing.join(' | ')}`)
  console.log(`  report: listed ${a.report.listed}, not placed ${a.report.dropped.length}, scan +${a.report.scanned} (${a.report.fetches} fetches), asked again ${a.report.retried.length}, still empty ${a.report.uncovered.length}`)
  if (a.report.dropped.length) console.log(`  not placed: ${a.report.dropped.join(' | ')}`)
  if (process.argv.includes('--show'))
    for (const [i, s] of a.sentences.entries())
      console.log(`  ${i + 1}. ${markSentence(s, item.extras, [], a.perSentence[i], item.picks, a.note).map((g) => (g.mark && g.mark !== 'structure' ? `[${g.text}]` : g.text)).join('')}`)
}

for (const id of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  const speakingFile = path.join(root, 'progress', 'speaking', `${id}.json`)
  const writingFile = path.join(root, 'progress', 'writing-reviews', `${id}.json`)
  if (existsSync(speakingFile)) {
    const r: SpeakingResult = JSON.parse(readFileSync(speakingFile, 'utf8'))
    for (const [n, answer] of r.answers.entries()) {
      if (!answer.sentences?.length) continue
      await check(
        `speaking ${id} Q${n + 1} (Part ${r.part})`,
        { sentences: answer.sentences, picks: answer.picks, extras: answer.extras },
        [answer.idea ?? ''],
        `an IELTS Speaking Part ${r.part} model answer (natural spoken English)`,
        r.answers.length === 1 ? gold[id] : undefined,
      )
    }
  } else if (existsSync(writingFile)) {
    const r: WritingReviewResult = JSON.parse(readFileSync(writingFile, 'utf8'))
    if (!r.modelEssay) continue
    await check(
      `writing ${id}`,
      { sentences: r.modelEssay.sentences, picks: r.modelEssay.picks, extras: r.modelEssay.extras },
      [r.text, ...(r.correctedSentences ?? [])],
      'an IELTS Writing Task 2 model essay (written English)',
      gold[id],
    )
  } else console.log(`\n${id}: not found`)
}
