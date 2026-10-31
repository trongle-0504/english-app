import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock,
  ExternalLink,
  FileDown,
  FileText,
  FileType,
  Flame,
  Languages,
  Loader2,
  Newspaper,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { adminApi, refreshSiteData } from '@/features/admin/api'
import { slugify } from '@/features/admin/utils'
import { SpeakButton } from '@/components/SpeakButton'
import { Badge, Button, Card, EmptyState, SearchInput } from '@/components/ui'
import { cn } from '@/lib/cn'
import { stopSpeaking } from '@/lib/speech'
import { useLocalStorage } from '@/lib/storage'
import { formatDate, matchesQuery } from '@/lib/text'
import type { NewsItem, NewsPipelineState } from '@/types/news'
import { DateRangePopover, matchesDateRange, TopicFilterDropdown, type DateRange } from './DateRangeFilter'
import { newsToMarkdown, newsToReportDoc, triggerBlobDownload } from './export-news'

type FilterTab = 'all' | 'popular' | 'done' | 'pending'
type FontSize = 'xs' | 'sm' | 'base'

const FONT_SIZE_CLASS: Record<FontSize, string> = {
  xs: 'text-[13px] leading-snug',
  sm: 'text-sm leading-relaxed',
  base: 'text-[15.5px] leading-relaxed',
}

interface PickedSelection {
  text: string
  contextSentence: string
  rect: { top: number; bottom: number; left: number; width: number }
}

