import { useEffect, useRef, useState } from 'react'

/**
 * Renders long lists in pages as the user scrolls, so a 250-word lesson paints instantly.
 * Returns the visible slice and a sentinel ref to place after the list. `minCount` forces items visible
 * (e.g. the target of a #hash link).
 */
export function useProgressiveList<T>(items: T[], pageSize = 20, minCount = 0) {
  const [pages, setCount] = useState(pageSize)
  const [source, setSource] = useState(items)
  if (source !== items) {
    // New list (filter/sort changed): start from the first page again.
    setSource(items)
    setCount(pageSize)
  }
  const count = Math.max(pages, minCount)
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinel.current
    if (!el || count >= items.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.min(c + pageSize, items.length))
      },
      { rootMargin: '800px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [count, items.length, pageSize])

  return { visible: items.slice(0, count), sentinel, hasMore: count < items.length, showAll: () => setCount(items.length) }
}
