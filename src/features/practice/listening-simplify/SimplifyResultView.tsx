// Listening → Simplify result: the transcript split into Linearthinking roles (S - V - O backbone, reference words,
// signposts, section anchors, answer words, skippable detail), with the Vietnamese gloss above each chunk, the link of
// every sentence to the one before it and each section's main idea and flow. Shared by the page and its history.
import { AlignLeft, ChevronDown, Eye, EyeOff, Languages, Lightbulb, ListOrdered, MapPin, Sparkles, Workflow } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ExtraRow } from '@/features/practice/speaking-ideas/SuggestionResult'
import type { SimplifyRelation, SimplifyResult, SimplifySegment } from '@/types/listening'

const LEGEND = (hasKeys: boolean): { label: string; hint: string; sample: ReactNode }[] => [
  {
    label: 'Trục chính (Core)',
    hint: 'chủ ngữ – động từ – tân ngữ',
    sample: <span className="font-normal text-slate-900 dark:text-slate-100">She sews pockets</span>,
  },
  {
    label: 'Có thể lướt qua (Skip)',
    hint: 'mệnh đề phụ, ví dụ, chi tiết',
    sample: <span className="font-normal text-slate-400 dark:text-slate-500">[for the customer]</span>,
  },
  {
    label: 'Từ thay thế (Reference)',
    hint: 'it / they / this + N nhắc lại ý trước',
    sample: (
      <span className="font-medium text-emerald-700 underline decoration-emerald-300 decoration-dotted underline-offset-[3px] dark:text-emerald-300">
        they
      </span>
    ),
  },
  {
    label: 'Mốc định vị (Anchor)',
    hint: 'báo chuyển phần / liệt kê ý',
    sample: <AnchorMark>Let’s begin with</AnchorMark>,
  },
  {
    label: 'Từ nối (Signpost)',
    hint: 'quan hệ logic giữa các ý',
    sample: (
      <span className="font-normal text-violet-700 underline decoration-violet-300 decoration-1 underline-offset-[3px] dark:text-violet-300">
        However
      </span>
    ),
  },
  ...(hasKeys
    ? [
        {
          label: 'Dẫn tới đáp án (Key)',
          hint: 'từ khóa trả lời câu hỏi',
          sample: (
            <span className="rounded-xs bg-amber-100/90 px-1 py-0.5 font-normal text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
              convenient <sup className="text-[9px] text-amber-800 dark:text-amber-300">(31)</sup>
            </span>
          ),
        },
      ]
    : []),
  {
    label: 'Nhãn tiếng Việt phía trên',
    hint: 'đặt trực tiếp trên cụm tương ứng',
    sample: (
      <ruby className="font-normal text-slate-900 dark:text-slate-100">
        pickpockets
        <rt className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">kẻ móc túi</rt>
      </ruby>
    ),
  },
]

const ANCHOR_CLASS =
  'rounded-xs bg-sky-100 px-1 py-0.5 font-semibold text-sky-800 dark:bg-sky-950/60 dark:text-sky-200'

/** A section anchor: pin icon + tinted background (no border), so it still stands out when the talk is shown as one paragraph. */
function AnchorMark({ children }: { children: ReactNode }) {
  return (
    <span className={ANCHOR_CLASS}>
      <MapPin className="mr-0.5 mb-0.5 inline size-3" aria-hidden />
      {children}
    </span>
  )
}

