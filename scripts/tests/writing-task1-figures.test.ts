// Writing Task 1 figure check (server/writing-review/task1-figures.ts): the model lists, code compares.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { z } from 'zod'
import type { WritingTask1Chart } from '../../src/types/writingReview.ts'
import type { JsonRequest, LlmProvider } from '../../server/writing-review/llm-types.ts'
import { checkFigures, mergeDataErrors, numberOf } from '../../server/writing-review/task1-figures.ts'

// bar-027 (carbon emissions, UK 1990-2010) as the agent read it, and a learner's answer with figures off by 10.
const chart: WritingTask1Chart = {
  kind: 'bar chart',
  subject: 'Carbon emissions from three fossil fuels',
  unit: 'million tons',
  period: '1990 - 2010',
  categories: ['Gas', 'Oil', 'Coal'],
  overview: [],
  keyFeatures: [],
  figures: [
    ['Gas 1990', '≈220'], ['Oil 1990', '≈270'], ['Coal 1990', '≈315'],
    ['Gas 1995', '≈270'], ['Oil 1995', '≈240'], ['Coal 1995', '≈280'],
    ['Gas 2000', '≈220'], ['Oil 2000', '≈270'], ['Coal 2000', '≈315'],
  ].map(([label, v]) => ({ label, value: `${v} million tons` })),
}
const sentences = [
  'In 1990, coal produced approximately 320 million tons of carbon emissions, making it the highest figure among the three fuels.',
  'Oil accounted for 260 million tons, whereas gas generated around 230 million tons.',
  'In 2000, the figures for gas and oil were 220 and 270 million tons respectively, while coal reached 310 million tons.',
  'In 1995, gas emissions increased sharply to 280 million tons, while oil emissions fell down to 230 million tons.',
  'Coal also experienced a slight decrease, reaching 270 million tons.',
]
const claims = [
  { n: 1, quote: '320 million tons', figure: 'Coal 1990', value: 320 },
  { n: 2, quote: '260 million tons', figure: 'Oil 1990', value: 260 },
  { n: 2, quote: '230 million tons', figure: 'Gas 1990', value: 230 },
  { n: 3, quote: '220', figure: 'Gas 2000', value: 220 },
  { n: 3, quote: '270 million tons', figure: 'Oil 2000', value: 270 },
  { n: 3, quote: '310 million tons', figure: 'Coal 2000', value: 310 },
  { n: 4, quote: '280 million tons', figure: 'Gas 1995', value: 280 },
  { n: 4, quote: '230 million tons', figure: 'Oil 1995', value: 230 },
  { n: 5, quote: '270 million tons', figure: 'Coal 1995', value: 270 },
  // Made up by the model: a number the sentence does not have, a label the chart does not have.
  { n: 5, quote: '999', figure: 'Coal 1995', value: 999 },
  { n: 1, quote: '320', figure: 'Coal 1985', value: 320 },
]

function fakeLlm(answer: unknown) {
  const calls: JsonRequest<unknown>[] = []
  const llm: LlmProvider = {
    name: 'fake',
    model: 'fake',
    async json<T>(req: JsonRequest<T>) {
      calls.push(req as JsonRequest<unknown>)
      return { value: (req.schema as z.ZodType<T>).parse(answer), model: 'fake', usage: { input: 0, output: 0 } }
    },
  }
  return { llm, calls }
}

test('numberOf reads the first number of a chart value', () => {
  assert.equal(numberOf('≈270 million tons'), 270)
  assert.equal(numberOf('$40,000'), 40000)
  assert.equal(numberOf('12.5%'), 12.5)
  assert.equal(numberOf('n/a'), undefined)
})

test('figures off by more than the reading allows are data errors; close ones and made-up claims are not', async () => {
  const { llm, calls } = fakeLlm({ claims })
  const errors = await checkFigures(llm, { sentences, chart })
  assert.deepEqual(
    errors.map((e) => [e.sentence, e.quote]),
    [
      [1, '260 million tons'],
      [1, '230 million tons'],
      [3, '280 million tons'],
      [3, '230 million tons'],
      [4, '270 million tons'],
    ],
  )
  assert.match(errors[0].correct, /Oil 1990 = ≈270/)
  // The model sees the labels only, never the values.
  assert.match(calls[0].prompt, /- Coal 1995/)
  assert.doesNotMatch(calls[0].prompt, /≈280/)
})

test('merge keeps the score call errors and adds the checked figures once', () => {
  const fromScore = [{ sentence: 3, quote: 'gas emissions increased sharply to 280 million tons', wrote: 'x', correct: 'y' }]
  const fromCheck = [
    { sentence: 3, quote: '280 million tons', wrote: 'a', correct: 'b' },
    { sentence: 1, quote: '260 million tons', wrote: 'c', correct: 'd' },
  ]
  assert.deepEqual(
    mergeDataErrors(fromScore, fromCheck).map((e) => [e.sentence, e.quote]),
    [
      [1, '260 million tons'],
      [3, 'gas emissions increased sharply to 280 million tons'],
    ],
  )
})
