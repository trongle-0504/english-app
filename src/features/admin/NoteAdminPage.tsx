import { FilePlus2, NotebookPen, Pencil, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Markdown } from '@/components/Markdown'
import { Badge, Button, EmptyState, SearchInput, SegmentedControl, type Tone } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatDate, matchesQuery } from '@/lib/text'
import type { Note, NoteType } from '@/types/content'
import { cleanDrills } from '@/lib/wordDrills'
import { ReviewDrills } from './ReviewDrills'
import { adminApi, refreshSiteData, useAdminResource } from './api'
import { EntryEditor } from './EntryEditor'
import { OzdicSummary, type OzdicGrounding } from './OzdicSummary'
import { ImagePicker, type ImageCandidate } from './ImagePicker'
import { WordImage } from '../words/WordImage'
import { SpeakButton } from '@/components/SpeakButton'
import { ConfirmDelete, EditorSkeleton, Field, Panel, StatusAlert, TextArea } from './ui'
import { parseJson, useAction, useAdminContext } from './utils'

const NOTE_TYPES: NoteType[] = ['Structure', 'Idiom', 'Collocation', 'Vocabulary', 'Other']
const typeTone: Record<NoteType, Tone> = { Structure: 'indigo', Idiom: 'violet', Collocation: 'teal', Vocabulary: 'sky', Other: 'slate' }

type NoteDraft = Omit<Note, 'id' | 'created_at'>

const NOTE_TEMPLATE: NoteDraft = {
  title: '',
  pronunciation: '',
  type: 'Vocabulary',
  formula: '',
  meaning_vi: '',
  usage_context: '',
  patterns: [],
  examples: [{ en: '', vi: '' }],
  related_notes: [],
}

/** Fields the editor shows; id and created_at are managed by the server. */
function editable({ id: _id, created_at: _created, ...fields }: Note): NoteDraft {
  return fields
}

function NotePreview({ note }: { note: Partial<Note> }) {
  const type = NOTE_TYPES.includes(note.type as NoteType) ? (note.type as NoteType) : 'Other'
  return (
    <article className="min-h-[420px] space-y-4 rounded-xl border border-slate-200 p-4 sm:p-5 dark:border-slate-800">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">{note.title || 'Untitled'}</h3>
          <Badge tone={typeTone[type]}>{type}</Badge>
          {type !== 'Structure' && note.pronunciation ? <span className="ipa font-mono text-sm text-slate-500 dark:text-slate-400">{note.pronunciation}</span> : null}
          {note.title ? <SpeakButton text={note.title} className="-my-1" /> : null}
        </div>
        {note.formula ? (
          <p className="inline-block rounded-lg bg-brand-50 px-2.5 py-1 font-mono text-sm text-brand-800 dark:bg-brand-950/50 dark:text-brand-200">
            {note.formula}
          </p>
        ) : null}
      </header>

      {note.image ? (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/50 p-2.5 dark:border-slate-800 dark:bg-slate-900/40">
          <WordImage
            src={note.image}
            alt={note.title || ''}
            credit={note.image_credit}
            className="size-20 shrink-0 rounded-xl object-cover shadow-xs ring-2 ring-white dark:ring-slate-800"
          />
          <div className="min-w-0 flex-1 text-xs text-slate-500">
            <p className="font-semibold text-slate-700 dark:text-slate-300">Ảnh minh họa</p>
            {note.image_credit ? <p className="truncate text-slate-400">Nguồn: {note.image_credit}</p> : null}
          </div>
        </div>
      ) : null}

      <Markdown className="text-slate-700 dark:text-slate-300">{note.meaning_vi}</Markdown>
      {note.usage_context ? <Markdown className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">{note.usage_context}</Markdown> : null}
      {note.patterns?.map((p, i) => (
        <section key={i} className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">{p.pattern}</p>
          <Markdown className="text-sm text-slate-600 dark:text-slate-400">{p.meaning_vi}</Markdown>
          <Examples items={p.examples} />
        </section>
      ))}
      <Examples items={note.examples} />
      {note.related_notes?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {note.related_notes.map((r) => (
            <Badge key={r}>{r}</Badge>
          ))}
        </div>
      ) : null}
      <ReviewDrills
        drills={cleanDrills(
          note,
          note.title ?? '',
          (note.patterns ?? []).map((p) => p.pattern),
        )}
      />
    </article>
  )
}

