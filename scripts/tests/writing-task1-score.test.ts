// Writing Task 1 scoring (server/writing-review/task1.ts) with a fake model: cleaning, the chart rule, the cache, fixtures.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import type { z } from 'zod'
import { parseImages } from '../../server/images.ts'
import type { JsonRequest, LlmProvider } from '../../server/writing-review/llm-types.ts'
import { ChartReadSchema, readChart, reviewTask1, scoreTask1, Task1ScoreSchema } from '../../server/writing-review/task1.ts'
import { addImages } from '../../server/writing-task1/store.ts'

const root = path.resolve(import.meta.dirname, '..', '..')
const fixture = (name: string) => JSON.parse(readFileSync(path.join(root, 'mocks', 'llm', name), 'utf8'))
const SCORE = fixture('writing-review-task1-score.json')
const CHART = fixture('writing-review-task1-chart.json')

/** The answer the score fixture was written for (mocks/samples/task1/README.md, section 4). */
const ESSAY = readFileSync(path.join(root, 'mocks', 'samples', 'task1', 'README.md'), 'utf8')
  .split('## 4.')[1]
  .split('\n## ')[0]
  .split('\n')
  .slice(1)
  .join('\n')
  .trim()

/** Answers each call by its label; records the calls. */
function fakeLlm(answers: Record<string, unknown>) {
  const calls: JsonRequest<unknown>[] = []
  const llm: LlmProvider = {
    name: 'fake',
    model: 'fake',
    async json<T>(req: JsonRequest<T>) {
      calls.push(req as JsonRequest<unknown>)
      return { value: (req.schema as z.ZodType<T>).parse(answers[req.label]), model: 'fake-model', usage: { input: 0, output: 0 } }
    },
  }
  return { llm, calls }
}

const picture = { mimeType: 'image/webp', data: 'AAAA' }

test('fixtures: both mock answers match the schemas the calls send', () => {
  assert.doesNotThrow(() => Task1ScoreSchema.parse(SCORE))
  assert.doesNotThrow(() => ChartReadSchema.parse(CHART))
})

test('score with a chart: TA in the tr slot, bands and overall, quotes checked, data errors kept', async () => {
  const { llm, calls } = fakeLlm({ 'task1 score': SCORE })
  const { score, task1 } = await scoreTask1(llm, {
    text: ESSAY,
    prompt: 'The bar chart illustrates the amount of money a company donated…',
    vietnameseText: 'Overview: phúc lợi nhiều nhất…',
    chart: ChartReadSchema.parse(CHART),
    images: [picture],
    skill: 'DOL 3 golden steps',
  })
  assert.deepEqual([score.criteria.tr.band, score.criteria.cc.band, score.criteria.lr.band, score.criteria.gra.band], [6, 7, 6, 6])
  assert.equal(score.overall, 6.5)
  assert.equal(score.reviewer, 'fake-model')
  // Every fixture quote is in the sentence it names: nothing dropped.
  assert.equal(score.criteria.gra.issues.length, 3)
  assert.equal(score.criteria.tr.issues[0].sentence, 6)
  assert.equal(task1.noChart, false)
  assert.equal(task1.dataErrors.length, 1)
  assert.equal(task1.dataErrors[0].sentence, 6)
  assert.equal(task1.overview.status, 'clear')
  assert.ok(task1.ideaCheck?.wrong.length)
  assert.equal(task1.chart?.figures.length, 18)

  const call = calls[0]
  assert.deepEqual(call.images, [picture])
  assert.match(call.prompt, /DOL 3 golden steps/)
  assert.match(call.prompt, /Social welfare 2014 = 50/)
  assert.match(call.prompt, /learner's plan in Vietnamese/)
  assert.match(call.prompt, /\n7\. Environment saw the biggest increase/)
})

test('a quote that is not in its sentence is dropped, for issues and for data errors', async () => {
  const broken = structuredClone(SCORE)
  broken.criteria.lr.issues[0].quote = 'words that are not there'
  broken.dataErrors[0].n = 2
  const { llm } = fakeLlm({ 'task1 score': broken })
  const { score, task1 } = await scoreTask1(llm, { text: ESSAY, images: [picture], skill: '' })
  assert.equal(score.criteria.lr.issues.length, 1)
  assert.equal(task1.dataErrors.length, 0)
})

test('no chart picture: no pictures sent, the prompt says so, data errors are not trusted', async () => {
  const { llm, calls } = fakeLlm({ 'task1 score': SCORE })
  const { task1 } = await scoreTask1(llm, { text: ESSAY, prompt: 'The bar chart…', images: [], skill: '' })
  assert.equal(calls[0].images, undefined)
  assert.match(calls[0].prompt, /No chart picture was given/)
  assert.equal(task1.noChart, true)
  assert.deepEqual(task1.dataErrors, [])
  assert.equal(task1.chart, undefined)
})

test('no Vietnamese plan: no idea check, and the prompt says to leave it empty', async () => {
  const { llm, calls } = fakeLlm({ 'task1 score': SCORE })
  const { task1 } = await scoreTask1(llm, { text: ESSAY, images: [picture], skill: '' })
  assert.equal(task1.ideaCheck, undefined)
  assert.match(calls[0].prompt, /wrote no Vietnamese plan/)
})

test('chart reading: pictures sent, lists trimmed and capped', async () => {
  const long = { ...CHART, overview: [' a ', 'b', 'c', 'd'], keyFeatures: Array.from({ length: 9 }, (_, i) => `k${i}`) }
  const { llm, calls } = fakeLlm({ 'task1 chart': long })
  const chart = await readChart(llm, [picture], 'The bar chart…')
  assert.deepEqual(chart.overview, ['a', 'b', 'c'])
  assert.equal(chart.keyFeatures.length, 6)
  assert.deepEqual(calls[0].images, [picture])
})

test('a review reads the chart once per set of pictures (cached in the store)', async () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'task1-score-'))
  const contentDir = path.join(rootDir, 'content')
  try {
    mkdirSync(path.join(contentDir, 'practice', 'writing-mock'), { recursive: true })
    writeFileSync(
      path.join(contentDir, 'practice', 'writing-mock', 'task1-prompts.json'),
      JSON.stringify([{ id: 'bar-001', prompt: 'The bar chart…', chart_type: 'Bar Chart' }]),
    )
    const ctx = { rootDir, contentDir }
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } }).png().toBuffer()
    await addImages(ctx, 'bar-001', parseImages([{ mimeType: 'image/png', data: png.toString('base64') }]))

    const { llm, calls } = fakeLlm({ 'task1 chart': CHART, 'task1 score': SCORE })
    const input = { promptId: 'bar-001', text: ESSAY, prompt: 'The bar chart…' }
    await reviewTask1(ctx, llm, input)
    await reviewTask1(ctx, llm, input)
    // The figure check (task1-figures.ts) runs beside each score; it is tested on its own.
    const scoring = calls.filter((c) => c.label !== 'task1 figures')
    assert.deepEqual(
      scoring.map((c) => c.label),
      ['task1 chart', 'task1 score', 'task1 score'],
    )
    assert.equal(scoring[1].images?.[0].mimeType, 'image/webp')
  } finally {
    rmSync(rootDir, { recursive: true, force: true, maxRetries: 5 })
  }
})
