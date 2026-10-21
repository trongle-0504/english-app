// Lists and looks up (Longman / OZDIC) the collocations of a saved writing review's model essay again, without
// rewriting the essay: for reviews saved when the model listed too little wording. Usage:
//   node scripts/refresh-essay-wording.ts <review id>
import path from 'node:path'
import { loadEnv } from '../server/env.ts'

const root = path.join(import.meta.dirname, '..')
loadEnv(root)
const { writingReviewModel } = await import('../server/writing-review/llm.ts')
const { refreshEssayWording } = await import('../server/writing-review/writing-essay.ts')

const id = process.argv[2]
if (!id) throw new Error('Usage: node scripts/refresh-essay-wording.ts <review id>')
const result = await refreshEssayWording({ rootDir: root }, id, writingReviewModel())
for (const w of result.modelEssay?.wording ?? []) console.log(w.verified ? '✓' : '?', w.text)
