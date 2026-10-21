// Builds content/topic-collocations/index.json (what the server reads) from the per-topic files beside it: their items
// in file-name order, and the count per topic. The minimal data pack leaves the index out; restore runs this.
// Run: node scripts/build-topic-index.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TopicCollocationItem } from '../server/topic-collocations.ts'

export const topicIndexDir = (root: string) => path.join(root, 'content', 'topic-collocations')

/** Writes the index; returns how many items it holds. */
export function buildTopicIndex(root: string): number {
  const dir = topicIndexDir(root)
  const items = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as TopicCollocationItem[])
  const topics: Record<string, number> = {}
  for (const it of items) topics[it.topic] = (topics[it.topic] ?? 0) + 1
  writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify({ total: items.length, topics, items }, null, 2)}\n`)
  return items.length
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, '..')
  console.log(`Wrote ${buildTopicIndex(root)} items to content/topic-collocations/index.json`)
}
