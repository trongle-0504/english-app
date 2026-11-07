import assert from 'node:assert/strict'
import test from 'node:test'
import type { HesitationSpot } from '../../server/speaking-review/fluency.ts'
import { mapCriterionIssues, placePhrase } from '../../server/speaking-review/review.ts'
import type { TalkMisheard, TalkWord } from '../../src/types/speakingReview.ts'

const sampleSentences = [
  'I really like living in a big city.',
  'There are many good jobs and Oxford dictionary resources.',
]
const heardSentences = [
  'I really like living in a big city.',
  'There are many good jobs and effort dictionary resources.',
]
const sampleWords: TalkWord[] = [
  { w: 'I', start: 0.0, end: 0.2, conf: 1 },
  { w: 'really', start: 0.2, end: 0.5, conf: 1 },
  { w: 'like', start: 0.5, end: 0.8, conf: 1 },
  { w: 'living', start: 0.8, end: 1.2, conf: 1 },
  { w: 'in', start: 1.2, end: 1.3, conf: 1 },
  { w: 'a', start: 1.3, end: 1.4, conf: 1 },
  { w: 'big', start: 1.4, end: 1.7, conf: 1 },
  { w: 'city.', start: 1.7, end: 2.1, conf: 1 },
  { w: 'There', start: 2.5, end: 2.8, conf: 1 },
  { w: 'are', start: 2.8, end: 3.0, conf: 1 },
  { w: 'many', start: 4.2, end: 4.5, conf: 1 },
  { w: 'good', start: 4.5, end: 4.8, conf: 1 },
  { w: 'jobs', start: 4.8, end: 5.2, conf: 1 },
  { w: 'and', start: 5.2, end: 5.4, conf: 1 },
  { w: 'effort', start: 5.4, end: 5.9, conf: 0.4 },
  { w: 'dictionary', start: 5.9, end: 6.5, conf: 0.9 },
  { w: 'resources.', start: 6.5, end: 7.1, conf: 1 },
]

test('placePhrase: found in sentence, found elsewhere when sentence index is wrong, and not found', () => {
  // Found in specified sentence (index 1)
  const inSentence = placePhrase('good jobs', 1, sampleSentences, sampleWords)
  assert.deepEqual(inSentence, { sentence: 1, start: 4.5, end: 5.2 })

  // Found in another sentence when sentenceIndex points to sentence 0
  const elsewhere = placePhrase('good jobs', 0, sampleSentences, sampleWords)
  assert.deepEqual(elsewhere, { sentence: 1, start: 4.5, end: 5.2 })

  // Not found in sentences at all
  const missing = placePhrase('completely absent words', 0, sampleSentences, sampleWords)
  assert.deepEqual(missing, { sentence: -1, start: 0, end: 0 })
})

test('mapCriterionIssues: maps H ref, M ref, plain quotes, and drops quotes not in the restored sentence', () => {
  const spots: HesitationSpot[] = [
    { ref: 'H1', sentence: 1, before: 'are', after: 'many', seconds: 1.2, start: 3.0, end: 4.2 },
  ]
  const misheard: TalkMisheard[] = [
    {
      sentence: 1,
      heard: 'effort dictionary',
      meant: 'Oxford dictionary',
      ipa: '/ˈɒksfəd/',
      tip: 'Âm /ɒks/',
      start: 5.4,
      end: 6.5,
    },
  ]

  const { issues, dropped } = mapCriterionIssues(
    [
      // H1 spot: start = 3.0 - 1.5 = 1.5, end = 4.2 + 1.5 = 5.7, sentence from spot (1)
      { n: 2, quote: 'are many', ref: 'H1', problem: 'Ngập ngừng 1.2s giữa câu', better: 'there are plenty of' },
      // M1 misheard: start/end from misheard[0] (5.4..6.5)
      { n: 2, quote: 'Oxford dictionary', ref: 'M1', problem: 'Phát âm từ Oxford chưa rõ', better: '/ˈɒksfəd/ — rõ cụm /ksf/' },
      // Plain quote in sentence 1
      { n: 1, quote: 'big city', ref: '', problem: 'Cụm từ đơn giản', better: 'major metropolis' },
      // Quote not in restored sentence -> must be dropped
      { n: 1, quote: 'nonexistent phrase here', ref: '', problem: 'Bịa', better: 'none' },
    ],
    sampleSentences,
    heardSentences,
    sampleWords,
    spots,
    misheard,
  )

  assert.equal(dropped, 1)
  assert.equal(issues.length, 3)

  assert.deepEqual(issues[0], {
    sentence: 1,
    quote: 'are many',
    problem: 'Ngập ngừng 1.2s giữa câu',
    better: 'there are plenty of',
    start: 1.5,
    end: 5.7,
  })
  assert.deepEqual(issues[1], {
    sentence: 1,
    quote: 'Oxford dictionary',
    problem: 'Phát âm từ Oxford chưa rõ',
    better: '/ˈɒksfəd/ — rõ cụm /ksf/',
    start: 5.4,
    end: 6.5,
  })
  assert.deepEqual(issues[2], {
    sentence: 0,
    quote: 'big city',
    problem: 'Cụm từ đơn giản',
    better: 'major metropolis',
    start: 1.4,
    end: 2.1,
  })
})
