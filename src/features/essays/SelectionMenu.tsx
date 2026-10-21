import { BookOpen, ExternalLink, NotebookPen, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ESSAY_ITEM_KINDS, type Essay, type EssayDoc, type EssayItem, type EssayItemKind } from '@/types/essays'
import { refreshSiteData } from '../admin/api'
import { slugify } from '../admin/utils'
import { essayAdminApi } from './api'
import { KIND_META } from './lib'

export interface TextSelection {
  sentence: number
  start: number
  end: number
  text: string
  /** Viewport rectangle of the selection, to place the menu under it. */
  rect: { top: number; bottom: number; left: number; width: number }
}

type Done = { tone: 'ok' | 'error'; message: string; href?: string }

/** Menu under a selected phrase: add it to this essay, or send it to Admin → Vocabulary / Notes. */
export function SelectionMenu({
  essay,
  selection,
  onClose,
  onAdded,
}: {
  essay: EssayDoc
  selection: TextSelection
  onClose: () => void
  onAdded: (essay: Essay, item: EssayItem) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [kind, setKind] = useState<EssayItemKind | 'auto'>('auto')
  const [pending, setPending] = useState<'' | 'essay' | 'vocab' | 'note'>('')
  const [done, setDone] = useState<Done | null>(null)
  const sentence = essay.sentences[selection.sentence]?.text ?? ''

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const outside = (e: MouseEvent) => !pending && ref.current && !ref.current.contains(e.target as Node) && onClose()
    window.addEventListener('keydown', key)
    window.addEventListener('mousedown', outside)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('mousedown', outside)
    }
  }, [onClose, pending])

  const run = async (what: 'essay' | 'vocab' | 'note') => {
    setPending(what)
    setDone(null)
    try {
      if (what === 'essay') {
        const { essay: next, item } = await essayAdminApi.addItem({ essayId: essay.id, sentence: selection.sentence, start: selection.start, end: selection.end, kind })
        refreshSiteData('essays/index.json', 'essays/phrases.json', 'review')
        onAdded(next, item)
        return
      }
      const context = `Ngữ cảnh — câu trong bài mẫu IELTS "${essay.title}": ${sentence}`
      if (what === 'vocab') {
        const res = await essayAdminApi.toVocabulary(selection.text, context)
        refreshSiteData('vocabulary', 'review')
        const { topic, subTopic } = res.placement
        setDone({
          tone: 'ok',
          message: `"${res.entry.word}" ${res.action === 'created' ? 'đã thêm vào' : 'đã cập nhật trong'} Vocabulary · ${topic} › ${subTopic}`,
          href: `/vocabulary/${slugify(topic)}/${slugify(subTopic)}#${slugify(res.entry.word)}`,
        })
      } else {
        const res = await essayAdminApi.toNote(`${selection.text}\n\n${context}`)
        refreshSiteData('notes', 'review')
        setDone({ tone: 'ok', message: `Note "${res.note.title}" ${res.action === 'created' ? 'đã tạo' : 'đã cập nhật'}`, href: `/notes#${res.note.id}` })
      }
    } catch (e) {
      setDone({ tone: 'error', message: (e as Error).message })
    } finally {
      setPending('')
    }
  }

  const width = 320
  const left = Math.min(Math.max(8, selection.rect.left + selection.rect.width / 2 - width / 2), window.innerWidth - width - 8)
  const below = selection.rect.bottom + 8
  const top = below + 230 > window.innerHeight ? Math.max(8, selection.rect.top - 238) : below

  return (
    <div
      ref={ref}
      style={{ top, left, width }}
      className="fixed z-50 space-y-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold text-slate-900 dark:text-white">“{selection.text}”</p>
        <button type="button" onClick={onClose} className="rounded p-0.5 text-slate-400 hover:text-slate-600" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {(['auto', ...ESSAY_ITEM_KINDS] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
              kind === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
            )}
          >
            {k === 'auto' ? 'AI chọn loại' : KIND_META[k].label}
          </button>
        ))}
      </div>
      <Button size="sm" className="w-full" loading={pending === 'essay'} disabled={Boolean(pending)} onClick={() => void run('essay')}>
        <Plus className="size-4" /> Thêm vào bài này
      </Button>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="outline" loading={pending === 'vocab'} disabled={Boolean(pending)} onClick={() => void run('vocab')}>
          <BookOpen className="size-4" /> Vocabulary
        </Button>
        <Button size="sm" variant="outline" loading={pending === 'note'} disabled={Boolean(pending)} onClick={() => void run('note')}>
          <NotebookPen className="size-4" /> Notes
        </Button>
      </div>
      {pending === 'vocab' || pending === 'note' ? <p className="text-[11px] text-slate-500">Gemini + Longman/OZDIC, thường 15–40 giây…</p> : null}
      {done ? (
        <p className={cn('rounded-lg px-2.5 py-1.5 text-xs', done.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300')}>
          {done.message}
          {done.href ? (
            <Link to={done.href} className="ml-1 inline-flex items-center gap-0.5 font-semibold underline">
              Mở <ExternalLink className="size-3" />
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
