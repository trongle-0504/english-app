import { TONES, type Tone } from '@/components/ui'
import type { BlogIndex } from '@/types/content'

const ACCENTS = TONES.filter((tone) => tone !== 'slate')

/** A stable accent colour per topic, following the order topics appear in the index. */
export function topicTones(topics: BlogIndex['topics']): Map<string, Tone> {
  return new Map(topics.map((topic, i) => [topic.id, ACCENTS[i % ACCENTS.length]]))
}
