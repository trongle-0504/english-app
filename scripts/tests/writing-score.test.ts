import assert from 'node:assert/strict'
import test from 'node:test'
import { countWords, quoteInSentence } from '../../server/writing-review/score.ts'
import { overallBand } from '../../src/types/writingReview.ts'

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
