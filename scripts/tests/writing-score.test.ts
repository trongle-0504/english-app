import assert from 'node:assert/strict'
import test from 'node:test'
import { buildErrorPhrase, findCopiedErrors, isSurfaceOnlyFix } from '../../server/writing-review/copied-errors.ts'
import { countWords, quoteInSentence, WRITING_SCORE_SYSTEM } from '../../server/writing-review/score.ts'
import { overallBand } from '../../src/types/writingReview.ts'

test('buildErrorPhrase extracts original plus one word on each side', () => {
  const sentence = 'To organize tests for millions of people, including children and elderly, the government would have to...'
  assert.equal(buildErrorPhrase(sentence, 'elderly'), 'and elderly')
  assert.equal(buildErrorPhrase('Parent certainly can share their experience', 'Parent'), 'Parent certainly')
  assert.equal(buildErrorPhrase('Consequently, they truggle to find jobs', 'truggle'), 'they truggle to')
})

test('WRITING_SCORE_SYSTEM contains strict criteria distinction instructions', () => {
  assert.equal(/never let grammar/i.test(WRITING_SCORE_SYSTEM), true)
  assert.equal(WRITING_SCORE_SYSTEM.includes('never a rarer'), true)
})

test('countWords counts valid tokens and excludes Vietnamese & English paragraph labels', () => {
  const textWithLabels = `
Mở bài: In today's modern world, technology plays a crucial role in education.
Thân bài 1: Firstly, online learning offers great flexibility for students.
Body 2: Secondly, digital resources make learning materials more accessible.
Kết bài: In conclusion, while there are minor challenges, the benefits of technology are undeniable.
`
  // Tokens without labels:
  // Para 1: In, today's, modern, world, technology, plays, a, crucial, role, in, education (11)
  // Para 2: Firstly, online, learning, offers, great, flexibility, for, students (8)
  // Para 3: Secondly, digital, resources, make, learning, materials, more, accessible (8)
  // Para 4: In, conclusion, while, there, are, minor, challenges, the, benefits, of, technology, are, undeniable (13)
  // Total = 11 + 8 + 8 + 13 = 40
  const count = countWords(textWithLabels)
  assert.equal(count, 40)
})

test('quoteInSentence matches case-insensitively, ignoring straight/curly quotes and punctuation', () => {
  const sentence = 'It is believed that “social media” has negative impacts on young people.'
  assert.equal(quoteInSentence('social media', sentence), true)
  assert.equal(quoteInSentence('“social media”', sentence), true)
  assert.equal(quoteInSentence('"social media"', sentence), true)
  assert.equal(quoteInSentence('negative impacts', sentence), true)
  assert.equal(quoteInSentence('Negative Impacts', sentence), true)
  assert.equal(quoteInSentence('completely untrue quote', sentence), false)
})

test('overallBand rounds IELTS four criteria correctly', () => {
  assert.equal(overallBand([6, 7, 6, 6]), 6.5) // 25 / 4 = 6.25 -> 6.5
  assert.equal(overallBand([6, 6, 6, 7]), 6.5) // 25 / 4 = 6.25 -> 6.5
  assert.equal(overallBand([7, 7, 6, 6]), 6.5) // 26 / 4 = 6.5 -> 6.5
  assert.equal(overallBand([7, 7, 7, 6]), 7)   // 27 / 4 = 6.75 -> 7
  assert.equal(overallBand([6, 6, 6, 6]), 6)
  assert.equal(overallBand([8, 8, 8, 8]), 8)
})

test('findCopiedErrors handles case-only fixes without false positives and catches actual copied errors', () => {
  // Using real draft sentence, fix, and essay sentence from cache/rereview-writing/mw27noidea-595505.low.2.json
  const draftSentences = [
    'It is sometimes believed that all people have to get driving test before participate in traffic.',
    'I completely disagree with this view because this can prevent green development and give raise to waste public funds.',
    'The first argument to support my opinion is that Mandating driving tests for cyclists would create significant administrative barriers and waste the national buget.',
    'To organize tests for millions of people, including children and elderly, the government would have to undertake numerous of tasks, such as establishing testing centers, standard exam question to suit all participants.',
  ]
  const mandatingFix = [{ sentenceIndex: 2, original: 'Mandating', replacement: 'mandating' }]
  const essaySentenceCorrect =
    'The first argument in support of this view is that mandating driving tests for cyclists would create significant administrative barriers and strain public finances.'

  // 1. Case-only fix with lowercase in essay -> []
  const res1 = findCopiedErrors(draftSentences, mandatingFix, [essaySentenceCorrect])
  assert.deepEqual(res1, [])

  // 2. The same fix with capitalized "Mandating" in essay -> one match
  const essaySentenceFaulty =
    'The first argument in support of this view is that Mandating driving tests for cyclists would create significant administrative barriers and strain public finances.'
  const res2 = findCopiedErrors(draftSentences, mandatingFix, [essaySentenceFaulty])
  assert.equal(res2.length, 1)
  assert.equal(res2[0]?.phrase, 'that Mandating driving')
  assert.equal(res2[0]?.sentence, essaySentenceFaulty)

  // 3. A word fix ("numerous of tasks" -> "numerous tasks") where essay repeats phrase with neighbour words -> one match
  const wordFix = [{ sentenceIndex: 3, original: 'numerous of tasks', replacement: 'numerous tasks' }]
  const essaySentenceWithWordError =
    'Authorities would have to undertake numerous of tasks such as establishing new testing centers.'
  const res3 = findCopiedErrors(draftSentences, wordFix, [essaySentenceWithWordError])
  assert.equal(res3.length, 1)
  assert.equal(res3[0]?.phrase, 'undertake numerous of tasks')

  // 4. isSurfaceOnlyFix assertions
  assert.equal(isSurfaceOnlyFix('funds, the', 'funds; the'), true)
  assert.equal(isSurfaceOnlyFix('buget', 'budget'), false)
})
