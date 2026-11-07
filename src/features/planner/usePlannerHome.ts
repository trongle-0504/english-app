import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlannerHome, PlannerTask } from '@/types/planner'
import { getHome, OfflineError, setDone } from './api'
import { vnDay } from './dates'
import { setBadge } from './push'
import { useToast } from './toast'

const CACHE_KEY = 'planner:home'

function readCache(): PlannerHome | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as PlannerHome) : null
  } catch {
    return null
  }
}

function writeCache(home: PlannerHome) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(home))
  } catch {
    // Storage blocked: the live answer still shows.
  }
}

const badgeOf = (home: PlannerHome) => home.tasks.filter((t) => !t.doneAt).length + home.overdue.length

/**
 * The home page's plan for today. Keeps the last answer for offline use, and reloads when the app becomes visible
 * again or the day changes (an installed app stays in memory overnight).
 */
export function usePlannerHome() {
  const [home, setHome] = useState<PlannerHome | null>(readCache)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  const dayRef = useRef(vnDay())

  const reload = useCallback(async () => {
    try {
      const next = await getHome()
      setHome(next)
      writeCache(next)
      setOffline(false)
      setError('')
      setBadge(badgeOf(next))
    } catch (err) {
      if (err instanceof OfflineError) setOffline(true)
      else setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      dayRef.current = vnDay()
      void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => {
      if (vnDay() !== dayRef.current) {
        dayRef.current = vnDay()
        void reload()
      }
    }, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [reload])

  /** Ticks optimistically; rolls back with a toast when the server refuses (offline ticks are refused). */
  const toggle = useCallback(
    async (task: PlannerTask, done: boolean) => {
      if (offline) {
        toast('Đang ngoại tuyến — chưa đánh dấu được.')
        return
      }
      const patch = (t: PlannerTask) => (t.id === task.id ? { ...t, doneAt: done ? new Date().toISOString() : undefined } : t)
      const before = home
      setHome((h) => (h ? { ...h, tasks: h.tasks.map(patch), overdue: done ? h.overdue.filter((t) => t.id !== task.id) : h.overdue.map(patch) } : h))
      try {
        await setDone(task.id, done)
        void reload()
      } catch (err) {
        setHome(before)
        toast((err as Error).message || 'Không lưu được.')
      }
    },
    [home, offline, reload, toast],
  )

  return { home, setHome, offline, error, loading, reload, toggle }
}
