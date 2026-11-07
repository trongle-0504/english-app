import type { SpeakingAnswer, SpeakingResult } from '../../../types/speaking.ts'
import { normalize } from './topicGroups.ts'

/** Resolve a question inside a suggestion run: prefer `index` when its question matches, else search by normalized text. */
export function resolveAnswer(
  result: SpeakingResult,
  index: number,
  question?: string,
): { answer: SpeakingAnswer; index: number } | null {
  const atIndex = Number.isInteger(index) && index >= 0 ? result.answers[index] : undefined
  if (atIndex && (!question || normalize(atIndex.question) === normalize(question))) {
    return { answer: atIndex, index }
  }
  if (question) {
    const target = normalize(question)
    const foundIdx = result.answers.findIndex((a) => normalize(a.question) === target)
    if (foundIdx >= 0) {
      return { answer: result.answers[foundIdx]!, index: foundIdx }
    }
  }
  return null
}
