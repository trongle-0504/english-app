import { BookOpenCheck, ChevronDown, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { TASK1_MAX_MODEL_CHARS, type WritingTask1Extras } from '@/types/writingMock'
import { countWords, task1Api } from './api'

type SaveState = 'idle' | 'waiting' | 'saving' | 'saved' | 'error'

const AUTOSAVE_MS = 800

/**
 * The learner's own model essay for a question. It saves itself: 0.8 s after typing stops, on blur, and when the box
 * unmounts with unsaved changes (so pressing "Bắt đầu" right after pasting never loses it). The draft is never
 * replaced by the server's copy. Render it with `key={promptId}`.
 */
export function ModelEssayBox({
  promptId,
  extras,
  onSaved,
  defaultOpen = false,
  className,
}: {
  promptId: string
  extras: WritingTask1Extras | null
  onSaved?: (extras: WritingTask1Extras) => void
  defaultOpen?: boolean
  className?: string
}) {
  const initial = extras?.modelEssay?.text ?? ''
  const [open, setOpen] = useState(defaultOpen || Boolean(initial))
  const [draft, setDraft] = useState(initial)
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState('')
  const saved = useRef(initial)
  const [savedText, setSavedText] = useState(initial)
  const latest = useRef(initial)
  const timer = useRef<number | undefined>(undefined)
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved

  // The first server copy fills an untouched, empty box (extras may load after the box mounts).
  const touched = useRef(false)
  useEffect(() => {
    if (touched.current || !initial || latest.current) return
    saved.current = initial
    setSavedText(initial)
    latest.current = initial
    setDraft(initial)
    setOpen(true)
  }, [initial])

  const save = useCallback(async () => {
    window.clearTimeout(timer.current)
    const text = latest.current
    if (text.trim() === saved.current.trim()) {
      setState((s) => (s === 'waiting' ? 'saved' : s))
      return
    }
    setState('saving')
    try {
      const { extras: next } = await task1Api.saveModelEssay(promptId, text)
      saved.current = text
      setSavedText(text)
      setError('')
      setState(latest.current === text ? 'saved' : 'waiting')
      onSavedRef.current?.(next)
    } catch (cause) {
      setError((cause as Error).message)
      setState('error')
    }
  }, [promptId])

  // Unmount with unsaved changes (e.g. "Bắt đầu" pressed right after pasting): save now.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (latest.current.trim() !== saved.current.trim()) {
        void task1Api.saveModelEssay(promptId, latest.current).then(({ extras: next }) => onSavedRef.current?.(next)).catch(() => {})
      }
    },
    [promptId],
  )

  const change = (text: string) => {
    touched.current = true
    latest.current = text
    setDraft(text)
    setState('waiting')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS)
  }

  const words = countWords(draft)
  const status =
    state === 'saving'
      ? 'Đang lưu…'
      : state === 'waiting'
        ? 'Sẽ tự lưu khi bạn ngừng gõ'
        : state === 'saved'
          ? '✓ Đã lưu'
          : state === 'error'
            ? `Chưa lưu được: ${error}`
            : savedText
              ? '✓ Đã lưu'
              : ''

  return (
    <div className={cn('rounded-xl border border-slate-200 dark:border-slate-700', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 p-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
          <BookOpenCheck className="size-4 text-brand-600" /> Bài mẫu của bạn
          <span className="text-xs font-normal text-slate-500">(không bắt buộc{savedText ? ` · ${countWords(savedText)} từ` : ''})</span>
        </span>
        <ChevronDown className={cn('size-4 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-slate-200 p-3 dark:border-slate-700">
          <p className="text-xs text-slate-500">
            Dán bài mẫu bạn có cho đề này. Bài mẫu được ẩn trong lúc làm bài; sau khi chấm, AI so sánh bài của bạn với bài mẫu và chọn từ vựng đáng học từ đó.
          </p>
          <textarea
            value={draft}
            onChange={(e) => change(e.target.value)}
            onBlur={() => void save()}
            maxLength={TASK1_MAX_MODEL_CHARS}
            className="min-h-[180px] w-full resize-y rounded-lg border p-3 text-sm leading-relaxed"
            placeholder="The bar chart illustrates…"
            aria-label="Bài mẫu của bạn"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className={cn('text-slate-500', state === 'error' && 'text-rose-600', state === 'saved' && 'text-emerald-600')}>
              {status}
              {words ? ` · ${words} từ` : ''}
            </span>
            {draft ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!window.confirm('Xoá bài mẫu của đề này?')) return
                  change('')
                  void save()
                }}
              >
                <Trash2 className="size-3.5" /> Xoá bài mẫu
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
