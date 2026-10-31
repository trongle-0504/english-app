import { Square, Volume2 } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/cn'
import { getSpeakingText, speak, stopSpeaking, subscribeSpeakingState } from '@/lib/speech'

export function SpeakButton({
  text,
  voice,
  rate,
  className,
  label = 'Listen (Best British voice)',
}: {
  text: string
  voice?: string
  rate?: number
  className?: string
  label?: string
}) {
  const activeText = useSyncExternalStore(subscribeSpeakingState, getSpeakingText, () => null)
  const isPlaying = Boolean(text) && activeText === text

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        if (isPlaying) {
          stopSpeaking()
        } else {
          speak(text, { voice, rate })
        }
      }}
      aria-label={isPlaying ? 'Stop reading' : `${label}: ${text}`}
      title={isPlaying ? 'Dừng đọc' : label}
      className={cn(
        'relative inline-flex size-8 shrink-0 hit-area items-center justify-center rounded-full transition-colors',
        isPlaying
          ? 'bg-brand-100 text-brand-600 hover:bg-brand-200 dark:bg-brand-950/80 dark:text-brand-300'
          : 'text-slate-400 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950/60 dark:hover:text-brand-300',
        className,
      )}
    >
      {isPlaying ? <Square className="size-3.5 fill-current" /> : <Volume2 className="size-4" />}
    </button>
  )
}
