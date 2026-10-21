import { ArrowRight, BookOpenCheck, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CatalogLayout, type CatalogFilter } from '@/components/CatalogLayout'
import { ButtonLink, EmptyState, PageHeader, SearchInput, SectionTitle } from '@/components/ui'
import { prefetchData, useData } from '@/lib/data'
import { matchesQuery, plural } from '@/lib/text'
import { useQueryParam } from '@/lib/useQueryParam'
import type { GrammarIndex, GrammarTopicSummary } from '@/types/content'
import { LevelBadge } from './levels'

type LessonSummary = GrammarTopicSummary['lessons'][number]

function LessonCard({ lesson }: { lesson: LessonSummary }) {
  const prefetch = () => prefetchData(`grammar/${lesson.slug}.json`)
  return (
    <Link
      to={`/grammar/${lesson.slug}`}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      className="group flex flex-col rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-sm shadow-slate-900/[0.03] transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-brand-900"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-bold tracking-tight text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-300">
          {lesson.title}
        </h3>
        <LevelBadge level={lesson.level} className="mt-1" />
      </div>
      {lesson.brief_description_vi ? (
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{lesson.brief_description_vi}</p>
      ) : null}
      <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-brand-600 dark:text-brand-400">
        Open lesson
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}

export default function GrammarListPage() {
  const { topics } = useData<GrammarIndex>('grammar/index.json')
  const [topicParam, setTopic] = useQueryParam('topic')
  const [query, setQuery] = useState('')

  const activeId = topics.some((t) => t.id === topicParam) ? topicParam : ''
  const total = useMemo(() => new Set(topics.flatMap((t) => t.lessons.map((l) => l.slug))).size, [topics])

  const filters: CatalogFilter[] = [
    { id: '', label: 'All lessons', count: total },
    ...topics.map((t) => ({ id: t.id, label: t.name, count: t.lessons.length })),
  ]

  const sections = useMemo(
    () =>
      topics
        .filter((t) => !activeId || t.id === activeId)
        .map((t) => ({
          ...t,
          lessons: t.lessons.filter((l) => matchesQuery(l.title, query) || matchesQuery(l.brief_description_vi, query)),
        }))
        .filter((t) => t.lessons.length),
    [topics, activeId, query],
  )

  return (
    <>
      <title>Grammar · LinearThinking</title>
      <PageHeader
        eyebrow="Grammar"
        title="Grammar library"
        description={`${plural(total, 'lesson')} with structures, usage and examples.`}
        actions={
          <ButtonLink to="/grammar-analyze" variant="outline">
            <Sparkles className="size-4" />
            Analyze a sentence
          </ButtonLink>
        }
      />
      <CatalogLayout
        title="Topics"
        filters={filters}
        value={activeId}
        onChange={setTopic}
        toolbar={
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lessons…"
            aria-label="Search lessons"
            className="w-full sm:max-w-sm"
          />
        }
      >
        {sections.length === 0 ? (
          <EmptyState
            icon={<BookOpenCheck className="size-8" />}
            title="No lessons found"
            description={query ? `Nothing matches “${query}”. Try another keyword.` : 'This topic has no lessons yet.'}
          />
        ) : (
          sections.map((topic) => (
            <section key={topic.id} className="animate-fade-in pb-4">
              <SectionTitle count={topic.lessons.length}>{topic.name}</SectionTitle>
              {topic.description_vi ? <p className="-mt-1 mb-3 text-sm text-slate-500 dark:text-slate-400">{topic.description_vi}</p> : null}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {topic.lessons.map((lesson) => (
                  <LessonCard key={lesson.slug} lesson={lesson} />
                ))}
              </div>
            </section>
          ))
        )}
      </CatalogLayout>
    </>
  )
}
