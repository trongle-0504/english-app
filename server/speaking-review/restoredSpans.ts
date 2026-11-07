// Guard for parallel Speaking review calls: Call B proposes edits on the raw ("heard") transcript while Call A
// restores misheard words in parallel. Any edit whose original span in the heard sentence touches words that Call A
// restored is dropped so B never "corrects" a recognizer mishearing or overwrites A's restoration.
import { diffWords } from 'diff'
import { locate } from '../writing-review/rewrite.ts'

export interface CharSpan {
  start: number
  end: number
}

/**
 * Character ranges in `heard` that `restored` changed (or insertion points where `restored` added words).
 * Returns `[]` when the sentence was not restored.
 */
export function changedSpans(heard: string, restored: string): CharSpan[] {
  if (!heard || !restored || heard === restored) return []
  const parts = diffWords(heard, restored)
  const spans: CharSpan[] = []
  let cursor = 0
  let prevRemoved = false
  for (const part of parts) {
    if (part.added) {
      if (!prevRemoved && part.value.trim().length > 0) {
        spans.push({ start: cursor, end: cursor })
      }
      prevRemoved = false
      continue
    }
    const len = part.value.length
    if (part.removed) {
      const lead = len - part.value.trimStart().length
      const tail = len - part.value.trimEnd().length
      if (len - lead - tail > 0) {
        spans.push({ start: cursor + lead, end: cursor + len - tail })
        prevRemoved = true
      }
    } else {
      prevRemoved = false
    }
    cursor += len
  }
  return spans
}

/** Whether `[start, end)` in `heard` overlaps any span changed by restoration. */
export function overlapsChangedSpan(start: number, end: number, spans: CharSpan[]): boolean {
  return spans.some((s) => start < s.end && end > s.start)
}

export interface SentenceEditCandidate {
  sentence: number
  original: string
  replacement: string
}

/**
 * Filters Call B's edits against Call A's restored sentences (`said`):
 * - Drops empty or no-op edits.
 * - Drops an edit when its `original` in `heard[i]` overlaps a range changed by restoration.
 * - Requires `original` to still be locatable in `said[i]`.
 */
export function filterRestoredEdits<T extends SentenceEditCandidate>(
  heardSentences: string[],
  restoredSentences: string[],
  edits: T[],
): { kept: T[]; dropped: number } {
  const spansBySentence = heardSentences.map((h, i) => changedSpans(h, restoredSentences[i] ?? h))
  const kept: T[] = []
  let dropped = 0
  for (const edit of edits) {
    const idx = edit.sentence - 1
    const heard = heardSentences[idx]
    const said = restoredSentences[idx]
    const orig = edit.original.trim()
    if (!heard || !said || !orig || orig === edit.replacement.trim()) continue
    const spans = spansBySentence[idx] ?? []
    if (spans.length > 0) {
      const atHeard = locate(heard, edit.original)
      if (atHeard < 0 || overlapsChangedSpan(atHeard, atHeard + edit.original.length, spans)) {
        dropped++
        continue
      }
    }
    if (locate(said, edit.original) < 0) {
      dropped++
      continue
    }
    kept.push(edit)
  }
  return { kept, dropped }
}
