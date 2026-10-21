import { Timer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

export const TIME_LIMITS = [0, 10, 15, 20, 25] as const

/**
 * Study time of the session: counts only while the tab is visible (a break in another tab does not use up the time)
 * and while a card is on screen. Once the budget is used up the clock stops, unless an answer is still being worked
 * on (`holding`): that card is finished first.
 */
export function useStudyTime({ idle, holding, budgetMs }: { idle: boolean; holding: boolean; budgetMs: number }): number {
  const [elapsed, setElapsed] = useState(0)
  const latest = useRef({ holding, budgetMs })
  useEffect(() => {
    latest.current = { holding, budgetMs }
  }, [holding, budgetMs])
  useEffect(() => {
    if (idle) return
    let last = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      const step = now - last
      last = now
      if (document.visibilityState !== 'visible') return
      setElapsed((e) => {
        const { holding: busy, budgetMs: budget } = latest.current
        return budget > 0 && e >= budget && !busy ? e : e + step
      })
    }, 1000)
    return () => clearInterval(id)
  }, [idle])
  return elapsed
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Header control: pick a time limit, see the countdown (or the time spent when there is no limit). */
export function SessionTimer({ limitMin, onLimit, elapsed, budgetMs }: { limitMin: number; onLimit: (min: number) => void; elapsed: number; budgetMs: number }) {
  const left = budgetMs - elapsed
  const warn = limitMin > 0 && left <= 60_000
  return (
    <label
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums',
        warn
          ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
          : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300',
      )}
      title="Thời lượng phiên học: hết giờ thì dừng sau thẻ đang làm. Chỉ tính lúc tab này đang mở."
    >
      <Timer className="size-3.5" />
      {limitMin > 0 ? clock(left) : clock(elapsed)}
      <select
        value={limitMin}
        onChange={(e) => onLimit(Number(e.target.value))}
        className="cursor-pointer bg-transparent font-semibold outline-none"
        aria-label="Session length"
      >
        {TIME_LIMITS.map((m) => (
          <option key={m} value={m}>
            {m ? `/ ${m} phút` : '· không giới hạn'}
          </option>
        ))}
      </select>
    </label>
  )
}
