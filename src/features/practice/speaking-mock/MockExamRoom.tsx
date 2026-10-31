import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Flag,
  Mic,
  MicOff,
  RotateCcw,
  SkipForward,
  Volume2,
} from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { speak, speechSupported, stopSpeaking } from '@/lib/speech'
import { base64Of, toWav16k } from '../speaking-review/recorder'
import { ExaminerOrb, type OrbMode } from './ExaminerOrb'
import type { BuiltMockSession, MockQuestionItem, MockQuestionRecording } from './types'

type StagePhase = 'examiner' | 'preparing' | 'recording' | 'saving' | 'error'

interface ActiveMicSession {
  stop: () => Promise<{ blob: Blob; duration: number }>
  cancel: () => void
}

async function openMicStream(onLevel: (level: number) => void): Promise<ActiveMicSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const audioCtx = new AudioContext()
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 1024
  audioCtx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Float32Array(analyser.fftSize)
  let frameId = 0
  let active = true

  const tick = () => {
    if (!active) return
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += v * v
    onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6))
    frameId = requestAnimationFrame(tick)
  }
  frameId = requestAnimationFrame(tick)

  const startedAt = performance.now()

  const releaseResources = () => {
    active = false
    cancelAnimationFrame(frameId)
    stream.getTracks().forEach((t) => t.stop())
    void audioCtx.close().catch(() => {})
    onLevel(0)
  }

  recorder.start(500)

  return {
    stop: () =>
      new Promise<{ blob: Blob; duration: number }>((resolve) => {
        const duration = (performance.now() - startedAt) / 1000
        if (recorder.state === 'inactive') {
          releaseResources()
          resolve({ blob: new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), duration })
          return
        }
        recorder.onstop = () => {
          releaseResources()
          resolve({ blob: new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), duration })
        }
        recorder.stop()
      }),
    cancel: () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop()
      } catch {
        // ignore
      }
      releaseResources()
    },
  }
}

function speakWithFallback(text: string, onDone: () => void, rate = 0.95): () => void {
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    clearTimeout(fallbackTimer)
    onDone()
  }

  const wordCount = text.trim().split(/\s+/).length
  const maxWaitMs = Math.max(4000, wordCount * 480 + 2500)
  const fallbackTimer = setTimeout(finish, maxWaitMs)

  if (!speechSupported) {
    clearTimeout(fallbackTimer)
    const shortTimer = setTimeout(finish, 600)
    return () => {
      finished = true
      clearTimeout(shortTimer)
    }
  }

  speak(text, {
    rate,
    onEnd: finish,
  })

  return () => {
    finished = true
    clearTimeout(fallbackTimer)
    stopSpeaking()
  }
}

