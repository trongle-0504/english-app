import { BookOpen, ExternalLink, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, ButtonLink, SegmentedControl } from '@/components/ui'
import { adminApi, refreshSiteData, useAdminResource } from './api'
import { EntryEditor } from './EntryEditor'
import { ImageAttachments } from './ImageAttachments'
import { WordCard } from '../words/WordCard'
import { ImagePicker } from './ImagePicker'
import { previewWord } from './wordPreview'
import { ReviewDrills } from './ReviewDrills'
import { OzdicSummary, type OzdicGrounding } from './OzdicSummary'
import { BackgroundJobStatus, DrillsNowButton, DrillsPanel, type GenerateJob } from './GenerateExtras'
import { lacksDrills } from './drillsState'
import { EditorSkeleton, Field, NamePicker, Panel, StatusAlert, TextArea, TextInput, Toggle } from './ui'
import { parseJson, readFileAsBase64, slugify, useAction, useAdminContext } from './utils'

interface VocabTopic {
  name: string
  description_vi: string
  sub_topics: { name: string; description_vi: string; wordCount: number }[]
}

interface VocabOverview {
  topics: VocabTopic[]
  words: string[]
}

interface WordEntry {
  word: string
  [key: string]: unknown
}

interface Placement {
  topic: string
  subTopic: string
}

interface GenerateResponse {
  action: 'created' | 'updated'
  entry: WordEntry
  placement: Placement
  /** Gemini chose the topic / sub-topic because none was picked. */
  autoPlaced?: boolean
  lemma?: OzdicGrounding['lemma']
  lemmaError?: string
  ozdic?: OzdicGrounding['ozdic']
  notes?: OzdicGrounding['notes']
  timings?: OzdicGrounding['timings']
  /** Picture and practice questions made in the background after saving. */
  job?: GenerateJob
  /** Gemini's scene description: the picker searches with it when it opens. */
  image?: { query: string }
}

const isEntry = (value: unknown): value is WordEntry =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as WordEntry).word === 'string'

const lessonHref = (p: Placement, word: string) => `/vocabulary/${slugify(p.topic)}/${slugify(p.subTopic)}#${slugify(word)}`

