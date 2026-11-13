// Speaking ideas → "Kho đề": pick a question from the Speaking Mock Test bank instead of pasting it. Read-only: it only
// reads /data/practice/speaking-mock.json; nothing is written to the Mock Test (its attempts and history are untouched).
import { Check, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { useData } from '@/lib/data'
import type { SpeakingMockDataset } from '@/types/content'
import type { SpeakingPart } from '@/types/speaking'

/** What was picked for one Part: the bank id and the text it fills in (the same format as a pasted topic). */
export interface BankPick {
  id: string
  text: string
}

interface Item {
  id: string
  group: string
  title: string
  detail: string
  text: string
}

function itemsFor(data: SpeakingMockDataset, part: SpeakingPart): Item[] {
  if (part === 1) {
    return data.part1Topics.map((t) => ({
      id: t.id,
      group: 'Part 1',
      title: t.topic,
      detail: `${t.questions.length} câu hỏi`,
      text: [t.topic, ...t.questions.map((q) => `* ${q}`)].join('\n'),
    }))
  }
  return data.part23Categories.flatMap((c) =>
    c.subTopics
      .filter((s) => (part === 2 ? s.part2.topic : s.part3.questions.length))
      .map((s) => ({
        id: s.id,
        group: c.category,
        title: part === 2 ? s.part2.topic : s.subTopic,
        detail: part === 2 ? `${s.part2.cueCard.length} gợi ý` : `${s.part3.questions.length} câu hỏi Part 3`,
        text:
          part === 2
            ? [s.part2.topic, ...(s.part2.cueCard.length ? ['You should say:', ...s.part2.cueCard] : [])].join('\n')
            : [s.subTopic, ...s.part3.questions.map((q) => `* ${q}`)].join('\n'),
      })),
  )
}

/** The Mock Test questions of one Part, searchable and grouped; a click picks one. */
export function QuestionBank({ part, picked, onPick }: { part: SpeakingPart; picked?: string; onPick: (pick: BankPick) => void }) {
  const data = useData<SpeakingMockDataset>('practice/speaking-mock.json')
  const [query, setQuery] = useState('')
  const items = useMemo(() => itemsFor(data, part), [data, part])
  const q = query.trim().toLowerCase()
  const shown = q ? items.filter((i) => `${i.group} ${i.text}`.toLowerCase().includes(q)) : items
  const groups = [...new Set(shown.map((i) => i.group))]

  return (
    <div className="rounded-xl border border-slate-300 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950">
      <div className="relative border-b border-slate-200 p-2 dark:border-slate-800">
        <Search className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Tìm trong ${items.length} đề Part ${part}…`}
          aria-label="Tìm đề"
          className="w-full rounded-lg bg-slate-50 py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand-500/20 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
        />
      </div>
      <div className="max-h-72 overflow-y-auto p-1.5">
        {groups.map((group) => (
          <div key={group}>
            {part !== 1 ? (
              <p className="sticky top-0 z-10 bg-white/95 px-2.5 pt-2 pb-1 text-xs font-bold tracking-wide text-slate-500 uppercase dark:bg-slate-950/95">{group}</p>
            ) : null}
            {shown
              .filter((i) => i.group === group)
              .map((item) => {
                const active = item.id === picked
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onPick({ id: item.id, text: item.text })}
                    aria-pressed={active}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      active ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/50 dark:text-brand-200' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                    )}
                  >
                    <Check className={cn('mt-0.5 size-4 shrink-0', active ? 'text-brand-600' : 'invisible')} />
                    <span className="min-w-0 flex-1">{item.title}</span>
                    <span className="shrink-0 text-xs text-slate-400">{item.detail}</span>
                  </button>
                )
              })}
          </div>
        ))}
        {!shown.length ? <p className="px-3 py-6 text-center text-sm text-slate-500">Không có đề nào khớp “{query}”.</p> : null}
      </div>
    </div>
  )
}
