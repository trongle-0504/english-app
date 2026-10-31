import { splitSentences, stripMarkdown } from '@/features/practice/lib/sentences'

/**
 * Text-to-speech with British English ("Best British voice"):
 * - On desktop Chrome / Edge with built-in high-quality British voices (Microsoft Natural UK or Google UK English Female),
 *   uses Web Speech API directly.
 * - On Android / iOS (where mobile browsers lack desktop Google UK English Female and Android Chrome ignores `utterance.voice`),
 *   or on any browser without a high-quality UK voice, streams British English (`en-GB`, Google UK English Female)
 *   from `/api/tts?q=...` with automatic next-sentence preloading and Web Speech fallback.
 */
const webSpeechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
const audioSupported = typeof window !== 'undefined' && typeof Audio !== 'undefined'
const isMobileDevice =
  typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

let chosen: SpeechSynthesisVoice | null = null
let chosenScore = -1

function score(voice: SpeechSynthesisVoice): number {
  const lang = voice.lang.replace('_', '-').toLowerCase()
  if (lang !== 'en-gb') return -1
  const name = voice.name.toLowerCase()
  if (name.includes('natural')) return 5
  if (name.includes('online')) return 4
  if (name.includes('google') && name.includes('female')) return 3
  if (name.includes('google')) return 2
  return 1
}

/**
 * Picks the highest-scoring British English (en-GB) voice available in the browser.
 */
function pickVoice(): SpeechSynthesisVoice | null {
  if (!webSpeechSupported) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return chosen
  const best = voices
    .map((voice) => ({ voice, score: score(voice) }))
    .filter((v) => v.score >= 0)
    .sort((a, b) => b.score - a.score)[0]
  if (best && best.score >= chosenScore) {
    chosen = best.voice
    chosenScore = best.score
  }
  return chosen
}

if (webSpeechSupported) {
  pickVoice()
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    chosen = null
    chosenScore = -1
    pickVoice()
  })
}

export const speechSupported = webSpeechSupported || audioSupported

/** Name of the voice in use, e.g. "Google UK English Female". */
export function currentVoiceName(): string | null {
  return pickVoice()?.name ?? 'Google UK English Female (en-GB)'
}

/** Every English voice the browser offers, British first, then by name. */
export function englishVoices(): SpeechSynthesisVoice[] {
  if (!webSpeechSupported) return []
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('en'))
    .sort((a, b) => score(b) - score(a) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
}

/** Calls `listener` when the voice list changes (Chrome fills it in after load). Returns an unsubscribe. */
export function onVoicesChanged(listener: () => void): () => void {
  if (!webSpeechSupported) return () => {}
  window.speechSynthesis.addEventListener('voiceschanged', listener)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', listener)
}

interface SpeakOptions {
  rate?: number
  /** Voice name from `englishVoices()`; the default Best British voice when missing or unavailable. */
  voice?: string
  onStart?: () => void
  onEnd?: () => void
  /** Word boundaries (character offset in `text`). */
  onBoundary?: (charIndex: number, charLength: number) => void
}

/**
 * Splits prose into sentence chunks just like `/practice/speaking` Read aloud (`toSentences`),
 * and breaks any extra-long sentence (> 200 chars) on clause boundaries so online British voices
 * and `/api/tts` never exceed utterance length limits.
 */
