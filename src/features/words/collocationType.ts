import type { Tone } from '@/components/ui'

const toneByHead: [RegExp, Tone][] = [
  [/^adjective\+noun/, 'violet'],
  [/^verb\+noun/, 'sky'],
  [/^verb\+(prep|adverb|particle)|phrasal/, 'teal'],
  [/^adverb\+/, 'emerald'],
  [/^noun\+/, 'amber'],
  [/^(verb|noun|adjective) phrase|idiom/, 'rose'],
]

export function collocationTypeTone(type?: string): Tone {
  if (!type) return 'slate'
  return toneByHead.find(([pattern]) => pattern.test(type))?.[1] ?? 'slate'
}
