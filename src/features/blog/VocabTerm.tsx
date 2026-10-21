import * as Popover from '@radix-ui/react-popover'
import { Volume2 } from 'lucide-react'
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui'
import { speak } from '@/lib/speech'

interface Term {
  word: string
  meaning: string
  ipa?: string
  partOfSpeech?: string
}

interface ActiveTerm {
  term: Term
  anchor: HTMLElement
  /** Opened by click/tap/Enter: stays open until dismissed instead of closing on pointer leave/blur. */
  pinned: boolean
}

interface TermController {
  show: (term: Term, anchor: HTMLElement, delay?: number) => void
  toggle: (term: Term, anchor: HTMLElement) => void
  hideSoon: () => void
  hide: () => void
  cancel: () => void
}

const HOVER_DELAY = 120
const TermContext = createContext<TermController | null>(null)

/**
 * One shared popover for every <T> in a post (a reading passage has hundreds), so terms stay
 * plain spans and opening one never re-renders the memoised markdown.
 */
export function VocabTermProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveTerm | null>(null)
  const timer = useRef<number>(undefined)

  const controller = useMemo<TermController>(() => {
    const cancel = () => window.clearTimeout(timer.current)
    const later = (fn: () => void, delay: number) => {
      cancel()
      if (delay) timer.current = window.setTimeout(fn, delay)
      else fn()
    }
    return {
      cancel,
      show: (term, anchor, delay = 0) =>
        later(() => setActive((prev) => ({ term, anchor, pinned: prev?.anchor === anchor && prev.pinned })), delay),
      toggle: (term, anchor) =>
        later(() => setActive((prev) => (prev?.anchor === anchor && prev.pinned ? null : { term, anchor, pinned: true })), 0),
      hideSoon: () => later(() => setActive((prev) => (prev?.pinned ? prev : null)), 150),
      hide: () => later(() => setActive(null), 0),
    }
  }, [])

  useEffect(() => controller.cancel, [controller])

  // Highlight the open term without re-rendering the post.
  const anchor = active?.anchor
  useEffect(() => {
    if (!anchor) return
    anchor.setAttribute('data-active', '')
    return () => anchor.removeAttribute('data-active')
  }, [anchor])

  // Measure the first line box so a phrase that wraps anchors to where it starts.
  const virtualRef = useMemo(
    () => ({ current: active ? { getBoundingClientRect: () => active.anchor.getClientRects()[0] ?? active.anchor.getBoundingClientRect() } : null }),
    [active],
  )

  const keepWhenOnTerm = (event: Event) => {
    if ((event.target as Element | null)?.closest?.('[data-vocab-term]')) event.preventDefault()
  }

  return (
    <TermContext value={controller}>
      {children}
      <Popover.Root open={active !== null} onOpenChange={(open) => !open && controller.hide()}>
        <Popover.Anchor virtualRef={virtualRef} />
        {active ? (
          <Popover.Portal>
            <Popover.Content
              side="top"
              sideOffset={8}
              collisionPadding={12}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              // Moving to another term switches the card instead of closing it first.
              onInteractOutside={keepWhenOnTerm}
              onPointerEnter={controller.cancel}
              onPointerLeave={(event) => event.pointerType === 'mouse' && controller.hideSoon()}
              className="animate-scale-in z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xl shadow-slate-900/10 outline-none dark:border-slate-700 dark:bg-slate-900"
            >
              <TermCard term={active.term} />
              <Popover.Arrow className="fill-white dark:fill-slate-900" width={14} height={7} />
            </Popover.Content>
          </Popover.Portal>
        ) : null}
      </Popover.Root>
    </TermContext>
  )
}

function TermCard({ term }: { term: Term }) {
  return (
    <div className="text-left">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base leading-snug font-bold text-slate-900 dark:text-white">{term.word}</p>
          {term.ipa ? <p className="ipa mt-0.5 text-sm text-slate-500 dark:text-slate-400">{term.ipa}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => speak(term.word)}
          aria-label={`Listen to “${term.word}”`}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950/60 dark:hover:text-brand-300"
        >
          <Volume2 className="size-4" />
        </button>
      </div>
      {term.partOfSpeech ? (
        <Badge tone="brand" className="mt-2">
          {term.partOfSpeech}
        </Badge>
      ) : null}
      <p className="mt-3 border-t border-slate-100 pt-3 text-sm leading-relaxed text-slate-700 dark:border-slate-800 dark:text-slate-200">
        {term.meaning}
      </p>
    </div>
  )
}

interface VocabTermProps {
  /** Vietnamese meaning */
  v?: string
  /** IPA */
  p?: string
  /** Part of speech, e.g. "noun", "collocation" */
  t?: string
  children?: ReactNode
}

/** `<T v="nghĩa" p="/IPA/" t="noun">word</T>` from reading-practice posts. */
export function VocabTerm({ v, p, t, children }: VocabTermProps) {
  const controller = use(TermContext)
  if (!v || !controller) return <>{children}</>

  const termOf = (el: HTMLElement): Term => ({ word: el.textContent?.trim() ?? '', meaning: v, ipa: p, partOfSpeech: t })

  return (
    <span
      role="button"
      tabIndex={0}
      data-vocab-term=""
      aria-description={v}
      onPointerEnter={(event) => event.pointerType === 'mouse' && controller.show(termOf(event.currentTarget), event.currentTarget, HOVER_DELAY)}
      onPointerLeave={(event) => event.pointerType === 'mouse' && controller.hideSoon()}
      onFocus={(event) => controller.show(termOf(event.currentTarget), event.currentTarget)}
      onBlur={controller.hideSoon}
      onClick={(event) => controller.toggle(termOf(event.currentTarget), event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        controller.toggle(termOf(event.currentTarget), event.currentTarget)
      }}
      className="cursor-help rounded-[3px] border-b-2 border-dotted border-brand-500/70 bg-brand-50/70 px-0.5 font-semibold text-slate-900 box-decoration-clone transition-colors outline-none hover:bg-brand-100 focus-visible:ring-2 focus-visible:ring-brand-500 data-[active]:bg-brand-100 dark:border-brand-400/70 dark:bg-brand-950/50 dark:text-white dark:hover:bg-brand-900/60 dark:data-[active]:bg-brand-900/60"
    >
      {children}
    </span>
  )
}
