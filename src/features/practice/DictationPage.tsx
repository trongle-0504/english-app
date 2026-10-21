import { RotateCcw, VolumeX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, PageHeader } from '@/components/ui'
import { useLocalStorage } from '@/lib/storage'
import { DictationSession, type Rate } from './dictation/DictationSession'
import { SourceForm } from './dictation/SourceForm'
import { splitSentences, stripMarkdown } from './lib/sentences'
import { useSpeech } from './lib/useSpeech'

export default function DictationPage() {
  const [source, setSource] = useLocalStorage('practice:dictation-source', '')
  const [rate, setRate] = useLocalStorage<Rate>('practice:dictation-rate', '1')
  // Sentences of the running session (null while editing the source).
  const [session, setSession] = useState<string[] | null>(null)
  const { speak, speaking, supported } = useSpeech()
  const sentences = useMemo(() => splitSentences(stripMarkdown(source)), [source])

  const start = () => {
    setSession(sentences)
    speak(sentences[0], Number(rate))
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Listening"
        title="Dictation"
        description="Paste a paragraph, listen to it sentence by sentence and type what you hear."
        actions={
          session ? (
            <Button variant="outline" size="sm" onClick={() => setSession(null)}>
              <RotateCcw className="size-4" />
              Reset
            </Button>
          ) : null
        }
      />

      {supported ? null : (
        <p className="mb-5 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <VolumeX className="size-4 shrink-0" />
          Your browser doesn’t support speech synthesis, so sentences can’t be read aloud.
        </p>
      )}

      {session ? (
        <DictationSession
          sentences={session}
          source={source}
          rate={rate}
          onRateChange={setRate}
          speak={speak}
          speaking={speaking}
          onNewText={() => setSession(null)}
        />
      ) : (
        <SourceForm value={source} onChange={setSource} sentenceCount={sentences.length} onStart={start} />
      )}
    </div>
  )
}
