import * as Dialog from '@radix-ui/react-dialog'
import { Infinity as NoLimit, Timer, X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { buttonClass } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useLocalStorage } from '@/lib/storage'
import { TIME_LIMITS } from './SessionTimer'

/** localStorage key shared with the session page (which can still change the limit mid-session). */
export const TIME_LIMIT_KEY = 'review:time-limit'

/**
 * A session button (Start review, Practice again…) that first asks how long to study, then opens the session.
 * The last choice is pre-selected; the session stops after that many minutes of study.
 */
export function StartSessionButton({
  to,
  children,
  heading = 'How long do you want to study?',
  variant,
  size,
  className,
  title,
  counts,
}: {
  to: string
  children: ReactNode
  heading?: string
  variant?: Parameters<typeof buttonClass>[0]
  size?: Parameters<typeof buttonClass>[1]
  className?: string
  title?: string
  /** Also ask how many cards (the choice is remembered and added to the link as `?<param>=n`). */
  counts?: { label: string; values: number[]; initial: number; storageKey: string; param: string }
}) {
  const navigate = useNavigate()
  const [limit, setLimit] = useLocalStorage<number>(TIME_LIMIT_KEY, 0)
  const [count, setCount] = useLocalStorage<number>(counts?.storageKey ?? 'review:unused-count', counts?.initial ?? 0)
  const start = (minutes: number) => {
    setLimit(minutes)
    navigate(counts ? `${to}${to.includes('?') ? '&' : '?'}${counts.param}=${count}` : to)
  }
  return (
    <Dialog.Root>
      <Dialog.Trigger className={buttonClass(variant, size, className)} title={title}>
        {children}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm" />
        <Dialog.Content className="animate-slide-up fixed top-1/2 left-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-4 sm:p-5 shadow-2xl dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
              <Timer className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-bold text-slate-900 dark:text-white">{heading}</Dialog.Title>
              <Dialog.Description className="text-sm text-slate-500 dark:text-slate-400">
                When time is up, the session stops after the card you are on. Short, regular sessions keep you focused and help you remember.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          {counts ? (
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-semibold text-slate-500">{counts.label}</p>
              <div className="grid grid-cols-4 gap-2">
                {counts.values.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={count === n}
                    onClick={() => setCount(n)}
                    className={cn(
                      'rounded-lg border py-1.5 text-sm font-bold tabular-nums transition-colors',
                      count === n
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-950/50 dark:text-brand-200'
                        : 'border-slate-200 text-slate-600 hover:border-brand-300 dark:border-slate-700 dark:text-slate-300',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-3 mb-1.5 text-xs font-semibold text-slate-500">Time</p>
            </div>
          ) : null}
          <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', !counts && 'mt-4')}>
            {TIME_LIMITS.filter(Boolean).map((m) => (
              <MinuteButton key={m} active={limit === m} onClick={() => start(m)}>
                <span className="text-2xl font-extrabold tabular-nums">{m}</span>
                <span className="text-xs font-semibold opacity-70">min</span>
              </MinuteButton>
            ))}
          </div>
          <MinuteButton active={limit === 0} onClick={() => start(0)} className="mt-2 w-full flex-row gap-2 py-2.5">
            <NoLimit className="size-4" /> <span className="text-sm font-semibold">No limit</span>
          </MinuteButton>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function MinuteButton({ active, className, ...props }: ComponentProps<'button'> & { active: boolean }) {
  return (
    <button
      type="button"
      // The last choice gets focus, so Enter starts with it.
      autoFocus={active}
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border-2 py-3 transition-colors focus:ring-4 focus:ring-brand-500/20 focus:outline-none',
        active
          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-950/50 dark:text-brand-200'
          : 'border-slate-200 text-slate-700 hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-brand-700',
        className,
      )}
      {...props}
    />
  )
}
