import { ExternalLink, Library, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, ButtonLink } from '@/components/ui'
import type { Essay } from '@/types/essays'
import { adminApi, refreshSiteData, useAdminResource } from './api'
import { EntryEditor } from './EntryEditor'
import { ConfirmDelete, EditorSkeleton, Field, Panel, StatusAlert, TextArea, TextInput } from './ui'
import { useAction, useAdminContext } from './utils'

interface EssayListItem {
  id: string
  title: string
  topic: string
  createdAt: string
  items: number
}

interface AnalyzeResponse {
  essay: Essay
  model: string
  usage?: { totalTokenCount?: number }
}

export default function EssayAdminPage() {
  const { gemini } = useAdminContext()
  const list = useAdminResource<{ essays: EssayListItem[] }>('essays')
  const [prompt, setPrompt] = useState('')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const form = useAction()
  const [json, setJson] = useState('')
  const [current, setCurrent] = useState<string>()
  const editor = useAction()

  const show = (essay: Essay) => {
    setJson(JSON.stringify(essay, null, 2))
    setCurrent(essay.id)
  }
  const afterWrite = () => {
    refreshSiteData('essays', 'review')
    list.reload()
  }

  const analyze = () =>
    form.run('analyze', async () => {
      const res = await adminApi<AnalyzeResponse>('essays/analyze', { method: 'POST', body: { prompt, text, title } })
      show(res.essay)
      afterWrite()
      const counts = res.essay.items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }), {})
      form.setStatus({
        tone: 'success',
        message: `"${res.essay.title}" saved — ${res.essay.items.length} items (${Object.entries(counts)
          .map(([k, n]) => `${n} ${k}`)
          .join(', ')}), ${res.essay.tasks.length} new tasks · ${(res.usage?.totalTokenCount ?? 0).toLocaleString('en-US')} tokens.`,
      })
      setPrompt('')
      setText('')
      setTitle('')
    })

  const load = (id: string) =>
    editor.run('load', async () => {
      const res = await adminApi<{ essay: Essay }>('essays/item', { query: { id } })
      show(res.essay)
    })

  const save = (value: unknown) =>
    editor.run('save', async () => {
      const res = await adminApi<{ essay: Essay; action: string }>('essays', { method: 'PUT', body: { essay: value } })
      show(res.essay)
      afterWrite()
      editor.setStatus({ tone: 'success', message: `Saved "${res.essay.title}" (${res.action}).` })
    })

  const remove = (id: string) =>
    editor.run(`delete:${id}`, async () => {
      await adminApi('essays', { method: 'DELETE', query: { id } })
      if (current === id) {
        setJson('')
        setCurrent(undefined)
      }
      afterWrite()
      editor.setStatus({ tone: 'success', message: `Deleted "${id}".` })
    })

  if (list.loading && !list.data) return <EditorSkeleton />
  const essays = list.data?.essays ?? []

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <Panel
          icon={<Sparkles className="size-4.5" />}
          title="Add a model essay"
          description="Paste the task and the essay. Gemini turns it into a lesson: sentence roles and translations, paragraph outlines, collocations, vocabulary, paraphrases, sentence frames, weak spots and 3 new tasks. Linking words are found by code."
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void analyze()
            }}
          >
            <Field label="Task (the IELTS question)" htmlFor="essay-prompt">
              <TextArea id="essay-prompt" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Some experts believe that… To what extent do you agree or disagree?" required />
            </Field>
            <Field label="Essay" htmlFor="essay-text" hint="Keep the paragraphs separated by a blank line.">
              <TextArea id="essay-text" rows={12} value={text} onChange={(e) => setText(e.target.value)} required />
            </Field>
            <Field label="Title (optional)" htmlFor="essay-title">
              <TextInput id="essay-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Gemini picks one when empty" />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" loading={form.pending === 'analyze'} disabled={!gemini || !prompt.trim() || text.trim().split(/\s+/).length < 60 || Boolean(form.pending)}>
                <Sparkles className="size-4" /> Analyze & save
              </Button>
              {form.pending === 'analyze' ? <span className="text-xs text-slate-500">Usually 20–40 seconds…</span> : null}
              {!gemini ? <span className="text-xs text-slate-500">Needs GEMINI_API_KEY on the server.</span> : null}
            </div>
            <StatusAlert status={form.status} onDismiss={() => form.setStatus(null)} />
          </form>
        </Panel>

        <Panel icon={<Library className="size-4.5" />} title={`Essays (${essays.length})`} description="Newest first.">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {essays.map((e) => (
              <li key={e.id} className="flex items-center gap-2 py-2.5">
                <button type="button" onClick={() => void load(e.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{e.title}</span>
                  <span className="text-xs text-slate-500">
                    {e.topic} · {e.items} items
                  </span>
                </button>
                <ButtonLink to={`/practice/essays/${e.id}`} variant="ghost" size="icon-sm" aria-label="Open">
                  <ExternalLink className="size-4" />
                </ButtonLink>
                <ConfirmDelete busy={editor.pending === `delete:${e.id}`} onConfirm={() => void remove(e.id)} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <EntryEditor
        title="Essay JSON"
        description="Fix a translation, a meaning or an item. An edited item's text is found again in its sentence when saving."
        loadOptions={essays.map((e) => e.id)}
        loadPlaceholder="Load an essay…"
        onLoad={load}
        value={json}
        onChange={setJson}
        onSave={save}
        onClear={() => {
          setJson('')
          setCurrent(undefined)
        }}
        pending={editor.pending}
        status={editor.status}
        onDismissStatus={() => editor.setStatus(null)}
        summary={
          current ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="brand">{current}</Badge>
              <ButtonLink to={`/practice/essays/${current}`} size="sm" variant="outline">
                <ExternalLink className="size-4" /> Open lesson
              </ButtonLink>
            </div>
          ) : null
        }
        placeholder='{ "id": "…", "title": "…", "sentences": [], "items": [] }'
      />
    </div>
  )
}
