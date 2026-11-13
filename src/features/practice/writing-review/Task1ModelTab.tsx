import { BookOpenCheck, Check, ExternalLink, GitCompare, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button } from '@/components/ui'
import type { WritingTask1Extras } from '@/types/writingMock'
import type { WritingReviewResult, WritingTask1CompareArea, WritingTask1VocabCategory, WritingTask1VocabItem } from '@/types/writingReview'
import { PhraseReviewButton } from '../PhraseReview'
import { LibraryAddButtons } from '../speaking-ideas/SuggestionResult'
import { task1Api } from '../writing-mock/api'
import { ModelEssayBox } from '../writing-mock/ModelEssayBox'
import { writingReviewApi } from './api'

const AREA: Record<WritingTask1CompareArea, string> = {
  intro: 'Mở bài',
  overview: 'Overview',
  grouping: 'Cách nhóm số liệu',
  comparison: 'Câu so sánh',
  data: 'Số liệu',
  language: 'Từ ngữ',
}

export const VOCAB_CATEGORY: Record<WritingTask1VocabCategory, string> = {
  trend: 'Xu hướng',
  comparison: 'So sánh',
  proportion: 'Tỉ lệ',
  approximation: 'Ước lượng',
  overview: 'Overview',
  sequence: 'Trình tự / nối ý',
  other: 'Khác',
}

const QUOTE = 'border-l-2 pl-2.5 text-sm italic'

