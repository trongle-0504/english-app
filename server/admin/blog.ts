// Blog admin. Metadata: content/blog/posts/posts-<slug(topic)>.json; body: content/blog/markdown/<Topic>/<slug>.md;
// images: original in content/blog/images/<folder>/, served WebP copy in public/blog-images/<folder>/.
import { existsSync } from 'node:fs'
import { readdir, readFile, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { slugify } from '../../content-pipeline/shared.ts'
import { ApiError, type ApiContext, type ApiHandler } from '../api.ts'
import { contentFile, writeTextFile } from '../files.ts'
import { isObject, jsonBody, optionalName, optionalText, queryParam, requiredName, requiredText, sameName } from './input.ts'
import { applyStyle, detectStyle, exclusive, readJsonDoc, writeJsonDoc, type TextStyle } from './store.ts'

interface RawSubTopic {
  name: string
  description_vi?: string
}

interface RawTopic {
  name: string
  description_vi?: string
  sub_topics: RawSubTopic[]
}

interface TopicFile {
  topics: RawTopic[]
}

export interface RawPost {
  title: string
  slug: string
  topic: string
  subTopic: string
  excerpt: string
  images: string[]
  createdAt: string
  updatedAt?: string
}

interface PostsFile {
  file: string
  posts: RawPost[]
  style: TextStyle
}

const topicsFile = (ctx: ApiContext) => contentFile(ctx.contentDir, 'blog', 'topics.json')
const postsDir = (ctx: ApiContext) => contentFile(ctx.contentDir, 'blog', 'posts')
const postsFileFor = (ctx: ApiContext, topic: string) => contentFile(ctx.contentDir, 'blog', 'posts', `posts-${slugify(topic)}.json`)
const markdownDir = (ctx: ApiContext) => contentFile(ctx.contentDir, 'blog', 'markdown')
const markdownFileFor = (ctx: ApiContext, topic: string, slug: string) => contentFile(ctx.contentDir, 'blog', 'markdown', topic, `${slug}.md`)

function topicList(file: TopicFile): RawTopic[] {
  file.topics = Array.isArray(file.topics) ? file.topics : []
  for (const topic of file.topics) topic.sub_topics ??= []
  return file.topics
}

async function readPostsFiles(ctx: ApiContext): Promise<PostsFile[]> {
  const dir = postsDir(ctx)
  const names = existsSync(dir) ? (await readdir(dir)).filter((n) => n.endsWith('.json')).sort() : []
  return Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name)
      const doc = await readJsonDoc<RawPost[]>(file, [])
      return { file, posts: Array.isArray(doc.value) ? doc.value : [], style: doc.style }
    }),
  )
}

function findPost(files: PostsFile[], slug: string): { source: PostsFile; index: number } | undefined {
  for (const exact of [true, false]) {
    for (const source of files) {
      const index = source.posts.findIndex((p) => (exact ? p.slug === slug : slugify(p.slug) === slugify(slug)))
      if (index >= 0) return { source, index }
    }
  }
  return undefined
}

/** Same lookup order as content-pipeline/blog.ts: <topic>/<slug>.md, <slug>.md, then any folder. */
async function findMarkdown(ctx: ApiContext, post: RawPost): Promise<string | undefined> {
  const root = markdownDir(ctx)
  for (const file of [markdownFileFor(ctx, post.topic, post.slug), path.join(root, `${post.slug}.md`)]) {
    if (existsSync(file)) return file
  }
  if (!existsSync(root)) return undefined
  const match = (await readdir(root, { recursive: true })).find((rel) => path.basename(rel) === `${post.slug}.md`)
  return match ? path.join(root, match) : undefined
}

/** Deletes a markdown file, and its topic folder once that is empty. */
async function removeMarkdown(ctx: ApiContext, file: string) {
  await unlink(file)
  const dir = path.dirname(file)
  if (dir !== markdownDir(ctx) && !(await readdir(dir)).length) await rmdir(dir)
}

async function writePostsFile(file: string, posts: RawPost[], style?: TextStyle) {
  if (posts.length) await writeJsonDoc(file, posts, style)
  else if (existsSync(file)) await unlink(file) // no empty posts-*.json left behind
}

function summarize(topics: RawTopic[], files: PostsFile[]) {
  const posts = files.flatMap((f) => f.posts)
  return topics.map((topic) => {
    const own = posts.filter((p) => sameName(p.topic, topic.name))
    const subNames = [...topic.sub_topics.map((s) => s.name), ...own.map((p) => p.subTopic)].filter(Boolean)
    return {
      name: topic.name,
      description_vi: topic.description_vi ?? '',
      postCount: own.length,
      sub_topics: topic.sub_topics.map((s) => ({ name: s.name, description_vi: s.description_vi ?? '' })),
      /** Declared sub-topics plus the ones posts already use, for suggestions. */
      subTopicSuggestions: [...new Map(subNames.map((n) => [n.toLowerCase(), n])).values()].sort((a, b) => a.localeCompare(b)),
    }
  })
}

