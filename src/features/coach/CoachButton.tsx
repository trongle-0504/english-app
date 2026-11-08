// The Coach entry on every page: a round button bottom-right; the chat panel loads on first open.
import { Sparkles } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { cn } from '@/lib/cn'
import * as api from './api'

const CoachPanel = lazy(() => import('./CoachPanel'))

export default function CoachButton() {
  const { pathname } = useLocation()
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(false)

  useEffect(() => {
    api
      .status()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false))
  }, [])

  if (!enabled) return null
  // The Planner has its own + button in the same corner: sit above it there.
  const raised = pathname.startsWith('/planner')
  return (
    <>
      {!open ? (
        <button
          type="button"
          aria-label="Open Coach"
          title="Coach"
          onClick={() => {
            setUsed(true)
            setOpen(true)
          }}
          className={cn(
            'fixed right-4 z-40 flex size-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-xl shadow-slate-900/25 ring-1 ring-white/10 transition-transform hover:scale-105 active:scale-95 dark:bg-white dark:text-slate-900',
            raised ? 'bottom-[max(5.75rem,calc(env(safe-area-inset-bottom)+5.25rem))]' : 'bottom-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]',
          )}
        >
          <Sparkles className="size-5" />
        </button>
      ) : null}
      {used ? (
        <Suspense fallback={null}>
          <CoachPanel open={open} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  )
}
