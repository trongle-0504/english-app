import { ImagePlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { imageFiles } from './utils'

/** Image files attached to a Gemini request: browse, drop, or paste (Ctrl+V) anywhere in the zone. */
export function ImageAttachments({ files, onChange, max = 6 }: { files: File[]; onChange: (files: File[]) => void; max?: number }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files])
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])

  const add = (incoming: File[]) => {
    if (incoming.length) onChange([...files, ...incoming].slice(0, max))
  }

  return (
    <div
      tabIndex={0}
      onPaste={(e) => {
        const pasted = imageFiles(e.clipboardData)
        if (!pasted.length) return
        e.preventDefault()
        add(pasted)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        add(imageFiles(e.dataTransfer))
      }}
      className={cn(
        'rounded-xl border border-dashed p-3 transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none',
        dragging ? 'border-brand-400 bg-brand-50/60 dark:bg-brand-950/30' : 'border-slate-300 dark:border-slate-700',
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={files.length >= max}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <ImagePlus className="size-4" /> Add images
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400">or drop / paste (Ctrl+V) here · sent to Gemini as context</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          add(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      {files.length ? (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {files.map((file, i) => (
            <li key={previews[i]} className="group relative overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <img src={previews[i]} alt={file.name} className="aspect-square w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-slate-900/70 text-white transition pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus:opacity-100"
                aria-label={`Remove ${file.name}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
