// Re-picks the picture of every word in content/vocabulary/words.json from a "scene" query per word
// (file: lines "index|query", index = position in words.json). Stores pictures in public/vocab-images/ and saves
// image, image_credit, image_source and image_query on each word. Usage:
//   node scripts/refresh-vocab-images.ts <queries.txt> [--from N]
import { readFileSync } from 'node:fs'
import path from 'node:path'
process.loadEnvFile(path.join(import.meta.dirname, '..', '.env'))
const { firstImages, storeImage } = await import('../server/admin/images.ts')
const { readJsonDoc, writeJsonDoc } = await import('../server/admin/store.ts')

const root = path.join(import.meta.dirname, '..')
const file = path.join(root, 'content', 'vocabulary', 'words.json')
const queries = new Map(
  readFileSync(process.argv[2], 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split('|'))
    .map(([i, q]) => [Number(i), q.trim()] as const),
)
const from = Number(process.argv[process.argv.indexOf('--from') + 1]) || 0
const doc = await readJsonDoc<Record<string, unknown>[]>(file, [])
const ctx = { rootDir: root, contentDir: path.join(root, 'content'), onContentChange() {} }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let done = 0
let failed: string[] = []
for (let i = from; i < doc.value.length; i++) {
  const word = doc.value[i]
  const q = queries.get(i)
  if (!q) continue
  const candidates = await firstImages(q, 3)
  let saved = false
  for (const c of candidates) {
    try {
      word.image = await storeImage(ctx as never, String(word.word), c.url)
      word.image_credit = c.credit
      word.image_source = c.source
      saved = true
      break
    } catch {
      // next candidate
    }
  }
  word.image_query = q
  if (saved) done++
  else failed.push(String(word.word))
  // Pixabay allows 100 requests a minute.
  await sleep(700)
  if ((i + 1) % 25 === 0) {
    await writeJsonDoc(file, doc.value, doc.style)
    console.log(`${i + 1}/${doc.value.length} · ${done} saved · ${failed.length} without picture`)
  }
}
await writeJsonDoc(file, doc.value, doc.style)
console.log(`done: ${done} saved, ${failed.length} without picture${failed.length ? `: ${failed.join(', ')}` : ''}`)
