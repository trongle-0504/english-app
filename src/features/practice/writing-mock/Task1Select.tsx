import { CheckCircle2, FileText, ImageIcon, RotateCcw } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Badge, Button, Card, EmptyState, PageHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { WritingTask1ExtrasMap, WritingTask1Index, WritingTask1Prompt } from '@/types/writingMock'
import type { WritingReviewSummary } from '@/types/writingReview'
import { examDate } from './api'
import { DoneStatus, doneCardClass } from './DoneStatus'
import { ListToolbar } from './ListToolbar'

type Status = 'all' | 'done' | 'todo'
type Picture = 'all' | 'with' | 'without'


/** The Task 1 question list: filters, search, a random pick, and each question's done status. */
export function Task1Select({
  index,
  extras,
  attemptsByPrompt,
  onOpen,
  taskSwitch,
}: {
  index: WritingTask1Index
  extras: WritingTask1ExtrasMap
  /** Reviews per question id, newest first. */
  attemptsByPrompt: Map<string, WritingReviewSummary[]>
  onOpen: (prompt: WritingTask1Prompt) => void
  taskSwitch?: ReactNode
}) {
  const [chartType, setChartType] = useState('all')
  const [typeName, setTypeName] = useState('all')
  const [status, setStatus] = useState<Status>('all')
  const [picture, setPicture] = useState<Picture>('all')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return index.prompts.filter((p) => {
      const done = attemptsByPrompt.has(p.id)
      const hasPicture = (extras[p.id]?.images ?? 0) > 0
      return (
        (chartType === 'all' || p.chart_type === chartType) &&
        (typeName === 'all' || p.type_name === typeName) &&
        (status === 'all' || (status === 'done') === done) &&
        (picture === 'all' || (picture === 'with') === hasPicture) &&
        (!q || `${p.id} ${p.title} ${p.prompt} ${p.chart_type} ${p.type_name}`.toLowerCase().includes(q))
      )
    })
  }, [attemptsByPrompt, chartType, extras, index.prompts, picture, query, status, typeName])

  const random = () => {
    const pool = filtered.length ? filtered : index.prompts
    const pick = pool[Math.floor(Math.random() * pool.length)]
    if (pick) onOpen(pick)
  }

  return (
    <div className="mx-auto max-w-6xl pb-16">
      <PageHeader eyebrow="Writing" title="Writing Mock Test" actions={taskSwitch} />
      <ListToolbar
        query={query}
        onQuery={setQuery}
        onRandom={random}
        randomDisabled={!index.prompts.length}
        filters={[
          {
            label: 'Loại biểu đồ',
            value: chartType,
            onChange: setChartType,
            options: [{ value: 'all', label: 'Tất cả biểu đồ' }, ...index.chartTypes.map((v) => ({ value: v, label: v }))],
          },
          {
            label: 'Dạng đề',
            value: typeName,
            onChange: setTypeName,
            options: [{ value: 'all', label: 'Tất cả dạng đề' }, ...index.typeNames.map((v) => ({ value: v, label: v }))],
          },
          {
            label: 'Trạng thái',
            value: status,
            onChange: (v) => setStatus(v as Status),
            options: [
              { value: 'all', label: 'Đã làm & chưa làm' },
              { value: 'done', label: 'Đã làm' },
              { value: 'todo', label: 'Chưa làm' },
            ],
          },
          {
            label: 'Hình biểu đồ',
            value: picture,
            onChange: (v) => setPicture(v as Picture),
            options: [
              { value: 'all', label: 'Có & chưa có hình' },
              { value: 'with', label: 'Đã có hình' },
              { value: 'without', label: 'Chưa có hình' },
            ],
          },
        ]}
      />
      <div>
        <main className="min-w-0">
          <div className="space-y-3">
            {filtered.map((item) => {
              const attempts = attemptsByPrompt.get(item.id) ?? []
              const latest = attempts[0]
              const added = extras[item.id]
              const date = examDate(item.title)
              return (
                <Card key={item.id} className={cn('p-4 transition-shadow hover:shadow-md sm:p-5', latest && doneCardClass)}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge tone="violet">{item.chart_type}</Badge>
                        {item.type_name ? <Badge tone="slate">{item.type_name}</Badge> : null}
                        {added?.images ? (
                          <Badge tone="sky">
                            <ImageIcon className="mr-1 inline size-3" />
                            {added.images} hình
                          </Badge>
                        ) : (
                          <Badge tone="amber">Chưa có hình</Badge>
                        )}
                        {added?.hasModel ? <Badge tone="emerald">Có bài mẫu</Badge> : null}
                        {date ? <Badge tone="slate">Đề {date}</Badge> : null}
                      </div>
                      <p className="text-[15px] leading-relaxed text-slate-700 sm:text-base dark:text-slate-300">{item.prompt}</p>
                      <DoneStatus attempts={attempts} />
                    </div>
                    {latest ? (
                      <div className="flex flex-wrap gap-2 self-start">
                        <Button size="sm" onClick={() => onOpen(item)}>
                          <RotateCcw className="size-4" /> Làm lại
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => (window.location.href = `/practice/writing-review?id=${latest.id}`)}>
                          <CheckCircle2 className="size-4" /> Xem kết quả
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" className="self-start" onClick={() => onOpen(item)}>
                        <FileText className="size-4" /> Vào làm bài
                      </Button>
                    )}
                  </div>
                </Card>
              )
            })}
            {!filtered.length ? <EmptyState title="Không tìm thấy đề phù hợp" description="Hãy đổi từ khóa hoặc bộ lọc." /> : null}
          </div>
        </main>
      </div>
    </div>
  )
}
