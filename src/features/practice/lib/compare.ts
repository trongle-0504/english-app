import { diffWords, type ChangeObject } from 'diff'

export type DiffPart = ChangeObject<string>

/** Unifies typographic quotes/dashes and whitespace so typed text compares fairly with the source. */
export function normalizeTypography(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalises a short answer: case, spacing, apostrophes and trailing punctuation don't matter. */
export function normalizeAnswer(text: string): string {
  return normalizeTypography(text)
    .toLowerCase()
    .replace(/[\s.,!?;:]+$/, '')
}

export function isAnswerCorrect(input: string, expected: string): boolean {
  const answer = normalizeAnswer(input)
  return answer !== '' && answer === normalizeAnswer(expected)
}

/** Lowercased word tokens, punctuation dropped (hyphenated words and contractions stay whole). */
export function words(text: string): string[] {
  return normalizeTypography(text).toLowerCase().match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? []
}

export interface SentenceComparison {
  /** Word diff from the user's text to the target: `added` = missing words, `removed` = extra/wrong words. */
  parts: DiffPart[]
  /** Same words in the same order (case and punctuation are not graded). */
  correct: boolean
}

export function compareSentence(user: string, target: string): SentenceComparison {
  const parts = diffWords(normalizeTypography(user), normalizeTypography(target), { ignoreCase: true })
  const a = words(user)
  const b = words(target)
  return { parts, correct: a.length === b.length && a.every((word, i) => word === b[i]) }
}
