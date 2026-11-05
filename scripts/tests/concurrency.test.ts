import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runWithConcurrency } from '../../src/lib/concurrency.ts'

test('runs three library additions concurrently', async () => {
  const samples = ['waste the national budget', 'testing centers', 'exam questions']
  let active = 0
  let maximumActive = 0
  const completed: string[] = []

  await runWithConcurrency(samples, 3, async (sample) => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    await new Promise((resolve) => setTimeout(resolve, 10))
    completed.push(sample)
    active -= 1
  })

  assert.equal(maximumActive, 3)
  assert.deepEqual(completed.sort(), samples.sort())
})
