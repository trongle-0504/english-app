// Admin → Generate after the change: background picture / practice jobs, and the nightly drills batch (no AI: the
// batch's AI call is replaced; content lives in a scratch folder).
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getGenerateJob, retryGeneratePart, settled, startGenerateJob } from '../../server/admin/generate-jobs.ts'
import {
  BATCH_SIZE,
  batchPrompt,
  drillFields,
  drillsForItem,
  drillsStatus,
  missingDrills,
  pendingItems,
  runDue,
  runNightlyDrills,
  setDrillsGeneratorForTests,
} from '../../server/admin/drills-nightly.ts'

/* ───────────── Background jobs ───────────── */

test('picture and practice run side by side; each result is kept, a failure does not touch the other', async () => {
  const order: string[] = []
  const job = startGenerateJob('vocabulary', 'decision', {
    image: async () => {
      order.push('image start')
      await new Promise((r) => setTimeout(r, 30))
      order.push('image end')
      return { entry: { word: 'decision', image: '/vocab-images/decision.webp' } }
    },
    practice: async () => {
      order.push('practice start')
      throw new Error('no distractors')
    },
  })!
  assert.equal(job.parts.image?.status, 'running')
  assert.equal(job.parts.practice?.status, 'running')
  await settled(job)
  assert.deepEqual(order.slice(0, 2).sort(), ['image start', 'practice start'], 'both started before either finished')
  assert.equal(job.parts.image?.status, 'done')
  assert.deepEqual(job.parts.image?.result, { entry: { word: 'decision', image: '/vocab-images/decision.webp' } })
  assert.equal(job.parts.practice?.status, 'error')
  assert.equal(job.parts.practice?.error, 'no distractors')
  assert.equal(getGenerateJob(job.id), job)
})

test('a part that finds nothing to do is "skipped"; a failed part can be retried', async () => {
  let attempts = 0
  const job = startGenerateJob('note', 'take sth for granted', {
    image: async () => {
      attempts++
      if (attempts === 1) throw new Error('timeout')
      return null
    },
  })!
  await settled(job)
  assert.equal(job.parts.image?.status, 'error')
  retryGeneratePart(job.id, 'image')
  await settled(job)
  assert.equal(job.parts.image?.status, 'skipped')
  assert.equal(attempts, 2)
  assert.equal(startGenerateJob('note', 'x', {}), undefined, 'nothing to run: no job')
})

/* ───────────── Nightly drills: pure parts ───────────── */

const drilled = { use_prompts: [], dictation: [], paraphrase: [] }

test('missing drills = a drill field is absent; [] written by the batch counts as done', () => {
  assert.equal(missingDrills({ word: 'a' }), true)
  assert.equal(missingDrills({ word: 'a', use_prompts: [], dictation: [] }), true)
  assert.equal(missingDrills({ word: 'a', ...drilled }), false)
  const words = [{ word: 'Old', ...drilled }, { word: 'new' }, { word: 'dup' }, { word: 'DUP', ...drilled }]
  const notes = [{ id: 'n1', title: 'N1' }, { id: 'n2', title: 'N2', ...drilled }]
  assert.deepEqual(pendingItems(words, notes), [
    { kind: 'word', key: 'new', title: 'new' },
    { kind: 'note', key: 'n1', title: 'N1' },
  ])
})

test('the run is due from 03:00 VN once a day, and catches up later the same day', () => {
  // 02:59 VN = 19:59 UTC the day before.
  assert.equal(runDue(new Date('2026-11-12T19:59:00Z'), '2026-11-12'), false)
  assert.equal(runDue(new Date('2026-11-12T20:00:00Z'), '2026-11-12'), true)
  assert.equal(runDue(new Date('2026-11-12T20:00:00Z'), '2026-11-13'), false)
  // Machine off at 03:00, server up at 10:00: catch up.
  assert.equal(runDue(new Date('2026-11-13T03:00:00Z'), '2026-11-12'), true)
  assert.equal(runDue(new Date('2026-11-13T03:00:00Z'), undefined), true)
})

test('answers are cleaned like before: unknown targets dropped, missing fields written as []', () => {
  const entry = { word: 'decision', collocations: [{ text: 'make a decision' }] }
  const fields = drillFields('word', entry, {
    use_prompts: [{ context: 'Work', question: 'How do you choose?', fits: ['Make a decision', 'invented'] }],
    dictation: [{ target: 'decision', text: 'It was a hard **decision**.' }, { target: 'nothing', text: 'x' }],
  })
  assert.deepEqual(fields, {
    use_prompts: [{ context: 'Work', question: 'How do you choose?', fits: ['make a decision'] }],
    dictation: [{ target: 'decision', text: 'It was a hard decision.' }],
    paraphrase: [],
  })
  assert.equal(drillFields('word', entry, { dictation: [{ target: 'nope', text: 'x' }] }), null, 'nothing usable: left for the next run')
  assert.match(batchPrompt('note', [{ id: 'n1', title: 'take sth for granted', patterns: [{ pattern: 'take it for granted that' }] }]), /key: n1[\s\S]*pattern: take it for granted that/)
})

