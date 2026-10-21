import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface CatalogFilter {
  id: string
  label: string
  count?: number
  /** Nested options shown under the active item (e.g. blog sub-topics). */
  children?: CatalogFilter[]
}

interface CatalogLayoutProps {
  title: string
  filters: CatalogFilter[]
  value: string
  onChange: (id: string) => void
  childValue?: string
  onChildChange?: (id: string) => void
  toolbar?: ReactNode
  children: ReactNode
}

/** Topic sidebar (chips on mobile) + content column, used by every library page. */
export function CatalogLayout({ title, filters, value, onChange, childValue, onChildChange, toolbar, children }: CatalogLayoutProps) {
  const active = filters.find((f) => f.id === value)

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <aside className="lg:sticky lg:top-24 lg:w-64 lg:shrink-0">
        <p className="mb-2 hidden px-3 text-[11px] font-bold tracking-[0.18em] text-slate-400 uppercase lg:block">{title}</p>
        <nav
          aria-label={title}
          className="scrollbar-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:max-h-[calc(100vh-8rem)] lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:overflow-y-auto lg:px-0 lg:pb-0"
        >
          {filters.map((filter) => {
            const selected = filter.id === value
            return (
              <div key={filter.id} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  onClick={() => onChange(filter.id)}
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors lg:whitespace-normal',
                    selected
                      ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200 lg:ring-0 dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-900'
                      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-900 lg:bg-transparent lg:ring-0 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-800 dark:hover:bg-slate-800/70 dark:hover:text-white lg:dark:bg-transparent',
                  )}
                >
                  <span>{filter.label}</span>
                  {filter.count != null ? (
                    <span className={cn('text-xs tabular-nums', selected ? 'text-brand-500' : 'text-slate-400')}>{filter.count}</span>
                  ) : null}
                </button>
                {selected && filter.children?.length && onChildChange ? (
                  <div className="mt-0.5 mb-1 hidden space-y-0.5 border-l border-slate-200 pl-2 ml-4 lg:block dark:border-slate-800">
                    {filter.children.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => onChildChange(childValue === child.id ? '' : child.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors',
                          childValue === child.id
                            ? 'font-semibold text-brand-700 dark:text-brand-300'
                            : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                        )}
                      >
                        {child.label}
                        {child.count != null ? <span className="text-xs text-slate-400">{child.count}</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </nav>
        {active?.children?.length && onChildChange ? (
          <div className="scrollbar-thin -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 lg:hidden">
            {active.children.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => onChildChange(childValue === child.id ? '' : child.id)}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1 text-xs font-medium',
                  childValue === child.id
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                )}
              >
                {child.label}
              </button>
            ))}
          </div>
        ) : null}
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        {toolbar ? <div className="flex flex-wrap items-center gap-3">{toolbar}</div> : null}
        {children}
      </div>
    </div>
  )
}
