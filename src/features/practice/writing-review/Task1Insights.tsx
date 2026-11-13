import { AlertTriangle, BarChart3, Check, ChevronDown, Languages, ListChecks, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui'
import type { WritingTask1Image } from '@/types/writingMock'
import type { WritingReviewResult, WritingTask1Review } from '@/types/writingReview'
import { task1Api } from '../writing-mock/api'
import { ChartImages } from '../writing-mock/ChartImages'

const OVERVIEW: Record<WritingTask1Review['overview']['status'], { label: string; tone: 'emerald' | 'amber' | 'rose' }> = {
  clear: { label: 'Overview rõ', tone: 'emerald' },
  unclear: { label: 'Overview chưa rõ', tone: 'amber' },
  missing: { label: 'Thiếu overview', tone: 'rose' },
}

function Block({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  )
}

function List({ items, mark }: { items: string[]; mark: 'ok' | 'miss' | 'wrong' }) {
  if (!items.length) return null
  return (
    <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5">
          {mark === 'ok' ? (
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          ) : mark === 'wrong' ? (
            <X className="mt-0.5 size-4 shrink-0 text-rose-600" />
          ) : (
            <span className="mt-0.5 size-4 shrink-0 text-center font-bold text-amber-600">–</span>
          )}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** "Đề và biểu đồ": the pictures (loaded when opened) and what the agent read from them. */
function ChartSection({ result }: { result: WritingReviewResult }) {
  const [open, setOpen] = useState(false)
  const [images, setImages] = useState<WritingTask1Image[] | null>(null)
  const chart = result.task1?.chart
  useEffect(() => {
    if (!open || images || !result.promptId) return
    let live = true
    task1Api
      .prompt(result.promptId)
      .then(({ extras }) => live && setImages(extras.images))
      .catch(() => live && setImages([]))
    return () => {
      live = false
    }
  }, [images, open, result.promptId])
  return (
    <details className="group rounded-xl border border-slate-200 dark:border-slate-700" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm font-bold text-slate-900 dark:text-white [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <BarChart3 className="size-4 text-brand-600" /> Đề và biểu đồ
        </span>
        <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-slate-200 p-3 dark:border-slate-700">
        {result.prompt ? <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">{result.prompt}</p> : null}
        {open ? images ? <ChartImages images={images} /> : <p className="text-xs text-slate-500">Đang tải hình…</p> : null}
        {chart ? (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-slate-900 dark:text-white">Biểu đồ nói gì</p>
            <p className="text-slate-600 dark:text-slate-300">
              {chart.kind}: {chart.subject}
              {chart.unit ? ` (${chart.unit})` : ''}
              {chart.period ? ` · ${chart.period}` : ''}
            </p>
            {chart.overview.length ? (
              <ul className="list-disc space-y-0.5 pl-5 text-slate-700 dark:text-slate-300">
                {chart.overview.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            ) : null}
            {chart.keyFeatures.length ? (
              <>
                <p className="pt-1 text-xs font-bold uppercase text-slate-500">Đặc điểm chính</p>
                <ul className="list-disc space-y-0.5 pl-5 text-slate-700 dark:text-slate-300">
                  {chart.keyFeatures.map((k, i) => <li key={i}>{k}</li>)}
                </ul>
              </>
            ) : null}
            {chart.figures.length ? (
              <details className="text-xs">
                <summary className="cursor-pointer font-semibold text-slate-500">Số liệu AI đọc được ({chart.figures.length})</summary>
                <div className="mt-1 grid gap-x-4 gap-y-0.5 text-slate-600 sm:grid-cols-2 dark:text-slate-300">
                  {chart.figures.map((f, i) => (
                    <span key={i}>
                      {f.label}: <span className="font-semibold tabular-nums">{f.value}</span>
                    </span>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  )
}

/** The Task 1 checks under the band card: chart, overview and key features, wrong figures, the plan against the chart. */
export function Task1Insights({ result, onScrollToSentence }: { result: WritingReviewResult; onScrollToSentence: (i: number) => void }) {
  const t = result.task1
  if (!t) return result.task === 1 && result.promptId ? <div className="mb-6"><ChartSection result={result} /></div> : null
  const overview = OVERVIEW[t.overview.status]
  return (
    <section className="mb-8 space-y-5 border-b border-slate-100 pb-6 dark:border-slate-800">
      <ChartSection result={result} />
      {t.noChart ? (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Bài này chấm khi đề chưa có hình biểu đồ: Task Achievement được ước lượng theo nội dung đề, số liệu không được kiểm tra.
        </p>
      ) : null}

      <Block title="Overview và đặc điểm chính" icon={<ListChecks className="size-4 text-brand-600" />}>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <Badge tone={overview.tone}>{overview.label}</Badge>
          {t.overview.note}
        </p>
        {t.keyFeatures.covered.length ? (
          <>
            <p className="text-xs font-bold uppercase text-slate-500">Đã nêu</p>
            <List items={t.keyFeatures.covered} mark="ok" />
          </>
        ) : null}
        {t.keyFeatures.missed.length ? (
          <>
            <p className="text-xs font-bold uppercase text-slate-500">Còn thiếu</p>
            <List items={t.keyFeatures.missed} mark="miss" />
          </>
        ) : null}
      </Block>

      {t.dataErrors.length ? (
        <Block title="Số liệu sai so với biểu đồ" icon={<AlertTriangle className="size-4 text-rose-600" />}>
          <ul className="space-y-2">
            {t.dataErrors.map((e, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onScrollToSentence(e.sentence)}
                  className="w-full border-l-2 border-rose-300 pl-2.5 text-left text-sm hover:border-brand-400 dark:border-rose-800"
                >
                  <span className="text-slate-400">Câu {e.sentence + 1} · </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">“{e.quote}”</span>
                  <span className="block text-slate-600 dark:text-slate-400">Bạn viết: {e.wrote}</span>
                  <span className="block text-emerald-700 dark:text-emerald-400">Biểu đồ: {e.correct}</span>
                </button>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {t.ideaCheck ? (
        <Block title="Ý tưởng tiếng Việt so với biểu đồ" icon={<Languages className="size-4 text-brand-600" />}>
          {t.ideaCheck.summary ? <p className="text-sm text-slate-700 dark:text-slate-300">{t.ideaCheck.summary}</p> : null}
          {t.ideaCheck.matched.length ? (
            <>
              <p className="text-xs font-bold uppercase text-slate-500">Đúng với biểu đồ</p>
              <List items={t.ideaCheck.matched} mark="ok" />
            </>
          ) : null}
          {t.ideaCheck.wrong.length ? (
            <>
              <p className="text-xs font-bold uppercase text-slate-500">Sai so với biểu đồ</p>
              <List items={t.ideaCheck.wrong} mark="wrong" />
            </>
          ) : null}
          {t.ideaCheck.missing.length ? (
            <>
              <p className="text-xs font-bold uppercase text-slate-500">Còn thiếu</p>
              <List items={t.ideaCheck.missing} mark="miss" />
            </>
          ) : null}
        </Block>
      ) : null}
    </section>
  )
}