/** Tab "So với bài mẫu": what the answer can learn from the learner's own model essay. */
export function Task1CompareTab({
  result,
  running,
  onUpdate,
}: {
  result: WritingReviewResult
  running?: boolean
  onUpdate: (result: WritingReviewResult) => void
}) {
  const [extras, setExtras] = useState<WritingTask1Extras | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const promptId = result.promptId

  useEffect(() => {
    if (!promptId) return
    let live = true
    task1Api
      .prompt(promptId)
      .then(({ extras: next }) => live && setExtras(next))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [promptId])

  const compare = async () => {
    setBusy(true)
    setError('')
    try {
      const { result: next } = await writingReviewApi.task1Compare(result.id)
      onUpdate(next)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (result.pending?.includes('compare')) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <Loader2 className="size-4 animate-spin text-brand-600" /> Đang so sánh với bài mẫu của bạn…
      </p>
    )
  }

  const lesson = result.task1Model
  const hasModel = Boolean(extras?.modelEssay?.text)
  const edited = Boolean(lesson && extras?.modelEssay && extras.modelEssay.updatedAt !== lesson.modelUpdatedAt)
  const box = promptId ? (
    <ModelEssayBox key={promptId} promptId={promptId} extras={extras} onSaved={setExtras} defaultOpen={!lesson} className="mt-6" />
  ) : null
  const button = (label: string, icon: React.ReactNode) => (
    <Button onClick={() => void compare()} loading={busy} disabled={busy || running || !hasModel}>
      {icon} {label}
    </Button>
  )

  if (!lesson?.comparison) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Đề này chưa có bài mẫu lúc chấm. Dán bài mẫu bạn có (từ sách, trang luyện thi…) vào ô dưới, rồi bấm "So sánh với bài mẫu": AI chỉ ra
          điểm bài bạn học được từ bài mẫu (mở bài, overview, cách nhóm số liệu, câu so sánh…) và chọn từ vựng đáng học.
        </p>
        {box}
        <div className="flex flex-wrap items-center gap-2">
          {button('So sánh với bài mẫu', <GitCompare className="size-4" />)}
          {busy ? <span className="text-xs text-slate-500">Có thể mất 30–60 giây (tra từ điển các cụm từ)…</span> : null}
        </div>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </div>
    )
  }

  const { comparison } = lesson
  return (
    <div className="space-y-5">
      {edited ? (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> Bài mẫu đã được sửa sau lần so sánh này. Bấm "So sánh lại" để cập nhật.
        </p>
      ) : null}
      {comparison.summary ? <p className="text-[15px] font-medium text-slate-800 dark:text-slate-100">{comparison.summary}</p> : null}
      <ol className="space-y-4">
        {comparison.points.map((p, i) => (
          <li key={i} className="space-y-2 border-b border-slate-100 pb-4 last:border-b-0 dark:border-slate-800">
            <Badge tone="violet">{AREA[p.area]}</Badge>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">Bài của bạn</p>
                {p.yours ? (
                  <p className={`${QUOTE} border-rose-300 text-slate-700 dark:border-rose-800 dark:text-slate-300`}>{p.yours}</p>
                ) : (
                  <p className="text-sm text-slate-400">(bài của bạn chưa có phần này)</p>
                )}
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">Bài mẫu</p>
                <p className={`${QUOTE} border-emerald-300 text-slate-700 dark:border-emerald-800 dark:text-slate-300`}>{p.model}</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">{p.why}</p>
            {p.try ? (
              <p className="text-sm text-brand-700 dark:text-brand-300">
                <span className="font-semibold">Thử viết lại: </span>
                {p.try}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="text-xs text-slate-500">
        Bài mẫu {lesson.modelWords} từ · lưu lúc {new Date(lesson.modelUpdatedAt).toLocaleString('vi-VN')}
      </p>
      {box}
      <div className="flex flex-wrap items-center gap-2">
        {button('So sánh lại', <RefreshCw className="size-4" />)}
        {error ? <span className="text-sm text-rose-600">{error}</span> : null}
      </div>
    </div>
  )
}

function VocabCard({ item }: { item: WritingTask1VocabItem }) {
  return (
    <li className="space-y-2 border-b border-slate-100 py-3 last:border-b-0 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-slate-900 dark:text-white">{item.phrase}</p>
        {item.used ? (
          <Badge tone="emerald">
            <Check className="mr-0.5 inline size-3" />
            Bạn đã dùng
          </Badge>
        ) : null}
        {!item.verified ? <Badge tone="amber">Chưa xác nhận bằng từ điển</Badge> : null}
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">{item.meaning_vi}</p>
      {item.example ? <p className="border-l-2 border-brand-300 pl-2.5 text-xs italic text-slate-600 dark:border-brand-700 dark:text-slate-400">{item.example}</p> : null}
      {item.dictionary[0] || item.sources.length ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
          {item.dictionary[0] ? <span>{item.dictionary[0]}</span> : null}
          {item.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-600 hover:underline">
              {s.name} <ExternalLink className="size-3" />
            </a>
          ))}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-1 dark:border-slate-800/80">
        <PhraseReviewButton
          term={item.phrase}
          group="extra"
          meaning_vi={item.meaning_vi}
          example={item.example}
          phrase={{ group: 'extra', verified: item.verified, dictionary: item.dictionary, sources: item.sources }}
        />
        <LibraryAddButtons phrase={item.phrase} meaning_vi={item.meaning_vi} example={item.example || item.phrase} />
      </div>
    </li>
  )
}

/** "Từ vựng đáng học từ bài mẫu", grouped by category. */
export function Task1ModelVocab({ result }: { result: WritingReviewResult }) {
  const vocab = result.task1Model?.vocab ?? []
  if (result.pending?.includes('compare')) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <Loader2 className="size-4 animate-spin text-brand-600" /> Đang chọn từ vựng từ bài mẫu…
      </p>
    )
  }
  if (!vocab.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <BookOpenCheck className="size-4" /> Chưa có bài mẫu: thêm bài mẫu ở tab "So với bài mẫu" để có từ vựng đáng học.
      </p>
    )
  }
  const groups = (Object.keys(VOCAB_CATEGORY) as WritingTask1VocabCategory[])
    .map((c) => ({ c, items: vocab.filter((v) => v.category === c) }))
    .filter((g) => g.items.length)
  return (
    <div className="space-y-5">
      {groups.map(({ c, items }) => (
        <div key={c}>
          <p className="text-xs font-bold uppercase text-slate-500">{VOCAB_CATEGORY[c]}</p>
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {items.map((item) => (
              <VocabCard key={item.phrase} item={item} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
