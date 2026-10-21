import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import GithubSlugger from 'github-slugger'
import type { BlogHeading, BlogIndex, BlogPost, BlogPostMeta } from '../src/types/content.ts'
import { contentPath, listFiles, readJson, slugify, warn, type Output } from './shared.ts'

interface RawBlogTopics {
  topics?: { name: string; description_vi?: string; sub_topics?: { name: string }[] }[]
}

interface RawPost {
  title: string
  slug: string
  topic: string
  subTopic?: string
  excerpt?: string
  createdAt?: string
  updatedAt?: string
}

/** Old posts point at the Next.js image route; images now live in /blog-images as WebP. */
function rewriteImageUrls(markdown: string): string {
  return markdown.replace(
    /(?:\/[a-z]{2})?\/api\/blog\/image\?slug=([^&"')\s]+)&(?:amp;)?file=([^"')\s]+)/g,
    (_, folder: string, file: string) =>
      `/blog-images/${folder}/${decodeURIComponent(file).replace(/\.(png|jpe?g|gif)$/i, '.webp')}`,
  )
}

function plainHeadingText(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

/** Same ids rehype-slug will generate at render time (both use github-slugger). */
function extractHeadings(markdown: string): BlogHeading[] {
  const slugger = new GithubSlugger()
  const headings: BlogHeading[] = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) continue
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) continue
    const text = plainHeadingText(match[2])
    const id = slugger.slug(text)
    const depth = match[1].length
    if (depth >= 2 && depth <= 4 && text) headings.push({ id, text, depth: depth as 2 | 3 | 4 })
  }
  return headings
}

function indexMarkdownFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>()
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const full = path.join(entry.parentPath, entry.name)
    const rel = path.relative(dir, full)
    files.set(rel, full)
  }
  return files
}

export function buildBlog(root: string, out: Output): BlogPostMeta[] {
  const topicFile = readJson<RawBlogTopics>(contentPath(root, 'blog/topics.json'), {})
  const markdownDir = contentPath(root, 'blog/markdown')
  const mdFiles = indexMarkdownFiles(markdownDir)
  const postsDir = contentPath(root, 'blog/posts')

  const findMarkdown = (post: RawPost): string | undefined => {
    const candidates = [path.join(post.topic, `${post.slug}.md`), `${post.slug}.md`]
    for (const rel of candidates) if (mdFiles.has(rel)) return mdFiles.get(rel)
    // Fall back to any folder: a few posts were saved under a different topic folder.
    for (const [rel, full] of mdFiles) if (path.basename(rel) === `${post.slug}.md`) return full
    return undefined
  }

  const toPost = (raw: RawPost, slug: string, mdPath: string | undefined): BlogPost => {
    const markdown = mdPath ? rewriteImageUrls(readFileSync(mdPath, 'utf8')) : ''
    const subTopic = raw.subTopic?.trim() || raw.topic
    const words = markdown.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
    return {
      slug,
      sourceSlug: raw.slug,
      title: raw.title,
      topicId: slugify(raw.topic),
      topic: raw.topic,
      subTopicId: slugify(subTopic),
      subTopic,
      excerpt: raw.excerpt ?? '',
      createdAt: raw.createdAt ?? '',
      updatedAt: raw.updatedAt,
      readingMinutes: Math.max(1, Math.round(words / 200)),
      markdown,
      headings: extractHeadings(markdown),
    }
  }

  const posts: BlogPost[] = []
  const usedFiles = new Set<string>()
  for (const file of listFiles(postsDir, '.json')) {
    for (const raw of readJson<RawPost[]>(path.join(postsDir, file), [])) {
      if (!raw?.slug || !raw.title) continue
      const slug = slugify(raw.slug)
      if (posts.some((p) => p.slug === slug)) {
        warn(`blog: duplicate slug "${raw.slug}" in ${file}, skipped`)
        continue
      }
      const mdPath = findMarkdown(raw)
      if (!mdPath) warn(`blog: no markdown file for "${raw.topic}/${raw.slug}"`)
      else usedFiles.add(mdPath)
      posts.push(toPost(raw, slug, mdPath))
    }
  }

  // Markdown files without a metadata entry are published too: topic = folder, title = file name.
  // Files starting with "_", "*template*" files and empty files are drafts and stay hidden.
  for (const [rel, full] of mdFiles) {
    const name = path.basename(rel, '.md')
    if (usedFiles.has(full) || name.startsWith('_') || /template/i.test(name)) continue
    if (!readFileSync(full, 'utf8').trim()) continue // empty file, nothing written yet
    const slug = slugify(name)
    if (posts.some((p) => p.slug === slug)) continue
    const folder = path.dirname(rel)
    const topic = folder === '.' ? 'General' : folder.split(path.sep)[0]
    const title = name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    posts.push(
      toPost(
        { slug: name, title: title.charAt(0).toUpperCase() + title.slice(1), topic, createdAt: statSync(full).mtime.toISOString() },
        slug,
        full,
      ),
    )
  }
  posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const topicsById = new Map<string, BlogIndex['topics'][number]>()
  for (const topic of topicFile.topics ?? []) {
    topicsById.set(slugify(topic.name), {
      id: slugify(topic.name),
      name: topic.name,
      description_vi: topic.description_vi || undefined,
      subTopics: [],
      count: 0,
    })
  }
  for (const post of posts) {
    const topic = topicsById.get(post.topicId) ?? { id: post.topicId, name: post.topic, subTopics: [], count: 0 }
    topic.count++
    const sub = topic.subTopics.find((s) => s.id === post.subTopicId)
    if (sub) sub.count++
    else topic.subTopics.push({ id: post.subTopicId, name: post.subTopic, count: 1 })
    topicsById.set(topic.id, topic)
  }

  const metas: BlogPostMeta[] = posts.map(({ markdown: _markdown, headings: _headings, ...meta }) => meta)
  const index: BlogIndex = {
    topics: [...topicsById.values()].map((t) => ({ ...t, subTopics: t.subTopics.sort((a, b) => a.name.localeCompare(b.name)) })),
    posts: metas,
  }
  out.set('blog/index.json', index)
  for (const post of posts) out.set(`blog/${post.slug}.json`, post)
  return metas
}
