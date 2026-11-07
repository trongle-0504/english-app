import assert from 'node:assert/strict'
import test from 'node:test'
import { changedSpans, filterRestoredEdits } from '../../server/speaking-review/restoredSpans.ts'
import { locate } from '../../server/writing-review/rewrite.ts'

test('no restoration: changedSpans is empty and nothing is dropped', () => {
  const heard = ['I very like living in big city because it have many job.']
  const restored = ['I very like living in big city because it have many job.']
  assert.deepEqual(changedSpans(heard[0]!, restored[0]!), [])

  const edits = [
    { sentence: 1, original: 'very like', replacement: 'really like' },
    { sentence: 1, original: 'it have many job', replacement: 'it has many jobs' },
  ]
  const res = filterRestoredEdits(heard, restored, edits)
  assert.equal(res.dropped, 0)
  assert.equal(res.kept.length, 2)
})

test('edit overlapping a restored word is dropped; edit elsewhere in the same sentence is kept and located in restored text', () => {
  const heard = ['I always look up words in the effort dictionary when I study at the library every days.']
  const restored = ['I always look up words in the Oxford dictionary when I study at the library every days.']

  const spans = changedSpans(heard[0]!, restored[0]!)
  assert.equal(spans.length, 1)
  assert.equal(heard[0]!.slice(spans[0]!.start, spans[0]!.end), 'effort')

  const edits = [
    // Overlaps the misheard word "effort" -> must be dropped
    { sentence: 1, original: 'effort dictionary', replacement: 'online dictionary' },
    // Elsewhere in the same restored sentence -> must be kept and located in restored[0]
    { sentence: 1, original: 'every days', replacement: 'every day' },
  ]
  const res = filterRestoredEdits(heard, restored, edits)
  assert.equal(res.dropped, 1)
  assert.equal(res.kept.length, 1)
  assert.equal(res.kept[0]!.original, 'every days')
  assert.ok(locate(restored[0]!, res.kept[0]!.original) >= 0)
})
