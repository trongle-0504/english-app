import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

/**
 * `?topic=&sub=` as state. Both live in one update because react-router's functional
 * setSearchParams doesn't compose two calls made in the same tick (changing the topic clears the sub-topic).
 */
export function useTopicFilter() {
  const [params, setParams] = useSearchParams()

  const update = useCallback(
    (next: { topic?: string; sub: string }) =>
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(next)) {
            if (value) copy.set(key, value)
            else copy.delete(key)
          }
          return copy
        },
        { replace: true, preventScrollReset: true },
      ),
    [setParams],
  )

  return {
    topicId: params.get('topic') ?? '',
    subId: params.get('sub') ?? '',
    setTopic: useCallback((topic: string) => update({ topic, sub: '' }), [update]),
    setSub: useCallback((sub: string) => update({ sub }), [update]),
  }
}
