// POST /api/review/produce: checks sentences the learner wrote — "Viết lại câu" (rewrite a given sentence with the
// target) and "Tự dùng" (own sentence) — up to 5 per Gemini call, both kinds mixed.
// Kept small on purpose: a short system prompt, one compact line block per sentence, and a fixed JSON schema whose
// optional texts must be "" when there is nothing to say. The grade itself is decided by code (ladder.ts) from the
// verdict, so the model never chooses Again/Hard/Good/Easy.
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { ProduceItem, ProduceResponse, ProduceResult, ProduceVerdict } from '../../src/types/review.ts'
import { generateLogged } from '../admin/ai.ts'
import { isObject } from '../admin/input.ts'
import { ApiError, type ApiContext } from '../api.ts'

const MAX_ITEMS = 5
const VERDICTS: ProduceVerdict[] = ['ok', 'missing', 'wrong_meaning', 'wrong_collocation', 'wrong_form', 'changed_meaning']

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer', description: 'Item number.' },
          same_meaning: { type: 'boolean', description: 'REWRITE: SENTENCE says what REWRITE says (no idea lost/changed/added). TOPIC items: true.' },
          verdict: { type: 'string', enum: VERDICTS },
          natural: { type: 'boolean', description: 'Target sounds natural here (false = correct but forced).' },
          fixed: { type: 'string', description: 'Sentence with only the target part corrected; "" if verdict is ok.' },
          why: { type: 'string', description: 'Vietnamese, max 20 words; "" if ok and natural.' },
          better: {
            type: 'string',
            description: 'One natural sentence on the same topic using the target; "" if ok and natural, always "" for REWRITE.',
          },
          other: { type: 'string', description: 'Other errors not about the target, Vietnamese, max 15 words; "" if none.' },
          ref_backed: { type: 'boolean', description: 'ok: the usage is listed in REF; error: the correct form you give is listed in REF.' },
        },
        required: ['n', 'same_meaning', 'verdict', 'natural', 'fixed', 'why', 'better', 'other', 'ref_backed'],
      },
    },
  },
  required: ['items'],
}

const SYSTEM = `You check sentences of a Vietnamese IELTS learner: an own sentence on TOPIC, or the REWRITE sentence
paraphrased with TARGET. Judge ONLY how the TARGET is used:
ok = used with the given meaning, right form and right partner words.
missing = target (any inflected form) not used. wrong_meaning = used in another sense.
wrong_collocation = wrong partner/preposition/pattern (e.g. "take responsibility of").
wrong_form = wrong word form or grammar of the target itself (e.g. "a sense of belong").
REWRITE items: FIRST compare the meaning with the REWRITE sentence; if any main idea is lost, changed or added, the
verdict is changed_meaning even when the target itself is used correctly.
natural=false only if correct but unidiomatic. Mistakes elsewhere go in "other" and never change the verdict.
REF = dictionary data for the target and is authoritative: a partner or pattern listed in REF is correct, never mark it
wrong; follow REF when fixing. Use your own knowledge only for what REF does not cover.
Keep every text short; leave optional fields "".`

const clean = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

function items(raw: unknown): ProduceItem[] {
  if (!Array.isArray(raw) || !raw.length) throw new ApiError(400, '`items` must be a non-empty array.')
  if (raw.length > MAX_ITEMS) throw new ApiError(400, `At most ${MAX_ITEMS} sentences per check.`)
  return raw.map((r, i) => {
    if (!isObject(r)) throw new ApiError(400, `items[${i}] must be an object.`)
    const item: ProduceItem = {
      id: clean(r.id, 200),
      target: clean(r.target, 120),
      meaning: clean(r.meaning, 120),
      topic: clean(r.topic, 40),
      source: clean(r.source, 300),
      question: clean(r.question, 200),
      ref: clean(r.ref, 320),
      sentence: clean(r.sentence, 400),
    }
    if (!item.id || !item.target) throw new ApiError(400, `items[${i}] needs id and target.`)
    if (item.sentence.split(' ').length < 4) throw new ApiError(400, `Write a full sentence for "${item.target}".`)
    return item
  })
}

/** Mistakes are kept (progress/produce-log.jsonl) for a later "mistake notebook"; correct answers are not. */
async function logMistakes(ctx: ApiContext, list: ProduceItem[], results: ProduceResult[]) {
  const lines = results
    .map((r, i) => ({ r, item: list[i] }))
    .filter(({ r }) => r.verdict !== 'ok' || !r.natural)
    .map(({ r, item }) =>
      JSON.stringify({
        at: new Date().toISOString(),
        id: item.id,
        target: item.target,
        sentence: item.sentence,
        verdict: r.verdict,
        fixed: r.fixed,
        why: r.why,
        refBacked: r.refBacked,
      }),
    )
  if (!lines.length) return
  const dir = path.join(ctx.rootDir, 'progress')
  await mkdir(dir, { recursive: true })
  await appendFile(path.join(dir, 'produce-log.jsonl'), `${lines.join('\n')}\n`)
}

/** "1. TARGET: alleviate (giảm bớt) | REWRITE: The government should reduce poverty." + REF + SENTENCE lines. */
function promptLines(n: number, it: ProduceItem): string {
  const task = it.source ? `REWRITE: ${it.source}` : `TOPIC: ${it.topic}`
  return [`${n}. TARGET: ${it.target}${it.meaning ? ` (${it.meaning})` : ''} | ${task}`, it.ref && `REF: ${it.ref}`, `SENTENCE: ${it.sentence}`]
    .filter(Boolean)
    .join('\n')
}

export async function checkProduce(ctx: ApiContext, body: Record<string, unknown>): Promise<ProduceResponse> {
  const list = items(body.items)
  const prompt = list.map((it, i) => promptLines(i + 1, it)).join('\n')
  const res = await generateLogged<{ items?: Record<string, unknown>[] }>(
    ctx,
    `review produce: ${list
      .map((i) => i.target)
      .join(', ')
      .slice(0, 60)}`,
    {
      system: SYSTEM,
      prompt,
      jsonSchema: SCHEMA,
      thinking: 'low',
      retries: 2,
    },
  )
  const answers = Array.isArray(res.value?.items) ? res.value.items : []
  const results: ProduceResult[] = list.map((it, i) => {
    const a = answers.find((x) => Number(x.n) === i + 1)
    // A sentence the model skipped is not silently passed.
    if (!a || !VERDICTS.includes(a.verdict as ProduceVerdict)) throw new ApiError(502, 'Gemini did not check every sentence — try again.')
    // A rewrite that says something else fails even when the target is used well (decided here, not left to the verdict).
    const verdict: ProduceVerdict = it.source && a.same_meaning === false && a.verdict === 'ok' ? 'changed_meaning' : (a.verdict as ProduceVerdict)
    return {
      id: it.id,
      verdict,
      natural: a.natural !== false,
      fixed: verdict === 'ok' ? '' : clean(a.fixed, 400),
      why: clean(a.why, 200),
      better: clean(a.better, 300),
      other: clean(a.other, 160),
      // Without REF data nothing can back it.
      refBacked: Boolean(it.ref) && a.ref_backed === true,
    }
  })
  await logMistakes(ctx, list, results).catch((e) => console.warn('[produce] log failed:', (e as Error).message))
  return { results, usage: { model: res.model, total: res.usage?.totalTokenCount ?? 0 } }
}
