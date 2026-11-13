import { Clock, ListChecks, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge, Button } from '@/components/ui'
import { adminApi } from './api'

/** Step times of a Generate request (server/admin/generate-log.ts). */
export interface GenerateTimings {
  lemma: number
  dictionary: number
  main: number
  commit: number
  total: number
  dictionaryRequests: number
  cacheHits: number
  longmanWaitMs: number
  longmanPrefetched: boolean
  lemmaSkipped: boolean
  dictionarySource: 'longman' | 'ozdic' | 'both' | 'none'
  longmanError?: string
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** "Base form 0 s (skipped) · dictionaries 0.8 s · AI 19.9 s · save 0.0 s · total 20.7 s" under the dictionary summary. */
export function TimingsLine({ timings }: { timings?: GenerateTimings }) {
  if (!timings) return null
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
      <Clock className="size-3.5" />
      <span>Base form {timings.lemmaSkipped ? '0 s (skipped)' : sec(timings.lemma)}</span>·
      <span>
        dictionaries {sec(timings.dictionary)} ({timings.dictionaryRequests} requests, {timings.cacheHits} cached
        {timings.longmanWaitMs ? `, waited ${sec(timings.longmanWaitMs)}` : ''}
        {timings.longmanPrefetched ? ', prefetched' : ''})
      </span>
      ·<span>AI {sec(timings.main)}</span>·<span>save {sec(timings.commit)}</span>·<strong className="text-slate-700 dark:text-slate-200">total {sec(timings.total)}</strong>
    </p>
  )
}

interface JobPart {
  status: 'running' | 'done' | 'skipped' | 'error'
  error?: string
  ms?: number
  result?: { entry?: Record<string, unknown>; note?: Record<string, unknown>; added?: number; file?: string }
}

export interface GenerateJob {
  id: string
  parts: Partial<Record<'image' | 'practice', JobPart>>
}

const PART_LABEL = { image: 'Ảnh', practice: 'Practice' } as const
const STATUS_LABEL = { running: 'đang tạo…', done: 'xong', skipped: 'bỏ qua', error: 'lỗi' } as const
const STATUS_TONE = { running: 'sky', done: 'emerald', skipped: 'slate', error: 'rose' } as const

/**
 * Picture / practice made in the background after Generate: polls the job until every part is finished, shows
 * "đang tạo · xong · lỗi" with a retry button, and hands each finished part's result to `onPart`.
 */
export function BackgroundJobStatus({ job: initial, onPart }: { job: GenerateJob; onPart?: (part: 'image' | 'practice', part_: JobPart) => void }) {
  const [job, setJob] = useState(initial)
  const [error, setError] = useState('')
  const reported = useRef(new Set<string>())
  const onPartRef = useRef(onPart)
  useEffect(() => {
    onPartRef.current = onPart
  })

  const running = Object.values(job.parts).some((p) => p?.status === 'running')

  useEffect(() => {
    for (const [name, part] of Object.entries(job.parts) as ['image' | 'practice', JobPart][]) {
      const key = `${name}:${part.status}:${part.ms ?? ''}`
      if (part.status !== 'running' && !reported.current.has(key)) {
        reported.current.add(key)
        onPartRef.current?.(name, part)
      }
    }
  }, [job])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      adminApi<{ job: GenerateJob }>('generate/job', { query: { id: job.id } })
        .then((res) => setJob(res.job))
        .catch((e: Error) => {
          setError(e.message)
          clearInterval(timer)
        })
    }, 1500)
    return () => clearInterval(timer)
  }, [running, job.id])

  const retry = async (part: 'image' | 'practice') => {
    setError('')
    try {
      setJob((await adminApi<{ job: GenerateJob }>('generate/job/retry', { method: 'POST', body: { id: job.id, part } })).job)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {(Object.entries(job.parts) as ['image' | 'practice', JobPart][]).map(([name, part]) => (
        <span key={name} className="inline-flex items-center gap-1">
          <Badge tone={STATUS_TONE[part.status]} title={part.error}>
            {PART_LABEL[name]}: {STATUS_LABEL[part.status]}
            {name === 'practice' && part.status === 'done' && part.result?.added !== undefined ? ` (+${part.result.added})` : ''}
          </Badge>
          {part.status === 'error' ? (
            <Button size="sm" variant="ghost" onClick={() => void retry(name)} title={part.error}>
              <RotateCcw className="size-3" /> thử lại
            </Button>
          ) : null}
        </span>
      ))}
      {error ? <span className="text-rose-600">{error}</span> : null}
    </div>
  )
}