function Examples({ items }: { items?: Note['examples'] }) {
  if (!items?.length) return null
  return (
    <ul className="space-y-1.5 border-l-2 border-brand-200 pl-3 dark:border-brand-900">
      {items.map((e, i) => (
        <li key={i} className="text-sm">
          <Markdown inline className="text-slate-800 dark:text-slate-100">
            {e.en}
          </Markdown>
          {e.vi ? <span className="block text-slate-500 dark:text-slate-400">{e.vi}</span> : null}
        </li>
      ))}
    </ul>
  )
}

export default function NoteAdminPage() {
  const { gemini } = useAdminContext()
  const list = useAdminResource<{ notes: Note[] }>('notes')
  const [prompt, setPrompt] = useState('')
  const [type, setType] = useState<'auto' | NoteType>('auto')
  const form = useAction()
  const [grounding, setGrounding] = useState<OzdicGrounding>()
  const [generatedImage, setGeneratedImage] = useState<{ id: string; query?: string; candidates?: ImageCandidate[] } | null>(null)

  const [json, setJson] = useState('')
  const [originalId, setOriginalId] = useState<string>()
  const [view, setView] = useState<'json' | 'preview'>('json')
  const editor = useAction()

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | NoteType>('all')
  const notes = list.data?.notes
  const visible = useMemo(
    () => (notes ?? []).filter((n) => (filter === 'all' || n.type === filter) && (matchesQuery(n.title, query) || matchesQuery(n.meaning_vi, query))),
    [notes, filter, query],
  )

  const edit = (note: Note) => {
    setJson(JSON.stringify(editable(note), null, 2))
    setOriginalId(note.id)
    editor.setStatus(null)
  }

  const afterWrite = () => {
    refreshSiteData('notes.json')
    list.reload()
  }

  const generate = () =>
    form.run('generate', async () => {
      const res = await adminApi<{
        action: 'created' | 'updated'
        note: Note
        image?: { query: string; candidates: ImageCandidate[] }
      } & OzdicGrounding>('notes/generate', {
        method: 'POST',
        body: { prompt, type },
      })
      setGrounding(res)
      if (res.image) {
        setGeneratedImage({ id: res.note.id, query: res.image.query, candidates: res.image.candidates })
      }
      edit(res.note)
      setView('preview')
      afterWrite()
      form.setStatus({ tone: 'success', message: `"${res.note.title}" ${res.action}.` })
      setPrompt('')
    })

  const save = (value: unknown) =>
    editor.run('save', async () => {
      const res = await adminApi<{ action: 'created' | 'updated'; note: Note }>('notes', { method: 'PUT', body: { note: value, originalId } })
      edit(res.note)
      afterWrite()
      editor.setStatus({ tone: 'success', message: `Saved "${res.note.title}" (${res.action}).` })
    })

  const remove = (note: Note) =>
    editor.run(`delete:${note.id}`, async () => {
      await adminApi('notes', { method: 'DELETE', query: { id: note.id } })
      if (originalId === note.id) {
        setJson('')
        setOriginalId(undefined)
      }
      afterWrite()
      editor.setStatus({ tone: 'success', message: `Deleted "${note.title}".` })
    })

  const clear = () => {
    setJson('')
    setOriginalId(undefined)
    editor.setStatus(null)
  }

  if (list.loading && !list.data) return <EditorSkeleton />
  const draft = parseJson(json).value as Partial<Note> | undefined

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <Panel
          icon={<Sparkles className="size-4.5" />}
          title="Generate a note"
          description="A structure, idiom, collocation or word — or two items to compare (“affect vs effect”). Gemini puts the item in its base form, looks it up on OZDIC (Oxford Collocations) and Longman and corrects wrong collocations/patterns in your input."
        >
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              void generate()
            }}
          >
            <Field label="Type">
              <SegmentedControl
                size="sm"
                className="flex-wrap"
                value={type}
                onChange={setType}
                options={[{ value: 'auto' as const, label: 'Auto' }, ...NOTE_TYPES.map((t) => ({ value: t, label: t }))]}
              />
            </Field>
            <Field
              label="Input"
              htmlFor="note-prompt"
              hint="Paste everything you have: meaning, patterns, example sentences, IPA. Gemini keeps your examples, fixing only combinations the dictionaries show are wrong."
            >
              <TextArea
                id="note-prompt"
                rows={8}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="take something for granted – cho điều gì đó là hiển nhiên. We often take clean water for granted."
                required
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" loading={form.pending === 'generate'} disabled={!gemini || !prompt.trim() || Boolean(form.pending)}>
                <Sparkles className="size-4" /> Generate & save
              </Button>
              {!gemini ? <span className="text-xs text-slate-500">Needs GEMINI_API_KEY on the server.</span> : null}
            </div>
            <StatusAlert status={form.status} onDismiss={() => form.setStatus(null)} />
            {grounding && !form.pending ? (
              <OzdicSummary res={{ ...grounding, lemma: grounding.lemma && { ...grounding.lemma, note_vi: '' } }} subject="Title" showInput={false} />
            ) : null}
          </form>
        </Panel>

        {originalId && draft ? (
          <ImagePicker
            key={`${originalId}:${generatedImage?.id === originalId ? (generatedImage.query ?? '') : ''}`}
            word={originalId}
            image={typeof draft.image === 'string' ? draft.image : undefined}
            credit={typeof draft.image_credit === 'string' ? draft.image_credit : undefined}
            initialQuery={
              generatedImage?.id === originalId
                ? generatedImage.query
                : typeof draft.image_query === 'string'
                  ? draft.image_query
                  : draft.title
            }
            initialCandidates={generatedImage?.id === originalId ? generatedImage.candidates : undefined}
            searchEndpoint="notes/images"
            saveEndpoint="notes/image"
            itemKey="id"
            refreshResource="notes"
            title={`Picture · ${draft.title || originalId}`}
            description="Tìm bằng một cảnh thể hiện nghĩa (không phải chính từ). Bấm một ảnh để tải về và lưu cho note này."
            onSaved={(updatedNote: Note) => {
              edit(updatedNote)
              afterWrite()
            }}
          />
        ) : null}

        <Panel
          icon={<NotebookPen className="size-4.5" />}
          title={`All notes (${notes?.length ?? 0})`}
          description="Newest first. Edit opens the note in the editor."
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setJson(JSON.stringify(NOTE_TEMPLATE, null, 2))
                setOriginalId(undefined)
                setView('json')
              }}
            >
              <FilePlus2 className="size-3.5" /> New note
            </Button>
          }
        >
          <div className="mb-3 flex flex-wrap gap-2">
            <SearchInput className="min-w-48 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as 'all' | NoteType)}
              aria-label="Filter by type"
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">All types</option>
              {NOTE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <StatusAlert status={list.error ? { tone: 'error', message: list.error } : null} />
          {visible.length ? (
            <ul className="-mx-2 max-h-[560px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {visible.map((note) => (
                <li
                  key={note.id}
                  className={cn('flex items-center gap-3 rounded-lg px-2 py-2.5', originalId === note.id && 'bg-brand-50/70 dark:bg-brand-950/30')}
                >
                  {note.image ? (
                    <WordImage
                      src={note.image}
                      alt={note.title}
                      className="size-10 shrink-0 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{note.title}</span>
                      <Badge tone={typeTone[note.type] ?? 'slate'}>{note.type}</Badge>
                      {note.type !== 'Structure' && note.pronunciation ? <span className="ipa font-mono text-xs text-slate-400">{note.pronunciation}</span> : null}
                    </div>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {formatDate(note.created_at)} · {(note.meaning_vi ?? '').replace(/[*_`#>]/g, '')}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => edit(note)}>
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  <ConfirmDelete busy={editor.pending === `delete:${note.id}`} onConfirm={() => void remove(note)} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={notes?.length ? 'No notes match' : 'No notes yet'} />
          )}
        </Panel>
      </div>

      <div className="min-w-0 lg:sticky lg:top-20">
        <EntryEditor
          title={originalId ? 'Edit note' : 'Note JSON'}
          description="The id comes from the title; renaming keeps the original creation date."
          value={json}
          onChange={setJson}
          onSave={save}
          onClear={clear}
          pending={editor.pending}
          status={editor.status}
          onDismissStatus={() => editor.setStatus(null)}
          placeholder="Generate a note, pick one from the list, or start a new one."
          summary={
            json ? (
              <SegmentedControl
                size="sm"
                className="mb-3"
                value={view}
                onChange={setView}
                options={[
                  { value: 'json', label: 'JSON' },
                  { value: 'preview', label: 'Preview' },
                ]}
              />
            ) : null
          }
          preview={view === 'preview' && draft ? <NotePreview note={draft} /> : undefined}
        />
      </div>
    </div>
  )
}