function toSentenceChunks(source: string): string[] {
  const sentences = stripMarkdown(source)
    .split(/\n\s*\n/)
    .flatMap((block) => splitSentences(block.replace(/\n/g, ' ')))
    .map((s) => s.trim())
    .filter(Boolean)

  const chunks: string[] = []
  for (const s of sentences) {
    if (s.length <= 200) {
      chunks.push(s)
      continue
    }
    const parts = s.split(/(?<=[;—–,])\s+/)
    let buf = ''
    for (const part of parts) {
      if (!buf) {
        buf = part
      } else if (buf.length + 1 + part.length <= 200) {
        buf += ' ' + part
      } else {
        chunks.push(buf)
        buf = part
      }
    }
    if (buf) chunks.push(buf)
  }
  return chunks.length > 0 ? chunks : [source.replace(/[*_`]/g, ' ').trim()].filter(Boolean)
}

let runToken = 0
export let activeUtterance: SpeechSynthesisUtterance | null = null
let activeAudio: HTMLAudioElement | null = null
let activeText: string | null = null
const stateListeners = new Set<() => void>()

function setActiveText(next: string | null) {
  if (activeText === next) return
  activeText = next
  for (const fn of stateListeners) fn()
}

export function getSpeakingText(): string | null {
  return activeText
}

export function subscribeSpeakingState(listener: () => void): () => void {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
}

/**
 * Whether we should stream the "Best British voice" (`Google UK English Female` en-GB) from `/api/tts`
 * instead of relying on local OS Web Speech API:
 * - Always true on Android / iOS when using default "Best British voice" (`!voiceName`), because
 *   Android Chrome ignores `utterance.voice` and mobile OS TTS lacks desktop Google UK English Female.
 * - Also true on desktop browsers that don't have a high-scoring UK voice (`chosenScore < 2`).
 */
function shouldUseServerBritishTts(voiceName?: string): boolean {
  if (!audioSupported) return false
  if (voiceName) return false
  if (isMobileDevice) return true
  const v = pickVoice()
  return !v || score(v) < 2
}

function ttsUrlFor(chunk: string): string {
  return `/api/tts?q=${encodeURIComponent(chunk)}`
}

/**
 * Plays chunks sequentially via `/api/tts` (Google UK English Female en-GB) with preloading
 * of the next chunk, and falls back to `window.speechSynthesis` if `/api/tts` is unreachable.
 */
function speakViaServerTts(
  fullText: string,
  chunks: string[],
  { rate = 1, onStart, onEnd, onBoundary }: SpeakOptions,
  token: number,
  fallbackToWebSpeech: () => void,
): void {
  setActiveText(fullText)
  let started = false
  let nextPreloaded: HTMLAudioElement | null = null

  // Precompute word positions if `onBoundary` is requested (for ReadAloudPage on Android)
  const wordSpans: { start: number; length: number }[] = []
  if (onBoundary && chunks.length === 1) {
    const regex = /\S+/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(fullText)) !== null) {
      wordSpans.push({ start: m.index, length: m[0].length })
    }
  }

  const playChunk = (index: number) => {
    if (runToken !== token) return
    if (index >= chunks.length) {
      activeAudio = null
      setActiveText(null)
      onEnd?.()
      return
    }

    const audio = nextPreloaded ?? new Audio(ttsUrlFor(chunks[index]))
    nextPreloaded = null
    activeAudio = audio
    audio.playbackRate = rate

    // Preload next sentence chunk while current sentence plays
    if (index + 1 < chunks.length) {
      const preload = new Audio()
      preload.preload = 'auto'
      preload.src = ttsUrlFor(chunks[index + 1])
      nextPreloaded = preload
    }

    let lastWordIdx = -1
    if (onBoundary && wordSpans.length > 0) {
      audio.ontimeupdate = () => {
        if (runToken !== token || !audio.duration || !Number.isFinite(audio.duration)) return
        const progress = Math.min(0.999, Math.max(0, audio.currentTime / audio.duration))
        const idx = Math.min(wordSpans.length - 1, Math.floor(progress * wordSpans.length))
        if (idx !== lastWordIdx) {
          lastWordIdx = idx
          onBoundary(wordSpans[idx].start, wordSpans[idx].length)
        }
      }
    }

    audio.onplay = () => {
      if (runToken !== token) return
      if (!started) {
        started = true
        onStart?.()
      }
      if (onBoundary && wordSpans.length > 0 && lastWordIdx === -1) {
        lastWordIdx = 0
        onBoundary(wordSpans[0].start, wordSpans[0].length)
      }
    }

    audio.onended = () => {
      if (runToken !== token) return
      playChunk(index + 1)
    }

    audio.onerror = () => {
      if (runToken !== token) return
      activeAudio = null
      if (!started && webSpeechSupported) {
        fallbackToWebSpeech()
        return
      }
      setActiveText(null)
      onEnd?.()
    }

    void audio.play().catch(() => {
      if (runToken !== token) return
      activeAudio = null
      if (!started && webSpeechSupported) {
        fallbackToWebSpeech()
        return
      }
      setActiveText(null)
      onEnd?.()
    })
  }

  playChunk(0)
}

/**
 * Reads English text aloud using the Best British voice (matching `/practice/speaking` Read aloud),
 * interrupting anything already playing.
 */
export function speak(text: string, options: SpeakOptions = {}): void {
  const { rate = 1, voice: voiceName, onStart, onEnd, onBoundary } = options
  if (!speechSupported) return

  const token = ++runToken
  if (activeAudio) {
    try {
      activeAudio.pause()
      activeAudio.src = ''
    } catch {
      // ignore
    }
    activeAudio = null
  }
  if (webSpeechSupported) {
    window.speechSynthesis.cancel()
  }
  activeUtterance = null

  const trimmed = text.trim()
  if (!trimmed) {
    setActiveText(null)
    return
  }

  const chunks = onBoundary ? [text.replace(/[*_`]/g, ' ')] : toSentenceChunks(trimmed)
  if (chunks.length === 0) {
    setActiveText(null)
    return
  }

  const runWebSpeech = () => {
    if (!webSpeechSupported) {
      setActiveText(null)
      onEnd?.()
      return
    }
    const synth = window.speechSynthesis
    setActiveText(text)

    if (onBoundary) {
      const utterance = new SpeechSynthesisUtterance(text.replace(/[*_`]/g, ' '))
      activeUtterance = utterance
      const voice = (voiceName && synth.getVoices().find((v) => v.name === voiceName)) || pickVoice()
      if (voice) utterance.voice = voice
      utterance.lang = (voice?.lang ?? 'en-GB').replace('_', '-')
      utterance.rate = rate
      utterance.onstart = () => {
        if (runToken !== token) return
        onStart?.()
      }
      utterance.onend = utterance.onerror = () => {
        if (runToken !== token) return
        activeUtterance = null
        setActiveText(null)
        onEnd?.()
      }
      utterance.onboundary = (e) => {
        if (runToken !== token) return
        if (e.name === 'word') onBoundary(e.charIndex, e.charLength ?? 0)
      }
      synth.speak(utterance)
      return
    }

    let started = false
    const playChunk = (index: number) => {
      if (runToken !== token) return
      if (index >= chunks.length) {
        activeUtterance = null
        setActiveText(null)
        onEnd?.()
        return
      }
      const utterance = new SpeechSynthesisUtterance(chunks[index])
      activeUtterance = utterance
      const voice = (voiceName && synth.getVoices().find((v) => v.name === voiceName)) || pickVoice()
      if (voice) utterance.voice = voice
      utterance.lang = (voice?.lang ?? 'en-GB').replace('_', '-')
      utterance.rate = rate
      utterance.onstart = () => {
        if (runToken !== token) return
        if (!started) {
          started = true
          onStart?.()
        }
      }
      utterance.onend = () => {
        if (runToken !== token) return
        playChunk(index + 1)
      }
      utterance.onerror = () => {
        if (runToken !== token) return
        activeUtterance = null
        setActiveText(null)
        onEnd?.()
      }
      synth.speak(utterance)
    }

    playChunk(0)
  }

  if (shouldUseServerBritishTts(voiceName)) {
    speakViaServerTts(text, chunks, options, token, runWebSpeech)
    return
  }

  runWebSpeech()
}

export function stopSpeaking(): void {
  runToken++
  if (activeAudio) {
    try {
      activeAudio.pause()
      activeAudio.src = ''
    } catch {
      // ignore
    }
    activeAudio = null
  }
  activeUtterance = null
  setActiveText(null)
  if (webSpeechSupported) window.speechSynthesis.cancel()
}
