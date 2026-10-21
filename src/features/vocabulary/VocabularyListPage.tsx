import { BookOpen } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CatalogLayout } from '@/components/CatalogLayout'
import { EmptyState, PageHeader, SearchInput, SectionTitle } from '@/components/ui'
import { useData } from '@/lib/data'
import { matchesQuery, plural } from '@/lib/text'
import { useQueryParam } from '@/lib/useQueryParam'
import type { VocabIndex, VocabTopicSummary } from '@/types/content'
import { LessonCard } from '../library/LessonCard'

const ALL = 'all'

const topicMatches = (topic: VocabTopicSummary, q: string) =>
  matchesQuery(topic.name, q) ||
  matchesQuery(topic.description_vi, q) ||
  topic.subTopics.some((s) => matchesQuery(s.name, q) || s.preview.some((w) => matchesQuery(w, q)))

/** Where a topic card leads: straight to the lesson when the topic has a single sub-topic. */
const topicLink = (topic: VocabTopicSummary) =>
  topic.subTopics.length === 1 ? `/vocabulary/${topic.id}/${topic.subTopics[0].id}` : `/vocabulary?topic=${topic.id}`

export default function VocabularyListPage() {
  const index = useData<VocabIndex>('vocabulary/index.json')
  const [topicId, setTopicId] = useQueryParam('topic')
  const [query, setQuery] = useState('')

  const everything = index.topics.find((t) => t.id === ALL)
  const topics = useMemo(() => index.topics.filter((t) => t.id !== ALL), [index])
  const selected = topics.find((t) => t.id === topicId)

  const filters = useMemo(
    () => [{ id: '', label: 'All topics', count: topics.length }, ...topics.map((t) => ({ id: t.id, label: t.name, count: t.wordCount }))],
    [topics],
  )

  const visibleTopics = useMemo(() => topics.filter((t) => topicMatches(t, query)), [topics, query])
  const visibleSubTopics = useMemo(
    () => (selected ? selected.subTopics.filter((s) => matchesQuery(s.name, query) || s.preview.some((w) => matchesQuery(w, query))) : []),
    [selected, query],
  )

  return (
    <>
      <PageHeader
        eyebrow="Vocabulary"
        title="Vocabulary Library"
        description={`${index.totalWords} từ vựng IELTS theo ${topics.length} chủ đề — có phát âm, ví dụ, collocations và mẹo nhớ.`}
      />
      <CatalogLayout
        title="Topics"
        filters={filters}
        value={selected ? selected.id : ''}
        onChange={setTopicId}
        toolbar={<SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={selected ? `Filter ${selected.name}…` : 'Filter topics or words…'} className="w-full sm:max-w-sm" />}
      >
        {selected ? (
          <section className="animate-fade-in space-y-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">{selected.name}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {selected.description_vi ? `${selected.description_vi} · ` : ''}
                {plural(selected.wordCount, 'word')}
                {selected.subTopics.length > 1 ? ` · ${plural(selected.subTopics.length, 'sub-topic')}` : ''}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {selected.hasAllLesson && !query ? (
                <LessonCard
                  to={`/vocabulary/${selected.id}/all`}
                  dataKey={`vocabulary/${selected.id}/all.json`}
                  eyebrow={selected.name}
                  title={`All ${selected.name} words`}
                  description="Học hoặc ôn toàn bộ từ của chủ đề này."
                  meta={plural(selected.wordCount, 'word')}
                  accentIndex={0}
                  cta="Study"
                />
              ) : null}
              {visibleSubTopics.map((sub, i) => (
                <LessonCard
                  key={sub.id}
                  to={`/vocabulary/${selected.id}/${sub.id}`}
                  dataKey={`vocabulary/${selected.id}/${sub.id}.json`}
                  eyebrow={selected.name}
                  title={selected.subTopics.length > 1 ? sub.name : selected.name}
                  description={sub.description_vi}
                  chips={sub.preview}
                  meta={plural(sub.wordCount, 'word')}
                  accentIndex={i + 1}
                  cta="Study"
                />
              ))}
            </div>
            {!visibleSubTopics.length ? <EmptyState title="No sub-topic matches" description="Try another search." /> : null}
          </section>
        ) : (
          <>
            {everything && !query ? (
              <LessonCard
                to={`/vocabulary/${ALL}/${ALL}`}
                dataKey={`vocabulary/${ALL}/${ALL}.json`}
                eyebrow="Toàn bộ"
                title={everything.name}
                description={everything.description_vi}
                chips={everything.subTopics[0]?.preview}
                meta={plural(everything.wordCount, 'word')}
                accentIndex={5}
                cta="Study"
              />
            ) : null}
            <section className="animate-fade-in">
              <SectionTitle count={visibleTopics.length}>Topics</SectionTitle>
              {visibleTopics.length ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleTopics.map((topic, i) => (
                    <LessonCard
                      key={topic.id}
                      to={topicLink(topic)}
                      dataKey={topic.subTopics.length === 1 ? `vocabulary/${topic.id}/${topic.subTopics[0].id}.json` : 'vocabulary/index.json'}
                      eyebrow={topic.subTopics.length > 1 ? plural(topic.subTopics.length, 'sub-topic') : 'Topic'}
                      title={topic.name}
                      description={topic.description_vi}
                      chips={topic.subTopics.length > 1 ? topic.subTopics.map((s) => s.name) : topic.subTopics[0]?.preview}
                      meta={plural(topic.wordCount, 'word')}
                      accentIndex={i}
                      cta={topic.subTopics.length > 1 ? 'Open' : 'Study'}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState icon={<BookOpen className="size-8" />} title="No topics found" description="Try another search term." />
              )}
            </section>
          </>
        )}
      </CatalogLayout>
    </>
  )
}
