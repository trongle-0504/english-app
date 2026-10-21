// The recording of a Speaking review, shared by the parts of the page that play it: the player, the words "as heard"
// (click one to hear it) and the misheard phrases (hear exactly that stretch again).
import { useCallback, useMemo, useRef, useState } from 'react'

export interface AudioControl {
  /** The <audio> element once it is on the page (to follow its time). */
  el: HTMLAudioElement | null
  seek: (time: number, play?: boolean) => void
  toggle: () => void
  /** Plays from `start` to `end` (seconds), with a little margin on both sides, then stops. */
  playRange: (start: number, end: number) => void
}

/** Margin around a stretch played on its own, so its first and last sounds are not cut. */
const MARGIN = 0.15

/** The control, and the ref to put on the page's <audio> element. */
export function useTalkAudio(): { audio: AudioControl; bind: (node: HTMLAudioElement | null) => void } {
  const ref = useRef<HTMLAudioElement | null>(null)
  const stop = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [el, setEl] = useState<HTMLAudioElement | null>(null)

  const clearStop = useCallback(() => {
    if (stop.current) clearTimeout(stop.current)
    stop.current = null
  }, [])
  const bind = useCallback((node: HTMLAudioElement | null) => {
    ref.current = node
    setEl(node)
  }, [])
  const seek = useCallback(
    (time: number, play?: boolean) => {
      const a = ref.current
      if (!a) return
      clearStop()
      a.currentTime = Math.max(0, time)
      if (play) void a.play()
    },
    [clearStop],
  )
  const toggle = useCallback(() => {
    const a = ref.current
    if (!a) return
    clearStop()
    if (a.paused) void a.play()
    else a.pause()
  }, [clearStop])
  const playRange = useCallback(
    (start: number, end: number) => {
      const a = ref.current
      if (!a) return
      clearStop()
      a.currentTime = Math.max(0, start - MARGIN)
      void a.play()
      stop.current = setTimeout(() => a.pause(), (end - start + 2 * MARGIN) * 1000)
    },
    [clearStop],
  )
  const audio = useMemo(() => ({ el, seek, toggle, playRange }), [el, seek, toggle, playRange])
  return { audio, bind }
}
