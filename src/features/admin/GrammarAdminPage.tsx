import { ExternalLink, SpellCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, ButtonLink } from '@/components/ui'
import { useLocalStorage } from '@/lib/storage'
import { adminApi, refreshSiteData, useAdminResource } from './api'
import { EntryEditor } from './EntryEditor'
import { EditorSkeleton, Field, NamePicker, Panel, StatusAlert, TextArea, TextInput, Toggle } from './ui'
import { slugify, useAction, useAdminContext } from './utils'

interface GrammarTopic {
  name: string
  description_vi: string
  lessons: string[]
}

interface GrammarOverview {
  topics: GrammarTopic[]
  lessons: string[]
}

interface LessonEntry {
  title: string
  [key: string]: unknown
}

const isLesson = (value: unknown): value is LessonEntry =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as LessonEntry).title === 'string'

const LESSON_TEMPLATE = {
  title: '',
  level: 'B1',
  brief_description_vi: '',
  structures: [{ type: 'affirmative', formula: '', example: '' }],
  usages: [{ explanation_vi: '', examples: [{ en: '', vi: '' }] }],
  signals: [],
  notes_and_exceptions: [],
}

export default function GrammarAdminPage() {
  const { gemini } = useAdminContext()
  const overview = useAdminResource<GrammarOverview>('grammar')
  const [topicName, setTopicName] = useLocalStorage('english-app:admin-grammar-topic', '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const form = useAction()

  const [json, setJson] = useState('')
  const [original, setOriginal] = useState<string>()
  const [lessonTopics, setLessonTopics] = useState<string[]>([])
  const [lastAction, setLastAction] = useState<'created' | 'updated'>()
  const [addToSelected, setAddToSelected] = useState(false)
  const editor = useAction()

  const topics = overview.data?.topics ?? []
  const topic = topics.find((t) => t.name === topicName)

  const showLesson = (entry: LessonEntry, inTopics: string[], action?: 'created' | 'updated') => {
    setJson(JSON.stringify(entry, null, 2))
    setOriginal(entry.title)
    setLessonTopics(inTopics)
    setLastAction(action)
  }

  const createTopic = async (name: string, description_vi: string) =>
    Boolean(
      await form.run('topic', async () => {
        const res = await adminApi<{ topics: GrammarTopic[] }>('grammar/topics', { method: 'POST', body: { name, description_vi } })
        if (overview.data) overview.setData({ ...overview.data, topics: res.topics })
        return true
      }),
    )

  const generate = () =>
    form.run('generate', async () => {
      if (!topic) throw new Error('Choose a topic first.')
      const res = await adminApi<{ action: 'created' | 'updated'; entry: LessonEntry; topic: string }>('grammar/generate', {
        method: 'POST',
        body: { title, description, topic: topic.name },
      })
      showLesson(res.entry, [res.topic], res.action)
      editor.setStatus(null)
      refreshSiteData('grammar')
      overview.reload()
      form.setStatus({ tone: 'success', message: `"${res.entry.title}" ${res.action} and listed under ${res.topic}.` })
      setTitle('')
      setDescription('')
    })

  const load = (name: string) =>
    editor.run('load', async () => {
      const res = await adminApi<{ entry: LessonEntry; topics: string[] }>('grammar/lesson', { query: { title: name } })
      showLesson(res.entry, res.topics)
    })

  const save = (value: unknown) =>
    editor.run('save', async () => {
      if (!isLesson(value)) throw new Error('The JSON must be an object with a "title" string.')
      const linkTopic = addToSelected && topic ? topic.name : undefined
      const res = await adminApi<{ action: 'created' | 'updated'; entry: LessonEntry }>('grammar/lesson', {
        method: 'PUT',
        body: { entry: value, originalTitle: original, topic: linkTopic },
      })
      showLesson(res.entry, linkTopic && !lessonTopics.includes(linkTopic) ? [...lessonTopics, linkTopic] : lessonTopics, res.action)
      setAddToSelected(false)
      refreshSiteData('grammar')
      overview.reload()
      editor.setStatus({ tone: 'success', message: `Saved "${res.entry.title}" (${res.action}).` })
    })

  const clear = () => {
    setJson('')
    setOriginal(undefined)
    setLessonTopics([])
    setLastAction(undefined)
    editor.setStatus(null)
  }

  if (overview.loading && !overview.data) return <EditorSkeleton />

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Panel icon={<Sparkles className="size-4.5" />} title="Generate a lesson" description="Structures, usages, signal words and exceptions, explained in Vietnamese.">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            void generate()
          }}
        >
          <StatusAlert status={overview.error ? { tone: 'error', message: overview.error } : null} />
          <NamePicker
            label="Topic"
            value={topic ? topicName : ''}
            onChange={setTopicName}
            options={topics.map((t) => ({ value: t.name, label: `${t.name} (${t.lessons.length} lessons)` }))}
            placeholder="Choose a topic"
            onCreate={createTopic}
          />
          <Field label="Lesson title" htmlFor="grammar-title" hint="Used as the lesson's identity: generating the same title again replaces it.">
            <TextInput id="grammar-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Present Perfect Continuous" required />
          </Field>
          <Field label="Instructions (optional)" htmlFor="grammar-notes" hint="What to cover, level, examples to include. Empty → standard foundational content.">
            <TextArea
              id="grammar-notes"
              rows={8}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Focus on the difference with Present Perfect; include IELTS Speaking examples."
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" loading={form.pending === 'generate'} disabled={!gemini || !title.trim() || !topic || Boolean(form.pending)}>
              <Sparkles className="size-4" /> Generate & save
            </Button>
            {!gemini ? <span className="text-xs text-slate-500">Needs GEMINI_API_KEY on the server.</span> : null}
          </div>
          <StatusAlert status={form.status} onDismiss={() => form.setStatus(null)} />
        </form>
      </Panel>

      <EntryEditor
        title="Lesson JSON"
        description="Fix wording or examples by hand. Load an existing lesson, or start from the template."
        loadOptions={overview.data?.lessons}
        loadPlaceholder="Load an existing lesson…"
        onLoad={load}
        value={json}
        onChange={setJson}
        onSave={save}
        onClear={clear}
        pending={editor.pending}
        status={editor.status}
        onDismissStatus={() => editor.setStatus(null)}
        summary={
          original ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3.5 py-3 text-sm dark:bg-slate-800/50">
              <SpellCheck className="size-4 text-brand-600 dark:text-brand-400" />
              <span className="font-bold text-slate-900 dark:text-white">{original}</span>
              {lastAction ? <Badge tone={lastAction === 'created' ? 'emerald' : 'sky'}>{lastAction}</Badge> : null}
              {lessonTopics.map((name) => (
                <Badge key={name}>{name}</Badge>
              ))}
              {!lessonTopics.length ? <Badge tone="amber">Not in a topic (shown under “Other”)</Badge> : null}
              <ButtonLink to={`/grammar/${slugify(original)}`} target="_blank" variant="ghost" size="sm" className="ml-auto">
                View <ExternalLink className="size-3" />
              </ButtonLink>
            </div>
          ) : !json ? (
            <div className="mb-4">
              <Button variant="outline" size="sm" onClick={() => setJson(JSON.stringify(LESSON_TEMPLATE, null, 2))}>
                Start from template
              </Button>
            </div>
          ) : null
        }
        footer={json && topic ? <Toggle checked={addToSelected} onChange={setAddToSelected} label={`Also list under ${topic.name}`} /> : null}
      />
    </div>
  )
}
