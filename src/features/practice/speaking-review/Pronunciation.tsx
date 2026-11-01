// Pronunciation, with the evidence: each phrase the recognizer heard as other words ("Movie Dust Moonly"), what you
// most likely said ("multitasking smoothly") with its IPA and the sound to fix, and a button to hear exactly that
// stretch of your recording again. Below, the other words the recognizer was unsure of. Reviews made before the AI
// restored misheard phrases show only those unclear words.
import { ArrowRight, Check, ChevronDown, Loader2, Mic, Play, RotateCcw, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { TalkMisheard, TalkReviewResult, TalkWord } from '@/types/speakingReview'
import type { AudioControl } from './audio'
import { base64Of, useRecorder } from './recorder'

/** Below this the recognizer was unsure of the word (server/speaking-review/fluency.ts). */
const UNCLEAR = 0.6

/** Runs of unclear words in a row, outside the misheard phrases. */
function unclearRuns(words: TalkWord[], misheard: TalkMisheard[]): { text: string; start: number; end: number }[] {
  const covered = (w: TalkWord) => misheard.some((m) => m.end > m.start && w.start >= m.start - 0.01 && w.end <= m.end + 0.01)
  const runs: { text: string; start: number; end: number }[] = []
  let last = -2
  words.forEach((w, i) => {
    if (w.conf >= UNCLEAR || covered(w)) return
    const text = w.w.replace(/[^\p{L}\p{N}'-]/gu, '')
    if (!text) return
    if (i === last + 1 && runs.length) {
      const run = runs[runs.length - 1]
      run.text += ` ${text}`
      run.end = w.end
    } else runs.push({ text, start: w.start, end: w.end })
    last = i
  })
  return runs
}

function PlayButton({ audio, start, end, label }: { audio: AudioControl | null; start: number; end: number; label: string }) {
  const can = Boolean(audio?.el) && end > start
  return (
    <button
      type="button"
      disabled={!can}
      onClick={() => audio?.playRange(start, end)}
      title={can ? 'Nghe lại đúng đoạn này trong bản ghi của bạn' : 'Không có bản ghi để nghe lại'}
      aria-label={`Play “${label}”`}
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm transition-transform hover:scale-105 disabled:bg-slate-200 disabled:text-slate-400 dark:bg-brand-500 dark:disabled:bg-slate-800"
    >
      <Play className="ml-0.5 size-4" />
    </button>
  )
}

function PronunciationPractice({ meant }: { meant: string }) {
  const recorder = useRecorder(8)
  const [checking, setChecking] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')
  const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim()
  const correct = transcript ? normalized(transcript).includes(normalized(meant)) : false

  useEffect(() => {
    if (recorder.state !== 'ready' || !recorder.take) return
    let active = true
    setChecking(true)
    setError('')
    void base64Of(recorder.take.wav)
      .then(async (audio) => {
        const response = await fetch('/api/speaking-review/pronunciation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio }),
        })
        const body = (await response.json()) as { text?: string; error?: string }
        if (!response.ok) throw new Error(body.error ?? 'Không kiểm tra được phát âm.')
        if (active) setTranscript(body.text ?? '')
      })
      .catch((cause) => active && setError((cause as Error).message))
      .finally(() => active && setChecking(false))
    return () => {
      active = false
    }
  }, [recorder.state, recorder.take])

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {recorder.state === 'recording' ? (
        <Button size="sm" variant="outline" onClick={recorder.stop}>
          <Mic className="size-3.5 text-rose-600" /> Dừng ({Math.ceil(recorder.elapsed)}s)
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => void recorder.start()} disabled={checking || recorder.state === 'converting'}>
          {checking ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
          {checking ? 'Đang kiểm tra…' : 'Đọc lại để kiểm tra'}
        </Button>
      )}
      {transcript ? (
        <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', correct ? 'text-emerald-700' : 'text-amber-700')}>
          {correct ? <Check className="size-3.5" /> : <RotateCcw className="size-3.5" />}
          Máy nghe: “{transcript}” — {correct ? 'có vẻ đúng' : `hãy thử lại với “${meant}”`}
        </span>
      ) : null}
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </div>
  )
}

export function Pronunciation({ result, audio }: { result: TalkReviewResult; audio: AudioControl | null }) {
  const [open, setOpen] = useState(true)
  const misheard = result.misheard ?? []
  const unclear = unclearRuns(result.words, misheard)
  if (!misheard.length && !unclear.length) return null
  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left sm:px-6"
      >
        <span className="flex flex-wrap items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <span className="flex size-8 items-center justify-center rounded-lg bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300">
            <Volume2 className="size-4.5" />
          </span>
          Pronunciation
          {misheard.length ? (
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
              {misheard.length} misheard
            </span>
          ) : null}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          {open ? 'Hide' : 'Show'}
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-slate-100 px-5 pt-4 pb-5 sm:px-6 sm:pb-6 dark:border-slate-800">
          {misheard.length ? (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                The recognizer heard these as other words — most likely an unclear pronunciation (a noisy mic or speaking fast can do it too). Play
                each one and compare with what you meant.
              </p>
              <ul className="space-y-2.5">
                {misheard.map((m, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <PlayButton audio={audio} start={m.start} end={m.end} label={m.heard} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] leading-relaxed">
                        <span className="text-xs font-semibold text-slate-400 uppercase">Heard </span>
                        <span className="font-semibold text-rose-600 dark:text-rose-300">“{m.heard}”</span>
                        <ArrowRight className="mx-1.5 inline size-3.5 text-slate-400" />
                        <span className="text-xs font-semibold text-slate-400 uppercase">You meant </span>
                        <span className="font-semibold text-emerald-700 dark:text-emerald-300">“{m.meant}”</span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                        {m.ipa ? <span className="font-mono text-slate-700 dark:text-slate-300">{m.ipa}</span> : null}
                        {m.tip ? <span className="text-slate-500 dark:text-slate-400">{m.tip}</span> : null}
                      </p>
                      <PronunciationPractice meant={m.meant} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {unclear.length ? (
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                {misheard.length ? 'Other words the recognizer was unsure of' : 'Words the recognizer was unsure of'}
                <span className="ml-1 font-normal text-slate-500 dark:text-slate-400">— click to hear them</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unclear.map((u, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={!audio?.el}
                    onClick={() => audio?.playRange(u.start, u.end)}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-sm text-amber-900 ring-1 ring-amber-200 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900"
                  >
                    <Play className="size-3" /> {u.text}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
