import { History, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Card, SearchInput, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { matchesQuery } from '@/lib/text'
import { normalizeText } from './api'

interface HistoryPanelProps {
  /** Newest first; undefined while loading. */
  items: string[] | undefined
  activeText: string | undefined
  onSelect: (text: string) => void
  /** Only available with the local server. */
  onDelete?: (text: string) => void
  className?: string
}

export function HistoryPanel({ items, activeText, onSelect, onDelete, className }: HistoryPanelProps) {
  const [filter, setFilter] = useState('')
  const active = activeText ? normalizeText(activeText) : undefined
  const shown = items?.filter((item) => matchesQuery(item, filter))

  return (
    <Card className={cn('flex flex-col overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
          <History className="size-4 text-brand-500" />
          History
        </h2>
        {items ? <span className="text-xs text-slate-400 tabular-nums">{items.length}</span> : null}
      </div>

      {items && items.length > 5 ? (
        <div className="px-3 pt-3">
          <SearchInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter history…" aria-label="Filter history" />
        </div>
      ) : null}

      <div className="scrollbar-thin max-h-72 overflow-y-auto p-2 lg:max-h-[calc(100vh-14rem)]">
        {!shown ? (
          <div className="space-y-2 p-1" aria-busy="true" aria-label="Loading history">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">{items?.length ? 'No matches.' : 'No analyses yet.'}</p>
        ) : (
          <ul className="space-y-0.5">
            {shown.map((item) => {
              const selected = normalizeText(item) === active
              return (
                <li key={item} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    aria-current={selected ? 'true' : undefined}
                    title={item}
                    className={cn(
                      'w-full rounded-xl px-3 py-2 text-left text-[13px] leading-snug transition-colors',
                      onDelete && 'pr-9',
                      selected
                        ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/50 dark:text-brand-200'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white',
                    )}
                  >
                    <span className="line-clamp-2">{item}</span>
                  </button>
                  {onDelete ? (
                    <button
                      type="button"
                      onClick={() => onDelete(item)}
                      aria-label="Remove from history"
                      title="Remove from history"
                      className="absolute top-1.5 right-1.5 hit-area rounded-lg p-1.5 text-slate-400 transition-opacity hover:bg-rose-50 hover:text-rose-600 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100 dark:hover:bg-rose-950/50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
