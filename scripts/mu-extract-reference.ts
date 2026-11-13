// Builds the shared vocabulary bank of the multi-user app (PLAN-multi-user-v2.md, 5 and 7.2) from the owner's library,
// read-only: node scripts/mu-extract-reference.ts <owner content/ dir> <multi app content/ dir>
// Every word entry is copied except those whose text holds contact details (emails, phone numbers, Zalo/Facebook):
// those are listed in reference-review.md for the owner, and only enter the bank
// once their word is written in reference-approved.txt (one word per line) next to that file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const [from, to] = process.argv.slice(2)
if (!from || !to) {
  console.error('Usage: node scripts/mu-extract-reference.ts <owner content dir> <multi content dir>')
  process.exit(1)
}

type Entry = { word: string; [k: string]: unknown }
const words = JSON.parse(readFileSync(path.join(from, 'vocabulary', 'words.json'), 'utf8')) as Entry[]
const topics = JSON.parse(readFileSync(path.join(from, 'vocabulary', 'topics.json'), 'utf8'))
const notesDir = path.resolve(path.dirname(to))
const approvedFile = path.join(notesDir, 'reference-approved.txt')
const approved = new Set(
  existsSync(approvedFile)
    ? readFileSync(approvedFile, 'utf8')
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean)
    : [],
)

// Signs of personal content. The entries are dictionary-style (meanings and examples from Longman/OZDIC), so ordinary
// sentences ("I", "my", Vietnamese "tôi" in a translation) are normal and NOT flagged: only contact details.
const PERSONAL = [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/, /(?<!\d)0\d{9,10}(?!\d)/, /\b(zalo|facebook\.com|fb\.com)\b/i]
const PRIVATE_FIELDS = ['user_note', 'notes', 'personal_note', 'my_example']

const flagged: { entry: Entry; why: string[] }[] = []
const kept: Entry[] = []
for (const entry of words) {
  const clean: Entry = { ...entry }
  for (const f of PRIVATE_FIELDS) delete clean[f]
  const text = JSON.stringify(clean)
  const why = PERSONAL.filter((re) => re.test(text)).map((re) => re.source.slice(0, 40))
  if (why.length && !approved.has(entry.word.toLowerCase())) flagged.push({ entry: clean, why })
  else kept.push(clean)
}

const keptKeys = new Set(kept.map((w) => w.word.toLowerCase()))
for (const t of topics.topics ?? []) for (const s of t.sub_topics ?? []) s.words = (s.words ?? []).filter((w: string) => keptKeys.has(w.toLowerCase()))

mkdirSync(path.join(to, 'reference'), { recursive: true })
writeFileSync(path.join(to, 'reference', 'words.json'), `${JSON.stringify(kept, null, 2)}\n`)
writeFileSync(path.join(to, 'reference', 'topics.json'), `${JSON.stringify(topics, null, 2)}\n`)

const review = [
  '# Kho từ chung: mục cần duyệt',
  '',
  `Tạo lúc ${new Date().toISOString()}. Đã đưa vào kho chung: **${kept.length}** / ${words.length} mục.`,
  `Mục dưới đây **chưa** đưa vào vì có dấu hiệu nội dung cá nhân. Muốn đưa vào: ghi từ đó (mỗi dòng một từ) vào \`reference-approved.txt\` cạnh file này rồi chạy lại script. Muốn sửa ví dụ: sửa trong app cá nhân rồi chạy lại.`,
  '',
  ...flagged.map(({ entry, why }) => {
    const senses = (entry.senses as { definition_vi?: string; examples?: string[] }[] | undefined) ?? []
    return [`## ${entry.word}`, `- Lý do: ${why.join(' · ')}`, ...senses.flatMap((s) => [`- Nghĩa: ${s.definition_vi ?? ''}`, ...(s.examples ?? []).map((e) => `  - ${e}`)])].join('\n')
  }),
  '',
].join('\n')
writeFileSync(path.join(notesDir, 'reference-review.md'), review)
console.log(`Shared bank: ${kept.length} of ${words.length} entries; ${flagged.length} held for review → ${path.join(notesDir, 'reference-review.md')}`)
