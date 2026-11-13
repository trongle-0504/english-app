// The AI slot queue is shared fairly between accounts (round-robin): a second account waits for at most one task of the
// first, never for its whole batch.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inSlotForTests } from '../../server/llm/antigravity-cli.ts'
import { requestUser } from '../../server/users/context.ts'

test('one slot, A queues 3 tasks then B 1: B starts after at most one more of A', async () => {
  process.env.ANTIGRAVITY_PARALLEL = '1'
  const started: string[] = []
  const task = (name: string) => () =>
    new Promise<{ name: string }>((resolve) => {
      started.push(name)
      setTimeout(() => resolve({ name }), 20)
    })
  const as = (id: string, name: string) => requestUser.run({ id, role: 'learner' }, () => inSlotForTests(task(name)))
  const all = [as('user-aaaa-1', 'A1'), as('user-aaaa-1', 'A2'), as('user-aaaa-1', 'A3'), as('user-bbbb-2', 'B1')]
  await Promise.all(all)
  assert.deepEqual(started, ['A1', 'A2', 'B1', 'A3'])
  delete process.env.ANTIGRAVITY_PARALLEL
})