const toMeta = (post: RawPost) => ({ ...post, urlSlug: slugify(post.slug) })

/* ───────────── Handlers ───────────── */

export const listBlog: ApiHandler = async (_req, ctx) => {
  const [topicsDoc, files] = await Promise.all([readJsonDoc<TopicFile>(topicsFile(ctx), { topics: [] }), readPostsFiles(ctx)])
  const posts = files
    .flatMap((f) => f.posts)
    .filter((p) => p?.slug && p.title)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return { json: { topics: summarize(topicList(topicsDoc.value), files), posts: posts.map(toMeta) } }
}

export const getPost: ApiHandler = async (req, ctx) => {
  const slug = queryParam(req, 'slug')
  const found = findPost(await readPostsFiles(ctx), slug)
  if (!found) throw new ApiError(404, `No blog post with slug "${slug}".`)
  const post = found.source.posts[found.index]
  const file = await findMarkdown(ctx, post)
  const markdown = file ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : ''
  return { json: { post: { ...toMeta(post), markdown } } }
}

function topicMutation(ctx: ApiContext, mutate: (topics: RawTopic[]) => void) {
  return exclusive(async () => {
    const doc = await readJsonDoc<TopicFile>(topicsFile(ctx), { topics: [] })
    const topics = topicList(doc.value)
    mutate(topics)
    await writeJsonDoc(topicsFile(ctx), doc.value, doc.style)
    return summarize(topics, await readPostsFiles(ctx))
  })
}

export const createTopic: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const name = requiredName(body, 'name')
  const description = optionalText(body, 'description_vi', { max: 500 })
  if (!slugify(name)) throw new ApiError(400, 'The topic name must contain letters or digits.')
  const topics = await topicMutation(ctx, (list) => {
    if (list.some((t) => slugify(t.name) === slugify(name))) throw new ApiError(409, `Topic "${name}" already exists.`)
    list.push({ name, description_vi: description, sub_topics: [] })
  })
  ctx.onContentChange()
  return { status: 201, json: { topics } }
}

export const createSubTopic: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const topicName = requiredName(body, 'topic')
  const name = requiredName(body, 'name')
  const description = optionalText(body, 'description_vi', { max: 500 })
  const topics = await topicMutation(ctx, (list) => {
    const topic = list.find((t) => sameName(t.name, topicName))
    if (!topic) throw new ApiError(400, `Topic "${topicName}" does not exist.`)
    if (topic.sub_topics.some((s) => sameName(s.name, name))) throw new ApiError(409, `Sub-topic "${name}" already exists in "${topic.name}".`)
    topic.sub_topics.push({ name, description_vi: description })
  })
  ctx.onContentChange()
  return { status: 201, json: { topics } }
}

/**
 * Create (no originalSlug) or update a post. In edit mode the stored slug never changes, so links and
 * image folders stay valid; changing the topic moves the markdown file and the metadata entry.
 */
export const savePost: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const title = requiredText(body, 'title', { max: 200, collapse: true })
  const topicName = requiredName(body, 'topic')
  const subTopicInput = optionalName(body, 'subTopic')
  const excerpt = optionalText(body, 'excerpt', { max: 1000, collapse: true })
  if (typeof body.markdown !== 'string' || !body.markdown.trim()) throw new ApiError(400, '"markdown" is required.')
  const markdown = body.markdown
  const originalSlug = optionalText(body, 'originalSlug') || undefined
  const requestedSlug = optionalName(body, 'slug', 160)

  const result = await exclusive(async () => {
    const topicsDoc = await readJsonDoc<TopicFile>(topicsFile(ctx), { topics: [] })
    const topic = topicList(topicsDoc.value).find((t) => sameName(t.name, topicName))
    if (!topic) throw new ApiError(400, `Topic "${topicName}" does not exist. Create it first.`)
    const subTopic = subTopicInput || topic.name

    const files = await readPostsFiles(ctx)
    const found = originalSlug ? findPost(files, originalSlug) : undefined
    if (originalSlug && !found) throw new ApiError(404, `No blog post with slug "${originalSlug}".`)
    const previous = found ? found.source.posts[found.index] : undefined

    const slug = previous?.slug ?? (requestedSlug || slugify(title))
    if (!slugify(slug)) throw new ApiError(400, 'Cannot derive a slug from this title; enter one.')
    if (!previous && findPost(files, slug)) throw new ApiError(409, `A post with slug "${slugify(slug)}" already exists.`)

    const now = new Date().toISOString()
    const post: RawPost = {
      title,
      slug,
      topic: topic.name,
      subTopic,
      excerpt,
      images: previous?.images ?? [],
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }

    // 1. Markdown body (keeping the old file's line endings), then drop the old file if it moved.
    const oldMarkdown = previous ? await findMarkdown(ctx, previous) : undefined
    const style = oldMarkdown ? detectStyle(await readFile(oldMarkdown, 'utf8')) : undefined
    const newMarkdown = markdownFileFor(ctx, post.topic, slug)
    await writeTextFile(newMarkdown, applyStyle(markdown, style ?? { eol: '\n', finalNewline: true }))

    // 2. Metadata: replace in place, or move between posts files when the topic changed.
    const target = postsFileFor(ctx, post.topic)
    if (found && found.source.file === target) {
      found.source.posts[found.index] = post
      await writeJsonDoc(target, found.source.posts, found.source.style)
    } else {
      const existing = files.find((f) => f.file === target)
      // A new posts file copies the formatting of its siblings.
      await writeJsonDoc(target, [post, ...(existing?.posts ?? [])], (existing ?? files[0])?.style)
      if (found) {
        found.source.posts.splice(found.index, 1)
        await writePostsFile(found.source.file, found.source.posts, found.source.style)
      }
    }
    if (oldMarkdown && path.resolve(oldMarkdown) !== path.resolve(newMarkdown)) await removeMarkdown(ctx, oldMarkdown)

    return { action: previous ? ('updated' as const) : ('created' as const), post: { ...toMeta(post), markdown } }
  })
  ctx.onContentChange()
  return { status: result.action === 'created' ? 201 : 200, json: result }
}