/* ───────────── Nightly drills: running against files ───────────── */

function contentRoot(words: unknown[], notes: unknown[]) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'drills-nightly-'))
  mkdirSync(path.join(root, 'content', 'vocabulary'), { recursive: true })
  mkdirSync(path.join(root, 'content', 'note'), { recursive: true })
  writeFileSync(path.join(root, 'content', 'vocabulary', 'words.json'), JSON.stringify(words))
  writeFileSync(path.join(root, 'content', 'note', 'notes.json'), JSON.stringify(notes))
  const read = (file: 'words' | 'notes') =>
    JSON.parse(readFileSync(path.join(root, 'content', file === 'words' ? 'vocabulary/words.json' : 'note/notes.json'), 'utf8')) as Record<string, unknown>[]
  return { ctx: { rootDir: root, contentDir: path.join(root, 'content') }, read, root }
}

const answer = (item: string) => ({ use_prompts: [{ context: 'Work', question: 'Q?', fits: [] }], dictation: [{ target: item, text: `A ${item} sentence.` }], paraphrase: [] })

test('the nightly run batches 5 entries per AI call, writes only drill fields, skips deleted entries and keeps admin edits', async () => {
  const words = Array.from({ length: 7 }, (_, i) => ({ word: `w${i}`, senses: [{ definition_vi: 'nghĩa' }] }))
  const { ctx, read, root } = contentRoot([...words, { word: 'done', ...drilled, senses: [] }], [{ id: 'n1', title: 'N one', patterns: [] }])
  const calls: { label: string; keys: string[] }[] = []
  setDrillsGeneratorForTests(async (_ctx, label, options) => {
    const keys = [...options.prompt.matchAll(/--- key: (.+)/g)].map((m) => m[1])
    calls.push({ label, keys })
    if (keys.includes('w0')) {
      // While the call runs the admin deletes w1 and edits w2's senses.
      const list = read('words').filter((w) => w.word !== 'w1')
      list.find((w) => w.word === 'w2')!.senses = [{ definition_vi: 'sửa tay' }]
      writeFileSync(path.join(root, 'content', 'vocabulary', 'words.json'), JSON.stringify(list))
    }
    // w3 is left out of the answer: it stays pending for the next run.
    return { value: { items: keys.filter((k) => k !== 'w3').map((k) => ({ key: k, ...answer(k === 'n1' ? 'N one' : k) })) }, model: 'fake' } as never
  })
  const run = await runNightlyDrills(ctx, 'schedule')
  setDrillsGeneratorForTests()
  assert.equal(run.items, 8)
  assert.deepEqual(calls.map((c) => c.keys.length), [BATCH_SIZE, 2, 1])
  assert.ok(calls.every((c) => c.label === 'drills: nightly'))
  assert.deepEqual(run.failed.map((f) => f.key), ['w3'])
  const after = read('words')
  assert.equal(after.find((w) => w.word === 'w1'), undefined, 'a deleted entry is not brought back')
  assert.deepEqual(after.find((w) => w.word === 'w2')!.senses, [{ definition_vi: 'sửa tay' }], 'the admin edit is kept')
  assert.deepEqual(after.find((w) => w.word === 'w2')!.dictation, [{ target: 'w2', text: 'A w2 sentence.' }])
  assert.equal(missingDrills(after.find((w) => w.word === 'w3')), true)
  assert.deepEqual(read('notes')[0].dictation, [{ target: 'N one', text: 'A N one sentence.' }])
  const status = await drillsStatus(ctx)
  assert.equal(status.pending.words, 1)
  assert.equal(status.lastRun?.written, 6, 'the deleted entry is not counted')
  assert.equal(status.lastRunDay !== null, true)
})

test('"Tạo drills ngay" writes one entry at once; an entry that already has drills is not sent', async () => {
  const { ctx, read } = contentRoot([{ word: 'Habit', senses: [] }, { word: 'routine', ...drilled }], [])
  let sent = 0
  setDrillsGeneratorForTests(async (_ctx, label) => {
    sent++
    assert.equal(label, 'drills: Habit')
    return { value: { items: [{ key: 'habit', ...answer('Habit') }] }, model: 'fake' } as never
  })
  const entry = await drillsForItem(ctx, 'word', 'habit')
  assert.deepEqual(entry.dictation, [{ target: 'Habit', text: 'A Habit sentence.' }])
  await drillsForItem(ctx, 'word', 'routine')
  setDrillsGeneratorForTests()
  assert.equal(sent, 1)
  assert.equal(missingDrills(read('words')[0]), false)
  await assert.rejects(drillsForItem(ctx, 'note', 'missing'), /No note/)
})
