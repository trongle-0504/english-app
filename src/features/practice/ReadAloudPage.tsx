import { Languages, Pause, PencilLine, Play, Repeat1, Square, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Card, Kbd, PageHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { englishVoices, onVoicesChanged, speak, speechSupported, stopSpeaking } from '@/lib/speech'
import { useLocalStorage } from '@/lib/storage'
import { cleanWord, loadPronunciations, lookupIpa, type Pronunciations } from './lib/pronunciation'
import { splitSentences, stripMarkdown } from './lib/sentences'

const RATES = ['0.7', '0.85', '1', '1.15'] as const
type Rate = (typeof RATES)[number]

const SAMPLE = `Well, I'd say my hometown is a fairly small coastal city in the centre of Vietnam. What I like most about it is the pace of life — it's much more relaxed than in big cities like Hanoi. On top of that, the seafood there is absolutely incredible.`

interface Sentence {
  text: string
  paragraph: number
}

/** Sentences with their paragraph, so the reading view keeps the paragraph breaks. */
function toSentences(source: string): Sentence[] {
  return stripMarkdown(source)
    .split(/\n\s*\n/)
    .flatMap((block, paragraph) => splitSentences(block.replace(/\n/g, ' ')).map((text) => ({ text, paragraph })))
}

let voiceSnapshot: SpeechSynthesisVoice[] = englishVoices()
function subscribeVoices(listener: () => void) {
  return onVoicesChanged(() => {
    voiceSnapshot = englishVoices()
    listener()
  })
}

/** Plays sentences one after another; pausing stops at the current sentence and resuming replays it. */
function useReader(sentences: Sentence[], rate: number, voice: string, loop: boolean) {
  const [index, setIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [word, setWord] = useState<{ sentence: number; start: number; end: number } | null>(null)
  // Bumped on every stop/pause so the `onEnd` of a cancelled utterance is ignored.
  const run = useRef(0)
  const settings = useRef({ rate, voice, loop, sentences })
  settings.current = { rate, voice, loop, sentences }

  const playFrom = useCallback((i: number) => {
    const { sentences: list, rate: r, voice: v } = settings.current
    if (i < 0 || i >= list.length) return
    const token = ++run.current
    setIndex(i)
    setPlaying(true)
    setWord(null)
    speak(list[i].text, {
      rate: r,
      voice: v,
      onBoundary: (start, length) => {
        if (run.current !== token) return
        const rest = list[i].text.slice(start)
        setWord({ sentence: i, start, end: start + (length || rest.search(/\s|$/)) })
      },
      onEnd: () => {
        if (run.current !== token) return
        setWord(null)
        const next = settings.current.loop ? i : i + 1
        if (next < settings.current.sentences.length) playFrom(next)
        else {
          setPlaying(false)
          setIndex(-1)
        }
      },
    })
  }, [])

  const pause = useCallback(() => {
    run.current++
    stopSpeaking()
    setPlaying(false)
    setWord(null)
  }, [])

  const stop = useCallback(() => {
    pause()
    setIndex(-1)
  }, [pause])

  /** One word on its own; playback stops. */
  const sayWord = useCallback(
    (text: string) => {
      pause()
      speak(text, { rate: settings.current.rate, voice: settings.current.voice })
    },
    [pause],
  )

  useEffect(() => () => void (run.current++, stopSpeaking()), [])
  return { index, playing, word, playFrom, pause, stop, sayWord }
}

export default function ReadAloudPage() {
  const [source, setSource] = useLocalStorage('practice:read-aloud-text', '')
  const [rate, setRate] = useLocalStorage<Rate>('practice:read-aloud-speed', '1')
  const [voice, setVoice] = useLocalStorage('practice:read-aloud-voice', '')
  const [loop, setLoop] = useState(false)
  const [reading, setReading] = useState(false)
  const voices = useSyncExternalStore(subscribeVoices, () => voiceSnapshot)
  const sentences = useMemo(() => toSentences(source), [source])
  const reader = useReader(sentences, Number(rate), voice, loop)
  const { index, playing, playFrom, pause } = reader
  // A single click on a sentence waits a moment, so a double-click on a word doesn't start playback first.
  const clickTimer = useRef<number | undefined>(undefined)
  const clickSentence = (i: number, detail: number) => {
    window.clearTimeout(clickTimer.current)
    if (detail === 1) clickTimer.current = window.setTimeout(() => playFrom(i), 220)
  }
  const doubleClickWord = (word: string) => {
    window.clearTimeout(clickTimer.current)
    if (word) reader.sayWord(word)
  }

  const start = () => {
    setReading(true)
    playFrom(0)
  }
  const edit = () => {
    reader.stop()
    setReading(false)
  }
  const toggle = useCallback(() => (playing ? pause() : playFrom(Math.max(0, index))), [playing, pause, playFrom, index])

  // Space = play / pause, ← → = previous / next sentence (not while typing).
  useEffect(() => {
    if (!reading) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, button')) return
      if (e.key === ' ') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowRight') playFrom(Math.min(sentences.length - 1, index + 1))
      else if (e.key === 'ArrowLeft') playFrom(Math.max(0, index - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reading, toggle, playFrom, index, sentences.length])

  const paragraphs = useMemo(() => {
    const groups: { sentence: Sentence; i: number }[][] = []
    sentences.forEach((sentence, i) => (groups[sentence.paragraph] ??= []).push({ sentence, i }))
    return groups.filter(Boolean)
  }, [sentences])

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Speaking"
        title="Read aloud"
        description="Paste your speaking answer and listen to how it sounds in a British voice — sentence by sentence, at your own speed."
        actions={
          reading ? (
            <Button variant="outline" size="sm" onClick={edit}>
              <PencilLine className="size-4" /> Edit text
            </Button>
          ) : null
        }
      />

      {speechSupported ? null : (
        <p className="mb-5 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <VolumeX className="size-4 shrink-0" />
          Your browser can’t read text aloud. Open this page in Chrome or Edge.
        </p>
      )}

      <Card className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Speed</span>
          <div role="radiogroup" className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={rate === r}
                onClick={() => setRate(r)}
                className={cn(
                  'relative hit-area rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors',
                  rate === r
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400',
                )}
              >
                {r}×
              </button>
            ))}
          </div>
        </div>
        <label className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Voice</span>
          <select
            value={voices.some((v) => v.name === voice) ? voice : ''}
            onChange={(e) => setVoice(e.target.value)}
            className="h-8 max-w-64 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="">Best British voice (default)</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name.replace(/^Microsoft /, '')} · {v.lang}
              </option>
            ))}
          </select>
        </label>
        <label
          className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
          title="Repeat the current sentence until you move on — good for shadowing"
        >
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} className="size-4 rounded accent-brand-600" />
          <Repeat1 className="size-3.5" /> Loop sentence
        </label>
      </Card>

      {reading ? (
        <>
          <Card className="p-4 sm:p-7">
            <div className="space-y-4 text-lg leading-9 text-slate-700 dark:text-slate-200">
              {paragraphs.map((group, p) => (
                <p key={p}>
                  {group.map(({ sentence, i }) => (
                    <span key={i}>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => clickSentence(i, e.detail)}
                        onKeyDown={(e) => e.key === 'Enter' && playFrom(i)}
                        title="Play from this sentence"
                        className={cn(
                          'cursor-pointer rounded-md px-0.5 py-1 transition-colors box-decoration-clone',
                          i === index
                            ? 'bg-brand-100 text-slate-900 dark:bg-brand-900/60 dark:text-white'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                        )}
                      >
                        <Words text={sentence.text} highlight={reader.word?.sentence === i ? reader.word : null} onWord={doubleClickWord} />
                      </span>{' '}
                    </span>
                  ))}
                </p>
              ))}
            </div>
          </Card>

          <div className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
            <Button size="lg" onClick={toggle} className="min-w-36">
              {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
              {playing ? 'Pause' : index >= 0 ? 'Resume' : 'Play all'}
            </Button>
            <Button variant="outline" onClick={reader.stop} disabled={index < 0} aria-label="Stop">
              <Square className="size-4" /> Stop
            </Button>
            <span className="text-sm text-slate-500 tabular-nums">
              {index >= 0 ? `Sentence ${index + 1} / ${sentences.length}` : `${sentences.length} sentences`}
            </span>
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">
            Click a sentence to play from there · double-click a word to hear it alone · <Kbd>Space</Kbd> play / pause · <Kbd>←</Kbd> <Kbd>→</Kbd>{' '}
            previous / next
          </p>
          <PronunciationPanel sentences={sentences} current={index} onWord={reader.sayWord} onSentence={playFrom} />
        </>
      ) : (
        <Card className="space-y-4 p-4 sm:p-6">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-800 dark:text-slate-100">Your speaking answer</span>
            <textarea
              rows={10}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={SAMPLE}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] leading-relaxed focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={start} disabled={!sentences.length || !speechSupported}>
              <Volume2 className="size-5" /> Read aloud
            </Button>
            {!source.trim() ? (
              <Button variant="ghost" onClick={() => setSource(SAMPLE)}>
                Try a sample answer
              </Button>
            ) : (
              <span className="text-sm text-slate-500">{sentences.length} sentences · saved in this browser</span>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

/** A sentence split into words: double-click one to hear it; the word being spoken is underlined when the voice reports it. */
function Words({ text, highlight, onWord }: { text: string; highlight: { start: number; end: number } | null; onWord: (word: string) => void }) {
  const parts: { text: string; start: number }[] = []
  let offset = 0
  for (const part of text.split(/(\s+)/)) {
    parts.push({ text: part, start: offset })
    offset += part.length
  }
  return (
    <>
      {parts.map((part, n) =>
        /^\s+$/.test(part.text) || !part.text ? (
          part.text
        ) : (
          <span
            key={n}
            onDoubleClick={(e) => {
              e.stopPropagation()
              window.getSelection()?.removeAllRanges()
              onWord(part.text.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ''))
            }}
            className={cn(
              highlight &&
                part.start < highlight.end &&
                part.start + part.text.length > highlight.start &&
                'rounded bg-brand-500 text-white dark:bg-brand-400 dark:text-slate-950',
            )}
          >
            {part.text}
          </span>
        ),
      )}
    </>
  )
}

/** Every word with its British IPA underneath, sentence by sentence (below the reading view). */
function PronunciationPanel({
  sentences,
  current,
  onWord,
  onSentence,
}: {
  sentences: Sentence[]
  current: number
  onWord: (word: string) => void
  onSentence: (index: number) => void
}) {
  const [data, setData] = useState<Pronunciations | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    loadPronunciations().then(setData, (err: Error) => setError(err.message))
  }, [])

  const rows = useMemo(
    () =>
      data
        ? sentences.map((s) =>
            s.text
              .split(/\s+/)
              .filter(Boolean)
              .map((token) => ({ token, ...(lookupIpa(cleanWord(token), data) ?? { ipa: '', source: null }) })),
          )
        : [],
    [data, sentences],
  )
  const words = rows.flat().filter((w) => cleanWord(w.token))
  const missing = words.filter((w) => !w.ipa).length

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <Languages className="size-5 text-brand-600 dark:text-brand-400" /> Pronunciation
          </h2>
          <p className="text-sm text-slate-500">British IPA for every word. Click a word to hear it, or a sentence number to play that sentence.</p>
        </div>
        {data ? (
          <p className="text-xs text-slate-500">
            {words.length - missing}/{words.length} words found
            {missing ? ' · “?” = not in the dictionary' : ''}
          </p>
        ) : null}
      </div>
      <Card className="p-4 sm:p-6">
        {error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : !data ? (
          <p className="text-sm text-slate-400">Loading the pronunciation dictionary…</p>
        ) : (
          <ol className="space-y-4">
            {rows.map((row, i) => (
              <li
                key={i}
                className={cn(
                  'flex gap-3 rounded-xl px-2 py-2 transition-colors',
                  i === current && 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-950/40 dark:ring-brand-900',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSentence(i)}
                  title="Play this sentence"
                  className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500 tabular-nums hover:bg-brand-600 hover:text-white dark:bg-slate-800"
                >
                  {i + 1}
                </button>
                <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-2.5">
                  {row.map((w, n) => {
                    const word = cleanWord(w.token)
                    return (
                      <button
                        key={n}
                        type="button"
                        disabled={!word}
                        onClick={() => onWord(word)}
                        title={w.source === 'guess' ? 'Built from the base word' : w.source === 'app' ? 'From your vocabulary' : undefined}
                        className="group flex flex-col items-start rounded-md px-1 text-left hover:bg-slate-100 disabled:hover:bg-transparent dark:hover:bg-slate-800"
                      >
                        <span className="text-[15px] leading-6 text-slate-800 dark:text-slate-100">{w.token}</span>
                        <span
                          className={cn(
                            'ipa text-[13px] leading-5',
                            !w.ipa
                              ? 'text-slate-300 dark:text-slate-600'
                              : w.source === 'guess'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-brand-700 dark:text-brand-300',
                          )}
                        >
                          {w.ipa || (word ? '?' : '')}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <p className="mt-2 text-xs text-slate-400">
        Dictionary: ipa-dict and Britfone (British English, MIT licence) plus the IPA in your own vocabulary. Words are shown in their dictionary form
        — in connected speech small words like “and”, “to”, “of” are usually weaker (/ən/, /tə/, /əv/).
      </p>
    </section>
  )
}
