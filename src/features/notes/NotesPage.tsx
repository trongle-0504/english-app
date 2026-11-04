import { ArrowDownAZ, CalendarArrowDown, GraduationCap, NotebookPen } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { CatalogLayout, type CatalogFilter } from '@/components/CatalogLayout'
import { StudyOverlay } from '@/components/StudyOverlay'
import { Button, EmptyState, PageHeader, SearchInput, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useData } from '@/lib/data'
import { useLocalStorage } from '@/lib/storage'
import { matchesQuery, plural, shuffle } from '@/lib/text'
import { useQueryParam } from '@/lib/useQueryParam'
import type { Note } from '@/types/content'
import { NoteCard } from './NoteCard'
import { NOTE_TYPES, noteKey } from './noteTypes'

type Sort = 'newest' | 'az'

const SORT_OPTIONS = [
  { value: 'newest' as const, label: 'Newest', icon: <CalendarArrowDown className="size-3.5" /> },
  { value: 'az' as const, label: 'A–Z', icon: <ArrowDownAZ className="size-3.5" /> },
]

const byNewest = (a: Note, b: Note) => b.created_at.localeCompare(a.created_at)
const byTitle = (a: Note, b: Note) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' })

/**
 * Cards rendered per step. All notes at once is ~20,000 DOM nodes and a 300,000px page, which made scrolling stutter on
 * phones; more are added as the end of the list comes near.
 */
const PAGE = 24

/** Adds the next page once it is within a few screens of the viewport; the button is the fallback. */
function LoadMore({ onMore, shown }: { onMore: () => void; shown: number }) {
  const ref = useRef<HTMLDivElement>(null)
  // `shown` re-creates the observer after every page: one that is still intersecting would not fire again.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && onMore(), { rootMargin: '1500px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [onMore, shown])
  return (
    <div ref={ref} className="flex justify-center py-2">
      <Button variant="outline" onClick={onMore}>
        Show more
      </Button>
    </div>
  )
}

/** Study mode works on a snapshot of the list, so filtering can never push the index out of range. */
interface StudySession {
  notes: Note[]
  index: number
}

export default function NotesPage() {
  const notes = useData<Note[]>('notes.json')
  const [typeParam, setType] = useQueryParam('type')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useLocalStorage<Sort>('notes:sort', 'newest')
  const [study, setStudy] = useState<StudySession | null>(null)

  // Following a #note link (related chip, site search) clears the search so the target card is rendered.
  const { hash } = useLocation()
  const [seenHash, setSeenHash] = useState(hash)
  if (hash !== seenHash) {
    setSeenHash(hash)
    setQuery('')
  }

  const lookup = useMemo(() => {
    const map = new Map<string, string>()
    for (const note of notes) {
      map.set(noteKey(note.title), note.id)
      map.set(noteKey(note.id), note.id)
    }
    return map
  }, [notes])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const note of notes) map.set(note.type, (map.get(note.type) ?? 0) + 1)
    return map
  }, [notes])

  const filters: CatalogFilter[] = [
    { id: '', label: 'All', count: notes.length },
    ...NOTE_TYPES.filter((type) => counts.has(type)).map((type) => ({ id: type, label: type, count: counts.get(type) })),
  ]
  const activeType = counts.has(typeParam) ? typeParam : ''

  // Typing stays responsive while the (memoised) cards re-filter in the background.
  const deferredQuery = useDeferredValue(query)
  const visible = useMemo(
    () =>
      notes
        .filter(
          (n) =>
            (!activeType || n.type === activeType) &&
            (matchesQuery(n.title, deferredQuery) || matchesQuery(n.meaning_vi, deferredQuery) || matchesQuery(n.formula, deferredQuery)),
        )
        .sort(sort === 'az' ? byTitle : byNewest),
    [notes, activeType, deferredQuery, sort],
  )

  // Back to the first page whenever the filter, search or order changes.
  const [limit, setLimit] = useState(PAGE)
  const filterKey = `${activeType}|${deferredQuery}|${sort}`
  const [seenFilter, setSeenFilter] = useState(filterKey)
  if (filterKey !== seenFilter) {
    setSeenFilter(filterKey)
    setLimit(PAGE)
  }
  const showMore = useCallback(() => setLimit((n) => n + PAGE), [])
  // A #note link must find its card rendered, however far down the list it is.
  const targetIndex = hash ? visible.findIndex((note) => note.id === decodeURIComponent(hash.slice(1))) : -1
  const shown = visible.slice(0, Math.max(limit, targetIndex + 1))

  const closeStudy = () => setStudy(null)
  const current = study?.notes[study.index]

  return (
    <>
      <title>Notes & Phrases · NeuralSymbolic</title>
      <PageHeader
        eyebrow="Vocabulary"
        title="Notes & Phrases"
        description={`${plural(notes.length, 'note')} — structures, idioms, collocations and vocabulary collected while learning.`}
        actions={
          <>
            <SegmentedControl value={sort} onChange={setSort} options={SORT_OPTIONS} size="sm" />
            <Button onClick={() => setStudy({ notes: visible, index: 0 })} disabled={!visible.length}>
              <GraduationCap className="size-4" />
              Study mode
            </Button>
          </>
        }
      />

      <CatalogLayout
        title="Types"
        filters={filters}
        value={activeType}
        onChange={setType}
        toolbar={
          <>
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, meaning or formula…"
              aria-label="Search notes"
              className="w-full sm:max-w-sm"
            />
            <p className="text-sm text-slate-500 tabular-nums dark:text-slate-400" aria-live="polite">
              {plural(visible.length, 'note')}
            </p>
          </>
        }
      >
        {visible.length ? (
          <>
            <div className={cn('gap-5 lg:columns-2', query !== deferredQuery && 'opacity-60 transition-opacity')}>
              {shown.map((note) => (
                <NoteCard key={note.id} note={note} lookup={lookup} anchor className="mb-5 break-inside-avoid" />
              ))}
            </div>
            {shown.length < visible.length ? <LoadMore onMore={showMore} shown={shown.length} /> : null}
          </>
        ) : (
          <EmptyState
            icon={<NotebookPen className="size-8" />}
            title="No notes found"
            description={query ? `Nothing matches “${query}”.` : 'There are no notes of this type yet.'}
            action={
              query || activeType ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery('')
                    setType('')
                  }}
                >
                  Clear filters
                </Button>
              ) : null
            }
          />
        )}
      </CatalogLayout>

      <StudyOverlay
        open={Boolean(current)}
        onClose={closeStudy}
        index={study?.index ?? 0}
        total={study?.notes.length ?? 0}
        onIndexChange={(index) => setStudy((s) => s && { ...s, index })}
        onShuffle={() => setStudy((s) => s && { notes: shuffle(s.notes), index: 0 })}
        title={`Study · ${activeType || 'All notes'}`}
      >
        {current ? (
          <NoteCard
            note={current}
            lookup={lookup}
            onRelatedClick={closeStudy}
            className="mx-auto max-w-4xl border-0 bg-transparent p-0 shadow-none sm:p-0 dark:bg-transparent"
          />
        ) : null}
      </StudyOverlay>
    </>
  )
}
