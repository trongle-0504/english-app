import type { SpeakingPart } from '@/types/speaking'

const BULLET = /^(?:[*\-•–·]|\d+[.)])\s*/

/**
 * A pasted topic and its questions: "Art" then "* Are you good at art?"… The first line is the topic unless it is a
 * question. Part 2 is one cue card: its first line is the task, the rest ("You should say: …") belongs to it.
 */
export function parseTopic(text: string, part: SpeakingPart): { topic: string; questions: string[] } {
  const lines = text
    .split('\n')
    .map((l) => l.replace(BULLET, '').trim())
    .filter(Boolean)
  if (!lines.length) return { topic: '', questions: [] }
  if (part === 2) return { topic: lines[0], questions: [lines.join('\n')] }
  const [first, ...rest] = lines
  const titled = !first.endsWith('?') && rest.length > 0
  return { topic: titled ? first : '', questions: titled ? rest : lines }
}
