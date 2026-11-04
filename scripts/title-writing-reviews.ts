import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const dir = path.join(process.cwd(), 'progress', 'writing-reviews')
const files = (await readdir(dir)).filter((file) => file.endsWith('.json'))
let updated = 0

for (const file of files) {
  const filePath = path.join(dir, file)
  const review = JSON.parse(await readFile(filePath, 'utf8')) as { title?: string; text?: string }
  if (review.title) continue

  const text = review.text ?? ''
  const title = text.includes('children') && text.includes('modern technologies')
    ? 'Trẻ em và ảnh hưởng của công nghệ đến thời gian rảnh'
    : text.includes('students in countryside') && text.includes('test preparation')
      ? 'Cơ hội luyện thi của học sinh nông thôn'
      : 'Bài Writing Review trước đây'

  await writeFile(filePath, JSON.stringify({ ...review, title }, null, 1))
  updated++
  console.log(`[writing-review] titled ${file}: ${title}`)
}

console.log(`[writing-review] title migration complete: ${updated} updated`)
