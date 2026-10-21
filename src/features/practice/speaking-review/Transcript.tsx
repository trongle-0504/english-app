// What the recognizer heard, word by word: click a word to hear it, the word being played is highlighted, pauses of 1 s
// or more are marked, and words the recognizer was unsure of (often an unclear pronunciation) are underlined.
import { AudioLines, ChevronDown, FileText, Pause, Play } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Card, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { TalkReviewResult, TalkWord } from '@/types/speakingReview'
import { DiffText } from '../components/DiffText'
import type { AudioControl } from './audio'
import { diffWords } from 'diff'

const UNCLEAR = 0.6
const PAUSE = 1
/** A silence inside a sentence of at least this long is a hesitation (server/speaking-review/fluency.ts). */
const HESITATION = 0.8
const SENTENCE_END = /[.!?]["')\]]*$/
const LEAD = 0.06

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** The recording's controls; `seek` moves the playhead (and plays when asked). */
function Player({ audio, duration }: { audio: AudioControl; duration: number }) {
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const { el } = audio
  useEffect(() => {
    if (!el) return
    const on = () => setPlaying(!el.paused)
    const tick = () => setTime(el.currentTime)
    el.addEventListener('play', on)
    el.addEventListener('pause', on)
    el.addEventListener('timeupdate', tick)
    return () => {
      el.removeEventListener('play', on)
      el.removeEventListener('pause', on)
      el.removeEventListener('timeupdate', tick)
    }
  }, [el])
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={audio.toggle}
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm transition-transform hover:scale-105 dark:bg-brand-500"
        aria-label={playing ? 'Pause' : 'Play your recording'}
      >
        {playing ? <Pause className="size-4.5" /> : <Play className="ml-0.5 size-4.5" />}
      </button>
      <input
        type="range"
        min={0}
        max={duration}
        step={0.1}
        value={time}
        onChange={(e) => audio.seek(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer accent-brand-600"
        aria-label="Position"
      />
      <span className="text-xs font-semibold text-slate-500 tabular-nums">
        {clock(time)} / {clock(duration)}
      </span>
    </div>
  )
}

/** The word under the playhead, followed smoothly while playing. */
function usePlayhead(el: HTMLAudioElement | null) {
  const [time, setTime] = useState(-1)
  useEffect(() => {
    if (!el) return
    let frame = 0
    const loop = () => {
      setTime(el.currentTime)
      if (!el.paused) frame = requestAnimationFrame(loop)
    }
    const play = () => (frame = requestAnimationFrame(loop))
    const stop = () => {
      cancelAnimationFrame(frame)
      setTime(el.currentTime)
    }
    el.addEventListener('play', play)
    el.addEventListener('pause', stop)
    el.addEventListener('seeked', stop)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('play', play)
      el.removeEventListener('pause', stop)
      el.removeEventListener('seeked', stop)
    }
  }, [el])
  return time
}

function Heard({ words, audio }: { words: TalkWord[]; audio: AudioControl }) {
  const time = usePlayhead(audio.el)
  const seek = (w: TalkWord) => audio.seek(Math.max(0, w.start - LEAD / 2), true)
  return (
    <p className="text-[17px] leading-[2.1] text-slate-800 dark:text-slate-100">
      {words.map((w, i) => {
        const gap = i ? w.start - words[i - 1].end : 0
        // Inside a sentence a silence is a hesitation (from 0.8 s); between sentences it is natural (shown from 1 s, grey).
        const between = i > 0 && SENTENCE_END.test(words[i - 1].w)
        const marked = between ? gap >= PAUSE : gap >= HESITATION
        // A word lights up a little early: a click starts playing just before it (LEAD).
        const now = time >= w.start - LEAD && time < (words[i + 1] ? words[i + 1].start - LEAD : w.end + 0.3)
        return (
          <span key={i}>
            {marked ? (
              <span
                title={between ? `Ngừng ${gap.toFixed(1)} giây giữa hai câu (tự nhiên)` : `Ngừng ${gap.toFixed(1)} giây giữa câu — ngập ngừng tìm từ`}
                className={cn(
                  'mx-1 inline-flex items-center rounded-full px-1.5 align-middle text-[11px] leading-5 font-bold tabular-nums',
                  between
                    ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    : gap >= 2
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
                )}
              >
                ⏸ {gap.toFixed(1)}s
              </span>
            ) : i ? (
              ' '
            ) : null}
            <button
              type="button"
              onClick={() => seek(w)}
              title={
                w.conf < UNCLEAR
                  ? `Máy nghe chưa rõ từ này (độ chắc chắn ${Math.round(w.conf * 100)}%) — nghe lại và luyện phát âm`
                  : `${clock(w.start)} · bấm để nghe`
              }
              className={cn(
                'rounded px-0.5 transition-colors hover:bg-brand-50 dark:hover:bg-brand-950/50',
                w.conf < UNCLEAR && 'underline decoration-amber-500 decoration-dotted decoration-2 underline-offset-[5px]',
                now && 'bg-brand-100 text-brand-900 dark:bg-brand-900/60 dark:text-white',
              )}
            >
              {w.w}
            </button>
          </span>
        )
      })}
    </p>
  )
}

/**
 * Two cards: the recording on its own, then what you said — corrected or as heard — with `children` below it (the
 * corrections), which folds away. "As heard" plays the words from the recording above.
 */
export function Transcript({
  result,
  audioSrc,
  audio,
  bind,
  children,
}: {
  result: TalkReviewResult
  audioSrc?: string
  /** The recording's control and the ref for its element (useTalkAudio on the page). */
  audio: AudioControl
  bind: (node: HTMLAudioElement | null) => void
  children?: ReactNode
}) {
  // Corrected first: what to fix is what you came for; "As heard" is a click away.
  const [view, setView] = useState<'heard' | 'corrected'>('corrected')
  const [open, setOpen] = useState(true)
  return (
    <>
      {audioSrc ? (
        <Card className="p-4 sm:p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <AudioLines className="size-4 text-brand-600 dark:text-brand-400" /> Your recording
          </p>
          <audio ref={bind} src={audioSrc} preload="auto" className="hidden" />
          <Player audio={audio} duration={result.fluency.duration} />
        </Card>
      ) : null}

      <Card className="p-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left sm:px-6"
        >
          <span className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
              <FileText className="size-4.5" />
            </span>
            What you said
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {result.fixes.length} corrections
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
            {open ? 'Hide' : 'Show'}
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
          </span>
        </button>
        {open ? (
          <div className="space-y-4 border-t border-slate-100 px-5 pt-4 pb-5 sm:px-6 sm:pb-6 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedControl
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { value: 'heard', label: 'As heard' },
                  { value: 'corrected', label: `Corrected (${result.fixes.length})` },
                ]}
              />
              {view === 'heard' ? (
                <span className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      ⏸
                    </span>{' '}
                    pause ≥ 1 s
                  </span>
                  <span className="underline decoration-amber-500 decoration-dotted decoration-2 underline-offset-4">unclear word</span>
                  {audioSrc ? <span>Click a word to hear it</span> : null}
                </span>
              ) : null}
            </div>
            {view === 'heard' ? (
              <Heard words={result.words} audio={audio} />
            ) : (
              <div className="space-y-2 text-[16px]">
                {result.heardSentences ? (
                  <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                    Words the recognizer misheard are restored to what you most likely said ({result.misheard?.length ?? 0} — see Pronunciation).
                    Switch to “As heard” for the recognizer’s words.
                  </p>
                ) : null}
                {result.sentences.map((s, i) =>
                  s === result.correctedSentences[i] ? (
                    <p key={i} className="leading-relaxed text-slate-700 dark:text-slate-200">
                      {s}
                    </p>
                  ) : (
                    <DiffText key={i} parts={diffWords(s, result.correctedSentences[i] ?? s)} />
                  ),
                )}
              </div>
            )}
            {children}
          </div>
        ) : null}
      </Card>
    </>
  )
}
