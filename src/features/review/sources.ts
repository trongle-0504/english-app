// Review sources (vocabulary, lesson collocations, collocations inside words, notes, my cards, essays): each practises
// differently, so a session can be limited to some of them. The choice lives in the URL (?src=vocabulary,note) and is
// remembered per browser on the dashboard.
import type { ReviewCard, ReviewSource } from '@/types/content'

export const REVIEW_SOURCES: { value: ReviewSource; label: string }[] = [
  { value: 'vocabulary', label: 'Vocabulary' },
  { value: 'collocation', label: 'Collocations' },
  { value: 'word-collocation', label: 'In vocabulary' },
  { value: 'note', label: 'Notes' },
  { value: 'custom', label: 'My cards' },
  { value: 'essay', label: 'Essays' },
]

export const SOURCES_KEY = 'review:sources'

const KNOWN = new Set<string>(REVIEW_SOURCES.map((s) => s.value))

/** "vocabulary,note" → the valid sources ([] = all). */
export function parseSources(param: string | null | undefined): ReviewSource[] {
  return (param ?? '').split(',').filter((s): s is ReviewSource => KNOWN.has(s))
}

/** Adds `src=…` to a session link (nothing when every source is chosen). */
export function withSources(path: string, sources: readonly ReviewSource[]): string {
  return sources.length ? `${path}${path.includes('?') ? '&' : '?'}src=${sources.join(',')}` : path
}

/** Ids of the cards from these sources; undefined = no limit. */
export function sourceScope(cardsById: ReadonlyMap<string, ReviewCard>, sources: readonly ReviewSource[]): Set<string> | undefined {
  if (!sources.length) return undefined
  const wanted = new Set(sources)
  return new Set([...cardsById.values()].filter((c) => wanted.has(c.source)).map((c) => c.id))
}

export const sourcesLabel = (sources: readonly ReviewSource[]) =>
  sources.length
    ? REVIEW_SOURCES.filter((s) => sources.includes(s.value))
        .map((s) => s.label)
        .join(', ')
    : 'All sources'
