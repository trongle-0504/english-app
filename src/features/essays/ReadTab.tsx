import { Eye, EyeOff, Languages, ListTree, Pause, Play, Plus, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Badge, Button, Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { speak, stopSpeaking } from '@/lib/speech'
import { useLocalStorage } from '@/lib/storage'
import { ESSAY_ITEM_KINDS, itemCardId, type Essay, type EssayDoc, type EssayItem, type EssayItemKind } from '@/types/essays'
import type { ReviewCards } from './api'
import { ItemPanel } from './ItemPanel'
import { KIND_META, primaryItem, ROLE_LABEL, segments } from './lib'
import { SelectionMenu, type TextSelection } from './SelectionMenu'

/** The task with the parts the essay paraphrases highlighted (click = open that paraphrase). */
function TaskPrompt({ essay, onSelect }: { essay: EssayDoc; onSelect: (item: EssayItem) => void }) {
  const paraphrases = essay.items.filter((i) => i.kind === 'paraphrase' && i.source)
  const lower = essay.prompt.toLowerCase()
  const marks = paraphrases
    .map((item) => ({ item, at: lower.indexOf(item.source!.toLowerCase()) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at)
  const parts: ReactNode[] = []
  let cursor = 0
  for (const { item, at } of marks) {
    if (at < cursor) continue
    parts.push(essay.prompt.slice(cursor, at))
    parts.push(
      <button key={item.id} type="button" onClick={() => onSelect(item)} className={cn('rounded px-0.5', KIND_META.paraphrase.mark)}>
        {essay.prompt.slice(at, at + item.source!.length)}
      </button>,
    )
    cursor = at + item.source!.length
  }
  parts.push(essay.prompt.slice(cursor))
  return <p className="text-[15px] leading-relaxed text-slate-700 italic dark:text-slate-300">{parts}</p>
}

/** Characters trimmed from both ends of a selection. */
const EDGE = /[\s,.;:!?"“”‘’()—–-]/

/** The selected text as a sentence index and character range, when it lies inside one sentence of `root`. */
function readSelection(root: HTMLElement | null): TextSelection | null {
  const sel = window.getSelection()
  if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  const sentenceOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-sentence]')
  const a = sentenceOf(range.startContainer)
  const b = sentenceOf(range.endContainer)
  if (!a || a !== b || !root.contains(a)) return null
  const offset = (node: Node, at: number) => {
    const r = document.createRange()
    r.setStart(a, 0)
    r.setEnd(node, at)
    return r.toString().length
  }
  const full = a.textContent ?? ''
  let start = offset(range.startContainer, range.startOffset)
  let end = offset(range.endContainer, range.endOffset)
  while (start < end && EDGE.test(full[start])) start++
  while (end > start && EDGE.test(full[end - 1])) end--
  if (end - start < 2) return null
  const rect = range.getBoundingClientRect()
  return { sentence: Number(a.dataset.sentence), start, end, text: full.slice(start, end), rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width } }
}

export function ReadTab({
  essay,
  review,
  selectedId,
  onSelect,
  onEssayChange,
}: {
  essay: EssayDoc
  review: ReviewCards
  selectedId: string
  onSelect: (id: string) => void
  onEssayChange: (essay: Essay) => void
}) {
  const textRef = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<TextSelection | null>(null)
  // Selecting text (mouse or touch) opens the "add this phrase" menu; a collapsed selection leaves an open menu alone.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const onChange = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const next = readSelection(textRef.current)
        if (next) setPicked(next)
      }, 250)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', onChange)
    }
  }, [])
  const [layers, setLayers] = useLocalStorage<EssayItemKind[]>('essays:layers', ['collocation', 'vocabulary', 'paraphrase', 'linking', 'frame'])
  const [structure, setStructure] = useLocalStorage('essays:structure', false)
  const [translate, setTranslate] = useLocalStorage('essays:translate', false)
  const [hideKnown, setHideKnown] = useLocalStorage('essays:hide-known', true)
  const [playing, setPlaying] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  useEffect(() => stopSpeaking, [])

  const selected = essay.items.find((i) => i.id === selectedId)
  const visible = useMemo(
    () => essay.items.filter((i) => layers.includes(i.kind) && !(hideKnown && review.status(itemCardId(essay, i)) === 'known')),
    [essay, layers, hideKnown, review],
  )
  const count = (kind: EssayItemKind) => essay.items.filter((i) => i.kind === kind).length
  const toggle = (kind: EssayItemKind) => setLayers(layers.includes(kind) ? layers.filter((k) => k !== kind) : [...layers, kind])

  const playParagraph = (index: number) => {
    if (playing === index) {
      stopSpeaking()
      setPlaying(null)
      return
    }
    const text = essay.paragraphs[index].sentences.map((i) => essay.sentences[i].text).join(' ')
    setPlaying(index)
    speak(text, { rate: 0.95, onEnd: () => setPlaying((p) => (p === index ? null : p)) })
  }

  const unlearned = [...new Set(essay.items.filter((i) => i.kind === 'collocation' || i.kind === 'vocabulary').map((i) => itemCardId(essay, i)))].filter(
    (id) => !review.cards?.[id],
  )
  const known = [...new Set(essay.items.map((i) => itemCardId(essay, i)))].filter((id) => review.status(id) === 'known').length

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0 space-y-4">
        <Card className="p-4 sm:p-5">
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">Đề bài</p>
          <TaskPrompt essay={essay} onSelect={(item) => onSelect(item.id)} />
        </Card>

        <div className="flex flex-wrap items-center gap-1.5">
          {ESSAY_ITEM_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => toggle(kind)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
                layers.includes(kind)
                  ? 'border-slate-300 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
                  : 'border-transparent bg-slate-100 text-slate-400 dark:bg-slate-800/60',
              )}
            >
              <span className={cn('size-2.5 rounded-full', KIND_META[kind].swatch, !layers.includes(kind) && 'opacity-30')} />
              {KIND_META[kind].plural} <span className="tabular-nums opacity-60">{count(kind)}</span>
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
          <Button size="sm" variant={structure ? 'secondary' : 'ghost'} onClick={() => setStructure(!structure)}>
            <ListTree className="size-4" /> Cấu trúc
          </Button>
          <Button size="sm" variant={translate ? 'secondary' : 'ghost'} onClick={() => setTranslate(!translate)}>
            <Languages className="size-4" /> Tiếng Việt
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setHideKnown(!hideKnown)} title="Cụm đã thuộc (trong Review) không được tô màu">
            {hideKnown ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {hideKnown ? 'Ẩn cụm đã thuộc' : 'Hiện cả cụm đã thuộc'}
          </Button>
        </div>

        <p className="-mb-1 text-xs text-slate-400">Mẹo: bôi đen một cụm Gemini bỏ sót để thêm vào bài này, hoặc gửi sang Admin Vocabulary / Notes.</p>
        <Card className="space-y-6 p-4 sm:p-7" ref={textRef}>
          {essay.paragraphs.map((paragraph, p) => (
            <section key={p}>
              <div className="mb-1.5 flex items-center gap-2">
                <h3 className="text-xs font-bold tracking-wide text-brand-700 uppercase dark:text-brand-400">{paragraph.role}</h3>
                <button
                  type="button"
                  onClick={() => playParagraph(p)}
                  className="relative hit-area rounded-full p-1 text-slate-400 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950/50"
                  aria-label={playing === p ? 'Stop' : 'Read paragraph aloud'}
                >
                  {playing === p ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </button>
              </div>
              <div className={cn('text-[16.5px] leading-[1.95] text-slate-800 dark:text-slate-100', translate && 'space-y-2')}>
                {paragraph.sentences.map((s) => {
                  const sentence = essay.sentences[s]
                  const items = visible.filter((i) => i.sentence === s)
                  return (
                    <span key={s} className={cn(translate && 'block')}>
                      {structure ? (
                        <span className="mr-1 inline-block rounded bg-slate-100 px-1.5 align-[2px] text-[10.5px] leading-4 font-semibold text-slate-500 uppercase dark:bg-slate-800 dark:text-slate-400">
                          {ROLE_LABEL[sentence.role]}
                        </span>
                      ) : null}
                      <span data-sentence={s}>
                      {segments(sentence.text, items).map((seg, n) => {
                        if (!seg.items.length) return <span key={n}>{seg.text}</span>
                        const item = primaryItem(seg.items)
                        const active = seg.items.some((i) => i.id === selectedId)
                        return (
                          <span
                            key={n}
                            role="button"
                            tabIndex={0}
                            onClick={() => window.getSelection()?.isCollapsed !== false && onSelect(item.id)}
                            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(item.id))}
                            className={cn('cursor-pointer rounded-[3px] transition-shadow', seg.className, active && 'ring-2 ring-brand-500')}
                          >
                            {seg.text}
                          </span>
                        )
                      })}
                      </span>{' '}
                      {translate && sentence.vi ? <span className="block text-sm leading-relaxed text-slate-500 dark:text-slate-400">{sentence.vi}</span> : null}
                    </span>
                  )
                })}
              </div>
            </section>
          ))}
        </Card>

        {essay.critique.length ? (
          <Card className="p-4 sm:p-5">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
              <TriangleAlert className="size-4 text-amber-500" /> Đọc có phản biện — chỗ có thể viết tốt hơn
            </h3>
            <ul className="space-y-2 text-sm">
              {essay.critique.map((c, i) => (
                <li key={i}>
                  <span className="text-rose-600 line-through dark:text-rose-400">{c.text}</span> → <strong className="text-emerald-700 dark:text-emerald-400">{c.better}</strong>
                  <span className="block text-slate-500 dark:text-slate-400">{c.issue_vi}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      {picked ? (
        <SelectionMenu
          essay={essay}
          selection={picked}
          onClose={() => setPicked(null)}
          onAdded={(next, item) => {
            window.getSelection()?.removeAllRanges()
            setPicked(null)
            onEssayChange(next)
            if (!layers.includes(item.kind)) setLayers([...layers, item.kind])
            onSelect(item.id)
          }}
        />
      ) : null}
      <aside className="lg:sticky lg:top-20">
        {/* On phones an open item slides up as a bottom sheet instead of waiting below the essay. */}
        <Card
          className={cn(
            'p-4',
            selected && 'fixed inset-x-2 bottom-2 z-40 max-h-[62vh] overflow-y-auto shadow-2xl lg:static lg:max-h-none lg:overflow-visible lg:shadow-none',
          )}
        >
          {selected ? (
            <ItemPanel essay={essay} item={selected} review={review} onClose={() => onSelect('')} onEssayChange={onEssayChange} />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">Bấm vào một cụm được tô màu để xem nghĩa, ví dụ, từ điển và thêm vào Review.</p>
              {review.cards ? (
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  Đã thuộc <strong>{known}</strong> / {new Set(essay.items.map((i) => itemCardId(essay, i))).size} cụm của bài này.
                </p>
              ) : null}
              {unlearned.length && !review.offline ? (
                <Button
                  size="sm"
                  variant="outline"
                  loading={adding}
                  onClick={async () => {
                    setAdding(true)
                    await review.add(unlearned).finally(() => setAdding(false))
                  }}
                >
                  <Plus className="size-4" /> Thêm {unlearned.length} collocation & từ vựng vào Review
                </Button>
              ) : null}
              <div>
                <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">Dàn ý</p>
                <ol className="space-y-2.5">
                  {essay.paragraphs.map((p, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{p.role}</span>
                      <span className="block text-slate-500 dark:text-slate-400">{p.summary_vi}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge tone="slate">{essay.taskType}</Badge>
                {essay.band ? <Badge tone="violet">{essay.band}</Badge> : null}
                <Badge tone="slate">{essay.topic}</Badge>
              </div>
            </div>
          )}
        </Card>
      </aside>
    </div>
  )
}
