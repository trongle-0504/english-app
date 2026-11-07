import { useEffect, useState } from 'react'
import { onToast } from './toast'

/** Mount once per page (PlannerPage, TodayPanel). */
export function Toaster() {
  const [message, setMessage] = useState('')
  useEffect(() => {
    let timer = 0
    const listener = (next: string) => {
      setMessage(next)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setMessage(''), 3500)
    }
    const off = onToast(listener)
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [])
  if (!message) return null
  return (
    <div
      role="status"
      className="animate-slide-up fixed inset-x-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-[60] mx-auto max-w-sm rounded-2xl bg-slate-900/95 px-4 py-3 text-center text-sm font-medium text-white shadow-xl dark:bg-white/95 dark:text-slate-900"
    >
      {message}
    </div>
  )
}
