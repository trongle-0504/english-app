import { lazy, Suspense, useEffect, useState } from 'react'
import { Outlet, ScrollRestoration, useLocation } from 'react-router'
import { PageSkeleton } from '@/components/ui'
import { Footer } from './Footer'
import { Header } from './Header'

const WordLookup = lazy(() => import('@/features/lookup/WordLookup'))
// The Coach button on every page (the chat itself loads on first open).
const CoachButton = lazy(() => import('@/features/coach/CoachButton'))

/** Scrolls to #hash targets once the (possibly lazy) page has rendered them, and flashes them. */
function useScrollToHash() {
  const { hash, key } = useLocation()
  useEffect(() => {
    if (!hash) return
    const id = decodeURIComponent(hash.slice(1))
    let frame = 0
    const started = performance.now()
    const tick = () => {
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.classList.add('target-flash')
        window.setTimeout(() => el.classList.remove('target-flash'), 1800)
      } else if (performance.now() - started < 3000) {
        frame = requestAnimationFrame(tick)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [hash, key])
}

export function AppShell() {
  const [lookupOpen, setLookupOpen] = useState(false)
  // The lookup (and its dictionary data) loads only once someone opens it.
  const [lookupUsed, setLookupUsed] = useState(false)
  const openLookup = (open: boolean) => {
    if (open) setLookupUsed(true)
    setLookupOpen(open)
  }
  useScrollToHash()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setLookupUsed(true)
        setLookupOpen((open) => !open)
      } else if (event.key === '/' && !(event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) {
        event.preventDefault()
        setLookupUsed(true)
        setLookupOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Header onOpenLookup={() => openLookup(true)} />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-2 pb-20 sm:px-6">
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      {lookupUsed ? (
        <Suspense fallback={null}>
          <WordLookup open={lookupOpen} onOpenChange={openLookup} />
        </Suspense>
      ) : null}
      <Suspense fallback={null}>
        <CoachButton />
      </Suspense>
      <ScrollRestoration getKey={(location) => location.pathname} />
    </div>
  )
}
