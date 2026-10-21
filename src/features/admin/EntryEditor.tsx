import { Braces, Download, Eraser, Pencil, Save } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui'
import { JsonEditor, Panel, StatusAlert, TextInput } from './ui'
import { parseJson, type Status } from './utils'

interface EntryEditorProps {
  title: string
  description: ReactNode
  /** Existing entry names for the "load" box; omit to hide it. */
  loadOptions?: string[]
  loadPlaceholder?: string
  onLoad?: (name: string) => void
  value: string
  onChange: (value: string) => void
  onSave: (value: unknown) => void
  onClear: () => void
  pending: string | null
  status: Status | null
  onDismissStatus: () => void
  /** Rendered above the editor (result summary, badges). */
  summary?: ReactNode
  /** Rendered next to the save button (options such as "also add to topic"). */
  footer?: ReactNode
  /** Replaces the JSON textarea while set (e.g. a rendered preview). */
  preview?: ReactNode
  /** With a preview: shows an "Edit JSON" button instead of saving (the page then switches to the JSON). */
  onEdit?: () => void
  placeholder?: string
}

/** Editable JSON view of one content entry, with load / clear / save. */
export function EntryEditor({
  title,
  description,
  loadOptions,
  loadPlaceholder = 'Load an existing entry…',
  onLoad,
  value,
  onChange,
  onSave,
  onClear,
  pending,
  status,
  onDismissStatus,
  summary,
  footer,
  preview,
  onEdit,
  placeholder,
}: EntryEditorProps) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const parsed = parseJson(value)
  const load = () => {
    if (!onLoad || !query.trim()) return
    onLoad(query.trim())
    setQuery('')
  }

  return (
    <Panel icon={<Braces className="size-4.5" />} title={title} description={description}>
      {loadOptions && onLoad ? (
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            load()
          }}
        >
          <TextInput list={listId} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={loadPlaceholder} aria-label={loadPlaceholder} />
          <datalist id={listId}>
            {loadOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Button type="submit" variant="outline" disabled={!query.trim()} loading={pending === 'load'}>
            <Download className="size-4" /> Load
          </Button>
        </form>
      ) : null}

      {summary}
      {preview ?? <JsonEditor value={value} onChange={onChange} placeholder={placeholder} />}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">{footer}</div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={onClear} disabled={!value || Boolean(pending)}>
            <Eraser className="size-4" /> Clear
          </Button>
          {preview && onEdit ? (
            <Button onClick={onEdit} disabled={Boolean(pending)}>
              <Pencil className="size-4" /> Edit JSON
            </Button>
          ) : (
            <Button onClick={() => onSave(parsed.value)} disabled={parsed.error !== undefined || Boolean(pending)} loading={pending === 'save'}>
              <Save className="size-4" /> Save JSON
            </Button>
          )}
        </div>
      </div>
      <StatusAlert className="mt-4" status={status} onDismiss={onDismissStatus} />
    </Panel>
  )
}
