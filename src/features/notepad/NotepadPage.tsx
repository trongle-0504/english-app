import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Bold,
  Check,
  ChevronDown,
  ChevronLeft,
  Columns2,
  Copy,
  Eye,
  FileDown,
  FilePlus2,
  FileText,
  FileType,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Quote,
  RotateCcw,
  Save,
  Sparkles,
  StickyNote,
  Trash2,
  Type,
  Underline,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Markdown } from '@/components/Markdown'
import { Badge, Button, Card, EmptyState, SearchInput } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useLocalStorage } from '@/lib/storage'
import { formatDate, matchesQuery } from '@/lib/text'
import { notepadToReportDoc, triggerBlobDownload } from './export-notepad'

export interface NotepadNote {
  id: string
  title: string
  content: string
  pinned?: boolean
  created_at: string
  updated_at: string
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
type ViewMode = 'edit' | 'preview' | 'split'
type FontSize = 'xs' | 'sm' | 'base'

const FONT_SIZE_CLASS: Record<FontSize, string> = {
  xs: 'text-[13px] leading-snug',
  sm: 'text-sm leading-normal',
  base: 'text-[15px] leading-relaxed',
}

function sortNotes(notes: NotepadNote[]): NotepadNote[] {
  return [...notes].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    return (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at)
  })
}

