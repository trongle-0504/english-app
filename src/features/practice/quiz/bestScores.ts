import { useCallback } from 'react'
import { useLocalStorage } from '@/lib/storage'
import type { QuizMode } from '../lib/quiz'

export interface BestScore {
  correct: number
  total: number
}

type BestScores = Partial<Record<string, BestScore>>

const key = (quizId: string, mode: QuizMode) => `${quizId}:${mode}`
const ratio = (score: BestScore) => (score.total ? score.correct / score.total : 0)

/** Best full-round score per quiz and mode, kept in localStorage. */
export function useBestScores() {
  const [scores, setScores] = useLocalStorage<BestScores>('practice:quiz-best', {})

  const get = useCallback((quizId: string, mode: QuizMode) => scores[key(quizId, mode)], [scores])

  /** Stores the score if it beats the previous best; returns true when it did. */
  const record = useCallback(
    (quizId: string, mode: QuizMode, score: BestScore) => {
      const previous = scores[key(quizId, mode)]
      if (previous && ratio(previous) >= ratio(score)) return false
      setScores((prev) => ({ ...prev, [key(quizId, mode)]: score }))
      return true
    },
    [scores, setScores],
  )

  return { get, record }
}