const EDGE_CHARS = /[\s,.;:!?"“”‘’()—–-]/

function readDomSelection(root: HTMLElement | null): PickedSelection | null {
  const sel = window.getSelection()
  if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null

  let raw = sel.toString()
  let start = 0
  let end = raw.length
  while (start < end && EDGE_CHARS.test(raw[start])) start++
  while (end > start && EDGE_CHARS.test(raw[end - 1])) end--
  const text = raw.slice(start, end).replace(/\s+/g, ' ').trim()
  if (text.length < 2 || text.length > 140) return null

  const blockEl = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest('p, h3, li, div')
  const contextSentence = (blockEl?.textContent ?? text).replace(/\s+/g, ' ').trim().slice(0, 360)
  const r = range.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return {
    text,
    contextSentence,
    rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
  }
}

function NewsSelectionMenu({
  articleTitle,
  selection,
  onClose,
}: {
  articleTitle: string
  selection: PickedSelection
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<'' | 'vocab' | 'note' | 'translate'>('')
  const [translatedText, setTranslatedText] = useState<string | null>(null)
  const [done, setDone] = useState<{ tone: 'ok' | 'error'; message: string; href?: string } | null>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const outside = (e: MouseEvent) => !pending && ref.current && !ref.current.contains(e.target as Node) && onClose()
    window.addEventListener('keydown', key)
    window.addEventListener('mousedown', outside)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('mousedown', outside)
    }
  }, [onClose, pending])

  const handleTranslate = async () => {
    setPending('translate')
    setDone(null)
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selection.text, from: 'en', to: 'vi' }),
      })
      if (!res.ok) throw new Error('Không thể dịch đoạn này.')
      const data = (await res.json()) as { translated?: string }
      setTranslatedText(data.translated || 'Không có bản dịch.')
    } catch (err) {
      setDone({ tone: 'error', message: (err as Error).message })
    } finally {
      setPending('')
    }
  }

  const handleAdd = async (target: 'vocab' | 'note') => {
    setPending(target)
    setDone(null)
    try {
      const context = `Ngữ cảnh — trong bài báo Daily Paper "${articleTitle}": ${selection.contextSentence}`
      if (target === 'vocab') {
        const res = await adminApi<{
          action: 'created' | 'updated'
          entry: { word: string }
          placement: { topic: string; subTopic: string }
        }>('vocabulary/generate', {
          method: 'POST',
          body: { word: selection.text, description: context },
        })
        refreshSiteData('vocabulary', 'review')
        const { topic, subTopic } = res.placement
        setDone({
          tone: 'ok',
          message: `"${res.entry.word}" ${res.action === 'created' ? 'đã thêm vào' : 'đã cập nhật trong'} Vocabulary · ${topic} › ${subTopic}`,
          href: `/vocabulary/${slugify(topic)}/${slugify(subTopic)}#${slugify(res.entry.word)}`,
        })
      } else {
        const res = await adminApi<{
          action: 'created' | 'updated'
          note: { id: string; title: string }
        }>('notes/generate', {
          method: 'POST',
          body: { prompt: `${selection.text}\n\n${context}`, type: 'auto' },
        })
        refreshSiteData('notes', 'review')
        setDone({
          tone: 'ok',
          message: `Note "${res.note.title}" ${res.action === 'created' ? 'đã tạo' : 'đã cập nhật'}`,
          href: `/notes#${res.note.id}`,
        })
      }
    } catch (err) {
      setDone({ tone: 'error', message: (err as Error).message })
    } finally {
      setPending('')
    }
  }

  const width = 340
  const left = Math.min(Math.max(8, selection.rect.left + selection.rect.width / 2 - width / 2), window.innerWidth - width - 8)
  const below = selection.rect.bottom + 8
  const top = below + 220 > window.innerHeight ? Math.max(8, selection.rect.top - 225) : below

  return (
    <div
      ref={ref}
      style={{ top, left, width }}
      className="fixed z-50 space-y-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-bold text-slate-900 dark:text-white">“{selection.text}”</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      {translatedText ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-2.5 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <p className="font-semibold text-emerald-700 uppercase tracking-wide text-[10px] dark:text-emerald-300">Bản dịch tiếng Việt:</p>
          <p className="mt-0.5 text-[13px] leading-relaxed select-text">{translatedText}</p>
        </div>
      ) : null}

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          loading={pending === 'translate'}
          disabled={Boolean(pending)}
          onClick={() => void handleTranslate()}
          className="flex-1 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
        >
          <Languages className="size-3.5" /> Dịch nghĩa
        </Button>
      </div>

      <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">Thêm vào thư viện học:</p>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            variant="outline"
            loading={pending === 'vocab'}
            disabled={Boolean(pending)}
            onClick={() => void handleAdd('vocab')}
          >
            <BookOpen className="size-3.5" /> Admin Vocab
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={pending === 'note'}
            disabled={Boolean(pending)}
            onClick={() => void handleAdd('note')}
          >
            <NotebookPen className="size-3.5" /> Note
          </Button>
        </div>
      </div>

      {pending === 'vocab' || pending === 'note' ? (
        <p className="text-[11px] text-slate-500">AI + Longman/OZDIC đang xử lý (15–35 giây)…</p>
      ) : null}

      {done ? (
        <p
          className={cn(
            'rounded-lg px-2.5 py-1.5 text-xs',
            done.tone === 'ok'
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
          )}
        >
          {done.message}
          {done.href ? (
            <Link to={done.href} className="ml-1.5 inline-flex items-center gap-0.5 font-semibold underline">
              Mở <ExternalLink className="size-3" />
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

function itemDateKey(item: NewsItem): string {
  const raw = item.published_at || item.fetched_at
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export default function NewsPage() {
  const [items, setItems] = useState<NewsItem[]>([])
  const [state, setState] = useState<NewsPipelineState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<FilterTab>('all')
  const [topicFilter, setTopicFilter] = useState<string>('all')
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })
  const [query, setQuery] = useState('')

  const [selectedId, setSelectedId] = useState<string>('')
  const [fontSize, setFontSize] = useLocalStorage<FontSize>('news:font-size', 'sm')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileShowReader, setMobileShowReader] = useState(false)

  const [collecting, setCollecting] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState<'md' | 'docx' | 'pdf' | null>(null)
  const readerRef = useRef<HTMLDivElement>(null)
  const [pickedSelection, setPickedSelection] = useState<PickedSelection | null>(null)

  useEffect(() => {
    stopSpeaking()
    return () => stopSpeaking()
  }, [selectedId])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const onSelectionChange = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const next = readDomSelection(readerRef.current)
        if (next) setPickedSelection(next)
      }, 220)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [])

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/news', { cache: 'no-store' })
      if (!res.ok) throw new Error('Không tải được danh sách báo.')
      const data = (await res.json()) as { items?: NewsItem[]; state?: NewsPipelineState }
      const list = data.items ?? []
      setItems(list)
      setState(data.state ?? null)
      setSelectedId((prev) => {
        if (prev && list.some((it) => it.news_id === prev)) return prev
        const firstDone = list.find((it) => it.processing.status === 'done')
        return firstDone?.news_id || list[0]?.news_id || ''
      })
    } catch (err) {
      if (!silent) setError((err as Error).message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData(false)
  }, [loadData])

  // Poll every 4s while background pipeline or any article AI is running
  useEffect(() => {
    const busy = Boolean(state?.running) || processingIds.size > 0 || items.some((it) => it.processing.status === 'in_progress')
    if (!busy) return
    const timer = setInterval(() => {
      void loadData(true)
    }, 4000)
    return () => clearInterval(timer)
  }, [state?.running, processingIds.size, items, loadData])

  const handleCollectNow = async () => {
    if (collecting) return
    setCollecting(true)
    setError(null)
    try {
      const res = await fetch('/api/news/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: 'today', limit: 0, runAiCount: 3 }),
      })
      const data = (await res.json()) as { items?: NewsItem[]; state?: NewsPipelineState; error?: string }
      if (!res.ok) throw new Error(data.error || 'Lỗi khi lấy bài mới từ VnExpress.')
      if (data.items) setItems(data.items)
      if (data.state) setState(data.state)
      if (!selectedId && data.items?.length) setSelectedId(data.items[0].news_id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCollecting(false)
    }
  }

  const handleProcessOne = async (newsId: string) => {
    if (processingIds.has(newsId)) return
    setProcessingIds((prev) => new Set(prev).add(newsId))
    setError(null)
    try {
      const res = await fetch('/api/news/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ news_id: newsId }),
      })
      const data = (await res.json()) as { item?: NewsItem; error?: string }
      if (!res.ok || !data.item) throw new Error(data.error || 'Antigravity CLI gặp lỗi khi dịch bài này.')
      const updated = data.item
      setItems((prev) => prev.map((it) => (it.news_id === updated.news_id ? updated : it)))
    } catch (err) {
      setError((err as Error).message)
      void loadData(true)
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev)
        next.delete(newsId)
        return next
      })
    }
  }

  const handleProcessBatch = async () => {
    if (batchRunning) return
    setBatchRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/news/process-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 5 }),
      })
      const data = (await res.json()) as { items?: NewsItem[]; state?: NewsPipelineState; error?: string }
      if (!res.ok) throw new Error(data.error || 'Lỗi khi chạy batch AI.')
      if (data.items) setItems(data.items)
      if (data.state) setState(data.state)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBatchRunning(false)
    }
  }

  const handleDelete = async (newsId: string) => {
    try {
      const res = await fetch(`/api/news?id=${encodeURIComponent(newsId)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Không xóa được bài báo.')
      const remaining = items.filter((it) => it.news_id !== newsId)
      setItems(remaining)
      if (selectedId === newsId) {
        setSelectedId(remaining[0]?.news_id || '')
        setMobileShowReader(false)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleExport = async (item: NewsItem, kind: 'md' | 'docx' | 'pdf') => {
    if (exporting) return
    setExporting(kind)
    setError(null)
    try {
      const doc = newsToReportDoc(item)
      if (kind === 'md') {
        const md = newsToMarkdown(item)
        triggerBlobDownload(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${doc.fileName}.md`)
      } else if (kind === 'docx') {
        const { toDocxBlob } = await import('@/features/report/to-docx')
        triggerBlobDownload(await toDocxBlob(doc), `${doc.fileName}.docx`)
      } else {
        const res = await fetch('/api/report/pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doc }),
        })
        const json = (await res.json().catch(() => ({}))) as { pdf?: string; error?: string }
        if (!res.ok || !json.pdf) throw new Error(json.error ?? `Máy chủ trả lỗi ${res.status}`)
        const blob = new Blob([Uint8Array.from(atob(json.pdf), (c) => c.charCodeAt(0))], { type: 'application/pdf' })
        triggerBlobDownload(blob, `${doc.fileName}.pdf`)
      }
    } catch (err) {
      setError(`Không tạo được file: ${(err as Error).message}`)
    } finally {
      setExporting(null)
    }
  }

  const counts = useMemo(() => {
    let popular = 0
    let done = 0
    let pending = 0
    for (const it of items) {
      if (it.popularity_rank != null) popular++
      if (it.processing.status === 'done') done++
      else pending++
    }
    return { all: items.length, popular, done, pending }
  }, [items])

  const { dateCountsMap, topicCountsMap } = useMemo(() => {
    const dMap = new Map<string, number>()
    const tMap = new Map<string, number>()
    for (const it of items) {
      const k = itemDateKey(it)
      if (k) dMap.set(k, (dMap.get(k) ?? 0) + 1)
      if (it.ai.topic) tMap.set(it.ai.topic, (tMap.get(it.ai.topic) ?? 0) + 1)
    }
    return { dateCountsMap: dMap, topicCountsMap: tMap }
  }, [items])

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (tab === 'popular' && it.popularity_rank == null) return false
      if (tab === 'done' && it.processing.status !== 'done') return false
      if (tab === 'pending' && it.processing.status === 'done') return false
      if (!matchesDateRange(itemDateKey(it), dateRange)) return false
      if (topicFilter !== 'all' && it.ai.topic !== topicFilter) return false
      if (query.trim()) {
        const vocabText = it.ai.vocabulary.map((v) => `${v.phrase} ${v.meaning_vi}`).join(' ')
        return (
          matchesQuery(it.title, query) ||
          matchesQuery(it.ai.summary ?? undefined, query) ||
          matchesQuery(vocabText, query)
        )
      }
      return true
    })
  }, [items, tab, dateRange, topicFilter, query])

  const selectedItem = items.find((it) => it.news_id === selectedId) ?? filteredItems[0] ?? null
  const textSizeClass = FONT_SIZE_CLASS[fontSize] ?? FONT_SIZE_CLASS.sm

  return (
    <div className="pb-6">
      <title>Daily Paper · Đọc báo song ngữ & Từ vựng IELTS</title>

      {/* Top Header Bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="hidden md:inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/80 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            title={sidebarOpen ? 'Thu gọn danh sách báo' : 'Mở danh sách báo'}
          >
            {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </button>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl dark:text-white">Daily Paper</h1>
          </div>
          <span className="hidden lg:inline text-xs text-slate-400 dark:text-slate-500">
            · VnExpress Daily Reading (Tự động lấy bài: 06:00 · 18:00)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {state?.running && state.current_step ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
              <Loader2 className="size-3.5 animate-spin" />
              <span className="max-w-64 truncate">{state.current_step}</span>
            </span>
          ) : null}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleProcessBatch()}
            disabled={batchRunning || counts.pending === 0}
            className="border-violet-200 bg-violet-50/80 text-violet-700 hover:bg-violet-100 dark:border-violet-800/60 dark:bg-violet-950/50 dark:text-violet-300"
            title="Chạy Antigravity CLI tạo bài tiếng Anh & Vocab cho 5 bài nổi bật đang chờ"
          >
            {batchRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            <span>{batchRunning ? 'Đang chạy AI...' : 'AI Top 5 bài chờ'}</span>
          </Button>

          <Button size="sm" onClick={() => void handleCollectNow()} disabled={collecting}>
            <RefreshCw className={cn('size-3.5', collecting && 'animate-spin')} />
            <span>{collecting ? 'Đang lấy bài...' : 'Lấy báo mới'}</span>
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div
        className={cn(
          'grid gap-3.5',
          sidebarOpen ? 'md:grid-cols-[310px_minmax(0,1fr)] lg:grid-cols-[350px_minmax(0,1fr)]' : 'grid-cols-1',
        )}
      >
        {/* Left Sidebar: Article List */}
        {sidebarOpen ? (
          <Card className={cn('flex flex-col p-3 md:h-[calc(100dvh-8.2rem)]', mobileShowReader && 'hidden md:flex')}>
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm tiêu đề, chủ đề, từ vựng..."
              className="w-full"
            />

            {/* Filter Tabs */}
            <div className="mt-2 flex flex-wrap gap-1">
              {(
                [
                  { id: 'all', label: `Tất cả (${counts.all})` },
                  { id: 'popular', label: `🔥 Xem nhiều (${counts.popular})` },
                  { id: 'done', label: `✨ Có AI (${counts.done})` },
                  { id: 'pending', label: `Chờ (${counts.pending})` },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'rounded-lg px-2 py-1 text-[11px] font-semibold transition',
                    tab === t.id
                      ? 'bg-brand-600 text-white shadow-2xs dark:bg-brand-500 dark:text-slate-950'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800/80 dark:text-slate-300',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Date & Topic Filters */}
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <DateRangePopover
                range={dateRange}
                onChange={setDateRange}
                dateCounts={dateCountsMap}
              />
              <TopicFilterDropdown
                value={topicFilter}
                onChange={setTopicFilter}
                topicCounts={topicCountsMap}
              />
            </div>

            {/* Article List */}
            <div className="mt-2 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-xs text-slate-400">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Đang tải danh sách báo...
                </div>
              ) : filteredItems.length === 0 ? (
                <EmptyState
                  icon={<Newspaper className="size-8" />}
                  title="Chưa có bài báo phù hợp"
                  description='Bấm nút "Lấy báo mới" ở góc trên để tải tin tức hôm nay từ VnExpress.'
                />
              ) : (
                filteredItems.map((item) => {
                  const active = item.news_id === selectedItem?.news_id
                  const isRunning = item.processing.status === 'in_progress' || processingIds.has(item.news_id)
                  const isDone = item.processing.status === 'done'
                  return (
                    <button
                      key={item.news_id}
                      type="button"
                      onClick={() => {
                        setSelectedId(item.news_id)
                        setPickedSelection(null)
                        setMobileShowReader(true)
                      }}
                      className={cn(
                        'w-full rounded-xl border p-2.5 text-left transition-all',
                        active
                          ? 'border-brand-300 bg-brand-50/70 shadow-2xs dark:border-brand-700/70 dark:bg-brand-950/40'
                          : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:border-slate-700 dark:hover:bg-slate-800/50',
                      )}
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        {item.popularity_rank != null ? (
                          <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                            <Flame className="size-2.5 fill-amber-500 text-amber-500" /> #{item.popularity_rank}
                          </span>
                        ) : null}
                        {item.ai.topic ? (
                          <Badge tone="indigo" className="px-1.5 py-0 text-[10px]">
                            {item.ai.topic}
                          </Badge>
                        ) : null}
                        {isRunning ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-950/70 dark:text-violet-300">
                            <Loader2 className="size-2.5 animate-spin" /> Đang dịch AI
                          </span>
                        ) : isDone ? (
                          <span
                            className="inline-flex items-center justify-center rounded-md bg-emerald-100 p-0.5 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300"
                            title="Đã có bản dịch AI"
                          >
                            <CheckCircle2 className="size-3" />
                          </span>
                        ) : null}
                      </div>

                      <h3 className="line-clamp-2 text-xs font-bold leading-snug text-slate-900 dark:text-white">
                        {item.title}
                      </h3>

                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-2.5" />
                          {formatDate(item.published_at || item.fetched_at)}
                        </span>
                        <span>{item.source}</span>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </Card>
        ) : null}

        {/* Right Pane: Article Reader & IELTS Vocabulary */}
        <Card
          className={cn(
            'flex flex-col p-2 sm:p-5 md:h-[calc(100dvh-8.2rem)] overflow-y-auto',
            !mobileShowReader && items.length > 0 && sidebarOpen && 'hidden md:flex',
          )}
        >
          {!selectedItem ? (
            <EmptyState
              icon={<Newspaper className="size-10" />}
              title="Chọn một bài báo để đọc"
              description="Chọn bài báo từ danh sách bên trái để đọc song ngữ Anh – Việt và học từ vựng IELTS."
            />
          ) : (
            <div ref={readerRef} className="space-y-4">
              {pickedSelection ? (
                <NewsSelectionMenu
                  articleTitle={selectedItem.title}
                  selection={pickedSelection}
                  onClose={() => {
                    setPickedSelection(null)
                    window.getSelection()?.removeAllRanges()
                  }}
                />
              ) : null}
              {/* Top Reader Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2.5 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="ghost" size="sm" className="md:hidden -ml-2 h-7 px-2 text-xs" onClick={() => setMobileShowReader(false)}>
                    <ChevronLeft className="size-3.5" /> Danh sách
                  </Button>

                  {/* Font Size Switcher */}
                  <div className="inline-flex items-center rounded-lg bg-slate-200/60 p-0.5 dark:bg-slate-800" title="Cỡ chữ đọc báo">
                    {(
                      [
                        { id: 'xs', label: 'A-' },
                        { id: 'sm', label: 'A' },
                        { id: 'base', label: 'A+' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setFontSize(opt.id)}
                        className={cn(
                          'rounded-md px-1.5 py-0.5 text-[11px] font-bold transition',
                          fontSize === opt.id
                            ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-white'
                            : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right Actions: Run AI, Export, Original Link, Delete */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleProcessOne(selectedItem.news_id)}
                    disabled={processingIds.has(selectedItem.news_id) || selectedItem.processing.status === 'in_progress'}
                    className="h-7 border-violet-200 bg-violet-50/80 px-2.5 text-xs text-violet-700 hover:bg-violet-100 dark:border-violet-800/60 dark:bg-violet-950/50 dark:text-violet-300"
                  >
                    {processingIds.has(selectedItem.news_id) || selectedItem.processing.status === 'in_progress' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    <span>
                      {selectedItem.processing.status === 'done' ? 'Tạo lại AI' : 'Dịch IELTS & Vocab (AI)'}
                    </span>
                  </Button>

                  <DropdownMenu.Root modal={false}>
                    <DropdownMenu.Trigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={exporting !== null}
                        className="h-7 border-brand-200 bg-brand-50/80 px-2.5 text-xs text-brand-700 hover:bg-brand-100 dark:border-brand-800/70 dark:bg-brand-950/50 dark:text-brand-300"
                      >
                        {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
                        <span>Xuất file</span>
                        <ChevronDown className="size-3 opacity-60" />
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        align="end"
                        sideOffset={6}
                        className="animate-scale-in z-50 min-w-44 rounded-xl border border-slate-200/80 bg-white/95 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95"
                      >
                        <DropdownMenu.Item
                          onSelect={() => void handleExport(selectedItem, 'pdf')}
                          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none data-[highlighted]:bg-slate-100 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800"
                        >
                          <FileType className="size-4 text-rose-500" />
                          <span>Xuất PDF (.pdf)</span>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onSelect={() => void handleExport(selectedItem, 'docx')}
                          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none data-[highlighted]:bg-slate-100 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800"
                        >
                          <FileDown className="size-4 text-blue-600" />
                          <span>Xuất Word (.docx)</span>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onSelect={() => void handleExport(selectedItem, 'md')}
                          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none data-[highlighted]:bg-slate-100 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800"
                        >
                          <FileText className="size-4 text-slate-500" />
                          <span>Xuất Markdown (.md)</span>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete(selectedItem.news_id)}
                    className="h-7 px-2 text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-400"
                    title="Xóa bài báo này"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Article Metadata & Title */}
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {selectedItem.popularity_rank != null ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                      <Flame className="size-3 fill-amber-500 text-amber-500" /> Top #{selectedItem.popularity_rank}
                    </span>
                  ) : null}
                  {selectedItem.ai.topic ? <Badge tone="indigo">{selectedItem.ai.topic}</Badge> : null}
                  <span>Đăng lúc: {formatDate(selectedItem.published_at || selectedItem.fetched_at)}</span>
                  <a
                    href={selectedItem.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-brand-200/80 bg-brand-50/70 px-2.5 py-0.5 text-xs font-semibold text-brand-700 transition hover:border-brand-300 hover:bg-brand-100/80 dark:border-brand-800/70 dark:bg-brand-950/50 dark:text-brand-300 dark:hover:bg-brand-900/60"
                    title="Mở bài báo gốc trên VnExpress"
                  >
                    <Newspaper className="size-3" />
                    <span>Đọc bài gốc trên VnExpress</span>
                    <ExternalLink className="size-3 opacity-80" />
                  </a>
                </div>
                <h2 className="text-lg font-extrabold leading-snug text-slate-900 sm:text-xl dark:text-white">
                  {selectedItem.title}
                </h2>
              </div>

              {/* Prompt banner if AI has not processed this article yet */}
              {selectedItem.processing.status !== 'done' ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200/80 bg-violet-50/60 p-3.5 dark:border-violet-900/50 dark:bg-violet-950/30">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-violet-900 dark:text-violet-200">
                      {selectedItem.processing.status === 'in_progress' || processingIds.has(selectedItem.news_id)
                        ? 'Antigravity CLI đang viết bài báo tiếng Anh và lọc từ vựng cho bài này...'
                        : 'Bài báo này hiện mới có bản gốc tiếng Việt'}
                    </p>
                    <p className="text-xs text-violet-700 dark:text-violet-300">
                      {selectedItem.processing.last_error
                        ? `Lỗi lần trước: ${selectedItem.processing.last_error}`
                        : 'Bấm nút bên phải để AI tạo bản tóm tắt, bài đọc tiếng Anh và 15 collocations.'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void handleProcessOne(selectedItem.news_id)}
                    disabled={processingIds.has(selectedItem.news_id) || selectedItem.processing.status === 'in_progress'}
                  >
                    {processingIds.has(selectedItem.news_id) || selectedItem.processing.status === 'in_progress' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    <span>Tạo bản tiếng Anh IELTS & Vocab</span>
                  </Button>
                </div>
              ) : null}

              {/* Executive Summary */}
              {selectedItem.ai.summary ? (
                <div className="rounded-2xl border border-brand-200/80 bg-brand-50/40 p-3.5 dark:border-brand-900/50 dark:bg-brand-950/30">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-extrabold tracking-wider text-brand-700 uppercase dark:text-brand-300">
                      Executive Summary
                    </span>
                    <SpeakButton text={selectedItem.ai.summary} voice="" rate={1} className="-my-1" />
                  </div>
                  <p className={cn('text-left sm:text-justify text-slate-700 dark:text-slate-200', textSizeClass)}>{selectedItem.ai.summary}</p>
                </div>
              ) : null}

              {/* Main Article Body: English Article */}
              {selectedItem.ai.article ? (
                <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-2 sm:p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900/50">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
                      <Languages className="size-3.5" /> English Article
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="hidden text-[11px] text-slate-400 sm:inline">
                        Bôi đen cụm từ bất kỳ để thêm vào Admin Vocab / Note
                      </span>
                      <SpeakButton text={selectedItem.ai.article.replace(/^#{1,4}\s+/gm, '')} voice="" rate={1} className="-my-1" />
                    </div>
                  </div>
                  <div className={cn('space-y-3', textSizeClass)}>
                    {selectedItem.ai.article
                      .replace(/\r\n/g, '\n')
                      .split(/\n\n+/)
                      .map((rawPara, idx) => {
                        const para = rawPara.trim()
                        if (!para) return null
                        if (/^#{1,4}\s+/.test(para)) {
                          return (
                            <h3 key={idx} className="text-base font-extrabold text-slate-900 sm:text-lg dark:text-white">
                              {para.replace(/^#{1,4}\s+/, '')}
                            </h3>
                          )
                        }
                        return (
                          <p key={idx} className="text-left sm:text-justify text-slate-800 dark:text-slate-100">
                            {para}
                          </p>
                        )
                      })}
                  </div>
                </div>
              ) : null}

              {/* IELTS Vocabulary Section */}
              {selectedItem.ai.vocabulary.length > 0 ? (
                <div className="rounded-2xl border border-slate-200/80 bg-white p-2 sm:p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900/50">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <BookOpen className="size-4 text-brand-600 dark:text-brand-400" />
                      <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                        Từ vựng & Collocation trong bài
                      </h3>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Bôi đen từ hoặc cụm bất kỳ để lưu vào Admin Vocab / Note
                    </span>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {selectedItem.ai.vocabulary.map((v, idx) => (
                      <div
                        key={`${v.phrase}-${idx}`}
                        className="flex flex-col justify-between rounded-xl border border-slate-200/70 bg-slate-50/50 p-2.5 transition hover:border-amber-300 hover:bg-amber-50/40 dark:border-slate-800 dark:bg-slate-900/40"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-1.5">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                              {idx + 1}. {v.phrase}
                            </span>
                            <SpeakButton text={v.phrase} voice="" rate={1} className="-my-1 shrink-0" />
                          </div>
                          <p className="ipa mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">{v.ipa}</p>
                        </div>
                        <p className="mt-1.5 text-xs font-medium text-brand-700 dark:text-brand-300">{v.meaning_vi}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
