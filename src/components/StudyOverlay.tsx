import * as Dialog from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight, Shuffle, X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Button, Kbd, Progress } from '@/components/ui'
import { cn } from '@/lib/cn'

interface StudyOverlayProps {
  open: boolean
  onClose: () => void
  index: number
  total: number
  onIndexChange: (index: number) => void
  title?: ReactNode
  /** Wrap from last to first (flashcards) instead of stopping at the ends. */
  wrap?: boolean
  onShuffle?: () => void
  /** Extra keyboard handling, e.g. Space to flip. Return true when handled. */
  onKey?: (event: KeyboardEvent) => boolean
  footerExtra?: ReactNode
  children: ReactNode
  className?: string
}

/** Full-screen one-item-at-a-time viewer with ←/→/Esc navigation, shared by every study/flashcard mode. */
export function StudyOverlay({
  open,
  onClose,
  index,
  total,
  onIndexChange,
  title,
  wrap,
  onShuffle,
  onKey,
  footerExtra,
  children,
  className,
}: StudyOverlayProps) {
  const canPrev = wrap ? total > 1 : index > 0
  const canNext = wrap ? total > 1 : index < total - 1
  const prev = () => canPrev && onIndexChange((index - 1 + total) % total)
  const next = () => canNext && onIndexChange((index + 1) % total)

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]')) return
      if (onKey?.(event)) return event.preventDefault()
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        next()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        prev()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="animate-scale-in fixed inset-2 z-50 flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl outline-none sm:inset-4 lg:inset-x-[max(1rem,calc((100vw-72rem)/2))] dark:bg-slate-900"
        >
          <Progress value={total ? ((index + 1) / total) * 100 : 0} className="h-1 rounded-none" />
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6 dark:border-slate-800">
            <Dialog.Title className="min-w-0 truncate text-sm font-semibold text-slate-500 dark:text-slate-400">{title}</Dialog.Title>
            <div className="flex items-center gap-1">
              {onShuffle ? (
                <Button variant="ghost" size="icon-sm" onClick={onShuffle} aria-label="Shuffle" title="Shuffle">
                  <Shuffle className="size-4" />
                </Button>
              ) : null}
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close (Esc)" title="Close (Esc)">
                  <X className="size-5" />
                </Button>
              </Dialog.Close>
            </div>
          </div>

          <div key={index} className={cn('scrollbar-thin animate-slide-up flex-1 overflow-y-auto p-4 sm:p-8', className)}>
            {children}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-4 py-3 sm:px-6 dark:border-slate-800 dark:bg-slate-900/80">
            <Button variant="outline" onClick={prev} disabled={!canPrev}>
              <ChevronLeft className="size-4" />
              <span className="hidden sm:inline">Previous</span>
            </Button>
            <div className="flex items-center gap-4 text-sm">
              {footerExtra}
              <span className="font-bold text-slate-900 tabular-nums dark:text-white">
                {total ? index + 1 : 0}
                <span className="mx-1 text-slate-300 dark:text-slate-600">/</span>
                {total}
              </span>
              <span className="hidden items-center gap-1 text-xs text-slate-400 md:flex">
                <Kbd>←</Kbd>
                <Kbd>→</Kbd> navigate · <Kbd>Esc</Kbd> close
              </span>
            </div>
            <Button variant="secondary" onClick={next} disabled={!canNext}>
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
