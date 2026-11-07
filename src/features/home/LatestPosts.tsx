import { ArrowRight } from 'lucide-react'
import { Suspense, useMemo } from 'react'
import { Link } from 'react-router'
import { Skeleton } from '@/components/ui'
import { useData } from '@/lib/data'
import type { BlogIndex } from '@/types/content'
import { BlogPostCard } from '@/features/blog/BlogPostCard'
import { topicTones } from '@/features/blog/topicTones'
import { QuietBoundary } from './QuietBoundary'

const COUNT = 3

function PostCards() {
  const { topics, posts } = useData<BlogIndex>('blog/index.json')
  const tones = useMemo(() => topicTones(topics), [topics])
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {posts.slice(0, COUNT).map((post) => (
        <li key={post.slug}>
          <BlogPostCard post={post} tone={tones.get(post.topicId) ?? 'brand'} />
        </li>
      ))}
    </ul>
  )
}

export function LatestPosts() {
  return (
    <QuietBoundary>
      <section aria-labelledby="latest-title" className="mt-14 hidden md:block">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-brand-600 uppercase dark:text-brand-400">From the blog</p>
            <h2 id="latest-title" className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
              Latest posts
            </h2>
          </div>
          <Link
            to="/blog"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            View all posts
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <div className="mt-6">
          <Suspense
            fallback={
              <div className="grid gap-4 md:grid-cols-3">
                {Array.from({ length: COUNT }, (_, i) => (
                  <Skeleton key={i} className="h-44 rounded-2xl" />
                ))}
              </div>
            }
          >
            <PostCards />
          </Suspense>
        </div>
      </section>
    </QuietBoundary>
  )
}
