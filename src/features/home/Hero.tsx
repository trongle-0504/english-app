import { useState } from 'react'
import { PhotoBackdrop, type BackdropPhoto } from '@/components/PhotoBackdrop'
import { QuietBoundary } from './QuietBoundary'
import { TodayPanel } from './TodayPanel'

const SLIDES = 5

/**
 * New photos every day, the same for everyone on that date: random picsum photos of any kind (landscapes, cities,
 * objects). The first keeps the seed the hero used when it showed a single photo.
 */
function dailyPhotos(): BackdropPhoto[] {
  const now = new Date()
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return Array.from({ length: SLIDES }, (_, i) => {
    const url = (width: number, height: number) => `https://picsum.photos/seed/${i ? `${day}-${i}` : day}/${width}/${height}`
    return { src: url(1920, 1080), srcSet: `${url(960, 640)} 960w, ${url(1920, 1080)} 1920w` }
  })
}

export function Hero() {
  const [photos] = useState(dailyPhotos)
  return (
    <section className="relative isolate mt-2 overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-sky-800 to-indigo-950 shadow-xl shadow-slate-900/10 sm:mt-6 sm:min-h-[36rem]">
      <PhotoBackdrop photos={photos} sizes="(min-width: 80rem) 80rem, 100vw" className="absolute inset-0 -z-10">
        {/* Text sits at the top and the bottom now: dark at both ends on a phone, dark on the left from lg up. */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/30 to-slate-950/80 lg:bg-gradient-to-r lg:from-slate-950/80 lg:via-slate-950/45 lg:to-slate-950/20" />
      </PhotoBackdrop>
      <div className="px-3.5 pt-4 pb-3.5 sm:px-8 sm:pt-8 sm:pb-8 lg:px-12">
        <QuietBoundary fallback={<p className="text-sm text-white/80">Could not load today’s plan.</p>}>
          <TodayPanel />
        </QuietBoundary>
      </div>
    </section>
  )
}
