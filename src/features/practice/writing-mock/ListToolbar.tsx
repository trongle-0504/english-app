import { Shuffle, SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, SearchInput } from '@/components/ui'
import { cn } from '@/lib/cn'

export interface ListFilter {
  /** Read by screen readers; the first option ("Tất cả …") says it on screen. */
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}

/**
 * Search, filters and the random pick of a Mock Test question list, as one bar above the list. On a large screen
 * everything sits in one row; on a phone the search comes first and the filters open from "Bộ lọc".
 */
export function ListToolbar({
  query,
  onQuery,
  filters,
  onRandom,
  randomDisabled,
}: {
  query: string
  onQuery: (value: string) => void
  filters: ListFilter[]
  onRandom: () => void
  randomDisabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const active = filters.filter((f) => f.value !== 'all').length
  return (
    <Card className="mb-4 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Tìm đề bài…" className="min-w-0 flex-1 basis-full sm:basis-60" />
        <Button size="sm" variant={open || active ? 'primary' : 'outline'} className="flex-1 sm:flex-none lg:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <SlidersHorizontal className="size-4" /> Bộ lọc{active ? ` (${active})` : ''}
        </Button>
        <div className={cn('w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:w-auto lg:flex-none', open ? 'grid' : 'hidden')}>
          {filters.map((f) => (
            <select
              key={f.label}
              aria-label={f.label}
              title={f.label}
              value={f.value}
              onChange={(e) => f.onChange(e.target.value)}
              className={cn(
                'h-9 min-w-0 rounded-lg border bg-white px-2.5 text-sm dark:bg-slate-900',
                f.value !== 'all' ? 'border-brand-400 text-brand-700 dark:border-brand-600 dark:text-brand-300' : 'border-slate-200 dark:border-slate-700',
              )}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ))}
        </div>
        <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={onRandom} disabled={randomDisabled}>
          <Shuffle className="size-4" /> Ngẫu nhiên
        </Button>
      </div>
      {active || query ? (
        <div className="mt-2 flex justify-end px-1 text-sm">
          <button
            type="button"
            onClick={() => {
              onQuery('')
              for (const f of filters) f.onChange('all')
            }}
            className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
          >
            <X className="size-3.5" /> Xoá bộ lọc
          </button>
        </div>
      ) : null}
    </Card>
  )
}
