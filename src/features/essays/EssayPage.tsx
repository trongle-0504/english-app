import { ArrowLeft, BookOpenText, Brain, PenLine, Repeat2 } from 'lucide-react'
import { startTransition, useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import { ButtonLink, PageHeader, SegmentedControl } from '@/components/ui'
import { invalidateData, onDataInvalidated, useData } from '@/lib/data'
import { useQueryParam } from '@/lib/useQueryParam'
import type { Essay, EssayDoc } from '@/types/essays'
import { useReviewCards } from './api'
import { ReadTab } from './ReadTab'
import { RecallTab } from './RecallTab'
import { RebuildTab, TransferTab } from './WriteTabs'

type Tab = 'read' | 'recall' | 'rebuild' | 'use'

const TABS: { value: Tab; label: string; icon: React.ReactNode; hint: string }[] = [
  { value: 'read', label: '1 · Đọc', icon: <BookOpenText className="size-4" />, hint: 'Nhận ra cụm hay, cấu trúc và cách paraphrase' },
  { value: 'recall', label: '2 · Nhớ lại', icon: <Brain className="size-4" />, hint: 'Điền chỗ trống ngay trên bài, dịch ngược câu' },
  { value: 'rebuild', label: '3 · Viết lại đoạn', icon: <Repeat2 className="size-4" />, hint: 'Viết lại một đoạn từ dàn ý, AI nhận xét' },
  { value: 'use', label: '4 · Dùng vào đề mới', icon: <PenLine className="size-4" />, hint: 'Đoạn 3–4 câu cho đề mới với 5 cụm mục tiêu' },
]

export default function EssayPage() {
  const { essayId = '' } = useParams()
  const loaded = useData<EssayDoc>(`essays/${essayId}.json`)
  // After adding or removing an item the server's copy is shown at once; the rebuilt /data document is fetched in a
  // transition, so the page never falls back to its loading skeleton.
  const [edited, setEdited] = useState<{ id: string; essay: EssayDoc } | null>(null)
  const essay = edited?.id === loaded.id ? edited.essay : loaded
  const [, setVersion] = useState(0)
  // Content edits (this page's own, or Admin's) drop cached /data: refetch in a transition so the page stays up.
  useEffect(() => onDataInvalidated(() => startTransition(() => setVersion((v) => v + 1))), [])
  const onEssayChange = (next: Essay) => {
    setEdited({ id: next.id, essay: { ...next, related: essay.related } })
    // After this render has committed: drop the cached document and refetch it in a transition (old UI stays up).
    setTimeout(() =>
      startTransition(() => {
        invalidateData(`essays/${next.id}.json`)
        setVersion((v) => v + 1)
      }),
    )
  }
  const review = useReviewCards()
  const [tabParam, setTab] = useQueryParam('tab')
  const [selected, setSelected] = useQueryParam('item')
  const tab = (TABS.some((t) => t.value === tabParam) ? tabParam : 'read') as Tab
  const location = useLocation()

  // Review cards link to /practice/essays/<id>#<item>: open that item.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.replace(/^#/, ''))
    if (id && essay.items.some((i) => i.id === id)) setSelected(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [essay.id])

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={`Model essay · ${essay.topic}`}
        title={essay.title}
        description={TABS.find((t) => t.value === tab)?.hint}
        actions={
          <ButtonLink to="/practice/essays" variant="ghost" size="sm">
            <ArrowLeft className="size-4" /> Library
          </ButtonLink>
        }
      />
      <SegmentedControl value={tab} onChange={(v) => setTab(v === 'read' ? '' : v)} options={TABS.map((t) => ({ value: t.value, label: t.label, icon: t.icon }))} className="mb-5 flex-wrap" />
      {tab === 'read' ? <ReadTab essay={essay} review={review} selectedId={selected} onSelect={setSelected} onEssayChange={onEssayChange} /> : null}
      {tab === 'recall' ? <RecallTab essay={essay} review={review} /> : null}
      {tab === 'rebuild' ? <RebuildTab essay={essay} review={review} /> : null}
      {tab === 'use' ? <TransferTab essay={essay} review={review} /> : null}
    </div>
  )
}
