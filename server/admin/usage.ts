// Admin → Usage: Gemini tokens and cost for a period (GET /admin/usage?from=YYYY-MM-DD&to=YYYY-MM-DD, local server time).
import { ApiError, type ApiHandler } from '../api.ts'
import { costOf, featureOf, providerOf, readPricing, readUsage, writePricing, type ModelPrice, type Pricing, type UsageEntry, type UsageProvider } from '../usage.ts'
import { jsonBody } from './input.ts'

interface Bucket {
  key: string
  calls: number
  failed: number
  input: number
  output: number
  thinking: number
  total: number
  /** USD; calls of unpriced models count 0 and are reported in `unpriced`. */
  cost: number
}

const empty = (key: string): Bucket => ({ key, calls: 0, failed: 0, input: 0, output: 0, thinking: 0, total: 0, cost: 0 })
function add(b: Bucket, e: UsageEntry, cost: number | null) {
  b.calls++
  if (e.failed) b.failed++
  b.input += e.input
  b.output += e.output
  b.thinking += e.thinking
  b.total += e.total
  b.cost += cost ?? 0
}

/** Local calendar day of an ISO time ("2026-10-02"). */
const dayOf = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const validDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

export const getUsage: ApiHandler = async (req) => {
  const from = req.query.get('from') ?? ''
  const to = req.query.get('to') ?? ''
  if ((from && !validDay(from)) || (to && !validDay(to))) throw new ApiError(400, '"from" and "to" must be YYYY-MM-DD.')
  const [entries, pricing] = await Promise.all([readUsage(), readPricing()])

  const total = empty('total')
  const byProvider = new Map<string, Bucket>()
  const byFeature = new Map<string, Bucket>()
  const byModel = new Map<string, Bucket>()
  const byDay = new Map<string, Bucket>()
  /** "day|model" → bucket: the per-model daily series of the charts. */
  const byDayModel = new Map<string, Bucket & { day: string; model: string; provider: UsageProvider }>()
  const byMonth = new Map<string, Bucket>()
  const unpriced = new Set<string>()
  const recent: (UsageEntry & { cost: number | null; feature: string; provider: UsageProvider })[] = []
  for (const e of entries) {
    const cost = costOf(pricing, e)
    if (cost == null) unpriced.add(e.model)
    const day = dayOf(e.at)
    const provider = providerOf(e)
    // Months cover everything, so the month table can be used to pick a period.
    const month = day.slice(0, 7)
    add(byMonth.get(month) ?? byMonth.set(month, empty(month)).get(month)!, e, cost)
    if ((from && day < from) || (to && day > to)) continue
    const feature = featureOf(e.label)
    add(total, e, cost)
    add(byProvider.get(provider) ?? byProvider.set(provider, empty(provider)).get(provider)!, e, cost)
    add(byFeature.get(feature) ?? byFeature.set(feature, empty(feature)).get(feature)!, e, cost)
    add(byModel.get(e.model) ?? byModel.set(e.model, empty(e.model)).get(e.model)!, e, cost)
    add(byDay.get(day) ?? byDay.set(day, empty(day)).get(day)!, e, cost)
    const dm = `${day}|${e.model}`
    add(byDayModel.get(dm) ?? byDayModel.set(dm, { ...empty(dm), day, model: e.model, provider }).get(dm)!, e, cost)
    recent.push({ ...e, cost, feature, provider })
  }
  const byCost = (a: Bucket, b: Bucket) => b.cost - a.cost || b.total - a.total
  return {
    json: {
      from,
      to,
      total,
      providers: [...byProvider.values()].sort((a, b) => b.total - a.total),
      features: [...byFeature.values()].sort(byCost),
      models: [...byModel.values()].sort(byCost),
      days: [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
      daily: [...byDayModel.values()].sort((a, b) => a.day.localeCompare(b.day)),
      months: [...byMonth.values()].sort((a, b) => b.key.localeCompare(a.key)),
      recent: recent.slice(-50).reverse(),
      unpriced: [...unpriced],
      first: entries[0]?.at,
      pricing,
    },
  }
}

/** PUT /admin/usage/pricing { usdToVnd, models: { name: { input, output, … } } } */
export const savePricing: ApiHandler = async (req) => {
  const body = jsonBody(req)
  const rate = Number(body.usdToVnd)
  if (!(rate >= 0)) throw new ApiError(400, '"usdToVnd" must be a number.')
  const models: Record<string, ModelPrice> = {}
  const raw = body.models && typeof body.models === 'object' ? (body.models as Record<string, Record<string, unknown>>) : {}
  for (const [name, p] of Object.entries(raw)) {
    const key = name.trim()
    if (!/^[a-z0-9.-]{3,60}$/.test(key)) throw new ApiError(400, `Invalid model name "${name}".`)
    const num = (v: unknown) => (v === '' || v == null ? undefined : Number(v))
    const price: ModelPrice = { input: Number(p.input), output: Number(p.output) }
    if (!(price.input >= 0) || !(price.output >= 0)) throw new ApiError(400, `"${key}": input and output prices must be numbers.`)
    for (const k of ['inputLong', 'outputLong', 'longAbove'] as const) {
      const v = num(p[k])
      if (v != null) {
        if (!(v >= 0)) throw new ApiError(400, `"${key}.${k}" must be a number.`)
        price[k] = v
      }
    }
    models[key] = price
  }
  const pricing: Pricing = { usdToVnd: rate, models, updated: new Date().toISOString().slice(0, 10) }
  await writePricing(pricing)
  return { json: { pricing: await readPricing() } }
}
