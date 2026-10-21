import { alignSentences } from './align.ts'
import { compareSentence, type SentenceComparison } from './compare.ts'
import { splitSentences } from './sentences.ts'

export type SentenceReview =
  | { kind: 'matched'; targetIndex: number; target: string; comparison: SentenceComparison }
  | { kind: 'missing'; targetIndex: number; target: string }
  | { kind: 'extra'; user: string }

export interface ParagraphReview {
  items: SentenceReview[]
  correct: number
  total: number
}

/** Splits the learner's paragraph, aligns it with the model sentences and diffs each pair. */
export function reviewParagraph(text: string, targets: readonly string[]): ParagraphReview {
  const user = splitSentences(text)
  const items = alignSentences(user, targets).map((pair): SentenceReview => {
    if (pair.kind === 'extra') return { kind: 'extra', user: user[pair.user] }
    const target = targets[pair.target]
    if (pair.kind === 'missing') return { kind: 'missing', targetIndex: pair.target, target }
    return { kind: 'matched', targetIndex: pair.target, target, comparison: compareSentence(user[pair.user], target) }
  })
  const correct = items.filter((item) => item.kind === 'matched' && item.comparison.correct).length
  return { items, correct, total: targets.length }
}
