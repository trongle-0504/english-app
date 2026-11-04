// Listening → Simplify: paste a transcript (and the questions if you like) and Gemini applies NeuralSymbolic: the
// backbone of every sentence, the detail you can let pass, reference words, signposts, section anchors and the words that
// lead to the answers, plus how the sentences and sections connect. IELTS mode is for test recordings; Podcast mode for
// natural, machine-transcribed speech. A long transcript is analysed in parts side by side. Every analysis is saved;
// ?id= opens a saved one.
import { ArrowLeft, History, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, ButtonLink, Card, PageHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useLocalStorage } from '@/lib/storage'
import { useQueryParam } from '@/lib/useQueryParam'
import type { SimplifyMode, SimplifyResult } from '@/types/listening'
import { estimate, listeningApi, TRANSCRIPT_MAX } from './listening-simplify/api'
import { QuestionsField } from './listening-simplify/QuestionsField'
import { SimplifyResultView } from './listening-simplify/SimplifyResultView'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] leading-relaxed focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900'

const MODES: { value: SimplifyMode; label: string; hint: string }[] = [
  { value: 'ielts', label: 'IELTS', hint: 'bài nghe trong đề, có thể kèm câu hỏi / đáp án' },
  { value: 'podcast', label: 'Podcast', hint: 'lời nói tự nhiên: podcast, phỏng vấn, vlog (phụ đề tự động)' },
]

/** What an analysis was made from; the server trims both the same way (Podcast mode ignores the questions). */
const keyOf = (transcript: string, questions: string, mode: SimplifyMode) =>
  `${mode}\n---\n${transcript.trim()}\n---\n${mode === 'podcast' ? '' : questions.trim()}`

const minutes = (seconds: number) => (seconds < 90 ? `khoảng ${Math.round(seconds / 15) * 15} giây` : `khoảng ${Math.round(seconds / 30) / 2} phút`)

export default function ListeningSimplifyPage() {
  const [transcript, setTranscript] = useLocalStorage('practice:listening-simplify-transcript', '')
  const [questions, setQuestions] = useLocalStorage('practice:listening-simplify-questions', '')
  const [mode, setMode] = useLocalStorage<SimplifyMode>('practice:listening-simplify-mode', 'ielts')
  // Analysis result is kept in session memory so freshly opening the page starts clean without displaying old results.
  const [result, setResult] = useState<SimplifyResult | null>(null)
  const [analyzed, setAnalyzed] = useState('')
  const inputKey = keyOf(transcript, questions, mode)
  const current = Boolean(result) && analyzed === inputKey
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useQueryParam('id')

  // Clean legacy localStorage keys if they exist from older versions
  useEffect(() => {
    try {
      localStorage.removeItem('practice:listening-simplify-result')
      localStorage.removeItem('practice:listening-simplify-analyzed')
    } catch {
      // ignore
    }
  }, [])

  const length = transcript.trim().length
  const tooLong = length > TRANSCRIPT_MAX
  const wait = estimate(length)

  // ?id= (from the history page) loads that saved analysis together with its transcript, questions and mode.
  useEffect(() => {
    if (!openId) return
    let active = true
    listeningApi.get(openId).then(
      ({ saved }) => {
        if (!active) return
        const savedMode = saved.result.mode ?? 'ielts'
        setTranscript(saved.transcript)
        setQuestions(saved.questions)
        setMode(savedMode)
        setResult(saved.result)
        setAnalyzed(keyOf(saved.transcript, saved.questions, savedMode))
        setOpenId('')
      },
      (err: Error) => active && setError(err.message),
    )
    return () => {
      active = false
    }
  }, [openId, setOpenId, setTranscript, setQuestions, setMode, setResult, setAnalyzed])

  const run = async () => {
    setError('')
    setBusy(true)
    try {
      setResult((await listeningApi.simplify(transcript, mode === 'podcast' ? '' : questions, mode)).result)
      setAnalyzed(inputKey)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const clearAll = () => {
    setTranscript('')
    setQuestions('')
    setResult(null)
    setAnalyzed('')
    setError('')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <PageHeader
        eyebrow="Listening · Simplify"
        title="Đơn giản hóa transcript"
        description="Dán transcript, AI tách trục chính S – V – O của từng câu, phần có thể lướt qua, từ thay thế, từ nối và chỗ dẫn tới đáp án, rồi chỉ ra liên kết giữa các câu và ý chính từng đoạn. Nghe lại với mắt chỉ nhìn phần chính."
        actions={
          <>
            {transcript || questions || result ? (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <RotateCcw className="size-4" /> Làm mới
              </Button>
            ) : null}
            <ButtonLink to="/practice/listening-simplify/history" variant="ghost" size="sm">
              <History className="size-4" /> Lịch sử
            </ButtonLink>
            <ButtonLink to="/practice/dictation" variant="ghost" size="sm">
              <ArrowLeft className="size-4" /> Dictation
            </ButtonLink>
          </>
        }
      />

      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-0.5 dark:bg-slate-800" role="radiogroup" aria-label="Loại transcript">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                onClick={() => setMode(m.value)}
                className={cn(
                  'rounded-lg px-3 py-1 text-sm font-semibold transition-colors',
                  mode === m.value
                    ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-brand-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">{MODES.find((m) => m.value === mode)?.hint}</span>
        </div>

        <label className="block space-y-1.5">
          <span className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Transcript</span>
            <span className={cn('ml-auto text-xs tabular-nums', tooLong ? 'font-semibold text-rose-600' : 'text-slate-400')}>
              {length.toLocaleString('vi-VN')} / {TRANSCRIPT_MAX.toLocaleString('vi-VN')} ký tự
              {!tooLong && wait.parts > 1 ? ` · chia ${wait.parts} phần chạy song song` : ''}
            </span>
          </span>
          <textarea
            rows={10}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={mode === 'podcast' ? 'Dán phụ đề / transcript của podcast vào đây…' : 'Dán transcript của một Section vào đây…'}
            className={inputClass}
          />
        </label>
        {mode === 'ielts' ? <QuestionsField value={questions} onChange={setQuestions} inputClass={inputClass} /> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void run()} disabled={busy || length < 20 || tooLong}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {busy ? 'Đang phân tích…' : current ? 'Phân tích lại' : 'Phân tích'}
          </Button>
          {busy ? (
            <span className="text-sm text-slate-500">
              {wait.parts > 1 ? `Chia ${wait.parts} phần chạy song song, ` : ''}
              {minutes(wait.seconds)}.
            </span>
          ) : tooLong ? (
            <span className="text-sm text-rose-600">Transcript quá dài: hãy cắt bớt hoặc phân tích từng nửa.</span>
          ) : null}
        </div>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </Card>

      {result && transcript.trim() ? <SimplifyResultView result={result} /> : null}
    </div>
  )
}
