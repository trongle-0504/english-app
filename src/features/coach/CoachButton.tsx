// The Coach entry on every page: a round button bottom-right; the chat panel loads on first open.
import { Sparkles } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { cn } from '@/lib/cn'
import * as api from './api'
import { COACH_ASK_EVENT, type CoachAsk } from './ask'

const CoachPanel = lazy(() => import('./CoachPanel'))

export default function CoachButton() {
  const { pathname } = useLocation()
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(false)
  const [ask, setAsk] = useState<(CoachAsk & { n: number }) | undefined>()

  useEffect(() => {
    api
      .status()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false))
  }, [])

  useEffect(() => {
    if (!enabled) return
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<CoachAsk>).detail
      if (!detail?.text) return
      setUsed(true)
      setOpen(true)
      setAsk((a) => ({ ...detail, n: (a?.n ?? 0) + 1 }))
    }
    window.addEventListener(COACH_ASK_EVENT, onAsk)
    return () => window.removeEventListener(COACH_ASK_EVENT, onAsk)
  }, [enabled])

  if (!enabled) return null
  // The Planner has its own + button in the same corner: sit above it there.
  const raised = pathname.startsWith('/planner')
  return (
    <>
      {!open ? (
        <button
          type="button"
          aria-label="Open Nova Agent, your AI study coach"
          title="Nova Agent · AI study coach"
          onClick={() => {
            setUsed(true)
            setOpen(true)
          }}
          className={cn(
            'fixed right-4 z-40 flex size-12 items-center justify-center rounded-full bg-violet-600 text-white shadow-xl shadow-violet-600/30 ring-1 ring-white/10 transition-transform hover:scale-105 hover:bg-violet-700 active:scale-95 dark:bg-violet-500 dark:shadow-violet-950/40 dark:hover:bg-violet-400',
            raised ? 'bottom-[max(5.75rem,calc(env(safe-area-inset-bottom)+5.25rem))]' : 'bottom-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]',
          )}
        >
          <Sparkles className="size-5" />
        </button>
      ) : null}
      {used ? (
        <Suspense fallback={null}>
          <CoachPanel open={open} onClose={() => setOpen(false)} ask={ask} />
        </Suspense>
      ) : null}
    </>
  )
}