export default function VocabularyAdminPage() {
  const { gemini } = useAdminContext()
  const overview = useAdminResource<VocabOverview>('vocabulary')
  // Empty = Gemini picks the topic / sub-topic (the default on every visit).
  const [placement, setPlacement] = useState<Placement>({ topic: '', subTopic: '' })
  const [word, setWord] = useState('')
  const [description, setDescription] = useState('')
  const [images, setImages] = useState<File[]>([])
  const [withPractice, setWithPractice] = useState(false)
  const form = useAction()

  const [json, setJson] = useState('')
  const [original, setOriginal] = useState<string>()
  const [placements, setPlacements] = useState<Placement[]>([])
  const [generated, setGenerated] = useState<GenerateResponse>()
  const [addToSelected, setAddToSelected] = useState(false)
  const editor = useAction()

  const topics = overview.data?.topics ?? []
  const topic = topics.find((t) => t.name === placement.topic)
  const subTopic = topic?.sub_topics.find((s) => s.name === placement.subTopic)
  const target = topic && subTopic ? { topic: topic.name, subTopic: subTopic.name } : undefined
  // What the generate request sends: nothing (AI picks), a topic (AI picks the sub-topic) or both.
  const chosen = topic ? { topic: topic.name, ...(subTopic ? { subTopic: subTopic.name } : {}) } : {}

  const applyTopics = (next: VocabTopic[]) => overview.data && overview.setData({ ...overview.data, topics: next })

  // Loaded / generated entries open as a rendered preview; "Edit JSON" switches to the editor until the next save.
  const [view, setView] = useState<'preview' | 'json'>('preview')

  const showEntry = (entry: WordEntry, where: Placement[]) => {
    setView('preview')
    setJson(JSON.stringify(entry, null, 2))
    setOriginal(entry.word)
    setPlacements(where)
  }

  const createTopic = async (name: string, description_vi: string) =>
    Boolean(
      await form.run('topic', async () => {
        const res = await adminApi<{ topics: VocabTopic[] }>('vocabulary/topics', { method: 'POST', body: { name, description_vi } })
        applyTopics(res.topics)
        setPlacement({ topic: name, subTopic: '' })
        return true
      }),
    )

  const createSubTopic = async (name: string, description_vi: string) =>
    Boolean(
      await form.run('sub-topic', async () => {
        const res = await adminApi<{ topics: VocabTopic[] }>('vocabulary/sub-topics', {
          method: 'POST',
          body: { topic: placement.topic, name, description_vi },
        })
        applyTopics(res.topics)
        return true
      }),
    )

  const generate = () =>
    form.run('generate', async () => {
      const attachments = await Promise.all(images.map(async (file) => ({ mimeType: file.type || 'image/png', data: await readFileAsBase64(file) })))
      const res = await adminApi<GenerateResponse>('vocabulary/generate', {
        method: 'POST',
        body: { word, description, ...chosen, images: attachments, generateQuestions: withPractice },
      })
      showEntry(res.entry, [res.placement])
      setGenerated(res)
      editor.setStatus(null)
      refreshSiteData('vocabulary')
      overview.reload()
      form.setStatus({
        tone: res.ozdic?.dictionarySource === 'none' ? 'warning' : 'success',
        message: `"${res.entry.word}" ${res.action === 'created' ? 'added to' : 'updated in'} ${res.placement.topic} › ${res.placement.subTopic}${res.autoPlaced ? ' (chosen by AI)' : ''}${res.action === 'created' ? ' — it is in today’s review session' : ''}.${res.job ? ' Picture / practice are being made in the background.' : ''}`,
      })
      setWord('')
      setDescription('')
      setImages([])
    })

  // A background part finished: show the stored picture; refresh practice data.
  const onJobPart = (part: 'image' | 'practice', result: { status: string; result?: { entry?: Record<string, unknown> } }) => {
    if (part === 'image' && result.status === 'done' && isEntry(result.result?.entry) && result.result.entry.word === original) {
      showEntry(result.result.entry, placements)
      refreshSiteData('vocabulary')
    }
    if (part === 'practice' && result.status === 'done') refreshSiteData('practice')
  }

  const load = (name: string) =>
    editor.run('load', async () => {
      const res = await adminApi<{ entry: WordEntry; placements: Placement[] }>('vocabulary/word', { query: { word: name } })
      showEntry(res.entry, res.placements)
      setGenerated(undefined)
    })

  const save = (value: unknown) =>
    editor.run('save', async () => {
      if (!isEntry(value)) throw new Error('The JSON must be an object with a "word" string.')
      const res = await adminApi<{ action: 'created' | 'updated'; entry: WordEntry }>('vocabulary/word', {
        method: 'PUT',
        body: { entry: value, originalWord: original, ...(addToSelected && target ? target : {}) },
      })
      const where = addToSelected && target && !placements.some((p) => p.topic === target.topic && p.subTopic === target.subTopic)
      showEntry(res.entry, where ? [...placements, target] : placements)
      setAddToSelected(false)
      refreshSiteData('vocabulary')
      overview.reload()
      editor.setStatus({ tone: 'success', message: `Saved "${res.entry.word}" (${res.action}).` })
    })

  const clear = () => {
    setJson('')
    setOriginal(undefined)
    setPlacements([])
    setGenerated(undefined)
    editor.setStatus(null)
  }

  const current = parseJson(json).value as WordEntry | undefined
  const previewed = view === 'preview' ? previewWord(current) : null

  if (overview.loading && !overview.data) return <EditorSkeleton />

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <Panel
          icon={<Sparkles className="size-4.5" />}
          title="Generate an entry"
          description="Gemini turns the word into its base form, looks it up on OZDIC (Oxford Collocations) and Longman, then writes the full entry from your notes and the dictionary data and files it under a topic — leave the topic empty and it picks one for you."
        >
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              void generate()
            }}
          >
            <StatusAlert status={overview.error ? { tone: 'error', message: overview.error } : null} />
            <div className="grid gap-4 sm:grid-cols-2">
              <NamePicker
                label="Topic"
                value={topic ? placement.topic : ''}
                onChange={(name) => setPlacement({ topic: name, subTopic: '' })}
                options={topics.map((t) => ({ value: t.name, label: `${t.name} (${t.sub_topics.length})` }))}
                placeholder="✨ Let AI choose"
                onCreate={createTopic}
              />
              <NamePicker
                label="Sub-topic"
                value={subTopic ? placement.subTopic : ''}
                onChange={(name) => setPlacement({ ...placement, subTopic: name })}
                options={(topic?.sub_topics ?? []).map((s) => ({ value: s.name, label: `${s.name} (${s.wordCount} words)` }))}
                placeholder={topic ? '✨ Let AI choose' : '✨ AI chooses with the topic'}
                disabled={!topic}
                onCreate={topic ? createSubTopic : undefined}
              />
            </div>

            <Field label="Word or phrase" htmlFor="vocab-word">
              <TextInput
                id="vocab-word"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                // Warms the Longman/OZDIC cache for a single base-form word (no AI call).
                onBlur={() => {
                  if (word.trim() && gemini) void adminApi('dictionary/prefetch', { method: 'POST', body: { word } }).catch(() => {})
                }}
                placeholder="e.g. boarding pass"
                required
              />
            </Field>

            <Field
              label="Notes for Gemini"
              htmlFor="vocab-notes"
              hint="Pronunciation, meanings, patterns, collocations, examples… Your patterns and collocations are kept, but wrong ones are corrected against OZDIC and Longman. Example sentences are used as examples, not as collocations. No collocations given? Gemini adds 3–4 common IELTS ones (from the dictionaries when they list the word)."
            >
              <TextArea
                id="vocab-notes"
                rows={7}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={'exchange (n, v)\n- in exchange for sth\n- cultural exchange: The two schools run a cultural exchange every summer.'}
              />
            </Field>

            <Field label="Images (optional)">
              <ImageAttachments files={images} onChange={setImages} />
            </Field>

            <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/50">
              <Toggle
                checked={withPractice}
                onChange={setWithPractice}
                label="Also generate practice questions"
                description="Multiple choice from bold sense examples and short answer from bold collocation examples, added to this sub-topic’s practice quiz."
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" loading={form.pending === 'generate'} disabled={!gemini || !word.trim() || Boolean(form.pending)}>
                <Sparkles className="size-4" /> Generate & save
              </Button>
              {!gemini ? <span className="text-xs text-slate-500">Needs GEMINI_API_KEY on the server.</span> : null}
              {form.pending === 'generate' ? (
                <span className="text-xs text-slate-500">
                  Base form → Longman / OZDIC → entry: usually 15–30 seconds (a few more for a word looked up for the first time). Picture and practice follow in the background; drills come with the 03:00 batch…
                </span>
              ) : null}
            </div>
            <StatusAlert status={form.status} onDismiss={() => form.setStatus(null)} />
            {generated && !form.pending ? <OzdicSummary res={generated} /> : null}
            {generated?.job && !form.pending ? <BackgroundJobStatus key={generated.job.id} job={generated.job} onPart={onJobPart} /> : null}
            <DrillsPanel refreshKey={generated} />
          </form>
        </Panel>
        {original && current ? (
          <ImagePicker
            key={`${original}:${generated?.entry.word === original ? (generated.image?.query ?? '') : ''}`}
            word={original}
            image={typeof current.image === 'string' ? current.image : undefined}
            credit={typeof current.image_credit === 'string' ? current.image_credit : undefined}
            initialQuery={
              generated?.entry.word === original ? generated.image?.query : typeof current.image_query === 'string' ? current.image_query : undefined
            }
            autoSearch={generated?.entry.word === original}
            onSaved={(entry) => showEntry(entry, placements)}
          />
        ) : null}
      </div>

      <EntryEditor
        title="Entry JSON"
        description="Edit any field and save. Load an existing word to fix it without calling Gemini."
        loadOptions={overview.data?.words}
        loadPlaceholder="Load an existing word…"
        onLoad={load}
        value={json}
        onChange={setJson}
        onSave={save}
        onClear={clear}
        pending={editor.pending}
        status={editor.status}
        onDismissStatus={() => editor.setStatus(null)}
        preview={
          previewed ? (
            <div className="space-y-3">
              <WordCard word={previewed} defaultExpanded anchor={false} className="max-h-[70vh] overflow-y-auto" />
              <ReviewDrills drills={previewed} />
            </div>
          ) : undefined
        }
        onEdit={() => setView('json')}
        placeholder={
          '{\n  "word": "…",\n  "pronunciation": "/…/",\n  "part_of_speech": ["noun"],\n  "senses": [{ "definition_vi": "…", "examples": ["…"] }]\n}'
        }
        summary={
          original ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3.5 py-3 text-sm dark:bg-slate-800/50">
              <BookOpen className="size-4 text-brand-600 dark:text-brand-400" />
              <span className="font-bold text-slate-900 dark:text-white">{original}</span>
              <SegmentedControl
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { value: 'preview' as const, label: 'Preview' },
                  { value: 'json' as const, label: 'JSON' },
                ]}
              />
              {generated ? <Badge tone={generated.action === 'created' ? 'emerald' : 'sky'}>{generated.action}</Badge> : null}
              {current && lacksDrills(current) ? <DrillsNowButton kind="word" itemKey={original} onDone={(entry) => isEntry(entry) && showEntry(entry, placements)} /> : null}
              {placements.length ? (
                <span className="ml-auto flex flex-wrap gap-1">
                  {placements.map((p) => (
                    <ButtonLink key={`${p.topic}/${p.subTopic}`} to={lessonHref(p, original)} variant="ghost" size="sm" target="_blank">
                      {p.topic} › {p.subTopic} <ExternalLink className="size-3" />
                    </ButtonLink>
                  ))}
                </span>
              ) : (
                <Badge tone="amber" className="ml-auto">
                  Not in any sub-topic
                </Badge>
              )}
            </div>
          ) : null
        }
        footer={
          json && target ? (
            <Toggle checked={addToSelected} onChange={setAddToSelected} label={`Also add to ${target.topic} › ${target.subTopic}`} />
          ) : null
        }
      />
    </div>
  )
}
