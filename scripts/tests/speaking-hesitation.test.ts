import assert from 'node:assert/strict'
import test from 'node:test'
import { hesitationSpots } from '../../server/speaking-review/fluency.ts'
import type { TalkWord } from '../../src/types/speakingReview.ts'

test('silence between sentences is ignored; silence inside a sentence is kept with right sentence index', () => {
  const sentences = ['I really like cities.', 'However housing is expensive there.']
  const words: TalkWord[] = [
    { w: 'I', start: 0.0, end: 0.2, conf: 1 },
    { w: 'really', start: 0.25, end: 0.6, conf: 1 },
    { w: 'like', start: 0.65, end: 0.9, conf: 1 },
    { w: 'cities.', start: 0.95, end: 1.4, conf: 1 },
    // 1.5 s pause between sentence 1 and sentence 2 -> must NOT be a hesitation spot
    { w: 'However', start: 2.9, end: 3.3, conf: 1 },
    { w: 'housing', start: 3.35, end: 3.8, conf: 1 },
    // 1.2 s pause inside sentence 2 -> MUST be a hesitation spot in sentence index 1
    { w: 'is', start: 5.0, end: 5.2, conf: 1 },
    { w: 'expensive', start: 5.25, end: 5.8, conf: 1 },
    { w: 'there.', start: 5.85, end: 6.2, conf: 1 },
  ]

  const spots = hesitationSpots(words, sentences)
  assert.equal(spots.length, 1)
  assert.deepEqual(spots[0], {
    ref: 'H1',
    sentence: 1,
    before: 'housing',
    after: 'is',
    seconds: 1.2,
    start: 3.8,
    end: 5.0,
  })
})

test('keeps the max longest hesitations and numbers refs H1.. in time order', () => {
  const sentences = ['One two three four five.']
  const words: TalkWord[] = [
    { w: 'One', start: 0.0, end: 0.3, conf: 1 },
    // gap 1: 0.9 s (shortest -> should be dropped when max=2)
    { w: 'two', start: 1.2, end: 1.5, conf: 1 },
    // gap 2: 2.1 s (longest)
    { w: 'three', start: 3.6, end: 4.0, conf: 1 },
    // gap 3: 1.4 s (second longest)
    { w: 'four', start: 5.4, end: 5.7, conf: 1 },
    // gap 4: 0.5 s (< 0.8 s, not a hesitation)
    { w: 'five.', start: 6.2, end: 6.6, conf: 1 },
  ]

  const spots = hesitationSpots(words, sentences, 2)
  assert.equal(spots.length, 2)
  assert.equal(spots[0]!.ref, 'H1')
  assert.equal(spots[0]!.before, 'two')
  assert.equal(spots[0]!.after, 'three')
  assert.equal(spots[0]!.seconds, 2.1)

  assert.equal(spots[1]!.ref, 'H2')
  assert.equal(spots[1]!.before, 'three')
  assert.equal(spots[1]!.after, 'four')
  assert.equal(spots[1]!.seconds, 1.4)
})
