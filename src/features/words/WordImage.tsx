import { ImageOff } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

/** Word illustration (stored in /vocab-images, or a remote link); hides itself when broken. `credit` = its source, as a tooltip. */
export function WordImage({ src, alt, className, placeholder, credit }: { src?: string; alt: string; className?: string; placeholder?: boolean; credit?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    if (!placeholder) return null
    return (
      <div className={cn('flex items-center justify-center bg-slate-100 text-slate-300 dark:bg-slate-800 dark:text-slate-600', className)}>
        <ImageOff className="size-8" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      title={credit ? `Ảnh: ${credit}` : undefined}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn('bg-slate-100 object-cover dark:bg-slate-800', className)}
    />
  )
}
