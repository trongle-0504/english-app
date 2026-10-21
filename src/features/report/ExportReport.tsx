// "Xuất báo cáo": the learner picks the parts (and, for Speaking, the questions) and downloads the report as Markdown,
// Word or PDF (the server writes the PDF: POST /api/report/pdf). Sources: one Speaking result, one Writing review, or
// the questions of a Speaking topic gathered from several results (the history page). The only piece of the report
// module the pages use.
import * as Dialog from '@radix-ui/react-dialog'
import { FileDown, FileText, FileType, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { buttonClass } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useLocalStorage } from '@/lib/storage'
import type { SpeakingResult } from '@/types/speaking'
import type { WritingReviewResult } from '@/types/writingReview'
import type { ReportDoc, SectionOption } from './model.ts'
import { SPEAKING_SECTIONS, speakingCollectionReport, speakingReport, type ReportOptions } from './speaking-report.ts'
import { toMarkdown } from './to-markdown.ts'
import { WRITING_SECTIONS, writingReport } from './writing-report.ts'

type Source =
  | { kind: 'speaking'; result: SpeakingResult; current: number }
  | { kind: 'writing'; result: WritingReviewResult }
  /** A topic's questions from several results, in this order; `load` reads a result (the page may have it already). */
  | { kind: 'speaking-group'; topic: string; questions: { id: string; index: number }[]; load: (id: string) => Promise<SpeakingResult> }

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const defaults = (sections: SectionOption[]) => sections.filter((s) => s.defaultOn).map((s) => s.key)

/** The trigger in the brand colour on a light tint: easy to find, lighter than a page's main action. */
const TRIGGER =
  'border border-brand-200 bg-brand-50 text-brand-700 hover:border-brand-300 hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-950/50 dark:text-brand-300 dark:hover:bg-brand-900/60'

