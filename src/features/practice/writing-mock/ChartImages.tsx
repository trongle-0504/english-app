import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, ChevronLeft, ChevronRight, ImagePlus, Loader2, Trash2, X, ZoomIn } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { TASK1_MAX_IMAGES, type WritingTask1Extras, type WritingTask1Image } from '@/types/writingMock'
import { imageForUpload, task1Api } from './api'

/** A full-size view of the pictures, with previous / next and ←/→ keys. */
function ImageViewer({ images, index, onIndex, onClose }: { images: WritingTask1Image[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const open = index !== null && Boolean(images[index])
  const step = useCallback(
    (delta: number) => {
      if (index === null || !images.length) return
      onIndex((index + delta + images.length) % images.length)
    },
    [images.length, index, onIndex],
  )
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(72rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white p-3 shadow-2xl dark:bg-slate-900"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') step(-1)
            if (e.key === 'ArrowRight') step(1)
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <Dialog.Title className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Hình biểu đồ {index !== null ? index + 1 : ''}/{images.length}
            </Dialog.Title>
            <Dialog.Description className="sr-only">Dùng phím mũi tên trái / phải để chuyển hình.</Dialog.Description>
            <Dialog.Close className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Đóng">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            {open ? <img src={images[index].url} alt={`Hình biểu đồ ${index + 1}`} className="max-h-[calc(100dvh-7rem)] max-w-full rounded-lg object-contain" /> : null}
            {images.length > 1 ? (
              <>
                <button type="button" onClick={() => step(-1)} aria-label="Hình trước" className="absolute left-1 rounded-full bg-white/90 p-2 shadow hover:bg-white dark:bg-slate-800/90">
                  <ChevronLeft className="size-5" />
                </button>
                <button type="button" onClick={() => step(1)} aria-label="Hình sau" className="absolute right-1 rounded-full bg-white/90 p-2 shadow hover:bg-white dark:bg-slate-800/90">
                  <ChevronRight className="size-5" />
                </button>
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** The chart pictures, read-only: a click opens them full size. */
export function ChartImages({ images, className }: { images: WritingTask1Image[]; className?: string }) {
  const [viewing, setViewing] = useState<number | null>(null)
  if (!images.length) {
    return (
      <p className={cn('flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200', className)}>
        <AlertTriangle className="size-4 shrink-0" /> Đề này chưa có hình biểu đồ.
      </p>
    )
  }
  return (
    <div className={cn('space-y-2', className)}>
      {images.map((image, i) => (
        <button
          key={image.n}
          type="button"
          onClick={() => setViewing(i)}
          className="group relative block w-full overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700"
          title="Bấm để phóng to"
        >
          <img src={image.url} alt={`Hình biểu đồ ${i + 1}`} width={image.width} height={image.height} className="h-auto w-full object-contain" loading="lazy" />
          <span className="absolute right-2 bottom-2 rounded-full bg-slate-900/70 p-1.5 text-white opacity-0 transition group-hover:opacity-100">
            <ZoomIn className="size-4" />
          </span>
        </button>
      ))}
      <ImageViewer images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
    </div>
  )
}

/** Picture files of a clipboard / drop, or [] (a clipboard holding text is left to the text box). */
function picturesOf(data: DataTransfer | null, onlyWhenNoText: boolean): File[] {
  if (!data) return []
  const files = [...data.files].filter((f) => f.type.startsWith('image/'))
  if (!files.length) {
    for (const item of data.items ?? []) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
  }
  if (onlyWhenNoText && files.length && data.types.includes('text/plain') && data.getData('text/plain').trim()) return []
  return files
}

const isTextField = (el: Element | null) =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'file'].includes(el.type)) || (el instanceof HTMLElement && el.isContentEditable)

/**
 * Adds chart pictures to a question: Ctrl+V anywhere on the page (also with a text box focused when the clipboard holds
 * only a picture), drag and drop, or the file picker. Thumbnails with delete and zoom.
 */
export function ChartImageBox({
  promptId,
  extras,
  onChange,
  compact = false,
}: {
  promptId: string
  extras: WritingTask1Extras | null
  onChange: (extras: WritingTask1Extras) => void
  compact?: boolean
}) {
  const images = extras?.images ?? []
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')
  const [dragging, setDragging] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const room = TASK1_MAX_IMAGES - images.length

  const upload = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      setError('')
      setHint('')
      if (files.length > room) {
        setError(room ? `Chỉ thêm được ${room} hình nữa (tối đa ${TASK1_MAX_IMAGES}).` : `Đề này đã có đủ ${TASK1_MAX_IMAGES} hình.`)
        if (!room) return
        files = files.slice(0, room)
      }
      setBusy(true)
      try {
        const prepared = await Promise.all(files.map(imageForUpload))
        const { extras: next } = await task1Api.addImages(promptId, prepared)
        onChange(next)
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [onChange, promptId, room],
  )

  // Ctrl+V anywhere on the page.
  const uploadRef = useRef(upload)
  uploadRef.current = upload
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const inText = isTextField(document.activeElement)
      const files = picturesOf(e.clipboardData, inText)
      if (files.length) {
        e.preventDefault()
        void uploadRef.current(files)
        return
      }
      if (inText) return
      const html = e.clipboardData?.getData('text/html') ?? ''
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (/<img\b/i.test(html) || /^https?:\/\/\S+\.(png|jpe?g|webp|gif)(\?\S*)?$/i.test(text.trim())) {
        setHint('Bạn vừa dán đường link của hình, không phải hình. Trên trang web, bấm chuột phải vào hình → "Sao chép hình ảnh" (Copy image), rồi Ctrl+V lại ở đây.')
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  const remove = async (n: number) => {
    setError('')
    try {
      const { extras: next } = await task1Api.removeImage(promptId, n)
      onChange(next)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void upload(picturesOf(e.dataTransfer, false))
        }}
        className={cn(
          'rounded-xl border-2 border-dashed p-4 text-center text-sm transition-colors',
          dragging ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30' : 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/50',
          compact && 'p-3',
        )}
      >
        <p className="font-semibold text-slate-700 dark:text-slate-200">
          {busy ? (
            <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Đang tải hình lên…</span>
          ) : (
            <>Dán hình biểu đồ (<kbd className="rounded border bg-white px-1 font-mono text-xs dark:bg-slate-900">Ctrl</kbd>+<kbd className="rounded border bg-white px-1 font-mono text-xs dark:bg-slate-900">V</kbd>) hoặc kéo thả vào đây</>
          )}
        </p>
        {!compact ? (
          <p className="mt-1 text-xs text-slate-500">Trên trang có đề: chuột phải vào hình → "Sao chép hình ảnh", rồi Ctrl+V ở bất kỳ đâu trên trang này. Tối đa {TASK1_MAX_IMAGES} hình, hình được lưu cho đề này.</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={busy || room <= 0}>
            <ImagePlus className="size-4" /> Chọn file ảnh
          </Button>
          <span className="text-xs tabular-nums text-slate-500">{images.length}/{TASK1_MAX_IMAGES}</span>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void upload([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </div>
      {hint ? <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{hint}</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {images.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {images.map((image, i) => (
            <div key={image.n} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700">
              <button type="button" onClick={() => setViewing(i)} className="block w-full" title="Phóng to">
                <img src={image.url} alt={`Hình biểu đồ ${i + 1}`} className="h-24 w-full object-contain" />
              </button>
              <button
                type="button"
                onClick={() => void remove(image.n)}
                className="absolute top-1 right-1 rounded-full bg-white/90 p-1 text-rose-600 shadow hover:bg-rose-50 dark:bg-slate-800/90"
                aria-label={`Xoá hình ${i + 1}`}
                title="Xoá hình"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <ImageViewer images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
    </div>
  )
}
