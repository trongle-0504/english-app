import { useEffect, useState } from 'react'
import type { SpeakingAnswer, SpeakingResult } from '@/types/speaking'
import { modelAnswerText } from '../speaking-ideas/answerText'
import { speakingApi } from '../speaking-ideas/api'
import { resolveAnswer } from '../speaking-ideas/resolveAnswer'

export interface LinkedQuestionState {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'error'
  result: SpeakingResult | null
  answer: SpeakingAnswer | null
  index: number
  script: string
  error?: string
}

/** Load a Speaking ideas suggestion by `from` (cached across `q` changes) and resolve its answer at `q`. */
export function useLinkedQuestion(
  from: string | null,
  q: number | null,
  expectedQuestion?: string,
  onIndexShift?: (newIndex: number) => void,
): LinkedQuestionState {
  const [cache, setCache] = useState<{ id: string; result: SpeakingResult | null; error?: string } | null>(null)

  useEffect(() => {
    if (!from || cache?.id === from) return
    let active = true
    speakingApi.get(from).then(
      ({ job }) => {
        if (!active) return
        setCache({ id: from, result: job.result ?? null })
      },
      (err: Error) => {
        if (!active) return
        const isNotFound = /not found|404/i.test(err.message)
        setCache({ id: from, result: null, error: isNotFound ? undefined : err.message })
      },
    )
    return () => {
      active = false
    }
  }, [from, cache?.id])

  const resolvedResult = from && cache?.id === from ? cache.result : null
  const resolved =
    resolvedResult && q !== null ? resolveAnswer(resolvedResult, q, expectedQuestion) : null

  useEffect(() => {
    if (from && q !== null && resolved && resolved.index !== q) {
      onIndexShift?.(resolved.index)
    }
  }, [from, q, resolved, onIndexShift])

  if (!from || q === null) {
    return { status: 'idle', result: resolvedResult, answer: null, index: 0, script: '' }
  }
  if (!cache || cache.id !== from) {
    return { status: 'loading', result: null, answer: null, index: q, script: '' }
  }
  if (cache.error) {
    return { status: 'error', result: null, answer: null, index: q, script: '', error: cache.error }
  }
  if (!cache.result || !resolved) {
    return { status: 'missing', result: cache.result, answer: null, index: q, script: '' }
  }

  return {
    status: 'ready',
    result: cache.result,
    answer: resolved.answer,
    index: resolved.index,
    script: modelAnswerText(resolved.answer, cache.result.part),
  }
}
