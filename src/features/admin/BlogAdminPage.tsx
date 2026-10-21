import { Columns2, ExternalLink, Eye, FilePlus2, FileText, ImagePlus, Loader2, PenLine, Plus, Save } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Badge, Button, ButtonLink, SearchInput, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatDate, matchesQuery } from '@/lib/text'
import { adminApi, refreshSiteData, useAdminResource } from './api'
import { BlogMarkdownPreview } from './BlogMarkdownPreview'
import { ConfirmDelete, EditorSkeleton, Field, NamePicker, Panel, Select, StatusAlert, TextArea, TextInput } from './ui'
import { imageFiles, readFileAsBase64, slugify, useAction } from './utils'

interface BlogTopic {
  name: string
  description_vi: string
  postCount: number
  sub_topics: { name: string; description_vi: string }[]
  subTopicSuggestions: string[]
}

interface PostMeta {
  title: string
  slug: string
  urlSlug: string
  topic: string
  subTopic: string
  excerpt: string
  createdAt: string
  updatedAt?: string
}

interface BlogOverview {
  topics: BlogTopic[]
  posts: PostMeta[]
}

interface Draft {
  title: string
  /** Create mode only; follows the title until edited by hand or images are uploaded. */
  slug: string
  slugTouched: boolean
  topic: string
  subTopic: string
  excerpt: string
  markdown: string
}

type View = 'write' | 'split' | 'preview'

const emptyDraft = (topic = ''): Draft => ({ title: '', slug: '', slugTouched: false, topic, subTopic: '', excerpt: '', markdown: '' })

const draftFromPost = (post: PostMeta & { markdown: string }): Draft => ({
  title: post.title,
  slug: post.slug,
  slugTouched: true,
  topic: post.topic,
  // Posts without their own sub-topic store the topic name; show that as "none".
  subTopic: post.subTopic === post.topic ? '' : post.subTopic,
  excerpt: post.excerpt,
  markdown: post.markdown,
})

