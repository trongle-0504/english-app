// Writing Task 1: the chart reading and the model-essay vocabulary started at "Bắt đầu" are shared with the review.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import type { z } from 'zod'
import { parseImages } from '../../server/images.ts'
import type { JsonRequest, LlmProvider } from '../../server/writing-review/llm-types.ts'
import { chartReading, reviewTask1 } from '../../server/writing-review/task1.ts'
import { modelVocabFor, type VerifyPhrase } from '../../server/writing-review/task1-model.ts'
import { addImages, cachedChartRead, saveModelEssay } from '../../server/writing-task1/store.ts'

const root = path.resolve(import.meta.dirname, '..', '..')
const fixture = (name: string) => JSON.parse(readFileSync(path.join(root, 'mocks', 'llm', name), 'utf8'))
const answers: Record<string, unknown> = {
  'task1 chart': fixture('writing-review-task1-chart.json'),
  'task1 score': fixture('writing-review-task1-score.json'),
  'task1 vocab': fixture('writing-review-task1-vocab.json'),
}
const readme = readFileSync(path.join(root, 'mocks', 'samples', 'task1', 'README.md'), 'utf8')
const section = (n: number) => readme.split(`## ${n}.`)[1].split('\n## ')[0].split('\n').slice(1).join('\n').trim()

/** Answers by label after a short delay, so calls overlap. */
function slowLlm() {
  const calls: string[] = []
  const llm: LlmProvider = {
    name: 'fake',
    model: 'fake',
    async json<T>(req: JsonRequest<T>) {
      calls.push(req.label)
      await new Promise((r) => setTimeout(r, 30))
      return { value: (req.schema as z.ZodType<T>).parse(structuredClone(answers[req.label])), model: 'fake', usage: { input: 0, output: 0 } }
    },
  }
  return { llm, calls }
}

function setup() {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'task1-prepare-'))
  const contentDir = path.join(rootDir, 'content')
  mkdirSync(path.join(contentDir, 'practice', 'writing-mock'), { recursive: true })
  writeFileSync(path.join(contentDir, 'practice', 'writing-mock', 'task1-prompts.json'), JSON.stringify([{ id: 'bar-001', prompt: 'The bar chart…', chart_type: 'Bar Chart' }]))
  return { ctx: { rootDir, contentDir }, cleanup: () => rmSync(rootDir, { recursive: true, force: true, maxRetries: 5 }) }
}

test('a review started while the chart is being read waits for that reading (one chart call)', async () => {
  const { ctx, cleanup } = setup()
  try {
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } }).png().toBuffer()
    await addImages(ctx, 'bar-001', parseImages([{ mimeType: 'image/png', data: png.toString('base64') }]))
    const { llm, calls } = slowLlm()
    const early = chartReading(ctx, llm, 'bar-001', 'The bar chart…')
    await reviewTask1(ctx, llm, { promptId: 'bar-001', text: section(4), prompt: 'The bar chart…' })
    await early
    assert.deepEqual(calls.filter((c) => c !== 'task1 figures'), ['task1 chart', 'task1 score'])
    assert.ok(await cachedChartRead(ctx, 'bar-001'))
    assert.equal(calls.filter((c) => c === 'task1 chart').length, 1)
  } finally {
    cleanup()
  }
})

test('no picture: no chart reading', async () => {
  const { ctx, cleanup } = setup()
  try {
    const { llm, calls } = slowLlm()
    assert.equal(await chartReading(ctx, llm, 'bar-001'), undefined)
    assert.deepEqual(calls, [])
  } finally {
    cleanup()
  }
})

test('the model vocabulary picked early is shared and then cached', async () => {
  const { ctx, cleanup } = setup()
  try {
    const model = section(2)
    await saveModelEssay(ctx, 'bar-001', model)
    const verify: VerifyPhrase = async () => ({ verified: true, dictionary: [], sources: [] })
    const { llm, calls } = slowLlm()
    const [a, b] = await Promise.all([
      modelVocabFor(ctx, llm, { promptId: 'bar-001', model }, verify),
      modelVocabFor(ctx, llm, { promptId: 'bar-001', model }, verify),
    ])
    assert.equal(a.length, b.length)
    await modelVocabFor(ctx, llm, { promptId: 'bar-001', model }, verify)
    assert.deepEqual(calls, ['task1 vocab'])
  } finally {
    cleanup()
  }
})
