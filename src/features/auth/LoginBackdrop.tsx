import { useState } from 'react'
import { PhotoBackdrop, type BackdropPhoto } from '@/components/PhotoBackdrop'

const PHOTOS = 5

/**
 * Picsum photo ids, picked by hand: only nature (forest, waterfall, mountains, sea, sunset). A random seed, as on the
 * home page, also brings people, objects and streets.
 */
const NATURE = [10, 11, 15, 16, 17, 28, 29, 37, 54, 62, 71, 83, 93, 110, 124, 128]

const photo = (id: number, width: number, height: number) => `https://picsum.photos/id/${id}/${width}/${height}`

/** Today's slides: a different run of the list each day, so all of it comes round. */
function todaysPhotos(): BackdropPhoto[] {
  const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / 86_400_000)
  return Array.from({ length: PHOTOS }, (_, i) => {
    const id = NATURE[(day * PHOTOS + i) % NATURE.length]
    return { src: photo(id, 1920, 1080), srcSet: `${photo(id, 960, 1280)} 960w, ${photo(id, 1920, 1080)} 1920w` }
  })
}

/** Full-screen nature backdrop for the login page. */
export function LoginBackdrop() {
  const [photos] = useState(todaysPhotos)
  return (
    <PhotoBackdrop photos={photos} className="fixed inset-0 -z-10">
      {/* Keeps the card and the white title readable on any photo. */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/40 via-slate-950/25 to-slate-950/60" />
    </PhotoBackdrop>
  )
}
