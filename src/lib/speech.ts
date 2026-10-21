/**
 * Text-to-speech with the browser's built-in voices (Web Speech API), always British English.
 * Voice preference, best first:
 *   1. Microsoft "Natural" UK voices (Sonia, Libby, Ryan…) — only in Edge
 *   2. Google UK English Female, then Male — Chrome
 *   3. any other en-GB voice (Windows Hazel, Susan, George…)
 */
const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

let chosen: SpeechSynthesisVoice | null = null

function score(voice: SpeechSynthesisVoice): number {
  const lang = voice.lang.replace('_', '-').toLowerCase()
  if (lang !== 'en-gb') return -1
  const name = voice.name.toLowerCase()
  if (name.includes('natural')) return 4
  if (name.includes('google') && name.includes('female')) return 3
  if (name.includes('google')) return 2
  return 1
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (chosen || !supported) return chosen
  const best = window.speechSynthesis
    .getVoices()
    .map((voice) => ({ voice, score: score(voice) }))
    .filter((v) => v.score >= 0)
    .sort((a, b) => b.score - a.score)[0]
  chosen = best?.voice ?? null
  return chosen
}

// Chrome loads its voice list asynchronously.
if (supported) window.speechSynthesis.addEventListener('voiceschanged', () => pickVoice())

export const speechSupported = supported

/** Name of the voice in use, e.g. "Google UK English Female" (null until voices have loaded). */
export function currentVoiceName(): string | null {
  return pickVoice()?.name ?? null
}

/** Every English voice the browser offers, British first, then by name. */
export function englishVoices(): SpeechSynthesisVoice[] {
  if (!supported) return []
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('en'))
    .sort((a, b) => score(b) - score(a) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
}

/** Calls `listener` when the voice list changes (Chrome fills it in after load). Returns an unsubscribe. */
export function onVoicesChanged(listener: () => void): () => void {
  if (!supported) return () => {}
  window.speechSynthesis.addEventListener('voiceschanged', listener)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', listener)
}

interface SpeakOptions {
  rate?: number
  /** Voice name from `englishVoices()`; the default British voice when missing or unavailable. */
  voice?: string
  onStart?: () => void
  onEnd?: () => void
  /** Word boundaries (character offset in `text`). Only local voices send them; Google's online voices don't. */
  onBoundary?: (charIndex: number, charLength: number) => void
}

/** Reads English text aloud, interrupting anything already playing. No-op when unsupported. */
export function speak(text: string, { rate = 0.95, voice: voiceName, onStart, onEnd, onBoundary }: SpeakOptions = {}): void {
  if (!supported) return
  const synth = window.speechSynthesis
  synth.cancel()
  // Same length as `text` (markers become spaces) so boundary offsets still line up.
  const utterance = new SpeechSynthesisUtterance(text.replace(/[*_`]/g, ' '))
  const voice = (voiceName && synth.getVoices().find((v) => v.name === voiceName)) || pickVoice()
  if (voice) utterance.voice = voice
  utterance.lang = voice?.lang ?? 'en-GB'
  utterance.rate = rate
  if (onStart) utterance.onstart = onStart
  if (onEnd) utterance.onend = utterance.onerror = onEnd
  if (onBoundary) utterance.onboundary = (e) => e.name === 'word' && onBoundary(e.charIndex, e.charLength ?? 0)
  synth.speak(utterance)
}

export function stopSpeaking(): void {
  if (supported) window.speechSynthesis.cancel()
}
