import * as Popover from '@radix-ui/react-popover'
import { Info } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

/** Small ⓘ next to a label: the explanation opens on hover (desktop) or tap (touch). */
export function InfoTip({ children, label = 'What does this mean?', wide = false }: { children: ReactNode; label?: string; wide?: boolean }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = () => {
    clearTimeout(closeTimer.current)
    setOpen(true)
  }
  // A short delay lets the pointer move from the icon onto the bubble.
  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={label}
        onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && hide()}
        // Inside a link tile (Reviewed today) the icon must not navigate.
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="relative inline-flex shrink-0 items-center rounded-full text-slate-400 hit-area transition-colors hover:text-brand-600 focus-visible:text-brand-600 focus-visible:outline-none dark:hover:text-brand-400"
      >
        <Info className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onPointerEnter={show}
          onPointerLeave={hide}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={`animate-fade-in z-50 ${wide ? 'max-w-[24rem]' : 'max-w-[18rem]'} rounded-xl bg-slate-900 px-3 py-2 text-xs leading-relaxed font-normal tracking-normal text-slate-100 normal-case shadow-xl dark:bg-slate-700`}
        >
          {children}
          <Popover.Arrow className="fill-slate-900 dark:fill-slate-700" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
