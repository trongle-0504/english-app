import { useMemo, useState } from 'react'
import { addToReview, useReviewStore } from '@/features/review/store'

/** Library phrases added to the review queue from this view, and the last error. */
export function useAddToReview() {
  const { cards } = useReviewStore()
  const [localAdded, setLocalAdded] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const add = (id: string) => {
    setError('')
    addToReview([id]).then(
      () => setLocalAdded((prev) => new Set(prev).add(id)),
      (err: Error) => setError(err.message),
    )
  }

  const added = useMemo(() => {
    const set = new Set<string>(Object.keys(cards))
    localAdded.forEach((id) => set.add(id))
    return set
  }, [cards, localAdded])

  return { added, add, error }
}
