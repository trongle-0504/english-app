import 'katex/dist/katex.min.css'
import './post.css'
import { memo, type ComponentProps, type JSX } from 'react'
import ReactMarkdown, { type Components, type ExtraProps, type Options } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSlug from 'rehype-slug'
import { remarkAlert } from 'remark-github-blockquote-alert'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { cn } from '@/lib/cn'
import { escapeCurrency } from './escapeCurrency'
import { rehypeDarkColors } from './rehypeDarkColors'
import { VocabTerm } from './VocabTerm'

const remarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath, remarkAlert]
// Raw HTML first so slugs, math and colour tagging also see elements written as HTML.
const rehypePlugins: Options['rehypePlugins'] = [rehypeRaw, rehypeSlug, [rehypeKatex, { strict: false }], rehypeDarkColors]

type Props<Tag extends keyof JSX.IntrinsicElements> = ComponentProps<Tag> & ExtraProps

/** Number of images when a paragraph holds nothing but images (and line breaks), else 0. */
function imageCount(node: ExtraProps['node']): number {
  if (!node) return 0
  let images = 0
  for (const child of node.children) {
    if (child.type === 'element' && child.tagName === 'img') images++
    else if (!(child.type === 'element' && child.tagName === 'br') && !(child.type === 'text' && !child.value.trim())) return 0
  }
  return images
}

function Paragraph({ node, ...props }: Props<'p'>) {
  const images = imageCount(node)
  if (!images) return <p {...props} />
  return <div className={cn('not-prose my-6 grid items-start gap-4 [&>br]:hidden', images > 1 && 'sm:grid-cols-2')}>{props.children}</div>
}

function Image({ node: _node, className, alt = '', ...props }: Props<'img'>) {
  return (
    <img
      {...props}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn('mx-auto h-auto max-w-full rounded-xl border border-slate-200 bg-slate-100 shadow-sm dark:border-slate-800 dark:bg-slate-800', className)}
    />
  )
}

function Table({ node: _node, className, ...props }: Props<'table'>) {
  // `table-wrapper` is targeted by <style> blocks inside some posts.
  return (
    <div className="table-wrapper scrollbar-thin my-6 overflow-x-auto">
      <table {...props} className={cn('my-0! table w-full', className)} />
    </div>
  )
}

function Anchor({ node: _node, href, ...props }: Props<'a'>) {
  const external = href ? /^https?:\/\//.test(href) : false
  return <a href={href} {...props} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : null)} />
}

// rehype-raw lowercases tag names, so <T> arrives as `t`.
const components = { p: Paragraph, img: Image, table: Table, a: Anchor, t: VocabTerm, T: VocabTerm } as Components

/** The (large) post body. Memoised so scroll-driven TOC updates never re-render it. */
export const PostBody = memo(function PostBody({ markdown }: { markdown: string }) {
  return (
    <div className="markdown blog-post prose-headings:scroll-mt-28 prose-h2:mt-12 prose-h2:border-b prose-h2:border-slate-200 prose-h2:pb-2 prose-img:my-0 dark:prose-h2:border-slate-800">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {escapeCurrency(markdown)}
      </ReactMarkdown>
    </div>
  )
})