export const deletePost: ApiHandler = async (req, ctx) => {
  const slug = queryParam(req, 'slug')
  await exclusive(async () => {
    const found = findPost(await readPostsFiles(ctx), slug)
    if (!found) throw new ApiError(404, `No blog post with slug "${slug}".`)
    const [post] = found.source.posts.splice(found.index, 1)
    const markdown = await findMarkdown(ctx, post)
    await writePostsFile(found.source.file, found.source.posts, found.source.style)
    if (markdown) await removeMarkdown(ctx, markdown)
  })
  ctx.onContentChange()
  return { json: { ok: true, slug } }
}

/* ───────────── Images ───────────── */

const IMAGE_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_FILES = 10

/**
 * Saves pasted/uploaded images for a post: the original under content/blog/images/<folder>/ and a
 * WebP copy (same settings as scripts/optimize-images.mjs) under public/blog-images/<folder>/.
 */
export const uploadImages: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const folder = slugify(requiredText(body, 'slug', { max: 160 }))
  if (!folder) throw new ApiError(400, '"slug" must contain letters or digits (it names the image folder).')
  if (!Array.isArray(body.files) || !body.files.length) throw new ApiError(400, '"files" must be a non-empty array of { name, mimeType, data }.')
  if (body.files.length > MAX_FILES) throw new ApiError(400, `At most ${MAX_FILES} images per upload.`)

  const uploads = body.files.map((item, i) => {
    if (!isObject(item) || typeof item.data !== 'string' || typeof item.mimeType !== 'string') {
      throw new ApiError(400, `"files[${i}]" must be { name, mimeType, data } with base64 data.`)
    }
    const ext = IMAGE_EXT[item.mimeType]
    if (!ext) throw new ApiError(400, `"files[${i}]": only PNG, JPEG, WebP and GIF images are supported.`)
    const buffer = Buffer.from(item.data.replace(/^data:[^,]*,/, ''), 'base64')
    if (!buffer.length) throw new ApiError(400, `"files[${i}]" is empty.`)
    if (buffer.length > MAX_IMAGE_BYTES) throw new ApiError(400, `"files[${i}]" is larger than 15 MB.`)
    const base = slugify(path.parse(typeof item.name === 'string' ? item.name : '').name) || 'image'
    return { base, ext, buffer }
  })

  let sharp: typeof import('sharp').default
  try {
    sharp = (await import('sharp')).default
  } catch {
    throw new ApiError(503, 'Image conversion needs the "sharp" package (npm install).')
  }

  const originalsDir = contentFile(ctx.contentDir, 'blog', 'images', folder)
  const publicDir = path.join(ctx.rootDir, 'public', 'blog-images', folder)
  const images = await exclusive(async () => {
    const saved: { file: string; url: string }[] = []
    for (const { base, ext, buffer } of uploads) {
      let webp: Buffer
      try {
        webp = await sharp(buffer, { animated: ext === '.gif' }).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
      } catch {
        throw new ApiError(400, `"${base}${ext}" is not a readable image.`)
      }
      let name = base
      for (let n = 1; existsSync(path.join(originalsDir, `${name}${ext}`)) || existsSync(path.join(publicDir, `${name}.webp`)); n++) {
        name = `${base}-${n}`
      }
      await writeTextFile(path.join(originalsDir, `${name}${ext}`), buffer)
      await writeTextFile(path.join(publicDir, `${name}.webp`), webp)
      saved.push({ file: `${name}.webp`, url: `/blog-images/${folder}/${name}.webp` })
    }
    return saved
  })
  ctx.onContentChange()
  return { status: 201, json: { folder, images } }
}