function Legend({ hasKeys }: { hasKeys: boolean }) {
  const items = LEGEND(hasKeys)
  return (
    <ul className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2.5">
          <div className="flex w-38 shrink-0 items-center justify-start text-[13.5px]">{item.sample}</div>
          <span className="text-slate-600 dark:text-slate-300">
            {item.label} <span className="text-slate-400">· {item.hint}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** One chunk formatted without rounded border boxes; distinctions are made through color and underline with normal font weight. */
function Chunk({ segment, focus, showVi }: { segment: SimplifySegment; focus: boolean; showVi: boolean }) {
  const { role, q, vi } = segment
  const text = segment.text
  const lead = /^\s*/.exec(text)?.[0] ?? ''
  const trail = /\s*$/.exec(text)?.[0] ?? ''
  const body = text.trim()
  if (!body) return <>{text}</>

  const gloss = !showVi || (focus && role === 'skip') ? '' : (vi ?? '').trim()

  let content: ReactNode
  let roleClass: string

  if (role === 'skip') {
    content = focus ? '(…)' : `[${body}]`
    roleClass = 'text-slate-400 dark:text-slate-500 font-normal'
  } else if (role === 'signpost') {
    content = body
    roleClass = 'text-violet-700 underline decoration-violet-300 decoration-1 underline-offset-[3px] dark:text-violet-300 dark:decoration-violet-500/60 font-normal'
  } else if (role === 'anchor') {
    content = (
      <>
        <MapPin className="mr-0.5 mb-0.5 inline size-3" aria-hidden />
        {body}
      </>
    )
    roleClass = ANCHOR_CLASS
  } else if (role === 'ref') {
    content = body
    roleClass =
      'text-emerald-700 underline decoration-emerald-300 decoration-dotted underline-offset-[3px] dark:text-emerald-300 dark:decoration-emerald-500/60 font-medium'
  } else if (role === 'key' && q > 0) {
    content = (
      <>
        {body}
        <sup className="ml-0.5 text-[10px] text-amber-800 dark:text-amber-300">({q})</sup>
      </>
    )
    roleClass = 'text-amber-900 bg-amber-100/90 px-1 py-0.5 rounded-xs dark:bg-amber-950/60 dark:text-amber-200 font-normal'
  } else {
    content = body
    roleClass = 'text-slate-900 dark:text-slate-100 font-normal'
  }

  if (!gloss) {
    return (
      <>
        {lead}
        <span className={roleClass} title={focus && role === 'skip' ? body : undefined}>
          {content}
        </span>
        {trail}
      </>
    )
  }

  return (
    <>
      {lead}
      <ruby className={cn('mx-0.5 inline-ruby', roleClass)}>
        {content}
        <rt className="text-[10.5px] leading-tight text-slate-500 dark:text-slate-400 select-none font-normal">
          {gloss}
        </rt>
      </ruby>
      {trail}
    </>
  )
}

/** Label and colour of each sentence-to-sentence relation; `pass` marks the ones that may be let go once the point is clear. */
const RELATION: Record<SimplifyRelation, { label: string; className: string; pass?: boolean }> = {
  start: { label: 'Mở ý', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  cause_effect: { label: 'Nhân → quả', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200' },
  contrast: { label: 'Tương phản', className: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200' },
  time: { label: 'Thời gian', className: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200' },
  similarity: { label: 'Bổ sung', className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200', pass: true },
  condition: { label: 'Điều kiện', className: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-200' },
  comparison: { label: 'So sánh', className: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-200' },
  example: { label: 'Ví dụ', className: 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-200', pass: true },
  explain: { label: 'Giải thích', className: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200', pass: true },
  reference: { label: 'Tham chiếu', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200' },
  continue: { label: 'Nối ý', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
}

function RelationBadge({ relation }: { relation: SimplifyRelation }) {
  const r = RELATION[relation] ?? RELATION.continue
  return (
    <span className={cn('inline-flex items-center rounded-md px-1.5 py-px text-[11px] font-semibold whitespace-nowrap', r.className)}>
      {r.label}
      {r.pass ? <span className="ml-1 font-normal opacity-70">· nghe lướt được</span> : null}
    </span>
  )
}

/** The whole analysis: legend and view switches, the annotated sections, speaker flow, vocabulary and tips. */
export function SimplifyResultView({ result }: { result: SimplifyResult }) {
  const [focus, setFocus] = useState(false)
  // Opens as a plain paragraph without the Vietnamese glosses, so the talk reads like listening again.
  const [showVi, setShowVi] = useState(false)
  // The colour legend is folded away until asked for.
  const [showLegend, setShowLegend] = useState(false)
  const [viewMode, setViewMode] = useState<'paragraph' | 'lines'>('paragraph')
  const hasKeys = result.sections.some((s) => s.lines.some((l) => l.segments.some((g) => g.role === 'key' && g.q > 0)))

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setShowLegend((v) => !v)}
            aria-expanded={showLegend}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
          >
            <ChevronDown className={cn('size-4 text-slate-400 transition-transform', showLegend ? '' : '-rotate-90')} />
            Cách đọc bản phân tích
            <span className="text-xs font-normal text-slate-400">{showLegend ? 'Thu gọn' : 'Xem chú thích màu'}</span>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowVi((v) => !v)}
              aria-pressed={!showVi}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                !showVi
                  ? 'border-brand-400 bg-brand-50 text-brand-800 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-200'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300',
              )}
            >
              <Languages className="size-3.5" />
              {showVi ? 'Ẩn từ tiếng Việt' : 'Hiện từ tiếng Việt'}
            </button>
            <button
              type="button"
              onClick={() => setViewMode((v) => (v === 'paragraph' ? 'lines' : 'paragraph'))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300"
            >
              {viewMode === 'paragraph' ? <ListOrdered className="size-3.5" /> : <AlignLeft className="size-3.5" />}
              {viewMode === 'paragraph' ? 'Hiện dạng tách câu' : 'Nối liền thành đoạn'}
            </button>
            <button
              type="button"
              onClick={() => setFocus((v) => !v)}
              aria-pressed={focus}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                focus
                  ? 'border-brand-400 bg-brand-50 text-brand-800 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-200'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300',
              )}
            >
              {focus ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {focus ? 'Đang chỉ hiện trục chính' : 'Ẩn chi tiết phụ'}
            </button>
          </div>
        </div>
        {showLegend ? <Legend hasKeys={hasKeys} /> : null}
      </Card>

      {!result.complete ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          AI đã bỏ sót hoặc đổi vài từ so với transcript gốc — hãy đối chiếu lại những chỗ quan trọng, hoặc bấm phân tích lại.
        </p>
      ) : null}

      {/* Main Sections */}
      <Card className="space-y-6 p-4 sm:p-5">
        {result.sections.map((section, i) => {
          // Sentence numbers run across the whole transcript; older results have no `n`, so count them here.
          const offset = result.sections.slice(0, i).reduce((sum, s) => sum + s.lines.length, 0)
          const num = (j: number) => section.lines[j].n || offset + j + 1
          return (
            <section key={i} className="space-y-3">
              {section.title_vi ? (
                <h3 className="border-l-3 border-brand-500 pl-2.5 text-xs font-bold tracking-wide text-slate-700 uppercase dark:border-brand-400 dark:text-slate-300">
                  {section.title_vi}
                </h3>
              ) : null}
              {section.link_vi ? (
                <p className="text-[13px] text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Liên kết với phần trước:</span> {section.link_vi}
                </p>
              ) : null}
              {viewMode === 'paragraph' ? (
                <p className={cn('text-[15px] text-slate-800 dark:text-slate-200', showVi ? 'leading-9' : 'leading-7')}>
                  {section.lines.map((line, j) => (
                    <span key={j}>
                      <sup className="mr-0.5 text-[10px] font-semibold text-slate-400 select-none">[{num(j)}]</sup>
                      {line.segments.map((segment, k) => (
                        <Chunk key={k} segment={segment} focus={focus} showVi={showVi} />
                      ))}{' '}
                    </span>
                  ))}
                </p>
              ) : (
                <div className="space-y-2.5 divide-y divide-slate-100 dark:divide-slate-800/60">
                  {section.lines.map((line, j) => (
                    <div key={j} className="flex items-start gap-2.5 pt-2">
                      <span className="mt-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1 text-[10.5px] font-semibold text-slate-500 select-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                        {num(j)}
                      </span>
                      <div className="min-w-0 space-y-1">
                        <p className={cn('text-[15px] text-slate-800 dark:text-slate-200', showVi ? 'leading-9' : 'leading-7')}>
                          {line.segments.map((segment, k) => (
                            <Chunk key={k} segment={segment} focus={focus} showVi={showVi} />
                          ))}
                        </p>
                        {line.relation || line.link_vi ? (
                          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                            {line.relation ? <RelationBadge relation={line.relation} /> : null}
                            {line.link_vi ? <span>{line.link_vi}</span> : null}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {section.main_idea_vi || section.flow_vi ? (
                <div className="space-y-1.5 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                  {section.main_idea_vi ? (
                    <p>
                      <span className="font-semibold text-slate-900 dark:text-white">→ Ý chính:</span> {section.main_idea_vi}
                    </p>
                  ) : null}
                  {section.flow_vi ? (
                    <p>
                      <span className="font-semibold text-slate-900 dark:text-white">→ Flow:</span> {section.flow_vi}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          )
        })}
      </Card>

      {/* Speaker Flow Module */}
      {result.flow && result.flow.length > 0 ? (
        <Card className="space-y-4 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300">
              <Workflow className="size-4" />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-slate-900 dark:text-white">
                Flow ý người nói (Speaker Flow)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tóm gọn mạch triển khai ý chính ngắn gọn theo tiến trình bài nghe
              </p>
            </div>
          </div>
          <ol className="relative ml-3 space-y-3 border-l-2 border-emerald-200 pl-4 dark:border-emerald-800/60">
            {result.flow.map((step, idx) => (
              <li key={idx} className="relative">
                <span className="absolute -left-[23px] flex size-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white shadow-xs">
                  {step.step || idx + 1}
                </span>
                <p className="text-[14px] leading-relaxed text-slate-800 dark:text-slate-200">
                  {step.text_vi}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {/* Recommended Vocabulary Module with Add to Vocab / Notes */}
      {result.vocab && result.vocab.length > 0 ? (
        <Card className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300">
              <Sparkles className="size-4" />
            </span>
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
                Cụm từ & Từ vựng đề xuất học
                <span className="rounded-full bg-slate-100 px-2 py-px text-xs font-semibold text-slate-600 tabular-nums dark:bg-slate-800 dark:text-slate-300">
                  {result.vocab.length}
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Collocation dùng lại được, ở dạng từ điển, đã đối chiếu Longman / OZDIC và bỏ qua cụm đã có trong Vocabulary

              </p>
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {result.vocab.map((item, i) => (
              <ExtraRow
                key={i}
                extra={{
                  phrase: item.phrase,
                  meaning_vi: item.meaning_vi,
                  example: item.example,
                  verified: item.verified ?? true,
                  dictionary: item.dictionary ?? [],
                  sources: item.sources ?? [
                    { name: 'OZDIC' as const, url: `https://ozdic.com/word/${encodeURIComponent(item.phrase.trim().toLowerCase().split(/\s+/)[0])}` },
                    { name: 'Longman' as const, url: `https://www.ldoceonline.com/dictionary/${encodeURIComponent(item.phrase.trim().toLowerCase().replace(/\s+/g, '-'))}` },
                  ],
                  original: item.original,
                }}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Practical Tips */}
      {result.tips_vi.length ? (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Lightbulb className="size-4 text-amber-500" /> Mẹo thực hành bài nghe này
          </h2>
          <ul className="list-disc space-y-1.5 pl-5 text-[14.5px] leading-relaxed text-slate-700 marker:text-slate-300 dark:text-slate-300">
            {result.tips_vi.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-right text-xs text-slate-400">Phân tích bởi {result.model}</p>
    </div>
  )
}
