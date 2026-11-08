// Mistakes across Writing and Speaking, from the existing mistake book (server/practice/mistakes.ts): counted by code,
// filtered here, explained by the model.
import { MISTAKE_LABEL, type MistakeCategory, type MistakeItem } from '../../../src/types/practice.ts'
import { mistakeBook } from '../../practice/mistakes.ts'
import { cut, dayOf, inRange } from '../data.ts'
import { optDay, optEnum, optEnumList, optInt } from './args.ts'
import { DAY, type CoachTool } from './types.ts'

const CATEGORIES = Object.keys(MISTAKE_LABEL) as MistakeCategory[]

/** Pure: the summary the tool returns for a list of mistake items (tested). */
export function summarizeMistakes(items: MistakeItem[], limit: number) {
  const byCategory = new Map<MistakeCategory, MistakeItem[]>()
  for (const item of items) byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), item])
  const categories = [...byCategory]
    .map(([category, list]) => ({
      category,
      errors: list.filter((i) => i.severity === 'error').length,
      improves: list.filter((i) => i.severity === 'improve').length,
      examples: [...list]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 2)
        .map((i) => ({ workId: i.workId, kind: i.kind === 'writing' ? 'writing' : 'speaking', day: dayOf(i.at), wrong: cut(i.wrong, 100), right: cut(i.right, 100), why: cut(i.why, 120) })),
    }))
    .sort((a, b) => b.errors + b.improves - (a.errors + a.improves))
    .slice(0, limit)
  const groups = new Map<string, { wrong: string; right: string; category: MistakeCategory; count: number }>()
  for (const i of items) {
    const g = groups.get(i.key)
    if (g) g.count++
    else groups.set(i.key, { wrong: cut(i.wrong, 80), right: cut(i.right, 80), category: i.category, count: 1 })
  }
  const repeated = [...groups.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count).slice(0, 8)
  return { total: items.length, categories, repeated }
}

export const getMistakes: CoachTool = {
  name: 'get_mistakes',
  description:
    "The learner's mistakes in scored Writing and Speaking work, counted by category (errors = wrong; improves = correct but weak or unnatural wording), with the newest examples and the mistakes made more than once. Filter by kind, days, categories and severity.",
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['writing', 'speaking', 'all'] },
      from: DAY,
      to: DAY,
      categories: { type: 'array', items: { type: 'string', enum: CATEGORIES } },
      severity: { type: 'string', enum: ['error', 'improve', 'all'] },
      limit: { type: 'integer', description: 'categories to return, 1-10, default 6' },
    },
  },
  label: (a) => (a.kind === 'speaking' ? 'Reading your Speaking mistakes…' : a.kind === 'writing' ? 'Reading your Writing mistakes…' : 'Reading your mistakes…'),
  async run(args, ctx) {
    const kind = optEnum(args, 'kind', ['writing', 'speaking', 'all'] as const, 'all')
    const from = optDay(args, 'from')
    const to = optDay(args, 'to')
    const categories = optEnumList(args, 'categories', CATEGORIES)
    const severity = optEnum(args, 'severity', ['error', 'improve', 'all'] as const, 'all')
    const limit = optInt(args, 'limit', 1, 10, 6)
    const book = await mistakeBook({ rootDir: ctx.rootDir, contentDir: ctx.contentDir })
    const items = book.items.filter(
      (i) =>
        (kind === 'all' || (kind === 'writing' ? i.kind === 'writing' : i.kind !== 'writing')) &&
        inRange(dayOf(i.at), from, to) &&
        (!categories.length || categories.includes(i.category)) &&
        (severity === 'all' || i.severity === severity),
    )
    return { filter: { kind, from: from ?? null, to: to ?? null, severity }, ...summarizeMistakes(items, limit) }
  },
}
