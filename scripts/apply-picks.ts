// Stores hand-picked candidates: node scripts/apply-picks.ts <candidates.json from pick-sheet> "index:choice,index:choice,…"
import { readFileSync } from 'node:fs'
import path from 'node:path'
process.loadEnvFile(path.join(import.meta.dirname, '..', '.env'))
const { storeImage } = await import('../server/admin/images.ts')
const { readJsonDoc, writeJsonDoc } = await import('../server/admin/store.ts')
const root = path.join(import.meta.dirname, '..')
const file = path.join(root, 'content', 'vocabulary', 'words.json')
const found = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Record<string, { query: string; candidates: { url: string; credit: string; source: string }[] }>
const picks = process.argv[3].split(',').map((p) => p.split(':').map(Number))
const doc = await readJsonDoc<Record<string, unknown>[]>(file, [])
const ctx = { rootDir: root, contentDir: path.join(root, 'content'), onContentChange() {} }
for (const [index, choice] of picks) {
  const entry = doc.value[index]
  const c = found[index]?.candidates[choice]
  if (!entry || !c) {
    console.log('skip', index, choice)
    continue
  }
  try {
    entry.image = await storeImage(ctx as never, String(entry.word), c.url)
    entry.image_credit = c.credit
    entry.image_source = c.source
    entry.image_query = found[index].query
    console.log('ok', index, entry.word, c.credit)
  } catch (e) {
    console.log('fail', index, entry.word, (e as Error).message)
  }
}
await writeJsonDoc(file, doc.value, doc.style)
