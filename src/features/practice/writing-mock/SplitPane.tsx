import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

const MIN = 25
const MAX = 70
const DEFAULT = 45

const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v))

function readWidth(key: string): number {
  try {
    const v = Number(localStorage.getItem(key))
    return v ? clamp(v) : DEFAULT
  } catch {
    return DEFAULT
  }
}

/**
 * Two columns on large screens with a draggable divider (pointer, ←/→ with Shift = 10 %, Home / End, double click
 * resets); stacked on phones. The left width (25–70 %, default 45 %) is remembered per `storageKey`.
 */
export function SplitPane({ left, right, storageKey, className }: { left: ReactNode; right: ReactNode; storageKey: string; className?: string }) {
  const [width, setWidth] = useState(() => readWidth(storageKey))
  const [dragging, setDragging] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(Math.round(width * 10) / 10))
    } catch {
      // Storage blocked: the width is kept for this visit only.
    }
  }, [storageKey, width])

  const fromPointer = useCallback((clientX: number) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect?.width) return
    setWidth(clamp(((clientX - rect.left) / rect.width) * 100))
  }, [])

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => fromPointer(e.clientX)
    const up = () => setDragging(false)
    const body = document.body.style
    const previous = body.userSelect
    body.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      body.userSelect = previous
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragging, fromPointer])

  return (
    <div
      ref={box}
      className={cn('flex flex-col gap-4 lg:flex-row lg:gap-0', className)}
      style={{ '--split-left': `${width}%` } as React.CSSProperties}
    >
      <div className="min-w-0 lg:w-[var(--split-left)] lg:shrink-0 lg:pr-3">{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Kéo để đổi độ rộng hai cột"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDoubleClick={() => setWidth(DEFAULT)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 2
          if (e.key === 'ArrowLeft') setWidth((w) => clamp(w - step))
          else if (e.key === 'ArrowRight') setWidth((w) => clamp(w + step))
          else if (e.key === 'Home') setWidth(MIN)
          else if (e.key === 'End') setWidth(MAX)
          else return
          e.preventDefault()
        }}
        className={cn(
          'group hidden w-3 shrink-0 cursor-col-resize items-stretch justify-center rounded focus-visible:outline-2 focus-visible:outline-brand-500 lg:flex',
          dragging && 'bg-brand-50 dark:bg-brand-950/30',
        )}
        title="Kéo để đổi độ rộng · nháy đúp để về mặc định"
      >
        <span className={cn('w-1 rounded-full bg-slate-200 transition-colors group-hover:bg-brand-400 dark:bg-slate-700', dragging && 'bg-brand-500')} />
      </div>
      <div className="min-w-0 flex-1 lg:pl-3">{right}</div>
    </div>
  )
}
