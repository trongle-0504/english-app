import type { StoredCard } from '@/types/review'
import type { EssayItem, EssayItemKind, SentenceRole } from '@/types/essays'
import { normalizeTypography } from '../practice/lib/compare'

export const KIND_META: Record<EssayItemKind, { label: string; plural: string; swatch: string; mark: string }> = {
  collocation: {
    label: 'Collocation',
    plural: 'Collocations',
    swatch: 'bg-amber-300 dark:bg-amber-500',
    mark: 'bg-amber-100 dark:bg-amber-900/45',
  },
  vocabulary: {
    label: 'Vocabulary',
    plural: 'Vocabulary',
    swatch: 'bg-sky-300 dark:bg-sky-500',
    mark: 'bg-sky-100 dark:bg-sky-900/45',
  },
  paraphrase: {
    label: 'Paraphrase',
    plural: 'Paraphrases',
    swatch: 'bg-violet-300 dark:bg-violet-500',
    mark: 'bg-violet-100 dark:bg-violet-900/45',
  },
  linking: {
    label: 'Linking',
    plural: 'Linking words',
    swatch: 'bg-emerald-500',
    mark: 'font-semibold text-emerald-700 dark:text-emerald-400',
  },
  frame: {
    label: 'Sentence frame',
    plural: 'Sentence frames',
    swatch: 'bg-rose-400',
    mark: 'underline decoration-rose-400 decoration-dotted decoration-2 underline-offset-[5px]',
  },
}

export const KIND_TONE: Record<EssayItemKind, 'amber' | 'sky' | 'violet' | 'emerald' | 'rose'> = {
  collocation: 'amber',
  vocabulary: 'sky',
  paraphrase: 'violet',
  linking: 'emerald',
  frame: 'rose',
}

export const ROLE_LABEL: Record<SentenceRole, string> = {
  paraphrase: 'Paraphrase đề',
  position: 'Quan điểm',
  claim: 'Luận điểm',
  explanation: 'Giải thích',
  example: 'Ví dụ',
  result: 'Kết quả',
  concession: 'Nhượng bộ',
  rebuttal: 'Phản bác',
  summary: 'Tóm lại',
}

/** Background kinds, in the order they win when spans overlap. */
const BACKGROUND: EssayItemKind[] = ['collocation', 'vocabulary', 'paraphrase']

export interface Segment {
  text: string
  items: EssayItem[]
  className: string
}

/** Splits a sentence at every item boundary so overlapping items ("translate into" inside a frame) all show. */
export function segments(sentence: string, items: EssayItem[]): Segment[] {
  const cuts = new Set([0, sentence.length])
  for (const item of items) {
    cuts.add(item.start)
    cuts.add(item.end)
  }
  const points = [...cuts].sort((a, b) => a - b)
  const out: Segment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]]
    const covering = items.filter((item) => item.start <= a && item.end >= b)
    const bg = BACKGROUND.find((k) => covering.some((c) => c.kind === k))
    const className = [
      bg ? KIND_META[bg].mark : '',
      covering.some((c) => c.kind === 'linking') ? KIND_META.linking.mark : '',
      covering.some((c) => c.kind === 'frame') ? KIND_META.frame.mark : '',
    ]
      .filter(Boolean)
      .join(' ')
    out.push({ text: sentence.slice(a, b), items: covering, className })
  }
  return out
}

/** The item a click on a segment opens: the shortest one covering it. */
export const primaryItem = (items: EssayItem[]) => [...items].sort((a, b) => a.end - a.start - (b.end - b.start))[0]

export type CardStatus = 'new' | 'learning' | 'known'

/** Known = marked done, or already in the long-term "Review" state of FSRS. */
export function cardStatus(card: StoredCard | undefined): CardStatus {
  if (!card) return 'new'
  return card.done || card.fsrs.state === 2 ? 'known' : 'learning'
}

/** Loose "is the phrase in this text" check, used for live hints while writing (the AI does the real check). */
export function mentions(text: string, item: EssayItem): boolean {
  const hay = ` ${normalizeTypography(text).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ')} `
  const stem = (w: string) => (w.length > 4 ? w.slice(0, Math.max(4, w.length - 3)) : w)
  const phrase = (item.kind === 'frame' ? item.text : item.key).toLowerCase().replace(/\b(x|y|z|sb|sth|something|somebody|someone)\b/g, ' ')
  const words = phrase.replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'for', 'with'].includes(w))
  if (!words.length) return hay.includes(` ${item.text.toLowerCase()} `)
  return words.every((w) => new RegExp(`\\b${stem(w).replace(/'/g, "\\'")}`).test(hay))
}

/** Case/typography-insensitive answer check for the cloze. */
export const sameAnswer = (a: string, b: string) =>
  normalizeTypography(a).toLowerCase().replace(/\s+/g, ' ').trim() === normalizeTypography(b).toLowerCase().replace(/\s+/g, ' ').trim()
