import { Layers } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CatalogLayout } from '@/components/CatalogLayout'
import { EmptyState, PageHeader, SearchInput, SectionTitle } from '@/components/ui'
import { useData } from '@/lib/data'
import { matchesQuery, plural } from '@/lib/text'
import { useQueryParam } from '@/lib/useQueryParam'
import type { CollocationIndex } from '@/types/content'
import { LessonCard } from '../library/LessonCard'

export default function CollocationListPage() {
  const index = useData<CollocationIndex>('collocations/index.json')
  const [topicId, setTopicId] = useQueryParam('topic')
  const [query, setQuery] = useState('')

  const filters = useMemo(
    () => [
      { id: '', label: 'All topics', count: index.totalLessons },
      ...index.topics.map((t) => ({ id: t.id, label: t.name, count: t.lessons.length })),
    ],
    [index],
  )

  const groups = useMemo(
    () =>
      index.topics
        .filter((t) => !topicId || t.id === topicId)
        .map((topic) => ({ topic, lessons: topic.lessons.filter((l) => matchesQuery(l.title, query) || matchesQuery(topic.name, query)) }))
        .filter((g) => g.lessons.length > 0),
    [index, topicId, query],
  )

  let accent = 0
  return (
    <>
      <PageHeader
        eyebrow="Vocabulary"
        title="Collocations in Use"
        description={`${index.totalLessons} bài học · ${index.totalWords} collocations kèm nghĩa, phát âm, ví dụ và bản PDF gốc.`}
      />
      <CatalogLayout
        title="Topics"
        filters={filters}
        value={topicId}
        onChange={setTopicId}
        toolbar={
          <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter lessons…" className="w-full sm:max-w-sm" />
        }
      >
        {groups.length === 0 ? (
          <EmptyState icon={<Layers className="size-8" />} title="No lessons found" description="Try another topic or search term." />
        ) : (
          groups.map(({ topic, lessons }) => (
            <section key={topic.id} className="animate-fade-in">
              {!topicId ? <SectionTitle count={lessons.length}>{topic.name}</SectionTitle> : null}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {lessons.map((lesson) => (
                  <LessonCard
                    key={lesson.id}
                    to={`/collocations/${lesson.id}`}
                    dataKey={`collocations/${lesson.id}.json`}
                    eyebrow={topic.name}
                    title={lesson.title}
                    meta={plural(lesson.wordCount, 'collocation')}
                    accentIndex={accent++}
                    cta="Study"
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </CatalogLayout>
    </>
  )
}