export default function NotepadPage() {
  const [notes, setNotes] = useState<NotepadNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const [selectedId, setSelectedId] = useState<string>('new')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [pinned, setPinned] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [mobileShowEditor, setMobileShowEditor] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('edit')
  const [fontSize, setFontSize] = useLocalStorage<FontSize>('notepad:font-size', 'sm')
  const [aiFormatting, setAiFormatting] = useState(false)
  const [exporting, setExporting] = useState<'md' | 'docx' | 'pdf' | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [undoSnapshot, setUndoSnapshot] = useState<{ title: string; content: string } | null>(null)

  const titleInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const latestDraftRef = useRef({ id: selectedId, title, content, pinned })
  latestDraftRef.current = { id: selectedId, title, content, pinned }

  useEffect(() => {
    let cancelled = false
    fetch('/api/notepad', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Không tải được danh sách ghi chú.')
        const data = (await res.json()) as { notes?: NotepadNote[] }
        if (cancelled) return
        const list = sortNotes(data.notes ?? [])
        setNotes(list)
        if (list.length > 0) {
          const first = list[0]
          setSelectedId(first.id)
          setTitle(first.title)
          setContent(first.content)
          setPinned(Boolean(first.pinned))
          setSaveState('saved')
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectNote = useCallback((note: NotepadNote) => {
    setSelectedId(note.id)
    setTitle(note.title)
    setContent(note.content)
    setPinned(Boolean(note.pinned))
    setSaveState('saved')
    setConfirmDelete(false)
    setUndoSnapshot(null)
    setMobileShowEditor(true)
  }, [])

  const startNewNote = useCallback(() => {
    setSelectedId('new')
    setTitle('')
    setContent('')
    setPinned(false)
    setSaveState('saved')
    setConfirmDelete(false)
    setUndoSnapshot(null)
    setViewMode('edit')
    setMobileShowEditor(true)
    setTimeout(() => titleInputRef.current?.focus(), 50)
  }, [])

  const saveCurrentNote = useCallback(async (draft = latestDraftRef.current) => {
    if (!draft.title.trim() && !draft.content.trim()) return
    setSaveState('saving')
    setError(null)
    try {
      const res = await fetch('/api/notepad', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draft.id === 'new' ? undefined : draft.id,
          title: draft.title,
          content: draft.content,
          pinned: draft.pinned,
        }),
      })
      const data = (await res.json()) as { note?: NotepadNote; error?: string }
      if (!res.ok || !data.note) throw new Error(data.error || 'Lỗi khi lưu ghi chú.')
      const saved = data.note
      setNotes((prev) => {
        const rest = prev.filter((n) => n.id !== saved.id)
        return sortNotes([saved, ...rest])
      })
      if (latestDraftRef.current.id === draft.id) {
        setSelectedId(saved.id)
        if (!draft.title.trim()) setTitle(saved.title)
        setSaveState('saved')
      }
    } catch (err) {
      setSaveState('error')
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    if (saveState !== 'dirty') return
    if (!title.trim() && !content.trim()) return
    const timer = setTimeout(() => {
      void saveCurrentNote({ id: selectedId, title, content, pinned })
    }, 900)
    return () => clearTimeout(timer)
  }, [saveState, selectedId, title, content, pinned, saveCurrentNote])

  // Wrap selected text in textarea with prefix/suffix (e.g. **bold**, *italic*, <u>underline</u>)
  const applyWrap = useCallback(
    (before: string, after = before, placeholder = 'văn bản') => {
      const el = textareaRef.current
      if (!el) {
        setContent((prev) => `${prev}${before}${placeholder}${after}`)
        setSaveState('dirty')
        return
      }
      const start = el.selectionStart
      const end = el.selectionEnd
      const selected = content.slice(start, end)
      const insert = selected || placeholder
      const next = content.slice(0, start) + before + insert + after + content.slice(end)
      setContent(next)
      setSaveState('dirty')
      setTimeout(() => {
        el.focus()
        el.setSelectionRange(start + before.length, start + before.length + insert.length)
      }, 0)
    },
    [content],
  )

  // Prefix selected lines with bullet/number/heading/quote
  const applyLinePrefix = useCallback(
    (prefix: string | ((idx: number) => string)) => {
      const el = textareaRef.current
      if (!el) return
      const start = el.selectionStart
      const end = el.selectionEnd
      const lineStart = content.lastIndexOf('\n', start - 1) + 1
      const lineEndIdx = content.indexOf('\n', end)
      const lineEnd = lineEndIdx === -1 ? content.length : lineEndIdx
      const block = content.slice(lineStart, lineEnd)
      const lines = block.split('\n')
      const transformed = lines
        .map((line, i) => {
          const p = typeof prefix === 'function' ? prefix(i) : prefix
          const cleaned = line.replace(/^(#{1,4}\s+|[-*]\s+|\d+\.\s+|>\s+)/, '')
          return `${p}${cleaned}`
        })
        .join('\n')
      const next = content.slice(0, lineStart) + transformed + content.slice(lineEnd)
      setContent(next)
      setSaveState('dirty')
      setTimeout(() => {
        el.focus()
        el.setSelectionRange(lineStart, lineStart + transformed.length)
      }, 0)
    },
    [content],
  )

  const insertDivider = useCallback(() => {
    const el = textareaRef.current
    const pos = el ? el.selectionEnd : content.length
    const prefix = pos > 0 && content[pos - 1] !== '\n' ? '\n\n' : '\n'
    const insert = `${prefix}---\n`
    const next = content.slice(0, pos) + insert + content.slice(pos)
    setContent(next)
    setSaveState('dirty')
    setTimeout(() => {
      if (el) {
        el.focus()
        el.setSelectionRange(pos + insert.length, pos + insert.length)
      }
    }, 0)
  }, [content])

  const uploadAndInsertImages = useCallback(
    async (fileList: File[]) => {
      const imageFiles = fileList.filter((f) => /^image\/(png|jpe?g|webp|gif)$/i.test(f.type))
      if (!imageFiles.length || uploadingImage) return
      setUploadingImage(true)
      setError(null)
      try {
        const encoded = await Promise.all(
          imageFiles.map(
            (file) =>
              new Promise<{ name: string; mimeType: string; data: string }>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve({ name: file.name || 'screenshot.png', mimeType: file.type, data: String(reader.result || '') })
                reader.onerror = () => reject(new Error(`Không đọc được file ${file.name}`))
                reader.readAsDataURL(file)
              }),
          ),
        )
        const res = await fetch('/api/notepad/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: encoded }),
        })
        const data = (await res.json()) as { images?: { name: string; url: string }[]; error?: string }
        if (!res.ok || !data.images?.length) throw new Error(data.error || 'Lỗi khi tải ảnh lên.')

        const el = textareaRef.current
        const pos = el ? el.selectionEnd : content.length
        const before = pos > 0 && content[pos - 1] !== '\n' ? '\n\n' : ''
        const mdLinks = data.images.map((img) => `![${img.name}](${img.url})`).join('\n\n')
        const insert = `${before}${mdLinks}\n\n`
        const nextContent = content.slice(0, pos) + insert + content.slice(pos)
        setContent(nextContent)
        await saveCurrentNote({ id: selectedId, title, content: nextContent, pinned })
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setUploadingImage(false)
      }
    },
    [content, uploadingImage, saveCurrentNote, selectedId, title, pinned],
  )

  // Keyboard shortcuts: Ctrl+S (save), Ctrl+B (bold), Ctrl+I (italic), Ctrl+U (underline)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        void saveCurrentNote()
      } else if (document.activeElement === textareaRef.current) {
        if (k === 'b') {
          e.preventDefault()
          applyWrap('**', '**', 'in đậm')
        } else if (k === 'i') {
          e.preventDefault()
          applyWrap('*', '*', 'in nghiêng')
        } else if (k === 'u') {
          e.preventDefault()
          applyWrap('<u>', '</u>', 'gạch chân')
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveCurrentNote, applyWrap])

  const handleAiFormat = async () => {
    if (!content.trim() || aiFormatting) return
    setAiFormatting(true)
    setError(null)
    const previous = { title, content }
    try {
      const res = await fetch('/api/notepad/format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      })
      const data = (await res.json()) as { title?: string; content?: string; error?: string }
      if (!res.ok || !data.content) throw new Error(data.error || 'AI không thể format ghi chú lúc này.')
      setUndoSnapshot(previous)
      const nextTitle = title.trim() || data.title || title
      const nextContent = data.content
      setTitle(nextTitle)
      setContent(nextContent)
      setViewMode('preview')
      await saveCurrentNote({ id: selectedId, title: nextTitle, content: nextContent, pinned })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAiFormatting(false)
    }
  }

  const handleUndoAiFormat = async () => {
    if (!undoSnapshot) return
    const { title: prevTitle, content: prevContent } = undoSnapshot
    setTitle(prevTitle)
    setContent(prevContent)
    setUndoSnapshot(null)
    setViewMode('edit')
    await saveCurrentNote({ id: selectedId, title: prevTitle, content: prevContent, pinned })
  }

  const handleTogglePin = async () => {
    const nextPinned = !pinned
    setPinned(nextPinned)
    if (selectedId !== 'new' || title.trim() || content.trim()) {
      await saveCurrentNote({ id: selectedId, title, content, pinned: nextPinned })
    }
  }

  const handleDelete = async () => {
    if (selectedId === 'new') {
      startNewNote()
      return
    }
    try {
      const res = await fetch(`/api/notepad?id=${encodeURIComponent(selectedId)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Không xóa được ghi chú.')
      const remaining = notes.filter((n) => n.id !== selectedId)
      setNotes(remaining)
      setConfirmDelete(false)
      if (remaining.length > 0) {
        selectNote(remaining[0])
        setMobileShowEditor(false)
      } else {
        startNewNote()
        setMobileShowEditor(false)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleCopy = async () => {
    const fullText = title.trim() ? `${title.trim()}\n\n${content}` : content
    await navigator.clipboard.writeText(fullText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const handleExport = async (kind: 'md' | 'docx' | 'pdf') => {
    if ((!title.trim() && !content.trim()) || exporting) return
    setExporting(kind)
    setError(null)
    try {
      const doc = notepadToReportDoc({
        title,
        content,
        updatedAt: selectedNote?.updated_at || selectedNote?.created_at,
      })
      if (kind === 'md') {
        const mdText = title.trim() ? `# ${title.trim()}\n\n${content}` : content
        triggerBlobDownload(new Blob([mdText], { type: 'text/markdown;charset=utf-8' }), `${doc.fileName}.md`)
      } else if (kind === 'docx') {
        const { toDocxBlob } = await import('@/features/report/to-docx')
        const blob = await toDocxBlob(doc)
        triggerBlobDownload(blob, `${doc.fileName}.docx`)
      } else {
        const res = await fetch('/api/report/pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doc }),
        })
        const json = (await res.json().catch(() => ({}))) as { pdf?: string; error?: string }
        if (!res.ok || !json.pdf) throw new Error(json.error ?? `Máy chủ trả lỗi ${res.status}`)
        const blob = new Blob([Uint8Array.from(atob(json.pdf), (c) => c.charCodeAt(0))], { type: 'application/pdf' })
        triggerBlobDownload(blob, `${doc.fileName}.pdf`)
      }
    } catch (err) {
      setError(`Không tạo được file: ${(err as Error).message}`)
    } finally {
      setExporting(null)
    }
  }

  const filteredNotes = useMemo(() => {
    if (!query.trim()) return notes
    return notes.filter((n) => matchesQuery(n.title, query) || matchesQuery(n.content, query))
  }, [notes, query])

  const wordCount = useMemo(() => {
    const trimmed = content.trim()
    return trimmed ? trimmed.split(/\s+/).length : 0
  }, [content])

  const selectedNote = notes.find((n) => n.id === selectedId)
  const textSizeClass = FONT_SIZE_CLASS[fontSize] ?? FONT_SIZE_CLASS.sm

  const toolBtnClass =
    'inline-flex h-7 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'

  return (
    <div className="pb-4">
      <title>Notepad · Ghi chú tự do</title>

      {/* Compact Top Bar so the editor gets maximum vertical space */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="hidden md:inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/80 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            title={sidebarOpen ? 'Thu gọn danh sách ghi chú' : 'Mở danh sách ghi chú'}
          >
            {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </button>
          <h1 className="text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl dark:text-white">Notepad</h1>
          <span className="hidden sm:inline text-xs text-slate-400 dark:text-slate-500">· Ghi chú tự do & AI Format</span>
        </div>

        <Button size="sm" onClick={startNewNote}>
          <FilePlus2 className="size-3.5" /> Ghi chú mới
        </Button>
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div
        className={cn(
          'grid gap-3.5',
          sidebarOpen && !expanded
            ? 'md:grid-cols-[260px_minmax(0,1fr)] lg:grid-cols-[290px_minmax(0,1fr)]'
            : 'grid-cols-1',
        )}
      >
        {/* Left Sidebar: Note List */}
        {sidebarOpen && !expanded ? (
          <Card className={cn('flex flex-col p-3 md:h-[calc(100dvh-8.2rem)]', mobileShowEditor && 'hidden md:flex')}>
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm tiêu đề hoặc nội dung..."
              className="w-full"
            />

            <div className="mt-2.5 flex items-center justify-between px-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
              <span>{filteredNotes.length} ghi chú</span>
              {selectedId === 'new' ? <Badge tone="brand">Mới</Badge> : null}
            </div>

            <div className="mt-1.5 flex-1 space-y-1 overflow-y-auto pr-0.5">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-xs text-slate-400">
                  <Loader2 className="mr-2 size-3.5 animate-spin" /> Đang tải...
                </div>
              ) : filteredNotes.length === 0 ? (
                <EmptyState
                  icon={<StickyNote className="size-7" />}
                  title={query ? 'Không tìm thấy' : 'Chưa có ghi chú'}
                  description={query ? 'Thử từ khóa khác.' : 'Gõ vào khung bên phải để tạo mới.'}
                />
              ) : (
                filteredNotes.map((note) => {
                  const active = note.id === selectedId
                  return (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => selectNote(note)}
                      className={cn(
                        'w-full rounded-xl border px-2.5 py-2 text-left transition-all',
                        active
                          ? 'border-brand-300 bg-brand-50/70 shadow-2xs dark:border-brand-700/70 dark:bg-brand-950/40'
                          : 'border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-800 dark:hover:bg-slate-800/50',
                      )}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <h3 className="line-clamp-1 text-xs font-bold text-slate-900 dark:text-white">
                          {note.title || 'Ghi chú không tiêu đề'}
                        </h3>
                        {note.pinned ? <Pin className="size-3 shrink-0 fill-amber-400 text-amber-500" /> : null}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {note.content.replace(/[#*_`>-]/g, '').trim() || 'Chưa có nội dung...'}
                      </p>
                      <p className="mt-1 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                        {formatDate(note.updated_at || note.created_at)}
                      </p>
                    </button>
                  )
                })
              )}
            </div>
          </Card>
        ) : null}

        {/* Right Pane: Notepad Editor */}
        <Card
          className={cn(
            'flex flex-col p-3 sm:p-4',
            expanded ? 'min-h-[82dvh]' : 'md:h-[calc(100dvh-8.2rem)]',
            !mobileShowEditor && notes.length > 0 && sidebarOpen && !expanded && 'hidden md:flex',
          )}
        >
          {/* Top Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="md:hidden -ml-2 h-7 px-2 text-xs" onClick={() => setMobileShowEditor(false)}>
                <ChevronLeft className="size-3.5" /> Danh sách ({notes.length})
              </Button>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                {saveState === 'saving' ? (
                  <span className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400">
                    <Loader2 className="size-3 animate-spin" /> Đang lưu...
                  </span>
                ) : saveState === 'dirty' ? (
                  <span className="text-amber-600 dark:text-amber-400">● Chưa lưu</span>
                ) : saveState === 'error' ? (
                  <span className="text-rose-600 dark:text-rose-400">● Lỗi lưu</span>
                ) : selectedNote ? (
                  <span>Đã lưu · {formatDate(selectedNote.updated_at || selectedNote.created_at)}</span>
                ) : (
                  <span>Ghi chú mới</span>
                )}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleAiFormat()}
                disabled={aiFormatting || !content.trim()}
                className="h-7 border-violet-200 bg-violet-50/80 px-2.5 text-xs text-violet-700 hover:bg-violet-100 dark:border-violet-800/60 dark:bg-violet-950/50 dark:text-violet-300 dark:hover:bg-violet-900/60"
                title="AI tự động chia đoạn, in đậm ý chính, tạo bullet list và sửa lỗi chính tả"
              >
                {aiFormatting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                <span>{aiFormatting ? 'Đang format...' : 'AI Format'}</span>
              </Button>

              {undoSnapshot ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleUndoAiFormat()}
                  title="Hoàn tác về bản trước khi AI Format"
                  className="h-7 px-2 text-xs text-slate-600 dark:text-slate-300"
                >
                  <RotateCcw className="size-3.5" />
                  <span className="hidden sm:inline">Hoàn tác</span>
                </Button>
              ) : null}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleTogglePin()}
                title={pinned ? 'Bỏ ghim' : 'Ghim ghi chú lên đầu'}
                className={cn('h-7 px-2 text-xs', pinned && 'text-amber-600 dark:text-amber-400')}
              >
                {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                <span className="hidden sm:inline">{pinned ? 'Bỏ ghim' : 'Ghim'}</span>
              </Button>

              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void handleCopy()} disabled={!title.trim() && !content.trim()}>
                {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                <span className="hidden sm:inline">{copied ? 'Đã chép' : 'Sao chép'}</span>
              </Button>

              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(!title.trim() && !content.trim()) || exporting !== null}
                    className="h-7 border-brand-200 bg-brand-50/80 px-2.5 text-xs text-brand-700 hover:border-brand-300 hover:bg-brand-100 dark:border-brand-800/70 dark:bg-brand-950/50 dark:text-brand-300 dark:hover:bg-brand-900/60"
                    title="Xuất ghi chú ra file PDF, Word (.docx) hoặc Markdown (.md)"
                  >
                    {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
                    <span>Xuất file</span>
                    <ChevronDown className="size-3 opacity-60" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={6}
                    className="animate-scale-in z-50 min-w-44 rounded-xl border border-slate-200/80 bg-white/95 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95"
                  >
                    <DropdownMenu.Item
                      onSelect={() => void handleExport('pdf')}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none data-[highlighted]:bg-slate-100 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800"
                    >
                      <FileType className="size-4 text-rose-500" />
                      <span>Xuất PDF (.pdf)</span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={() => void handleExport('docx')}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none data-[highlighted]:bg-slate-100 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800"
                    >
                      <FileDown className="size-4 text-blue-600" />
                      <span>Xuất Word (.docx)</span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={() => void handleExport('md')}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none data-[highlighted]:bg-slate-100 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800"
                    >
                      <FileText className="size-4 text-slate-500" />
                      <span>Xuất Markdown (.md)</span>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>

              {selectedId !== 'new' ? (
                confirmDelete ? (
                  <div className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-1.5 py-0.5 dark:bg-rose-950/50">
                    <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">Xóa?</span>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-rose-600 hover:bg-rose-100" onClick={() => void handleDelete()}>
                      Có
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setConfirmDelete(false)}>
                      Hủy
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(true)}
                    className="h-7 px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="size-3.5" />
                    <span className="hidden sm:inline">Xóa</span>
                  </Button>
                )
              ) : null}

              <Button
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => void saveCurrentNote()}
                disabled={saveState === 'saving' || (!title.trim() && !content.trim())}
              >
                <Save className="size-3.5" /> Lưu
              </Button>
            </div>
          </div>

          {/* Compact Title Input */}
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setSaveState('dirty')
            }}
            placeholder="Đặt tiêu đề ghi chú..."
            className="mt-2.5 w-full border-0 bg-transparent text-base font-extrabold tracking-tight text-slate-900 placeholder:text-slate-300 focus:outline-none sm:text-lg dark:text-white dark:placeholder:text-slate-600"
          />

          {/* Formatting Toolbar & View Mode / Font Size Switcher */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50/80 px-2 py-1 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="flex flex-wrap items-center gap-0.5">
              <button
                type="button"
                onClick={() => {
                  if (viewMode === 'preview') setViewMode('edit')
                  setTimeout(() => applyWrap('**', '**', 'in đậm'), 0)
                }}
                className={toolBtnClass}
                title="In đậm (Ctrl+B)"
              >
                <Bold className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (viewMode === 'preview') setViewMode('edit')
                  setTimeout(() => applyWrap('*', '*', 'in nghiêng'), 0)
                }}
                className={toolBtnClass}
                title="In nghiêng (Ctrl+I)"
              >
                <Italic className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (viewMode === 'preview') setViewMode('edit')
                  setTimeout(() => applyWrap('<u>', '</u>', 'gạch chân'), 0)
                }}
                className={toolBtnClass}
                title="Gạch chân (Ctrl+U)"
              >
                <Underline className="size-3.5" />
              </button>

              <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />

              {/* Multi-Header Dropdown */}
              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className={toolBtnClass}
                    title="Chọn cỡ tiêu đề (Heading 1 – 4)"
                  >
                    <Heading className="size-3.5" />
                    <ChevronDown className="size-3 opacity-60" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="start"
                    sideOffset={6}
                    className="animate-scale-in z-50 min-w-48 rounded-xl border border-slate-200/80 bg-white/95 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95"
                  >
                    {[
                      { label: 'Heading 1', sub: 'Tiêu đề lớn', prefix: '# ', icon: Heading1, sizeClass: 'text-sm font-extrabold' },
                      { label: 'Heading 2', sub: 'Tiêu đề vừa', prefix: '## ', icon: Heading2, sizeClass: 'text-xs font-bold' },
                      { label: 'Heading 3', sub: 'Tiêu đề nhỏ', prefix: '### ', icon: Heading3, sizeClass: 'text-xs font-semibold' },
                      { label: 'Heading 4', sub: 'Tiêu đề phụ', prefix: '#### ', icon: Heading4, sizeClass: 'text-[11px] font-semibold' },
                      { label: 'Normal text', sub: 'Văn bản thường', prefix: '', icon: Type, sizeClass: 'text-xs font-normal' },
                    ].map((h) => (
                      <DropdownMenu.Item
                        key={h.label}
                        onSelect={() => {
                          if (viewMode === 'preview') setViewMode('edit')
                          setTimeout(() => applyLinePrefix(h.prefix), 0)
                        }}
                        className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-slate-700 outline-none data-[highlighted]:bg-slate-100 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800"
                      >
                        <span className="flex items-center gap-2">
                          <h.icon className="size-3.5 text-slate-400" />
                          <span className={h.sizeClass}>{h.label}</span>
                        </span>
                        <span className="text-[11px] text-slate-400">{h.sub}</span>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>

              <button
                type="button"
                onClick={() => {
                  if (viewMode === 'preview') setViewMode('edit')
                  setTimeout(() => applyLinePrefix('- '), 0)
                }}
                className={toolBtnClass}
                title="Danh sách dấu chấm (Bullet list)"
              >
                <List className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (viewMode === 'preview') setViewMode('edit')
                  setTimeout(() => applyLinePrefix((i) => `${i + 1}. `), 0)
                }}
                className={toolBtnClass}
                title="Danh sách đánh số (Numbered list)"
              >
                <ListOrdered className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (viewMode === 'preview') setViewMode('edit')
                  setTimeout(() => applyLinePrefix('> '), 0)
                }}
                className={toolBtnClass}
                title="Trích dẫn / Ghi chú nổi bật (Quote)"
              >
                <Quote className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (viewMode === 'preview') setViewMode('edit')
                  setTimeout(() => insertDivider(), 0)
                }}
                className={toolBtnClass}
                title="Đường kẻ ngang phân cách"
              >
                <Minus className="size-3.5" />
              </button>

              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  if (files.length) void uploadAndInsertImages(files)
                }}
              />
              <button
                type="button"
                disabled={uploadingImage}
                onClick={() => imageInputRef.current?.click()}
                className={toolBtnClass}
                title="Chèn hình ảnh (hoặc dán trực tiếp bằng Ctrl+V / kéo thả ảnh vào khung viết)"
              >
                {uploadingImage ? <Loader2 className="size-3.5 animate-spin text-brand-600" /> : <ImagePlus className="size-3.5" />}
                <span className="hidden sm:inline">Ảnh</span>
              </button>

              <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />

              {/* Font Size Selector (Nhỏ / Vừa / Lớn) */}
              <div className="inline-flex items-center rounded-lg bg-slate-200/60 p-0.5 dark:bg-slate-800" title="Cỡ chữ hiển thị">
                {(
                  [
                    { id: 'xs', label: 'A-' },
                    { id: 'sm', label: 'A' },
                    { id: 'base', label: 'A+' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFontSize(opt.id)}
                    className={cn(
                      'rounded-md px-1.5 py-0.5 text-[11px] font-bold transition',
                      fontSize === opt.id
                        ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-white'
                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className={cn(toolBtnClass, 'hidden sm:inline-flex')}
                title={expanded ? 'Thu nhỏ khung soạn thảo' : 'Mở rộng toàn khung'}
              >
                {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </button>
            </div>

            {/* Mode Switcher: Soạn thảo / Xem đẹp / Song song */}
            <div className="flex items-center rounded-lg bg-slate-200/70 p-0.5 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setViewMode('edit')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition',
                  viewMode === 'edit'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                )}
              >
                <Pencil className="size-3" /> Soạn thảo
              </button>
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition',
                  viewMode === 'preview'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                )}
              >
                <Eye className="size-3" /> Xem đẹp
              </button>
              <button
                type="button"
                onClick={() => setViewMode('split')}
                className={cn(
                  'hidden sm:inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition',
                  viewMode === 'split'
                    ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                )}
              >
                <Columns2 className="size-3" /> Song song
              </button>
            </div>
          </div>

          {/* Content Area: Edit / Preview / Split */}
          <div
            className={cn(
              'mt-2.5 min-h-[420px] flex-1 overflow-hidden',
              viewMode === 'split' ? 'grid gap-3 sm:grid-cols-2' : 'flex flex-col',
            )}
          >
            {viewMode !== 'preview' ? (
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  setSaveState('dirty')
                }}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
                  if (files.length > 0) {
                    e.preventDefault()
                    void uploadAndInsertImages(files)
                  }
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
                }}
                onDrop={(e) => {
                  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
                  if (files.length > 0) {
                    e.preventDefault()
                    void uploadAndInsertImages(files)
                  }
                }}
                placeholder="Viết tự do tại đây (tiếng Việt, tiếng Anh, dàn ý, nháp bài viết, ghi chú cá nhân...) — bôi đen chữ để in đậm/nghiêng hoặc bấm nút AI Format để tự động trình bày đẹp."
                className={cn(
                  'h-full min-h-[400px] w-full flex-1 resize-none border-0 bg-transparent text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500',
                  textSizeClass,
                  viewMode === 'split' && 'border-r border-slate-200/80 pr-3 dark:border-slate-800',
                )}
              />
            ) : null}

            {viewMode !== 'edit' ? (
              <div
                onDoubleClick={() => setViewMode('edit')}
                title="Nhấp đúp để chuyển nhanh sang chế độ Soạn thảo"
                className={cn(
                  'h-full min-h-[400px] flex-1 overflow-y-auto rounded-xl bg-slate-50/40 p-3 text-slate-800 dark:bg-slate-900/30 dark:text-slate-100',
                  textSizeClass,
                )}
              >
                {content.trim() ? (
                  <Markdown
                    html
                    className="prose prose-sm prose-slate dark:prose-invert max-w-none space-y-1.5 [&_img]:my-2 [&_img]:max-h-96 [&_img]:rounded-xl [&_img]:border [&_img]:border-slate-200/80 [&_img]:shadow-sm dark:[&_img]:border-slate-800"
                  >
                    {content}
                  </Markdown>
                ) : (
                  <p className="text-xs italic text-slate-400">Chưa có nội dung để hiển thị. Chuyển sang tab "Soạn thảo" để viết ghi chú.</p>
                )}
              </div>
            ) : null}
          </div>

          {/* Compact Footer Counter */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400 dark:border-slate-800/80 dark:text-slate-500">
            <span>{wordCount} từ · {content.length} ký tự</span>
            <span>Ctrl+B (Đậm) · Ctrl+I (Nghiêng) · Ctrl+U (Gạch chân) · Ctrl+S (Lưu)</span>
          </div>
        </Card>
      </div>
    </div>
  )
}
