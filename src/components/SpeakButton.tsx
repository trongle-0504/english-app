import { Volume2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { speak } from '@/lib/speech'

export function SpeakButton({ text, className, label = 'Listen' }: { text: string; className?: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        speak(text)
      }}
      aria-label={`${label}: ${text}`}
      title={label}
      className={cn(
        'relative inline-flex size-8 shrink-0 hit-area items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950/60 dark:hover:text-brand-300',
        className,
      )}
    >
      <Volume2 className="size-4" />
    </button>
  )
}
