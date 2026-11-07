// Bottom sheet on phones, centred dialog from sm up. Body scrolls; the footer (buttons) stays visible.
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm" />
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl bg-white shadow-2xl outline-none dark:bg-slate-900',
            // The centred dialog uses transform to centre itself, so it fades instead of sliding.
            'animate-slide-up motion-reduce:animate-none sm:animate-fade-in',
            'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl',
            className,
          )}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-200 sm:hidden dark:bg-slate-700" aria-hidden />
          <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-2 sm:pt-5">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold text-slate-900 dark:text-white">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close
              className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-100 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-slate-800">
              {footer}
            </div>
          ) : (
            <div className="pb-[max(0.5rem,env(safe-area-inset-bottom))]" />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** A row of tappable chips (one value). */
export function Chips<T extends string | number>({
  value,
  onChange,
  options,
  className,
}: {
  value: T | undefined
  onChange: (value: T) => void
  options: { value: T; label: ReactNode }[]
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-9 rounded-full border px-3 text-sm font-medium transition-colors',
            value === o.value
              ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-950/50 dark:text-brand-200'
              : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
    </label>
  )
}

export const inputClass =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] text-slate-900 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
