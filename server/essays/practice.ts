// Practice → Model essays: feedback on a rebuilt paragraph ("Rebuild") and on a short paragraph for a new task ("Use it").
// One Gemini call each; the target phrases are checked one by one (correct / incorrect / missing).
import { readFile } from 'node:fs/promises'
import type { Essay, EssayFeedback, EssayItem } from '../../src/types/essays.ts'
import { generateLogged } from '../admin/ai.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { contentFile } from '../files.ts'

const FEEDBACK_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', description: '0–10.' },
    summary_vi: { type: 'string', description: '2–3 short Vietnamese sentences: what works, what to fix first.' },
    targets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          status: { type: 'string', enum: ['correct', 'incorrect', 'missing'] },
          note_vi: { type: 'string', description: 'Short Vietnamese note; for "incorrect", how to use it correctly.' },
        },
        required: ['itemId', 'status', 'note_vi'],
      },
    },
    corrections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { wrong: { type: 'string' }, right: { type: 'string' }, why_vi: { type: 'string' } },
        required: ['wrong', 'right', 'why_vi'],
      },
    },
    corrected: { type: 'string', description: "The learner's text with only the necessary corrections (grammar, word choice, collocation)." },
  },
  required: ['score', 'summary_vi', 'targets', 'corrections', 'corrected'],
}

const COMMON = `Rules:
- Check EVERY target phrase: "correct" = used naturally with the right meaning and grammar (inflected forms are fine, e.g. "reduced poverty" for "reduce poverty"); "incorrect" = attempted but wrong form, wrong partner word or wrong meaning; "missing" = not used.
- "corrections": at most 8 real errors in the learner's text (grammar, word choice, collocation, spelling); quote "wrong" exactly as written. Do not rewrite for style.
- "corrected": the learner's text with only those fixes applied.
- All explanations in natural, concise Vietnamese.`

const SYSTEM_REBUILD = `You are an IELTS Writing teacher. The learner is rebuilding a paragraph of a model essay from its outline, trying to reuse its key phrases. Judge the learner's paragraph on its own merits: it does not need to match the original word for word.
Score 0–10 for how well it covers the outline's ideas with clear, natural English and good use of the target phrases.
${COMMON}`

const SYSTEM_TRANSFER = `You are an IELTS Writing teacher. The learner wrote a short paragraph (about 3–4 sentences) answering a NEW task, trying to use target phrases learned from a model essay.
Score 0–10 for relevance to the task, clarity, natural English and correct use of the targets (using them naturally matters more than using all of them).
${COMMON}`

async function loadEssay(ctx: ApiContext, essayId: string): Promise<Essay> {
  if (!/^[a-z0-9-]{1,80}$/.test(essayId)) throw new ApiError(400, 'Invalid essay id.')
  try {
    return JSON.parse(await readFile(contentFile(ctx.contentDir, 'essays', `${essayId}.json`), 'utf8')) as Essay
  } catch {
    throw new ApiError(404, `No essay "${essayId}".`)
  }
}

const targetLines = (items: EssayItem[]) =>
  items.map((i) => `- ${i.id}: "${i.frame ?? i.key}"${i.kind === 'frame' ? ' (sentence frame)' : ''} — ${i.meaning_vi}`).join('\n')

function normalize(raw: Record<string, unknown>, targets: EssayItem[], model: string, total: number): EssayFeedback {
  const list = Array.isArray(raw.targets) ? (raw.targets as Record<string, unknown>[]) : []
  return {
    score: Math.min(10, Math.max(0, Math.round(Number(raw.score) || 0))),
    summary_vi: String(raw.summary_vi ?? ''),
    // One verdict per target, in the learner's order; a target the model skipped counts as missing.
    targets: targets.map((t) => {
      const r = list.find((x) => x.itemId === t.id)
      const status = r?.status === 'correct' || r?.status === 'incorrect' ? r.status : 'missing'
      return { itemId: t.id, status, note_vi: String(r?.note_vi ?? '') }
    }),
    corrections: (Array.isArray(raw.corrections) ? (raw.corrections as Record<string, unknown>[]) : [])
      .map((c) => ({ wrong: String(c.wrong ?? ''), right: String(c.right ?? ''), why_vi: String(c.why_vi ?? '') }))
      .filter((c) => c.wrong && c.right && c.wrong !== c.right)
      .slice(0, 8),
    corrected: String(raw.corrected ?? ''),
    usage: { model, total },
  }
}

function pickTargets(essay: Essay, ids: unknown): EssayItem[] {
  if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'Choose at least one target phrase.')
  const items = ids.map((id) => essay.items.find((i) => i.id === id)).filter((i): i is EssayItem => Boolean(i))
  if (!items.length) throw new ApiError(400, 'Unknown target phrases.')
  return items.slice(0, 8)
}

function learnerText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.split(/\s+/).length < 12) throw new ApiError(400, 'Write at least a couple of sentences first.')
  if (text.length > 3000) throw new ApiError(400, 'Keep it under 3000 characters.')
  return text
}

export async function checkRebuild(ctx: ApiContext, body: Record<string, unknown>): Promise<EssayFeedback> {
  const essay = await loadEssay(ctx, String(body.essayId ?? ''))
  const paragraph = essay.paragraphs[Number(body.paragraph)]
  if (!paragraph) throw new ApiError(400, 'Unknown paragraph.')
  const text = learnerText(body.text)
  const targets = pickTargets(essay, body.targets)
  const original = paragraph.sentences.map((i) => essay.sentences[i].text).join(' ')
  const res = await generateLogged<Record<string, unknown>>(ctx, `essay rebuild: ${essay.id}`, {
    system: SYSTEM_REBUILD,
    prompt: `Task of the essay: ${essay.prompt}\n\nParagraph role: ${paragraph.role}\nOutline:\n${paragraph.outline.map((o) => `- ${o}`).join('\n')}\n\nOriginal paragraph (for reference only):\n${original}\n\nTarget phrases:\n${targetLines(targets)}\n\nLearner's paragraph:\n"""${text}"""`,
    schema: FEEDBACK_SCHEMA,
    retries: 2,
  })
  return normalize(res.value, targets, res.model, res.usage?.totalTokenCount ?? 0)
}

export async function checkTransfer(ctx: ApiContext, body: Record<string, unknown>): Promise<EssayFeedback> {
  const essay = await loadEssay(ctx, String(body.essayId ?? ''))
  const task = typeof body.task === 'string' && body.task.trim() ? body.task.trim().slice(0, 600) : ''
  if (!task) throw new ApiError(400, 'Missing task.')
  const text = learnerText(body.text)
  const targets = pickTargets(essay, body.targets)
  const res = await generateLogged<Record<string, unknown>>(ctx, `essay transfer: ${essay.id}`, {
    system: SYSTEM_TRANSFER,
    prompt: `New task: ${task}\n\nTarget phrases (from the model essay "${essay.title}"):\n${targetLines(targets)}\n\nLearner's paragraph:\n"""${text}"""`,
    schema: FEEDBACK_SCHEMA,
    retries: 2,
  })
  return normalize(res.value, targets, res.model, res.usage?.totalTokenCount ?? 0)
}
