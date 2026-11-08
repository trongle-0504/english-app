// "Ask Coach about this" on a page (Writing / Speaking review, Today's focus): opens the Coach with a question about
// what is on screen, in a new chat. Hidden when the coach is switched off.
import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { askCoach } from './ask'

let enabledOnce: Promise<boolean> | null = null
const coachEnabled = () =>
  (enabledOnce ??= fetch('/api/coach/status')
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .then((s: { enabled?: boolean }) => Boolean(s.enabled))
    .catch(() => false))

export function AskCoachButton({ question, label = 'Ask Nova Agent', className }: { question: string; label?: string; className?: string }) {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let live = true
    void coachEnabled().then((on) => live && setEnabled(on))
    return () => {
      live = false
    }
  }, [])
  if (!enabled) return null
  return (
    <button
      type="button"
      onClick={() => askCoach(question)}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3.5 text-sm font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/40',
        className,
      )}
    >
      <Sparkles className="size-4" />
      {label}
    </button>
  )
}
