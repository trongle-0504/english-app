import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface BackdropPhoto {
  src: string
  srcSet?: string
}

const SLIDE_MS = 9000

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Animated photo backdrop (login page, home page hero): a turning aurora in brand colours, shown at once and all there
 * is when the photos cannot load, then photos that cross-fade every few seconds while each slowly zooms (Ken Burns).
 * With "reduce motion" nothing moves: one still photo. `className` places it (fixed full screen, or absolute in a
 * card); `children` go on top of the photos (a shade that keeps text readable).
 */
export function PhotoBackdrop({ photos, sizes = '100vw', className, children }: { photos: BackdropPhoto[]; sizes?: string; className?: string; children?: ReactNode }) {
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(new Set())
  const [current, setCurrent] = useState(0)

  // Only a photo that has arrived is shown, so a slow one never fades in half drawn.
  useEffect(() => {
    if (loaded.size < 2 || reducedMotion()) return
    const timer = window.setInterval(() => {
      setCurrent((i) => {
        for (let step = 1; step <= photos.length; step++) {
          const next = (i + step) % photos.length
          if (loaded.has(next)) return next
        }
        return i
      })
    }, SLIDE_MS)
    return () => window.clearInterval(timer)
  }, [loaded, photos.length])

  // The first photo to arrive is shown at once instead of waiting a whole slide.
  const shown = loaded.has(current) ? current : [...loaded][0]

  return (
    <div className={cn('overflow-hidden bg-slate-950', className)} aria-hidden>
      <div className="absolute inset-0 bg-gradient-to-br from-brand-700 via-sky-900 to-indigo-950" />
      <div className="absolute top-1/2 left-1/2 size-[150vmax] -translate-x-1/2 -translate-y-1/2 opacity-70 blur-3xl">
        <div className="size-full rounded-full bg-[conic-gradient(from_0deg,#0d9fd2,#6366f1,#14b8a6,#0a7fb1,#a855f7,#0d9fd2)] motion-safe:animate-[aurora-spin_40s_linear_infinite]" />
      </div>

      {photos.map((photo, i) => (
        <img
          key={photo.src}
          src={photo.src}
          srcSet={photo.srcSet}
          sizes={sizes}
          alt=""
          decoding="async"
          // The first photo matters most; the others load quietly behind it.
          fetchPriority={i === 0 ? 'high' : 'low'}
          onLoad={() => setLoaded((set) => new Set(set).add(i))}
          // Each photo drifts on its own clock (staggered), so one fading out never jumps back to the start.
          style={{ animationDelay: `${-i * 7}s` }}
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-[2500ms] ease-in-out motion-safe:animate-[ken-burns_24s_ease-in-out_infinite_alternate]',
            i === shown ? 'opacity-100' : 'opacity-0',
          )}
        />
      ))}

      {children}
    </div>
  )
}
