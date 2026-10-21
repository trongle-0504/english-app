import { ArrowLeft, CalendarDays, ChevronRight, Clock, RefreshCw, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Card } from '@/components/ui'
import { formatDate } from '@/lib/text'
import type { BlogPostMeta } from '@/types/content'

function Meta({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <dt>
        <Icon className="size-4" aria-hidden />
        <span className="sr-only">{label}</span>
      </dt>
      <dd>{children}</dd>
    </div>
  )
}

const crumbClass = 'transition-colors hover:text-brand-600 dark:hover:text-brand-400'

export function PostHeader({ post }: { post: BlogPostMeta }) {
  const topicHref = `/blog?topic=${post.topicId}`
  const updated = post.updatedAt && post.updatedAt.slice(0, 10) !== post.createdAt.slice(0, 10) ? post.updatedAt : undefined

  return (
    <Card className="animate-fade-in relative overflow-hidden p-4 sm:p-8">
      <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-brand-400/10 blur-3xl" aria-hidden />
      <Link
        to="/blog"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to Blog
      </Link>

      <nav aria-label="Breadcrumb" className="mt-3 sm:mt-5">
        <ol className="flex flex-wrap items-center gap-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <li>
            <Link to={topicHref} className={crumbClass}>
              {post.topic}
            </Link>
          </li>
          {post.subTopic !== post.topic ? (
            <li className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-slate-300 dark:text-slate-600" aria-hidden />
              <Link to={`${topicHref}&sub=${post.subTopicId}`} className={crumbClass}>
                {post.subTopic}
              </Link>
            </li>
          ) : null}
        </ol>
      </nav>

      <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 text-balance sm:text-4xl dark:text-white">{post.title}</h1>
      {post.excerpt ? <p className="mt-2 max-w-3xl text-base text-slate-500 sm:mt-3 sm:text-lg dark:text-slate-400">{post.excerpt}</p> : null}

      <dl className="mt-3 flex flex-wrap sm:mt-5 items-center gap-x-5 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
        {post.createdAt ? (
          <Meta icon={CalendarDays} label="Published">
            <time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time>
          </Meta>
        ) : null}
        {updated ? (
          <Meta icon={RefreshCw} label="Updated">
            <time dateTime={updated}>{formatDate(updated)}</time>
          </Meta>
        ) : null}
        <Meta icon={Clock} label="Reading time">
          {post.readingMinutes} min read
        </Meta>
      </dl>
    </Card>
  )
}
