import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/cn'

const inlineComponents: Components = { p: ({ children }) => <>{children}</> }

interface MarkdownProps {
  children: string | undefined
  className?: string
  /** Render without block wrappers, for short fields inside sentences. */
  inline?: boolean
  /** Treat single newlines as line breaks (content written by the generators relies on this). */
  breaks?: boolean
  /** Allow raw HTML in the source. */
  html?: boolean
  components?: Components
}

/** Lightweight markdown renderer for short content fields. Blog posts use their own richer pipeline. */
export const Markdown = memo(function Markdown({ children, className, inline, breaks = true, html, components }: MarkdownProps) {
  if (!children) return null
  const remarkPlugins = breaks ? [remarkGfm, remarkBreaks] : [remarkGfm]
  const content = (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={html ? [rehypeRaw] : undefined}
      components={inline ? { ...inlineComponents, ...components } : components}
    >
      {children}
    </ReactMarkdown>
  )
  if (inline) return <span className={className}>{content}</span>
  return <div className={cn('markdown-compact', className)}>{content}</div>
})
