import { ArrowRight, Layers } from 'lucide-react'
import { useState } from 'react'
import { PhotoBackdrop, type BackdropPhoto } from '@/components/PhotoBackdrop'
import { ButtonLink } from '@/components/ui'
import { HeroShortcuts } from './HeroShortcuts'

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

const glassButton =
  'border-white/30 bg-white/10 text-white backdrop-blur-md hover:border-white/50 hover:bg-white/20 dark:border-white/30 dark:bg-white/10 dark:text-white dark:hover:bg-white/20'

export function Hero() {
  const [photos] = useState(dailyPhotos)

  return (
    <section className="relative isolate mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-sky-800 to-indigo-950 shadow-xl shadow-slate-900/10 sm:mt-6">
      <PhotoBackdrop photos={photos} sizes="(min-width: 80rem) 80rem, 100vw" className="absolute inset-0 -z-10">
        {/* Darker where the text sits: at the bottom on a phone, on the left from sm up. */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-slate-950/15 sm:bg-gradient-to-r sm:from-slate-950/85 sm:via-slate-950/50 sm:to-slate-950/5" />
      </PhotoBackdrop>

      <div className="flex min-h-[32rem] flex-col justify-between gap-10 px-6 pt-7 pb-6 sm:min-h-[36rem] sm:px-10 sm:pt-9 sm:pb-8 lg:px-14 lg:pt-11 lg:pb-10">
        <div className="animate-slide-up max-w-4xl">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold tracking-[0.2em] text-white/90 uppercase ring-1 ring-white/20 backdrop-blur-md">
            <span className="size-1.5 rounded-full bg-brand-300" aria-hidden />
            Linear Thinking
          </p>
          {/* One line from tablet width up: the size follows the width (up to 60 px); phones may wrap. */}
          <h1 className="mt-5 text-[clamp(1.9rem,5.6vw,3.75rem)] leading-[1.05] font-extrabold tracking-tight text-white sm:whitespace-nowrap">
            Mastery Through Connection
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/80 sm:text-lg">
            A smart learning ecosystem that makes learning English more effective — through connection and systematic study.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink to="/vocabulary" size="lg">
              Start with Vocabulary
              <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
            <ButtonLink to="/collocations" size="lg" variant="outline" className={glassButton}>
              <Layers className="size-4" aria-hidden />
              Explore Collocations
            </ButtonLink>
          </div>
        </div>
        <HeroShortcuts />
      </div>
    </section>
  )
}
