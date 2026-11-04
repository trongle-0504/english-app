import { CircleAlert, KeyRound, ServerOff } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/ui'
import { useLocalStorage } from '@/lib/storage'
import { AnalysisResult, AnalysisSkeleton } from './analyze/AnalysisResult'
import { AnalyzeForm } from './analyze/AnalyzeForm'
import {
  analyze,
  deleteHistoryItem,
  findStatic,
  historyItems,
  loadBackend,
  normalizeText,
  type Analysis,
  type AnalyzeBackend,
} from './analyze/api'
import { HistoryPanel } from './analyze/HistoryPanel'

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
      <span className="mt-0.5 shrink-0 text-amber-500">{icon}</span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-amber-800/90 dark:text-amber-200/80">{children}</p>
      </div>
    </div>
  )
}

const code = (text: string) => <code className="rounded bg-amber-100 px-1 py-0.5 text-[0.9em] dark:bg-amber-900/50">{text}</code>

export default function GrammarAnalyzePage() {
  const [backend, setBackend] = useState<AnalyzeBackend>()
  const [text, setText] = useLocalStorage('grammar-analyze:draft', '')
  // Persisted so the result survives the dev server's full reload after history.json is written.
  const [result, setResult] = useLocalStorage<Analysis | null>('grammar-analyze:result', null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const latestRequest = useRef(0)
  const resultRef = useRef<HTMLDivElement>(null)
  const revealResult = useRef(false)

  useEffect(() => {
    let active = true
    loadBackend().then(
      (loaded) => active && setBackend(loaded),
      (err: Error) => active && setError(err.message),
    )
    return () => {
      active = false
    }
  }, [])

  // Bring a freshly shown result into view (not a result restored on page load).
  useEffect(() => {
    if (!revealResult.current) return
    revealResult.current = false
    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [result])

  const show = (analysis: Analysis) => {
    revealResult.current = true
    setResult(analysis)
  }

  const run = async (input: string) => {
    if (!backend) return
    setError(undefined)
    if (backend.mode === 'static') {
      const found = findStatic(backend.entries, input)
      if (found) show(found)
      else setError('This text has not been analyzed yet, and new analyses need the local server.')
      return
    }

    const request = ++latestRequest.current
    setPending(true)
    try {
      const analysis = await analyze(input.trim())
      if (request !== latestRequest.current) return
      show(analysis)
      const key = normalizeText(input)
      setBackend((current) =>
        current?.mode === 'server' && !current.items.some((item) => normalizeText(item) === key)
          ? { ...current, items: [key, ...current.items] }
          : current,
      )
    } catch (err) {
      if (request === latestRequest.current) setError((err as Error).message)
    } finally {
      if (request === latestRequest.current) setPending(false)
    }
  }

  const select = (item: string) => {
    setText(item)
    void run(item)
  }

  const remove = async (item: string) => {
    try {
      await deleteHistoryItem(item)
      setBackend((current) => (current?.mode === 'server' ? { ...current, items: current.items.filter((i) => i !== item) } : current))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <title>Grammar Analyzer · NeuralSymbolic</title>
      <PageHeader
        eyebrow="Grammar"
        title="Grammar Analyzer"
        description="Break a complex English sentence down with the Linear Thinking method: logic, subject–verb pairs, structure and main idea."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 space-y-4">
          {backend?.mode === 'static' ? (
            <Notice icon={<ServerOff className="size-5" />} title="Read-only mode">
              Analyzing new text needs the local server ({code('npm run dev')} or {code('npm start')}) with {code('GEMINI_API_KEY')} set in{' '}
              {code('.env')}. You can still open previous analyses from the history.
            </Notice>
          ) : backend?.mode === 'server' && !backend.gemini ? (
            <Notice icon={<KeyRound className="size-5" />} title="Gemini is not configured">
              Set {code('GEMINI_API_KEY')} in {code('.env')} and restart the server to analyze new text. Texts in the history still work.
            </Notice>
          ) : null}
          <AnalyzeForm text={text} onTextChange={setText} onSubmit={() => void run(text)} pending={pending} />
        </div>

        <HistoryPanel
          items={backend ? historyItems(backend) : undefined}
          activeText={result?.text}
          onSelect={select}
          onDelete={backend?.mode === 'server' ? remove : undefined}
          className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        />

        <div className="min-w-0 space-y-4">
          {error ? (
            <div role="alert" className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-rose-500" />
              <p>{error}</p>
            </div>
          ) : null}
          {pending ? <AnalysisSkeleton /> : result ? <AnalysisResult ref={resultRef} raw={result.raw} cached={result.cached} /> : null}
        </div>
      </div>
    </>
  )
}
