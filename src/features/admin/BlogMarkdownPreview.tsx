import { memo, useDeferredValue } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { remarkAlert } from 'remark-github-blockquote-alert'

const REMARK_PLUGINS = [remarkGfm, remarkAlert]
const REHYPE_PLUGINS = [rehypeRaw]

/**
 * Older posts still link images through the previous app's /api/blog/image route; the content pipeline
 * rewrites those at build time, so the preview does the same (the file itself is left untouched).
 */
function previewImageUrls(markdown: string): string {
  return markdown.replace(
    /(?:\/[a-z]{2})?\/api\/blog\/image\?slug=([^&"')\s]+)&(?:amp;)?file=([^"')\s]+)/g,
    (_, folder: string, file: string) => `/blog-images/${folder}/${decodeURIComponent(file).replace(/\.(png|jpe?g|gif)$/i, '.webp')}`,
  )
}

/** Live preview of a blog post body (GFM, GitHub alerts and raw HTML, like the post page). */
export const BlogMarkdownPreview = memo(function BlogMarkdownPreview({ markdown }: { markdown: string }) {
  const deferred = useDeferredValue(markdown)
  if (!deferred.trim()) return <p className="text-sm text-slate-400">Nothing to preview yet.</p>
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
        {previewImageUrls(deferred)}
      </ReactMarkdown>
    </div>
  )
})
