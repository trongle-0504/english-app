// The "questions / answers" box of Listening → Simplify. Besides typing, a screenshot of the question paper can be
// added (button, Ctrl+V into the box, or drop): Gemini reads it into text lines that are added to the box, so they can be
// checked and corrected before the analysis runs.
import { ImagePlus, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { imageFiles, readFileAsBase64 } from '@/features/admin/utils'
import { cn } from '@/lib/cn'
import { listeningApi } from './api'

const MAX_IMAGES = 4

export function QuestionsField({ value, onChange, inputClass }: { value: string; onChange: (next: string) => void; inputClass: string }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  // The text read from the images goes after what is already in the box.
  const read = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/')).slice(0, MAX_IMAGES)
    if (!images.length) return
    setError('')
    setReading(images.length)
    try {
      const payload = await Promise.all(images.map(async (f) => ({ mimeType: f.type || 'image/png', data: await readFileAsBase64(f) })))
      const { text } = await listeningApi.readImage(payload)
      if (text) onChange(value.trim() ? `${value.trimEnd()}\n${text}` : text)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setReading(0)
    }
  }

  return (
    <div className="block space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Câu hỏi hoặc đáp án <span className="font-normal text-slate-400">(không bắt buộc)</span>
        </span>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={reading > 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
        >
          {reading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
          {reading ? `Đang đọc ${reading} ảnh…` : 'Chèn ảnh đề / đáp án'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            void read(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      <textarea
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const pasted = imageFiles(e.clipboardData)
          if (!pasted.length) return
          e.preventDefault()
          void read(pasted)
        }}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.items).some((i) => i.kind === 'file')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          const dropped = imageFiles(e.dataTransfer)
          setDragging(false)
          if (!dropped.length) return
          e.preventDefault()
          void read(dropped)
        }}
        placeholder={'31 convenient\n32 suits\n33 tailor …\n(hoặc dán ảnh đề / đáp án bằng Ctrl+V)'}
        className={cn(inputClass, dragging && 'border-brand-400 bg-brand-50/60 dark:bg-brand-950/30')}
      />
      <span className="block text-xs text-slate-500">
        Có số câu thì AI đánh dấu đúng chỗ dẫn tới từng đáp án; để trống thì bỏ qua phần đáp án, AI không tự đoán. Ảnh được đọc thành chữ
        vào ô này để bạn kiểm tra trước khi phân tích.
      </span>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </div>
  )
}
