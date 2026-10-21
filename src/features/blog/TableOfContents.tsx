import { ChevronDown, ListTree } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import type { BlogHeading } from '@/types/content'

/** Headings scrolled past this line (below the sticky header) count as the current section. */
const ACTIVE_LINE = 120

/** Id of the last heading above the reading line, recomputed only when a heading crosses it. */
function useActiveHeading(headings: BlogHeading[]): string | undefined {
  const [active, setActive] = useState<string>()

  useEffect(() => {
    const elements = headings.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => el !== null)
    if (!elements.length) return
    const update = () => {
      let current: string | undefined
      for (const el of elements) {
        if (el.getBoundingClientRect().top > ACTIVE_LINE) break
        current = el.id
      }
      setActive(current)
    }
    const observer = new IntersectionObserver(update, { rootMargin: `-${ACTIVE_LINE}px 0px 0px 0px` })
    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [headings])

  return active
}

function TocLinks({ headings, active, onNavigate }: { headings: BlogHeading[]; active?: string; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5 border-l border-slate-200 dark:border-slate-800">
      {headings.map((heading) => (
        <li key={heading.id}>
          <a
            href={`#${heading.id}`}
            onClick={onNavigate}
            aria-current={heading.id === active ? 'location' : undefined}
            data-toc={heading.id}
            className={cn(
              '-ml-px block border-l-2 py-1 pr-2 text-[13px] leading-snug transition-colors',
              heading.depth === 2 && 'pl-3 font-medium',
              heading.depth === 3 && 'pl-6',
              heading.depth === 4 && 'pl-9 text-xs',
              heading.id === active
                ? 'border-brand-500 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-white',
            )}
          >
            {heading.text}
          </a>
        </li>
      ))}
    </ul>
  )
}

/** Sticky sidebar for wide screens; keeps the active entry scrolled into view. */
export function DesktopToc({ headings }: { headings: BlogHeading[] }) {
  const active = useActiveHeading(headings)
  const listRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const list = listRef.current
    const link = active ? list?.querySelector<HTMLElement>(`[data-toc="${CSS.escape(active)}"]`) : null
    if (!list || !link) return
    const top = link.offsetTop
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - link.offsetHeight) {
      list.scrollTo({ top: top - list.clientHeight / 3, behavior: 'smooth' })
    }
  }, [active])

  return (
    <div className="sticky top-24">
      <p id="toc-heading" className="mb-3 flex items-center gap-2 text-[11px] font-bold tracking-[0.18em] text-slate-400 uppercase">
        <ListTree className="size-3.5" aria-hidden />
        On this page
      </p>
      <nav ref={listRef} aria-labelledby="toc-heading" className="scrollbar-thin relative max-h-[calc(100vh-9rem)] overflow-y-auto pb-4">
        <TocLinks headings={headings} active={active} />
      </nav>
    </div>
  )
}

/** Collapsible contents for small screens; closes after picking a section. */
export function MobileToc({ headings, className }: { headings: BlogHeading[]; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null)
  return (
    <details
      ref={ref}
      className={cn(
        'group rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03] dark:border-slate-800 dark:bg-slate-900/60',
        className,
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 select-none dark:text-slate-200 [&::-webkit-details-marker]:hidden">
        <ListTree className="size-4 text-brand-600 dark:text-brand-400" aria-hidden />
        On this page
        <span className="text-xs font-medium text-slate-400">{headings.length}</span>
        <ChevronDown className="ml-auto size-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <nav aria-label="On this page" className="scrollbar-thin max-h-[60vh] overflow-y-auto border-t border-slate-100 px-4 py-3 dark:border-slate-800">
        <TocLinks headings={headings} onNavigate={() => ref.current?.removeAttribute('open')} />
      </nav>
    </details>
  )
}