function formatTimer(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}:${String(rem).padStart(2, '0')}`
}

export function MockExamRoom({
  session,
  initialQuestionIndex = 0,
  singleQuestionMode = false,
  existingRecordings,
  onSaveRecording,
  onFinishExam,
  onExitExam,
}: {
  session: BuiltMockSession
  initialQuestionIndex?: number
  singleQuestionMode?: boolean
  existingRecordings: Record<string, MockQuestionRecording>
  onSaveRecording: (rec: MockQuestionRecording) => void
  onFinishExam: () => void
  onExitExam: () => void
}) {
  const [currentIndex, setCurrentIndex] = useState(initialQuestionIndex)
  const question: MockQuestionItem | undefined = session.questions[currentIndex]

  const [phase, setPhase] = useState<StagePhase>('examiner')
  const [timeLeft, setTimeLeft] = useState<number>(60)
  const [micLevel, setMicLevel] = useState<number>(0)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [notesByQuestion, setNotesByQuestion] = useState<Record<string, string>>({})
  const [panelOpen, setPanelOpen] = useState<boolean>(false)

  const micRef = useRef<ActiveMicSession | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelSpeechRef = useRef<(() => void) | null>(null)
  const phaseRef = useRef<StagePhase>(phase)
  phaseRef.current = phase

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const cleanupAudioAndSpeech = useCallback(() => {
    clearTimer()
    if (cancelSpeechRef.current) {
      cancelSpeechRef.current()
      cancelSpeechRef.current = null
    }
    stopSpeaking()
    if (micRef.current) {
      micRef.current.cancel()
      micRef.current = null
    }
  }, [clearTimer])

  // Start the recording phase for the current question
  const beginRecordingPhase = useCallback(
    async (q: MockQuestionItem) => {
      clearTimer()
      if (cancelSpeechRef.current) {
        cancelSpeechRef.current()
        cancelSpeechRef.current = null
      }
      stopSpeaking()
      setErrorMsg('')
      try {
        if (micRef.current) {
          micRef.current.cancel()
          micRef.current = null
        }
        const mic = await openMicStream((lvl) => setMicLevel(lvl))
        micRef.current = mic
        setPhase('recording')
        setTimeLeft(q.speakSeconds)
      } catch (err) {
        const msg =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Trình duyệt chưa được cấp quyền micro. Hãy cho phép quyền truy cập micro trên thanh địa chỉ rồi bấm Thử lại.'
            : (err as Error).message || 'Không mở được micro.'
        setErrorMsg(msg)
        setPhase('error')
      }
    },
    [clearTimer],
  )

  // Stop recording, convert to 16kHz WAV + base64, save to parent, and advance
  const finishCurrentQuestionAndAdvance = useCallback(
    async (advanceAfterSave = true) => {
      if (!question) return
      clearTimer()
      if (cancelSpeechRef.current) {
        cancelSpeechRef.current()
        cancelSpeechRef.current = null
      }
      stopSpeaking()

      const activeMic = micRef.current
      micRef.current = null
      setMicLevel(0)

      if (activeMic) {
        setPhase('saving')
        try {
          const { blob, duration } = await activeMic.stop()
          if (duration >= 1.0 && blob.size > 0) {
            const { wav, seconds } = await toWav16k(blob)
            const base64Audio = await base64Of(wav)
            const audioUrl = URL.createObjectURL(wav)
            onSaveRecording({
              questionId: question.id,
              part: question.part,
              indexInPart: question.indexInPart,
              topic: question.topic,
              questionText: question.questionText,
              cueCardBullets: question.cueCardBullets,
              wavBlob: wav,
              audioUrl,
              base64Audio,
              durationSeconds: Math.max(1, Math.round(seconds || duration)),
              recordedAt: new Date().toISOString(),
            })
          }
        } catch (err) {
          console.error('[MockExamRoom] Failed to save recording:', err)
        }
      }

      if (!advanceAfterSave) return

      if (singleQuestionMode || currentIndex + 1 >= session.questions.length) {
        onFinishExam()
      } else {
        setCurrentIndex((idx) => idx + 1)
      }
    },
    [clearTimer, currentIndex, onFinishExam, onSaveRecording, question, session.questions.length, singleQuestionMode],
  )

  // Transition from Part 2 Preparation -> Part 2 Speaking
  const beginPart2SpeakingFromPrep = useCallback(() => {
    if (!question) return
    clearTimer()
    setPhase('examiner')
    cancelSpeechRef.current = speakWithFallback(
      'Alright, your preparation time is up. Please start speaking now.',
      () => {
        void beginRecordingPhase(question)
      },
      0.95,
    )
  }, [beginRecordingPhase, clearTimer, question])

  // Initialize question whenever `currentIndex` changes
  useEffect(() => {
    if (!question) return
    let cancelled = false
    cleanupAudioAndSpeech()
    setErrorMsg('')
    setMicLevel(0)

    if (question.part === 2) {
      // Part 2: Examiner introduces the cue card and gives 2 minutes to prepare
      setPhase('examiner')
      setTimeLeft(question.prepSeconds)
      const introText = `Now let's move on to Part 2. Here is your topic: ${question.topic}. You now have two minutes to prepare your ideas, and you can make notes if you wish.`
      cancelSpeechRef.current = speakWithFallback(
        introText,
        () => {
          if (cancelled) return
          setPhase('preparing')
          setTimeLeft(question.prepSeconds)
        },
        0.95,
      )
    } else {
      // Part 1 or Part 3: Examiner reads the question aloud, then recording starts automatically
      setPhase('examiner')
      setTimeLeft(question.speakSeconds)
      const prefix =
        question.indexInPart === 1
          ? question.part === 1
            ? `Part 1. Let's talk about ${question.topic}. `
            : `Part 3. Let's discuss some more general questions related to ${question.topic}. `
          : ''
      cancelSpeechRef.current = speakWithFallback(
        `${prefix}${question.questionText}`,
        () => {
          if (cancelled) return
          void beginRecordingPhase(question)
        },
        0.95,
      )
    }

    return () => {
      cancelled = true
      cleanupAudioAndSpeech()
    }
  }, [currentIndex, question, beginRecordingPhase, cleanupAudioAndSpeech])

  // Countdown interval during 'preparing' and 'recording' phases
  useEffect(() => {
    clearTimer()
    if (phase !== 'preparing' && phase !== 'recording') return

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearTimer()
          if (phaseRef.current === 'preparing') {
            beginPart2SpeakingFromPrep()
          } else if (phaseRef.current === 'recording') {
            void finishCurrentQuestionAndAdvance(true)
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearTimer()
  }, [phase, clearTimer, beginPart2SpeakingFromPrep, finishCurrentQuestionAndAdvance])

  if (!question) return null

  const orbMode: OrbMode =
    phase === 'examiner'
      ? 'speaking'
      : phase === 'preparing'
        ? 'preparing'
        : phase === 'recording'
          ? 'listening'
          : 'idle'

  const orbLabel =
    phase === 'examiner'
      ? `Part ${question.part} • EXAMINER SPEAKING`
      : phase === 'preparing'
        ? `Part 2 • PREPARATION (${formatTimer(timeLeft)})`
        : phase === 'recording'
          ? `Part ${question.part} • RECORDING (${formatTimer(timeLeft)})`
          : phase === 'saving'
            ? 'ĐANG LƯU BẢN GHI…'
            : `Part ${question.part} • TẠM DỪNG`

  const orbSublabel =
    phase === 'examiner'
      ? 'Giám khảo đang đọc câu hỏi… (Bấm nút bên dưới nếu muốn ghi âm luôn)'
      : phase === 'preparing'
        ? 'Thời gian chuẩn bị 2 phút (Ghi chú nháp bên phải sẽ không tính vào bài nộp)'
        : phase === 'recording'
          ? `Đang thu âm câu trả lời của bạn • Tối đa ${question.speakSeconds === 120 ? '2 phút' : '1 phút'}`
          : undefined

  const isLastQuestion = singleQuestionMode || currentIndex + 1 >= session.questions.length
  const totalQuestions = session.questions.length
  const progressPercent = Math.round(((currentIndex + (phase === 'recording' ? 0.5 : 0)) / totalQuestions) * 100)
  const recordedCount = Object.keys(existingRecordings).length

  const replayExaminerQuestion = () => {
    if (!question) return
    stopSpeaking()
    speak(question.part === 2 ? question.topic : question.questionText, { rate: 0.95 })
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* Top Exam Header Bar (matches screenshot 2 layout) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-2 py-3 sm:px-6 dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm">
            <Mic className="size-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-slate-900 dark:text-white">Làm bài</span>
              <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800 dark:bg-sky-950/70 dark:text-sky-300">
                Part {question.part}
              </span>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Câu {question.indexInPart}/{question.totalInPart} • Tổng tiến độ {currentIndex + 1}/{totalQuestions}
              </span>
            </div>
            <p className="line-clamp-1 text-xs text-slate-600 dark:text-slate-400">
              Real mode • IELTS Speaking • Part {question.part} • {question.topic}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Visible Countdown Timer Badge */}
          <div
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-sm font-bold tabular-nums transition-colors',
              phase === 'recording' && timeLeft <= 10
                ? 'animate-pulse border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
                : phase === 'recording'
                  ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200'
                  : phase === 'preparing'
                    ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                    : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
            )}
          >
            <Clock className="size-4" />
            <span>{formatTimer(timeLeft)}</span>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (phase === 'recording') {
                await finishCurrentQuestionAndAdvance(false)
              } else {
                cleanupAudioAndSpeech()
              }
              onFinishExam()
            }}
            title="Kết thúc phòng thi và chuyển tới màn hình kiểm tra & nộp bài"
          >
            <Flag className="size-4 text-rose-500" />
            <span className="hidden sm:inline">Kết thúc & Xem lại ({recordedCount})</span>
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-1 w-full bg-slate-100 dark:bg-slate-800">
        <div
          style={{ width: `${progressPercent}%` }}
          className="h-full bg-sky-600 transition-all duration-300 dark:bg-sky-400"
        />
      </div>

      {/* Main Split View: Left = Virtual Examiner Orb & Controls, Right = Cue Card / Question Prompt */}
      <div className="grid min-h-[540px] grid-cols-1 lg:grid-cols-12">
        {/* Left Column: Virtual Examiner Orb + Action Buttons */}
        <div
          className={cn(
            'relative flex flex-col items-center justify-between border-b border-slate-200 p-6 sm:p-8 lg:border-r lg:border-b-0 dark:border-slate-800',
            panelOpen ? 'lg:col-span-5' : 'lg:col-span-12',
          )}
        >
          <div className="flex w-full items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Virtual Examiner</span>
            {!panelOpen ? (
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Mở đề bài & Cuecard
              </button>
            ) : null}
          </div>

          {/* Center Orb */}
          <div className="my-6 flex flex-col items-center">
            <ExaminerOrb mode={orbMode} level={micLevel} label={orbLabel} sublabel={orbSublabel} />

            {/* Error Alert if Mic failed */}
            {phase === 'error' && errorMsg ? (
              <div className="mt-5 max-w-sm rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-center text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                <div className="mb-2 flex items-center justify-center gap-1.5 font-bold">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>Không thể thu âm</span>
                </div>
                <p className="mb-3">{errorMsg}</p>
                <Button size="sm" onClick={() => void beginRecordingPhase(question)}>
                  <RotateCcw className="size-3.5" /> Thử lại micro
                </Button>
              </div>
            ) : null}

            {/* Primary Stage Action Button below Orb (like "Nộp bài sớm" in reference screenshot) */}
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              {phase === 'examiner' ? (
                <button
                  type="button"
                  onClick={() => {
                    if (cancelSpeechRef.current) {
                      cancelSpeechRef.current()
                      cancelSpeechRef.current = null
                    }
                    stopSpeaking()
                    if (question.part === 2) {
                      setPhase('preparing')
                      setTimeLeft(question.prepSeconds)
                    } else {
                      void beginRecordingPhase(question)
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-5 py-2.5 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <SkipForward className="size-3.5" />
                  <span>{question.part === 2 ? 'Bắt đầu 2 phút chuẩn bị ngay' : 'Bỏ qua giọng đọc • Ghi âm ngay'}</span>
                </button>
              ) : null}

              {phase === 'preparing' ? (
                <button
                  type="button"
                  onClick={() => void beginRecordingPhase(question)}
                  className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-6 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-sky-700"
                >
                  <Mic className="size-4" />
                  <span>Bắt đầu nói ngay (Bỏ qua thời gian chuẩn bị)</span>
                </button>
              ) : null}

              {phase === 'recording' ? (
                <button
                  type="button"
                  onClick={() => void finishCurrentQuestionAndAdvance(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                >
                  {isLastQuestion ? (
                    <>
                      <CheckCircle2 className="size-4 text-emerald-400 dark:text-emerald-600" />
                      <span>Nộp bài sớm & Hoàn thành phần thi</span>
                    </>
                  ) : (
                    <>
                      <span>Hoàn thành câu này • Câu tiếp theo</span>
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </button>
              ) : null}
            </div>
          </div>

          {/* Bottom Floating Dock (Mic status + Replay Examiner Audio + Restart Question) */}
          <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200/90 bg-white px-3.5 py-2 shadow-md dark:border-slate-700 dark:bg-slate-800">
            <div
              className={cn(
                'flex size-10 items-center justify-center rounded-xl transition-colors',
                phase === 'recording'
                  ? 'bg-rose-500 text-white'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
              )}
              title={phase === 'recording' ? 'Micro đang thu âm' : 'Micro đang tắt'}
            >
              {phase === 'recording' ? <Mic className="size-5 animate-pulse" /> : <MicOff className="size-5" />}
            </div>

            <button
              type="button"
              onClick={replayExaminerQuestion}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/60"
              title="Nghe lại giám khảo đọc câu hỏi"
            >
              <Volume2 className="size-4 text-sky-600 dark:text-sky-400" />
              <span>Nghe lại câu hỏi</span>
            </button>

            {phase === 'recording' ? (
              <button
                type="button"
                onClick={() => void beginRecordingPhase(question)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60"
                title="Thu âm lại câu hỏi hiện tại từ đầu"
              >
                <RotateCcw className="size-3.5" />
                <span>Thu lại câu này</span>
              </button>
            ) : null}
          </div>
        </div>

        {/* Right Column: Question Card / Part 2 Cuecard + Scratchpad Note Area */}
        {panelOpen ? (
          <div className="flex flex-col justify-between bg-slate-50/40 p-5 sm:p-8 lg:col-span-7 dark:bg-slate-900/40">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-6 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    <FileText className="size-5" />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      {question.part === 2 ? 'Cuecard' : `Part ${question.part} • Question ${question.indexInPart}`}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Chủ đề: <span className="font-semibold text-slate-700 dark:text-slate-300">{question.topic}</span>
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  › Đóng
                </button>
              </div>

              {question.part === 2 ? (
                /* Part 2 Cue Card UI matching screenshot 2 */
                <div className="space-y-5">
                  <p className="text-base font-bold text-slate-900 sm:text-lg dark:text-white">{question.topic}</p>

                  {question.cueCardBullets && question.cueCardBullets.length > 0 ? (
                    <div className="space-y-2.5 text-sm text-slate-700 dark:text-slate-300">
                      <p className="font-medium text-slate-600 dark:text-slate-400">You should say:</p>
                      <ul className="space-y-2 pl-4">
                        {question.cueCardBullets.map((bullet, idx) => (
                          <li key={idx} className="flex items-start gap-2.5">
                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-700 dark:bg-slate-300" />
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {/* Scratchpad "Take note" lined paper area (strictly local, never submitted) */}
                  <div className="pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <label htmlFor="part2-scratchpad" className="text-sm font-medium text-slate-600 dark:text-slate-400">
                        Take note <span className="text-xs text-slate-400">(Ghi chú nháp cho bạn, không bắt buộc & không chấm điểm)</span>
                      </label>
                      {phase === 'preparing' ? (
                        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                          Còn {formatTimer(timeLeft)} chuẩn bị
                        </span>
                      ) : null}
                    </div>
                    <div className="relative rounded-xl border border-slate-200/80 bg-amber-50/20 p-3 pl-6 dark:border-slate-800 dark:bg-slate-800/40">
                      {/* Vertical red margin line like real note paper in screenshot 2 */}
                      <div className="pointer-events-none absolute top-2 bottom-2 left-4 w-px bg-rose-300/70 dark:bg-rose-500/40" />
                      <textarea
                        id="part2-scratchpad"
                        rows={6}
                        value={notesByQuestion[question.id] ?? ''}
                        onChange={(e) =>
                          setNotesByQuestion((prev) => ({
                            ...prev,
                            [question.id]: e.target.value,
                          }))
                        }
                        placeholder="Ghi nhanh từ khóa / ý chính tại đây trong 2 phút chuẩn bị..."
                        style={{
                          backgroundImage:
                            'repeating-linear-gradient(transparent, transparent 27px, rgba(148, 163, 184, 0.25) 27px, rgba(148, 163, 184, 0.25) 28px)',
                          lineHeight: '28px',
                        }}
                        className="w-full resize-none bg-transparent text-sm text-slate-800 focus:outline-none dark:text-slate-100"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* Part 1 & Part 3 Question Display */
                <div className="space-y-6 py-4">
                  <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-5 sm:p-6 dark:border-sky-900/50 dark:bg-sky-950/30">
                    <span className="mb-2 inline-block text-xs font-bold tracking-wider text-sky-700 uppercase dark:text-sky-300">
                      Câu hỏi {question.indexInPart} / {question.totalInPart}
                    </span>
                    <p className="text-lg leading-relaxed font-bold text-slate-900 sm:text-xl dark:text-white">
                      {question.questionText}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                      <p className="font-bold text-slate-800 dark:text-slate-200">Thời gian trả lời tối đa</p>
                      <p className="mt-0.5">1 phút (60 giây) cho mỗi câu hỏi Part {question.part}.</p>
                    </div>
                    <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                      <p className="font-bold text-slate-800 dark:text-slate-200">Chuyển câu tự động</p>
                      <p className="mt-0.5">Hệ thống tự lưu bản ghi khi hết giờ hoặc khi bạn bấm Chuyển câu.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Question Stepper Pills at the bottom of right column */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {session.questions.map((q, idx) => {
                  const isCurrent = idx === currentIndex
                  const hasRec = Boolean(existingRecordings[q.id])
                  return (
                    <span
                      key={q.id}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition',
                        isCurrent
                          ? 'bg-sky-600 text-white shadow-xs'
                          : hasRec
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : 'bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
                      )}
                    >
                      <span>
                        P{q.part}.{q.indexInPart}
                      </span>
                      {hasRec && !isCurrent ? <CheckCircle2 className="size-3" /> : null}
                    </span>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  cleanupAudioAndSpeech()
                  onExitExam()
                }}
                className="text-xs font-medium text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-200"
              >
                Thoát về danh sách chủ đề
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