export default function BlogAdminPage() {
  const overview = useAdminResource<BlogOverview>('blog')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [saved, setSaved] = useState<Draft>(emptyDraft)
  const [editing, setEditing] = useState<PostMeta>()
  const [view, setView] = useState<View>('split')
  const [uploading, setUploading] = useState(0)
  const [query, setQuery] = useState('')
  const [topicFilter, setTopicFilter] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const action = useAction()

  const topics = overview.data?.topics ?? []
  const posts = overview.data?.posts
  const topic = topics.find((t) => t.name === draft.topic)
  const slug = editing ? editing.slug : draft.slug
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const visiblePosts = useMemo(
    () =>
      (posts ?? []).filter(
        (p) => (!topicFilter || p.topic === topicFilter) && (matchesQuery(p.title, query) || matchesQuery(p.slug, query) || matchesQuery(p.subTopic, query)),
      ),
    [posts, query, topicFilter],
  )

  const update = (patch: Partial<Draft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch }
      if (patch.title !== undefined && !editing && !d.slugTouched) next.slug = slugify(patch.title)
      return next
    })

  const confirmDiscard = () => !dirty || window.confirm('Discard unsaved changes to this post?')

  const startNew = () => {
    if (!confirmDiscard()) return
    const fresh = emptyDraft(draft.topic || topics[0]?.name)
    setDraft(fresh)
    setSaved(fresh)
    setEditing(undefined)
    action.setStatus(null)
  }

  const open = (meta: PostMeta) => {
    if (meta.slug === editing?.slug || !confirmDiscard()) return
    void action.run('load', async () => {
      const { post } = await adminApi<{ post: PostMeta & { markdown: string } }>('blog/post', { query: { slug: meta.slug } })
      const loaded = draftFromPost(post)
      setDraft(loaded)
      setSaved(loaded)
      setEditing(post)
    })
  }

  const applyTopics = (next: BlogTopic[]) => overview.data && overview.setData({ ...overview.data, topics: next })

  const createTopic = async (name: string, description_vi: string) =>
    Boolean(
      await action.run('topic', async () => {
        const res = await adminApi<{ topics: BlogTopic[] }>('blog/topics', { method: 'POST', body: { name, description_vi } })
        applyTopics(res.topics)
        return true
      }),
    )

  const declareSubTopic = () =>
    action.run('sub-topic', async () => {
      const res = await adminApi<{ topics: BlogTopic[] }>('blog/sub-topics', {
        method: 'POST',
        body: { topic: draft.topic, name: draft.subTopic },
      })
      applyTopics(res.topics)
      action.setStatus({ tone: 'success', message: `Sub-topic “${draft.subTopic.trim()}” added to ${draft.topic}.` })
    })

  const save = () =>
    action.run('save', async () => {
      const res = await adminApi<{ action: 'created' | 'updated'; post: PostMeta & { markdown: string } }>('blog/post', {
        method: 'PUT',
        body: {
          originalSlug: editing?.slug,
          title: draft.title,
          slug: editing ? undefined : draft.slug,
          topic: draft.topic,
          subTopic: draft.subTopic,
          excerpt: draft.excerpt,
          markdown: draft.markdown,
        },
      })
      const next = draftFromPost(res.post)
      setDraft(next)
      setSaved(next)
      setEditing(res.post)
      refreshSiteData('blog')
      overview.reload()
      action.setStatus({ tone: 'success', message: `Post ${res.action}: “${res.post.title}”.` })
    })

  const remove = () =>
    action.run('delete', async () => {
      if (!editing) return
      await adminApi('blog/post', { method: 'DELETE', query: { slug: editing.slug } })
      const fresh = emptyDraft(draft.topic)
      setDraft(fresh)
      setSaved(fresh)
      setEditing(undefined)
      refreshSiteData('blog')
      overview.reload()
      action.setStatus({ tone: 'success', message: `Deleted “${editing.title}”. Its images were kept.` })
    })

  /** Uploads images and inserts their markdown where the cursor was, via a placeholder that survives typing. */
  const upload = async (files: File[]) => {
    if (!files.length) return
    if (!slugify(slug)) {
      action.setStatus({ tone: 'error', message: 'Enter a title first — the slug names the image folder.' })
      return
    }
    if (!editing) update({ slugTouched: true })
    const token = `![Uploading ${files.length > 1 ? `${files.length} images` : files[0].name || 'image'}…](uploading:${Date.now()})`
    const el = textareaRef.current
    const start = el?.selectionStart ?? draft.markdown.length
    const end = el?.selectionEnd ?? start
    setDraft((d) => ({ ...d, markdown: `${d.markdown.slice(0, start)}${token}${d.markdown.slice(end)}` }))
    setUploading((n) => n + 1)
    try {
      const payload = await Promise.all(files.map(async (file) => ({ name: file.name, mimeType: file.type, data: await readFileAsBase64(file) })))
      const res = await adminApi<{ images: { file: string; url: string }[] }>('blog/images', { method: 'POST', body: { slug, files: payload } })
      const snippet = res.images.map((img) => `![${img.file.replace(/\.webp$/, '')}](${img.url})`).join('\n\n')
      setDraft((d) => ({ ...d, markdown: d.markdown.replace(token, snippet) }))
    } catch (error) {
      setDraft((d) => ({ ...d, markdown: d.markdown.replace(token, '') }))
      action.setStatus({ tone: 'error', message: `Image upload failed: ${(error as Error).message}` })
    } finally {
      setUploading((n) => n - 1)
    }
  }

  const canSave = Boolean(draft.title.trim() && draft.topic && draft.markdown.trim() && !action.pending && !uploading)
  const subTopicDeclared = !draft.subTopic.trim() || topic?.sub_topics.some((s) => s.name.toLowerCase() === draft.subTopic.trim().toLowerCase())

  const onEditorKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (canSave) void save()
    }
  }

  if (overview.loading && !overview.data) return <EditorSkeleton />

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
      <Panel
        className="p-4 sm:p-4 lg:sticky lg:top-20"
        icon={<FileText className="size-4.5" />}
        title={`Posts (${posts?.length ?? 0})`}
        actions={
          <Button size="sm" variant="outline" onClick={startNew}>
            <FilePlus2 className="size-3.5" /> New
          </Button>
        }
      >
        <div className="space-y-2">
          <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search posts…" />
          <Select value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)} aria-label="Filter by topic">
            <option value="">All topics</option>
            {topics.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} ({t.postCount})
              </option>
            ))}
          </Select>
        </div>
        <StatusAlert className="mt-3" status={overview.error ? { tone: 'error', message: overview.error } : null} />
        {visiblePosts.length ? (
          <ul className="scrollbar-thin -mx-1 mt-3 max-h-[65vh] space-y-0.5 overflow-y-auto">
            {visiblePosts.map((post) => (
              <li key={post.slug}>
                <button
                  type="button"
                  onClick={() => open(post)}
                  className={cn(
                    'w-full rounded-lg px-2.5 py-2 text-left transition',
                    editing?.slug === post.slug ? 'bg-brand-50 dark:bg-brand-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                  )}
                >
                  <span className={cn('line-clamp-2 text-sm font-semibold', editing?.slug === post.slug ? 'text-brand-700 dark:text-brand-300' : 'text-slate-800 dark:text-slate-100')}>
                    {post.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                    {post.topic}
                    {post.subTopic !== post.topic ? ` › ${post.subTopic}` : ''} · {formatDate(post.updatedAt || post.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-center text-sm text-slate-500">{posts?.length ? 'No posts match.' : 'No posts yet.'}</p>
        )}
      </Panel>

      <div className="min-w-0" onKeyDown={onEditorKeyDown}>
        <Panel
          icon={<PenLine className="size-4.5" />}
          title={editing ? 'Edit post' : 'New post'}
          description={
            editing ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <code className="text-xs">{editing.slug}</code>
                {dirty ? <Badge tone="amber">Unsaved changes</Badge> : <Badge tone="emerald">Saved</Badge>}
              </span>
            ) : (
              'Markdown with live preview. Paste or drop images straight into the editor.'
            )
          }
          actions={
            editing ? (
              <>
                <ButtonLink to={`/blog/${editing.urlSlug}`} target="_blank" variant="ghost" size="sm">
                  View <ExternalLink className="size-3" />
                </ButtonLink>
                <ConfirmDelete busy={action.pending === 'delete'} onConfirm={() => void remove()} />
              </>
            ) : null
          }
        >
          {action.pending === 'load' ? (
            <div className="grid h-96 place-items-center text-slate-400">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : (
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Title"
                  htmlFor="blog-title"
                  className="md:col-span-2"
                  hint={
                    editing ? (
                      <>The slug stays <code>{editing.slug}</code> so links and image folders keep working.</>
                    ) : (
                      <span className="inline-flex flex-wrap items-center gap-1">
                        Slug
                        <input
                          value={draft.slug}
                          onChange={(e) => update({ slug: e.target.value, slugTouched: true })}
                          aria-label="Slug"
                          className="min-w-40 rounded-md border border-transparent bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 focus:border-brand-400 focus:outline-none dark:bg-slate-800 dark:text-slate-200"
                        />
                        <span>→ /blog/{slugify(draft.slug) || '…'}</span>
                      </span>
                    )
                  }
                >
                  <TextInput id="blog-title" value={draft.title} onChange={(e) => update({ title: e.target.value })} placeholder="IELTS Listening: Map questions" required />
                </Field>

                <NamePicker
                  label="Topic"
                  value={topic ? draft.topic : ''}
                  onChange={(name) => update({ topic: name })}
                  options={topics.map((t) => ({ value: t.name, label: `${t.name} (${t.postCount})` }))}
                  placeholder="Choose a topic"
                  onCreate={createTopic}
                />

                <Field
                  label="Sub-topic"
                  htmlFor="blog-subtopic"
                  hint="Free text. Empty → the post is grouped under the topic itself."
                  action={
                    !subTopicDeclared && topic ? (
                      <button
                        type="button"
                        onClick={() => void declareSubTopic()}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/50"
                      >
                        <Plus className="size-3.5" /> Add to topic list
                      </button>
                    ) : null
                  }
                >
                  <TextInput
                    id="blog-subtopic"
                    list="blog-subtopic-options"
                    value={draft.subTopic}
                    onChange={(e) => update({ subTopic: e.target.value })}
                    placeholder={topic ? `e.g. ${topic.subTopicSuggestions.find((s) => s !== topic.name) ?? 'Part 1'}` : 'Choose a topic first'}
                    disabled={!topic}
                  />
                  <datalist id="blog-subtopic-options">
                    {topic?.subTopicSuggestions.filter((s) => s !== topic.name).map((s) => <option key={s} value={s} />)}
                  </datalist>
                </Field>

                <Field label="Excerpt (optional)" htmlFor="blog-excerpt" className="md:col-span-2">
                  <TextInput id="blog-excerpt" value={draft.excerpt} onChange={(e) => update({ excerpt: e.target.value })} placeholder="One sentence shown on the blog list." />
                </Field>
              </div>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <SegmentedControl
                    size="sm"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: 'write', label: 'Write', icon: <PenLine className="size-3.5" /> },
                      { value: 'split', label: 'Split', icon: <Columns2 className="size-3.5" /> },
                      { value: 'preview', label: 'Preview', icon: <Eye className="size-3.5" /> },
                    ]}
                  />
                  <div className="flex items-center gap-2">
                    {uploading ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                        <Loader2 className="size-3.5 animate-spin" /> Uploading…
                      </span>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                      <ImagePlus className="size-3.5" /> Image
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      multiple
                      hidden
                      onChange={(e) => {
                        void upload(Array.from(e.target.files ?? []))
                        e.target.value = ''
                      }}
                    />
                  </div>
                </div>
                <div className={cn('grid gap-3', view === 'split' && 'xl:grid-cols-2')}>
                  {view !== 'preview' ? (
                    <TextArea
                      ref={textareaRef}
                      aria-label="Markdown"
                      value={draft.markdown}
                      onChange={(e) => update({ markdown: e.target.value })}
                      onPaste={(e) => {
                        const files = imageFiles(e.clipboardData)
                        if (!files.length) return
                        e.preventDefault()
                        void upload(files)
                      }}
                      onDrop={(e) => {
                        const files = imageFiles(e.dataTransfer)
                        if (!files.length) return
                        e.preventDefault()
                        void upload(files)
                      }}
                      spellCheck={false}
                      placeholder={'## Heading\n\nWrite in Markdown. Paste a screenshot to upload it here.'}
                      className="h-[65vh] min-h-96 resize-y font-mono text-[13px]"
                    />
                  ) : null}
                  {view !== 'write' ? (
                    <div className="scrollbar-thin h-[65vh] min-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-950/40">
                      <BlogMarkdownPreview markdown={draft.markdown} />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                <Button type="submit" size="lg" disabled={!canSave} loading={action.pending === 'save'}>
                  <Save className="size-4" /> {editing ? 'Save changes' : 'Create post'}
                </Button>
                <span className="text-xs text-slate-500">
                  Ctrl+S to save
                  {editing ? ` · created ${formatDate(editing.createdAt)}` : ''}
                </span>
              </div>
              <StatusAlert status={action.status} onDismiss={() => action.setStatus(null)} />
            </form>
          )}
        </Panel>
      </div>
    </div>
  )
}
