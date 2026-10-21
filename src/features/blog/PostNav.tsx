import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { prefetchData, useData } from '@/lib/data'
import type { BlogIndex, BlogPostMeta } from '@/types/content'

/** Neighbouring posts of the same topic, in index order. */
export function PostNav({ slug, topicId }: { slug: string; topicId: string }) {
  const { posts } = useData<BlogIndex>('blog/index.json')
  const siblings = posts.filter((post) => post.topicId === topicId)
  const index = siblings.findIndex((post) => post.slug === slug)
  if (index < 0) return null
  const prev = siblings[index - 1]
  const next = siblings[index + 1]
  if (!prev && !next) return null

  return (
    <nav aria-label="More posts in this topic" className="mt-8 grid gap-4 sm:grid-cols-2">
      {prev ? <NavCard post={prev} direction="prev" /> : <span className="hidden sm:block" />}
      {next ? <NavCard post={next} direction="next" /> : null}
    </nav>
  )
}

function NavCard({ post, direction }: { post: BlogPostMeta; direction: 'prev' | 'next' }) {
  const Icon = direction === 'prev' ? ArrowLeft : ArrowRight
  const prefetch = () => prefetchData(`blog/${post.slug}.json`)
  return (
    <Link
      to={`/blog/${post.slug}`}
      rel={direction}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      className={cn(
        'group flex flex-col gap-1 rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-sm shadow-slate-900/[0.03] transition-all hover:border-brand-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-brand-700',
        direction === 'next' && 'sm:items-end sm:text-right',
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">
        {direction === 'prev' ? <Icon className="size-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden /> : null}
        {direction === 'prev' ? 'Previous' : 'Next'}
        {direction === 'next' ? <Icon className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden /> : null}
      </span>
      <span className="font-bold text-slate-800 transition-colors text-pretty group-hover:text-brand-700 dark:text-slate-100 dark:group-hover:text-brand-300">
        {post.title}
      </span>
    </Link>
  )
}
