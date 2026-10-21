// "Bài gần đây": reviews limited to the phrases of your Speaking / Writing of the last days (?recent=N on the session
// pages). The cards and their progress are the usual ones; only the choice of cards changes.
import { useEffect, useState } from 'react'
import { practiceApi } from '../practice/practice-api'

export const RECENT_DAYS = [3, 7, 14, 30]
export const DEFAULT_RECENT_DAYS = 7
export const RECENT_DAYS_KEY = 'review:recent-days'
/** New cards a "Bài gần đây" session may introduce (beyond the daily limit: you chose these words). */
export const RECENT_NEW = [10, 20, 30, 50]
export const RECENT_NEW_KEY = 'review:recent-new'

/** ?recent=N → N (1–90), else null. */
export function recentDaysParam(value: string | null): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : null
}

/** The card ids of your recent work (null while loading; undefined when not limited). */
export function useRecentScope(days: number | null): {
  ids: Set<string> | null | undefined
  error?: string
} {
  const [state, setState] = useState<{
    days: number | null
    ids: Set<string> | null
    error?: string
  }>({ days: null, ids: null })
  useEffect(() => {
    if (!days) return
    let live = true
    practiceApi
      .recent(days)
      .then((r) => live && setState({ days, ids: new Set(r.ids) }))
      .catch((e: Error) => live && setState({ days, ids: new Set(), error: e.message }))
    return () => {
      live = false
    }
  }, [days])
  if (!days) return { ids: undefined }
  return state.days === days ? { ids: state.ids, error: state.error } : { ids: null }
}

/** Both limits at once (a deck or sources, and the recent work). */
export function intersect(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): Set<string> | undefined {
  if (!a) return b ? new Set(b) : undefined
  if (!b) return new Set(a)
  return new Set([...a].filter((id) => b.has(id)))
}
