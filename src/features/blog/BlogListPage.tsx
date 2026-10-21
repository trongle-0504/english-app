import { SearchX } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { CatalogLayout, type CatalogFilter } from '@/components/CatalogLayout'
import { Button, EmptyState, PageHeader, SearchInput, SectionTitle } from '@/components/ui'
import { useData } from '@/lib/data'
import { matchesQuery } from '@/lib/text'
import type { BlogIndex } from '@/types/content'
import { BlogPostCard } from './BlogPostCard'
import { topicTones } from './topicTones'
import { useTopicFilter } from './useTopicFilter'

export default function BlogListPage() {
  const { topics, posts } = useData<BlogIndex>('blog/index.json')
  const { topicId, subId, setTopic, setSub } = useTopicFilter()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const topic = topics.find((t) => t.id === topicId)
  const subTopic = topic?.subTopics.find((s) => s.id === subId)
  const tones = useMemo(() => topicTones(topics), [topics])

  const filters = useMemo<CatalogFilter[]>(
    () => [
      { id: '', label: 'All topics', count: posts.length },
      ...topics.map((t) => ({
        id: t.id,
        label: t.name,
        count: t.count,
        // A single sub-topic usually just repeats the topic name.
        children: t.subTopics.length > 1 ? t.subTopics.map((s) => ({ id: s.id, label: s.name, count: s.count })) : undefined,
      })),
    ],
    [topics, posts.length],
  )

  const visible = useMemo(
    () =>
      posts.filter(
        (post) =>
          (!topic || post.topicId === topic.id) &&
          (!subTopic || post.subTopicId === subTopic.id) &&
          (matchesQuery(post.title, deferredQuery) || matchesQuery(post.excerpt, deferredQuery)),
      ),
    [posts, topic, subTopic, deferredQuery],
  )

  const heading = subTopic?.name ?? topic?.name ?? 'All posts'

  return (
    <>
      <PageHeader
        eyebrow="Guides & practice"
        title="Blog"
        hideTitle
        description="Skill guides, reading and listening practice with vocabulary notes, and collocation lists, organised by topic."
      />
      <CatalogLayout
        title="Topics"
        filters={filters}
        value={topic?.id ?? ''}
        onChange={setTopic}
        childValue={subTopic?.id ?? ''}
        onChildChange={setSub}
        toolbar={
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search posts…"
            aria-label="Search posts"
            className="w-full sm:max-w-sm"
          />
        }
      >
        <SectionTitle count={visible.length} className="mt-2">
          {heading}
        </SectionTitle>
        {visible.length ? (
          <ul className="grid gap-4 sm:grid-cols-2">
            {visible.map((post) => (
              <li key={post.slug} className="animate-fade-in">
                <BlogPostCard post={post} tone={tones.get(post.topicId) ?? 'brand'} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<SearchX className="size-8" />}
            title="No posts found"
            description={
              deferredQuery ? `Nothing matches “${deferredQuery}”. Try another keyword or topic.` : 'There are no posts in this topic yet.'
            }
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery('')
                  setTopic('')
                }}
              >
                Clear filters
              </Button>
            }
          />
        )}
      </CatalogLayout>
    </>
  )
}
