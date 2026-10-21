import type { QuizQuestion } from '@/types/content'
import { isAnswerCorrect } from './compare.ts'

export type QuizMode = QuizQuestion['type']
export type Outcome = 'correct' | 'wrong' | 'skipped'

export const MODE_LABELS: Record<QuizMode, string> = {
  multiple_choice: 'Multiple choice',
  short_answer: 'Fill in the blank',
}

export interface QuizAnswer {
  /** Option id (multiple choice) or typed text (short answer); empty when skipped. */
  response: string
  outcome: Outcome
}

/** Blanks are written as two or more underscores. */
const BLANK = /_{2,}/

/** Tidies generator artefacts such as "economic __\n." into "economic __.". */
function tidy(sentence: string): string {
  return sentence.replace(/\s+/g, ' ').replace(/(_{2,}) (?=[.,!?;:])/g, '$1').trim()
}

/**
 * Splits a sentence around its first blank. Returns null when the sentence has no blank.
 * Any further blanks stay in `after` (a few generated sentences have two).
 */
export function splitAtBlank(sentence: string): { before: string; after: string } | null {
  const text = tidy(sentence)
  const match = BLANK.exec(text)
  if (!match) return null
  return { before: text.slice(0, match.index), after: text.slice(match.index + match[0].length) }
}

/** The sentence with the first blank filled in and leftover blanks dropped, for reading aloud or review. */
export function fillBlank(sentence: string, answer: string): string {
  const parts = splitAtBlank(sentence)
  const text = parts ? `${parts.before}${answer}${parts.after}` : `${tidy(sentence)} ${answer}`
  return text.replace(/_{2,}/g, '').replace(/\s+([.,!?;:])/g, '$1').replace(/\s+/g, ' ').trim()
}

export function correctAnswerText(question: QuizQuestion): string {
  if (question.type === 'short_answer') return question.correct_answer
  return question.options.find((o) => o.id === question.correct_answer)?.text ?? question.correct_answer
}

/** Display text for what the learner answered. */
export function responseText(question: QuizQuestion, response: string): string {
  if (question.type === 'short_answer') return response
  return question.options.find((o) => o.id === response)?.text ?? ''
}

export function grade(question: QuizQuestion, response: string): Outcome {
  if (question.type === 'multiple_choice') return response === question.correct_answer ? 'correct' : 'wrong'
  return isAnswerCorrect(response, question.correct_answer) ? 'correct' : 'wrong'
}

export function countOutcomes(answers: readonly (QuizAnswer | undefined)[]): Record<Outcome, number> {
  const counts: Record<Outcome, number> = { correct: 0, wrong: 0, skipped: 0 }
  for (const answer of answers) if (answer) counts[answer.outcome]++
  return counts
}

/** Next question (after `current`, wrapping around) that hasn't been answered or skipped yet. */
export function nextOpenIndex(answers: readonly (QuizAnswer | undefined)[], current: number): number | null {
  for (let step = 1; step < answers.length; step++) {
    const index = (current + step) % answers.length
    if (!answers[index]) return index
  }
  return null
}
