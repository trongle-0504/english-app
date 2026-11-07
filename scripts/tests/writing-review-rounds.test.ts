import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MIN_EDITS_FOR_SECOND_REVIEW_ROUND,
  shouldRunSecondReviewRound,
} from '../../server/writing-review/writing-essay.ts'

test('MIN_EDITS_FOR_SECOND_REVIEW_ROUND is 3', () => {
  assert.equal(MIN_EDITS_FOR_SECOND_REVIEW_ROUND, 3)
})

test('shouldRunSecondReviewRound respects maxRounds and minEdits threshold', () => {
  // With maxRounds = 1 (default), round 2 is never run
  assert.equal(shouldRunSecondReviewRound(0, 1), false)
  assert.equal(shouldRunSecondReviewRound(2, 1), false)
  assert.equal(shouldRunSecondReviewRound(3, 1), false)
  assert.equal(shouldRunSecondReviewRound(10, 1), false)

  // With maxRounds = 2, round 2 only runs if round 1 made at least minEdits (3)
  assert.equal(shouldRunSecondReviewRound(0, 2), false)
  assert.equal(shouldRunSecondReviewRound(1, 2), false)
  assert.equal(shouldRunSecondReviewRound(2, 2), false)
  assert.equal(shouldRunSecondReviewRound(3, 2), true)
  assert.equal(shouldRunSecondReviewRound(5, 2), true)

  // Custom minEdits threshold
  assert.equal(shouldRunSecondReviewRound(2, 2, 2), true)
  assert.equal(shouldRunSecondReviewRound(2, 2, 4), false)
})