interface DrillsStatus {
  pending: { words: number; notes: number; items: { kind: 'word' | 'note'; key: string; title: string }[] }
  running: { startedAt: string } | null
  lastRun: { trigger: string; startedAt: string; ms?: number; items: number; written: number; calls: number; failed: { key: string; error: string }[]; error?: string } | null
  runAt: string
}

/** Review drills are written by the nightly batch: how many entries wait, the last run, and "Chạy ngay". */
export function DrillsPanel({ refreshKey }: { refreshKey?: unknown }) {
  const [status, setStatus] = useState<DrillsStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () =>
    adminApi<DrillsStatus>('drills')
      .then(setStatus)
      .catch((e: Error) => setError(e.message))

  useEffect(() => {
    void load()
  }, [refreshKey])

  useEffect(() => {
    if (!status?.running) return
    const timer = setInterval(() => void load(), 4000)
    return () => clearInterval(timer)
  }, [status?.running])

  const runNow = async () => {
    setBusy(true)
    setError('')
    try {
      setStatus(await adminApi<DrillsStatus>('drills/run', { method: 'POST' }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!status) return error ? <p className="text-xs text-rose-600">{error}</p> : null
  const pending = status.pending.words + status.pending.notes
  const last = status.lastRun
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
      <ListChecks className="size-4 text-brand-600 dark:text-brand-400" />
      <span title={status.pending.items.map((i) => i.title).join(', ')}>
        Drills (Nghe chép, Viết lại câu, Tự dùng) được tạo theo lô lúc {status.runAt}: <strong>{pending}</strong> mục đang chờ
        {pending ? ` (${status.pending.words} từ, ${status.pending.notes} note)` : ''}.
      </span>
      {last ? (
        <span title={last.failed.map((f) => `${f.key}: ${f.error}`).join('\n')}>
          Lần chạy cuối {new Date(last.startedAt).toLocaleString()}: {last.written}/{last.items} mục, {last.calls} lượt AI
          {last.failed.length ? <span className="text-amber-600"> · {last.failed.length} lỗi</span> : null}
          {last.error ? <span className="text-rose-600"> · {last.error}</span> : null}
        </span>
      ) : (
        <span>Chưa chạy lần nào.</span>
      )}
      <Button size="sm" variant="outline" className="ml-auto" loading={busy || Boolean(status.running)} disabled={!pending || busy || Boolean(status.running)} onClick={() => void runNow()}>
        {status.running ? 'Đang chạy…' : 'Chạy ngay'}
      </Button>
      {error ? <span className="text-rose-600">{error}</span> : null}
    </div>
  )
}

/** "Tạo drills ngay" for one entry that has none yet. */
export function DrillsNowButton({ kind, itemKey, onDone }: { kind: 'word' | 'note'; itemKey: string; onDone: (entry: Record<string, unknown>) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <Badge tone="amber">Chưa có drills (lô 03:00)</Badge>
      <Button
        size="sm"
        variant="ghost"
        loading={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            onDone((await adminApi<{ entry: Record<string, unknown> }>('drills/item', { method: 'POST', body: { kind, key: itemKey } })).entry)
          } catch (e) {
            setError((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        Tạo drills ngay
      </Button>
      {error ? <span className="text-rose-600">{error}</span> : null}
    </span>
  )
}
