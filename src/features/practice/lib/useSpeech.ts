import { useCallback, useEffect, useState } from 'react'
import { speak as speakText, speechSupported as supported, stopSpeaking } from '@/lib/speech'

/** The shared British voice (lib/speech) with an adjustable rate and a `speaking` flag. */
export function useSpeech() {
  const [speaking, setSpeaking] = useState(false)

  const speak = useCallback((text: string, rate = 1) => {
    speakText(text, { rate, onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) })
  }, [])

  useEffect(
    () => stopSpeaking,
    [],
  )

  return { speak, speaking, supported }
}
