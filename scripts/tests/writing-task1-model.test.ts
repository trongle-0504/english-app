// Writing Task 1 ↔ the learner's model essay (server/writing-review/task1-model.ts) with a fake model and dictionary.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { z } from 'zod'
import type { JsonRequest, LlmProvider } from '../../server/writing-review/llm-types.ts'
import {
  compareWithModel,
  CompareSchema,
  modelVocabulary,
  ModelVocabSchema,
  task1ModelLesson,
  usedIn,
  type VerifyPhrase,
} from '../../server/writing-review/task1-model.ts'
import { saveModelEssay } from '../../server/writing-task1/store.ts'

const root = path.resolve(import.meta.dirname, '..', '..')
const fixture = (name: string) => JSON.parse(readFileSync(path.join(root, 'mocks', 'llm', name), 'utf8'))
const COMPARE = fixture('writing-review-task1-compare.json')
const VOCAB = fixture('writing-review-task1-vocab.json')

const readme = readFileSync(path.join(root, 'mocks', 'samples', 'task1', 'README.md'), 'utf8')
const section = (n: number) => readme.split(`## ${n}.`)[1].split('\n## ')[0].split('\n').slice(1).join('\n').trim()
const MODEL = section(2)
const ANSWER = section(4)

function fakeLlm(answers: Record<string, unknown>) {
  const calls: string[] = []
  const llm: LlmProvider = {
    name: 'fake',
    model: 'fake',
    async json<T>(req: JsonRequest<T>) {
      calls.push(req.label)
      return { value: (req.schema as z.ZodType<T>).parse(structuredClone(answers[req.label])), model: 'fake', usage: { input: 0, output: 0 } }
    },
  }
  return { llm, calls }
}

/** Confirms everything but phrases with "sums" in them. */
const fakeVerify: VerifyPhrase = async (phrase) =>
  phrase.includes('sums')
    ? { verified: false, dictionary: [], sources: [] }
    : { verified: true, dictionary: [`${phrase} (Longman)`], sources: [{ name: 'Longman', url: 'https://www.ldoceonline.com/' }] }

test('fixtures: both mock answers match their schemas', () => {
  assert.doesNotThrow(() => CompareSchema.parse(COMPARE))
  assert.doesNotThrow(() => ModelVocabSchema.parse(VOCAB))
})

test('usedIn: the phrase words in a row, ignoring case and punctuation', () => {
  assert.equal(usedIn('followed by', 'which was Followed, by health'), true)
  assert.equal(usedIn('topped the list', 'the list was topped'), false)
  assert.equal(usedIn('', 'anything'), false)
})

test('comparison: every fixture point quotes both essays; a made-up model quote is dropped, a wrong "yours" emptied', async () => {
  const { llm } = fakeLlm({ 'task1 compare': COMPARE })
  const full = await compareWithModel(llm, { text: ANSWER, model: MODEL, skill: '' })
  assert.equal(full.points.length, 6)
  assert.ok(full.points.every((p) => p.yours))

  const broken = structuredClone(COMPARE)
  broken.points[0].model = 'a sentence the model essay never had'
  broken.points[1].yours = 'words the learner never wrote'
  const { llm: llm2 } = fakeLlm({ 'task1 compare': broken })
  const cleaned = await compareWithModel(llm2, { text: ANSWER, model: MODEL, skill: '' })
  assert.equal(cleaned.points.length, 5)
  assert.equal(cleaned.points[0].area, 'overview')
  assert.equal(cleaned.points[0].yours, '')
})

test('vocabulary: phrases must be in the model essay; examples fall back to its sentence; each one checked', async () => {
  const withFake = structuredClone(VOCAB)
  withFake.items.push({ phrase: 'skyrocketed dramatically', category: 'trend', meaning_vi: 'x', example: 'x', checks: [] })
  withFake.items[1].example = 'not in the essay'
  const { llm } = fakeLlm({ 'task1 vocab': withFake })
  const items = await modelVocabulary(llm, { model: MODEL }, fakeVerify)
  assert.equal(items.length, 12)
  assert.ok(!items.some((i) => i.phrase === 'skyrocketed dramatically'))
  assert.match(items[1].example, /^Overall, social welfare received by far/)
  assert.equal(items.find((i) => i.phrase === 'far smaller sums')?.verified, false)
  assert.equal(items.find((i) => i.phrase === 'climbed steadily')?.verified, true)
})

test('lesson: none without a model essay; with one, the vocabulary is cached per essay and "used" follows the answer', async () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'task1-model-'))
  const contentDir = path.join(rootDir, 'content')
  try {
    mkdirSync(path.join(contentDir, 'practice', 'writing-mock'), { recursive: true })
    writeFileSync(
      path.join(contentDir, 'practice', 'writing-mock', 'task1-prompts.json'),
      JSON.stringify([{ id: 'bar-001', prompt: 'The bar chart…', chart_type: 'Bar Chart' }]),
    )
    const ctx = { rootDir, contentDir }
    const { llm, calls } = fakeLlm({ 'task1 compare': COMPARE, 'task1 vocab': VOCAB })
    const input = { promptId: 'bar-001', text: ANSWER, prompt: 'The bar chart…' }

    assert.equal(await task1ModelLesson(ctx, llm, input, fakeVerify), undefined)
    assert.deepEqual(calls, [])

    await saveModelEssay(ctx, 'bar-001', MODEL)
    const first = await task1ModelLesson(ctx, llm, input, fakeVerify)
    assert.equal(first?.comparison?.points.length, 6)
    assert.equal(first?.vocab.length, 12)
    assert.deepEqual(
      first?.vocab.filter((v) => v.used).map((v) => v.phrase),
      ['followed by', 'respectively'],
    )
    assert.ok((first?.modelWords ?? 0) > 150)

    // Another answer: the comparison runs again, the vocabulary comes from the cache.
    const second = await task1ModelLesson(ctx, llm, { ...input, text: 'Social welfare climbed steadily.' }, fakeVerify)
    assert.deepEqual(calls.sort(), ['task1 compare', 'task1 compare', 'task1 vocab'])
    assert.deepEqual(
      second?.vocab.filter((v) => v.used).map((v) => v.phrase),
      ['climbed steadily'],
    )

    // A new model essay: its vocabulary is taken again.
    await saveModelEssay(ctx, 'bar-001', `${MODEL}\n\nThe end.`)
    await task1ModelLesson(ctx, llm, input, fakeVerify)
    assert.equal(calls.filter((c) => c === 'task1 vocab').length, 2)
  } finally {
    rmSync(rootDir, { recursive: true, force: true, maxRetries: 5 })
  }
})