export function ExportReport(props: Source & { className?: string; /** Icon-only trigger (a list row). */ compact?: boolean }) {
  const page = props.kind === 'writing' ? 'writing' : 'speaking'
  const sections = page === 'speaking' ? SPEAKING_SECTIONS : WRITING_SECTIONS
  // Remembered per page kind in this browser (a convenience only).
  const [chosen, setChosen] = useLocalStorage<string[]>(`report:${page}:sections`, defaults(sections))
  const [showNatural, setShowNatural] = useLocalStorage(`report:${page}:natural`, false)
  const [scope, setScope] = useState<'all' | 'current'>('all')
  const [busy, setBusy] = useState<'md' | 'docx' | 'pdf' | null>(null)
  const [error, setError] = useState('')

  const multi = props.kind === 'speaking' && props.result.answers.length > 1
  const keys = chosen.filter((k) => sections.some((s) => s.key === k))
  const toggle = (key: string) => setChosen((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]))

  const report = async (): Promise<ReportDoc> => {
    const options: ReportOptions = { sections: new Set(keys), showNatural }
    if (props.kind === 'writing') return writingReport(props.result, options)
    if (props.kind === 'speaking-group') {
      const ids = [...new Set(props.questions.map((q) => q.id))]
      const results = new Map(await Promise.all(ids.map(async (id) => [id, await props.load(id)] as const)))
      return speakingCollectionReport(props.questions.map((q) => ({ result: results.get(q.id)!, index: q.index })), options)
    }
    const answers = scope === 'current' && multi ? [props.current] : props.result.answers.map((_, i) => i)
    return speakingReport(props.result, answers, options)
  }

  /** A file made from the report (Word: a lazy-loaded library; PDF: the server), with a busy state and an error. */
  const make = async (kind: 'md' | 'docx' | 'pdf', label: string, file: (doc: ReportDoc) => Promise<Blob>) => {
    setBusy(kind)
    setError('')
    try {
      const doc = await report()
      download(await file(doc), `${doc.fileName}.${kind}`)
    } catch (e) {
      setError(`Không tạo được file ${label}: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }
  const exportMarkdown = () => make('md', 'Markdown', async (doc) => new Blob([toMarkdown(doc)], { type: 'text/markdown;charset=utf-8' }))
  const exportWord = () => make('docx', 'Word', async (doc) => (await import('./to-docx.ts')).toDocxBlob(doc))
  const exportPdf = () =>
    make('pdf', 'PDF', async (doc) => {
      const res = await fetch('/api/report/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc }) })
      const json = (await res.json().catch(() => ({}))) as { pdf?: string; error?: string }
      if (!res.ok || !json.pdf) throw new Error(json.error ?? `máy chủ trả lỗi ${res.status}`)
      return new Blob([Uint8Array.from(atob(json.pdf), (c) => c.charCodeAt(0))], { type: 'application/pdf' })
    })

  return (
    <Dialog.Root>
      {props.compact ? (
        <Dialog.Trigger
          className={cn('rounded-md p-1', TRIGGER, props.className)}
          title="Xuất báo cáo cả chủ đề: Markdown, Word hoặc PDF"
          aria-label="Xuất báo cáo cả chủ đề"
        >
          <FileDown className="size-4" />
        </Dialog.Trigger>
      ) : (
        <Dialog.Trigger className={buttonClass('outline', 'sm', cn(TRIGGER, props.className))} title="Xuất báo cáo: Markdown, Word hoặc PDF">
          <FileDown className="size-4" /> Xuất báo cáo
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm" />
        <Dialog.Content className="animate-slide-up fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-4 sm:p-5 shadow-2xl dark:bg-slate-900">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-bold text-slate-900 dark:text-white">Xuất báo cáo</Dialog.Title>
              <Dialog.Description className="text-sm text-slate-500 dark:text-slate-400">
                {props.kind === 'speaking-group'
                  ? `${props.topic}: ${props.questions.length} câu hỏi${new Set(props.questions.map((q) => q.id)).size > 1 ? `, gom từ ${new Set(props.questions.map((q) => q.id)).size} lần gợi ý` : ''}. Chọn nội dung, rồi chọn định dạng.`
                  : 'Chọn nội dung, rồi chọn định dạng.'}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Đóng">
              <X className="size-5" />
            </Dialog.Close>
          </div>

          {multi ? (
            <fieldset className="mb-4">
              <legend className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">Câu hỏi</legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['all', `Tất cả (${props.kind === 'speaking' ? props.result.answers.length : 0} câu)`],
                    ['current', `Chỉ câu đang xem (câu ${props.kind === 'speaking' ? props.current + 1 : 1})`],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={cn(
                      'cursor-pointer rounded-lg border px-3 py-1.5 text-sm',
                      scope === value
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                        : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300',
                    )}
                  >
                    <input type="radio" name="report-scope" className="sr-only" checked={scope === value} onChange={() => setScope(value)} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="mb-4">
            <legend className="mb-1.5 flex w-full items-center justify-between text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Nội dung
              <span className="flex gap-2 normal-case">
                <button type="button" className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => setChosen(sections.map((s) => s.key))}>
                  Chọn hết
                </button>
                <button type="button" className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => setChosen(defaults(sections))}>
                  Mặc định
                </button>
              </span>
            </legend>
            <div className="space-y-1">
              {sections.map((s, i) => (
                <label key={s.key} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={keys.includes(s.key)} onChange={() => toggle(s.key)} />
                  <span className="text-slate-700 dark:text-slate-200">
                    <span className="mr-1 text-slate-400 tabular-nums">{i + 1}.</span>
                    {s.label}
                  </span>
                </label>
              ))}
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={showNatural} onChange={() => setShowNatural((v) => !v)} />
                Tô cả cụm “tự nhiên, từ điển chưa liệt kê” (màu xám) trong bài mẫu
              </label>
            </div>
          </fieldset>

          <div className="grid gap-2 sm:grid-cols-3">
            <button type="button" disabled={!keys.length || busy !== null} onClick={() => void exportMarkdown()} className={buttonClass('outline', 'md')}>
              {busy === 'md' ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} Markdown
            </button>
            <button type="button" disabled={!keys.length || busy !== null} onClick={() => void exportWord()} className={buttonClass('outline', 'md')}>
              {busy === 'docx' ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} Word
            </button>
            <button type="button" disabled={!keys.length || busy !== null} onClick={() => void exportPdf()} className={buttonClass('primary', 'md')}>
              {busy === 'pdf' ? <Loader2 className="size-4 animate-spin" /> : <FileType className="size-4" />} PDF
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
