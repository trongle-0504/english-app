import { ArrowUpRight, CalendarDays, Clock } from 'lucide-react'
import { Link } from 'react-router'
import { Badge, type Tone } from '@/components/ui'
import { prefetchData } from '@/lib/data'
import { formatDate } from '@/lib/text'
import type { BlogPostMeta } from '@/types/content'

export function BlogPostCard({ post, tone }: { post: BlogPostMeta; tone: Tone }) {
  const prefetch = () => prefetchData(`blog/${post.slug}.json`)
  const showSubTopic = post.subTopic !== post.topic

  return (
    <Link
      to={`/blog/${post.slug}`}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      className="group flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-sm shadow-slate-900/[0.03] transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700"
    >
      <p className="flex min-w-0 items-center gap-1.5 text-xs">
        <Badge tone={tone} className="shrink-0">
          {post.topic}
        </Badge>
        {showSubTopic ? (
          <>
            <span className="text-slate-300 dark:text-slate-600" aria-hidden>
              ›
            </span>
            <span className="truncate font-medium text-slate-500 dark:text-slate-400">{post.subTopic}</span>
          </>
        ) : null}
      </p>
      <h3 className="mt-3 text-lg leading-snug font-bold text-slate-900 transition-colors text-pretty group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-300">
        {post.title}
      </h3>
      {post.excerpt ? <p className="mt-1.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{post.excerpt}</p> : null}
      <div className="mt-auto flex items-center gap-4 pt-4 text-xs font-medium text-slate-400 dark:text-slate-500">
        {post.createdAt ? (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5" aria-hidden />
            <time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time>
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-3.5" aria-hidden />
          {post.readingMinutes} min read
        </span>
        <ArrowUpRight
          className="ml-auto size-4 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand-500 dark:text-slate-600"
          aria-hidden
        />
      </div>
    </Link>
  )
}
