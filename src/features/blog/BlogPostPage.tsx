import { Suspense } from 'react'
import { useParams } from 'react-router'
import { Card } from '@/components/ui'
import { useData } from '@/lib/data'
import type { BlogPost } from '@/types/content'
import { PostBody } from './PostBody'
import { PostHeader } from './PostHeader'
import { PostNav } from './PostNav'
import { DesktopToc, MobileToc } from './TableOfContents'
import { VocabTermProvider } from './VocabTerm'

export default function BlogPostPage() {
  const { slug = '' } = useParams()
  const post = useData<BlogPost>(`blog/${slug}.json`)
  const hasToc = post.headings.length > 1

  return (
    <div className="pt-6 sm:pt-8 xl:grid xl:grid-cols-[minmax(0,1fr)_16rem] xl:gap-10">
      <title>NeSy</title>
      <article className="min-w-0">
        <PostHeader post={post} />
        {hasToc ? <MobileToc headings={post.headings} className="mt-4 xl:hidden" /> : null}
        <Card className="animate-slide-up mt-6 px-5 py-6 sm:px-8 sm:py-8 lg:px-12 lg:py-10">
          <VocabTermProvider>
            <PostBody markdown={post.markdown} />
          </VocabTermProvider>
        </Card>
        <Suspense fallback={null}>
          <PostNav slug={post.slug} topicId={post.topicId} />
        </Suspense>
      </article>
      {hasToc ? (
        <aside className="hidden xl:block">
          <DesktopToc headings={post.headings} />
        </aside>
      ) : null}
    </div>
  )
}
