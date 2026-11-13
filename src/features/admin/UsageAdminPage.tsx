import { Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, Card } from '@/components/ui'
import { CoachStatsCard } from '@/features/coach/CoachStatsCard'
import { adminApi, errorMessage } from './api'
import { EditorSkeleton, StatusAlert, TextInput } from './ui'
import { useAction } from './utils'

interface Bucket {
  key: string
  calls: number
  failed: number
  input: number
  output: number
  thinking: number
  total: number
  cost: number
}

interface ModelPrice {
  input: number
  output: number
  inputLong?: number
  outputLong?: number
  longAbove?: number
}

interface Pricing {
  source?: string
  updated?: string
  usdToVnd: number
  models: Record<string, ModelPrice>
}

interface UsageReport {
  from: string
  to: string
  total: Bucket
  providers: Bucket[]
  features: Bucket[]
  models: Bucket[]
  days: Bucket[]
  /** One bucket per day and model (key "day|model"). */
  daily: (Bucket & { day: string; model: string; provider?: string })[]
  months: Bucket[]
  recent: {
    at: string
    label: string
    feature: string
    model: string
    provider?: string
    input: number
    output: number
    thinking: number
    total: number
    ms: number
    failed?: boolean
    cost: number | null
  }[]
  unpriced: string[]
  first?: string
  pricing: Pricing
}

const PROVIDER_LABEL: Record<string, { label: string; badge: string; color: string }> = {
  antigravity: { label: 'Antigravity CLI', badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800', color: 'emerald' },
  'antigravity-acp': { label: 'Antigravity (agy ấm)', badge: 'bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border-teal-200 dark:border-teal-800', color: 'teal' },
  claude: { label: 'Claude Code', badge: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800', color: 'indigo' },
  gemini_api: { label: 'Gemini API Key', badge: 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border-sky-200 dark:border-sky-800', color: 'sky' },
}

type Preset = 'this-month' | 'last-month' | '7d' | '30d' | '90d' | 'all' | 'custom'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function range(preset: Preset): { from: string; to: string } {
  const now = new Date()
  if (preset === 'this-month') return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) }
  if (preset === 'last-month') return { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) }
  const days = { '7d': 7, '30d': 30, '90d': 90 }[preset as '7d']
  if (days) return { from: ymd(new Date(now.getTime() - (days - 1) * 86_400_000)), to: ymd(now) }
  return { from: '', to: '' }
}

const fmtInt = (n: number) => n.toLocaleString('en-US')
const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : fmtInt(n))
const fmtUsd = (n: number) => (n === 0 ? '$0' : `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`)
const fmtVnd = (usd: number, rate: number) => (rate ? `${Math.round(usd * rate).toLocaleString('vi-VN')} ₫` : '')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-09-28" → "Sep 28", the date style of Google AI Studio's charts. */
const shortDay = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8))}`

/**
 * The days on the x axis: at least 30 from the start of the period (a whole month for the month presets). `past` is
 * false for days still to come — charts draw no line there.
 */
function axisDays(from: string, to: string, first?: string): { day: string; past: boolean }[] {
  const today = ymd(new Date())
  const start = from || first || today
  let end = to || today
  const startDate = new Date(`${start}T12:00:00`)
  if (/-01$/.test(start) && end.slice(0, 7) === start.slice(0, 7)) end = ymd(new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0))
  const min30 = ymd(new Date(startDate.getTime() + 29 * 86_400_000))
  if (end < min30) end = min30
  const last = to && to < today ? to : today
  const out: { day: string; past: boolean }[] = []
  for (let d = new Date(startDate); ymd(d) <= end && out.length < 400; d.setDate(d.getDate() + 1)) out.push({ day: ymd(d), past: ymd(d) <= last })
  return out
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(560)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** "Nice" top of the y axis (1, 2, 5 × 10ⁿ), so the gridlines read as round numbers. */
function niceTop(max: number): number {
  if (max <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(max))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((v) => v >= max) ?? 10 * p
}

/**
 * One metric per day, laid out like a Google AI Studio usage card: title, period total, a line with a point per day
 * and a crosshair tooltip. The line stops at today; days without calls are 0.
 */
function MetricCard({
  title,
  total,
  axis,
  values,
  format,
  tip,
  legend,
}: {
  title: string
  total: string
  axis: { day: string; past: boolean }[]
  values: number[]
  format: (v: number) => string
  tip?: (i: number) => string
  legend: string
}) {
  const [box, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const H = 190
  const pad = { l: 8, r: 52, t: 10, b: 24 }
  const plotW = width - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const top = niceTop(Math.max(0, ...values.filter((_, i) => axis[i].past)))
  const x = (i: number) => pad.l + (axis.length === 1 ? plotW / 2 : (i / (axis.length - 1)) * plotW)
  const y = (v: number) => pad.t + plotH - (v / top) * plotH
  const past = axis.map((_, i) => i).filter((i) => axis[i].past)
  const line = past.map((i, n) => `${n ? 'L' : 'M'}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join(' ')
  const ticks = Math.max(1, Math.ceil(axis.length / Math.max(2, Math.floor(plotW / 70))))
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((((e.clientX - r.left) / r.width) * width - pad.l) / plotW) * (axis.length - 1))
    setHover(Math.min(axis.length - 1, Math.max(0, i)))
  }
  const h = hover != null ? axis[hover] : null
  const tipLeft = hover != null ? Math.min(Math.max(x(hover) / width, 0.1), 0.72) : 0
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          <p className="mt-0.5 text-xl font-bold text-slate-900 tabular-nums dark:text-white">{total}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span className="h-0.5 w-3.5 rounded bg-brand-600 dark:bg-brand-400" />
          {legend}
        </span>
      </div>
      <div ref={box} className="relative mt-2">
        {h ? (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] whitespace-nowrap text-white shadow-lg tabular-nums dark:bg-slate-700"
            style={{ left: `${tipLeft * 100}%` }}
          >
            <span className="font-semibold">{shortDay(h.day)}</span> · {h.past ? (tip ? tip(hover!) : format(values[hover!])) : 'chưa tới'}
          </div>
        ) : null}
        <svg width="100%" viewBox={`0 0 ${width} ${H}`} className="block touch-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={title}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={pad.l} x2={width - pad.r} y1={y(top * f)} y2={y(top * f)} className={f ? 'stroke-slate-100 dark:stroke-slate-800' : 'stroke-slate-300 dark:stroke-slate-600'} strokeWidth={1} />
              <text x={width - pad.r + 6} y={y(top * f) + 3.5} className="fill-slate-400 text-[10px] tabular-nums">
                {format(top * f)}
              </text>
            </g>
          ))}
          {axis.map((a, i) =>
            (i % ticks === 0 && axis.length - 1 - i >= ticks / 2) || i === axis.length - 1 ? (
              <text key={a.day} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === axis.length - 1 ? 'end' : 'middle'} className="fill-slate-400 text-[10px]">
                {shortDay(a.day)}
              </text>
            ) : null,
          )}
          {line ? <path d={line} fill="none" className="stroke-brand-600 dark:stroke-brand-400" strokeWidth={2} strokeLinejoin="round" /> : null}
          {past.map((i) => (
            <circle key={i} cx={x(i)} cy={y(values[i])} r={hover === i ? 4.5 : 2.5} className="fill-brand-600 dark:fill-brand-400" />
          ))}
          {h ? <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={pad.t + plotH} className="stroke-slate-300 dark:stroke-slate-600" strokeWidth={1} strokeDasharray="3 3" pointerEvents="none" /> : null}
        </svg>
      </div>
    </Card>
  )
}

function PricingEditor({ pricing, onSaved }: { pricing: Pricing; onSaved: (p: Pricing) => void }) {
  const [draft, setDraft] = useState(() => ({
    usdToVnd: String(pricing.usdToVnd || ''),
    models: Object.entries(pricing.models).map(([name, p]) => ({
      name,
      input: String(p.input),
      output: String(p.output),
      inputLong: p.inputLong != null ? String(p.inputLong) : '',
      outputLong: p.outputLong != null ? String(p.outputLong) : '',
      longAbove: p.longAbove != null ? String(p.longAbove) : '',
    })),
  }))
  const action = useAction()
  const set = (i: number, key: string, value: string) => setDraft((d) => ({ ...d, models: d.models.map((m, n) => (n === i ? { ...m, [key]: value } : m)) }))
  const save = () =>
    action.run('save', async () => {
      const res = await adminApi<{ pricing: Pricing }>('usage/pricing', {
        method: 'PUT',
        body: {
          usdToVnd: Number(draft.usdToVnd) || 0,
          models: Object.fromEntries(draft.models.filter((m) => m.name.trim()).map((m) => [m.name.trim(), { input: m.input, output: m.output, inputLong: m.inputLong, outputLong: m.outputLong, longAbove: m.longAbove }])),
        },
      })
      onSaved(res.pricing)
      action.setStatus({ tone: 'success', message: 'Đã lưu đơn giá — chi phí được tính lại theo giá mới.' })
    })
  const cell = 'h-8 w-full min-w-16 px-2 text-right text-sm tabular-nums'
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1.5 pr-2 font-semibold">Model</th>
              <th className="py-1.5 pr-2 font-semibold">Input $/1M</th>
              <th className="py-1.5 pr-2 font-semibold">Output $/1M</th>
              <th className="py-1.5 pr-2 font-semibold" title="Giá khi prompt dài hơn ngưỡng (chỉ dòng Pro)">Input dài</th>
              <th className="py-1.5 pr-2 font-semibold">Output dài</th>
              <th className="py-1.5 font-semibold">Ngưỡng (token)</th>
            </tr>
          </thead>
          <tbody>
            {draft.models.map((m, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <TextInput className="h-8 min-w-44 px-2 text-sm" value={m.name} onChange={(e) => set(i, 'name', e.target.value)} />
                </td>
                {(['input', 'output', 'inputLong', 'outputLong', 'longAbove'] as const).map((k) => (
                  <td key={k} className="py-1 pr-2">
                    <TextInput className={cell} inputMode="decimal" value={m[k]} onChange={(e) => set(i, k, e.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, models: [...d.models, { name: '', input: '', output: '', inputLong: '', outputLong: '', longAbove: '' }] }))}>
          + Thêm model
        </Button>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          1 USD =
          <TextInput className="h-8 w-28 px-2 text-right text-sm tabular-nums" inputMode="numeric" value={draft.usdToVnd} onChange={(e) => setDraft((d) => ({ ...d, usdToVnd: e.target.value }))} />
          VND
        </label>
        <Button size="sm" className="ml-auto" loading={action.pending === 'save'} onClick={() => void save()}>
          <Save className="size-4" /> Lưu đơn giá
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Giá Standard (paid tier) theo{' '}
        <a href={pricing.source ?? 'https://ai.google.dev/gemini-api/docs/pricing'} target="_blank" rel="noreferrer" className="text-brand-600 underline">
          bảng giá Gemini API
        </a>
        {pricing.updated ? `, cập nhật ${pricing.updated}` : ''}. Output gồm cả token thinking. Lưu trong <code>config/gemini-pricing.json</code> — sửa file đó cũng được.
      </p>
      <StatusAlert status={action.status} onDismiss={() => action.setStatus(null)} />
    </div>
  )
}

export default function UsageAdminPage() {
  const [preset, setPreset] = useState<Preset>('30d')
  // '' = the model used most in the period (most people use one); '*' = all models.
  const [modelPick, setModelPick] = useState('')
  const [providerPick, setProviderPick] = useState('*')
  const [custom, setCustom] = useState(() => range('this-month'))
  const period = preset === 'custom' ? custom : range(preset)
  const [report, setReport] = useState<UsageReport | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true
    adminApi<UsageReport>('usage', { query: { from: period.from, to: period.to } }).then(
      (r) => active && (setReport(r), setError('')),
      (e) => active && setError(errorMessage(e)),
    )
    return () => {
      active = false
    }
  }, [period.from, period.to, version])

  if (!report && !error) return <EditorSkeleton />
  const rate = report?.pricing.usdToVnd ?? 0
  const models = report?.models.map((m) => m.key) ?? []
  const model = modelPick === '*' ? '*' : modelPick && models.includes(modelPick) ? modelPick : (models[0] ?? '*')
  const rows = (report?.daily ?? []).filter((d) => {
    const matchModel = model === '*' || d.model === model
    const matchProvider = providerPick === '*' || d.provider === providerPick
    return matchModel && matchProvider
  })
  const t = rows.reduce(
    (acc, d) => ({
      ...acc,
      calls: acc.calls + d.calls,
      failed: acc.failed + d.failed,
      input: acc.input + d.input,
      output: acc.output + d.output,
      thinking: acc.thinking + d.thinking,
      total: acc.total + d.total,
      cost: acc.cost + d.cost,
    }),
    { key: 'total', calls: 0, failed: 0, input: 0, output: 0, thinking: 0, total: 0, cost: 0 } as Bucket,
  )
  const axis = axisDays(period.from, period.to, report?.first?.slice(0, 10))
  const perDay = new Map<string, Bucket>()
  for (const d of rows) {
    const b = perDay.get(d.day) ?? { key: d.day, calls: 0, failed: 0, input: 0, output: 0, thinking: 0, total: 0, cost: 0 }
    b.calls += d.calls
    b.failed += d.failed
    b.input += d.input
    b.output += d.output
    b.thinking += d.thinking
    b.total += d.total
    b.cost += d.cost
    perDay.set(d.day, b)
  }
  const at = (key: keyof Bucket) => axis.map((a) => Number(perDay.get(a.day)?.[key] ?? 0))
  const legend = model === '*' ? 'Tất cả model' : model
  const chip = 'h-9 rounded-full border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'
  // Month to date, every model: what has been spent since the 1st, the pace for the whole month, and last month.
  const now = new Date()
  const monthKey = ymd(now).slice(0, 7)
  const lastKey = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7)
  const thisMonth = report?.months.find((m) => m.key === monthKey)
  const lastMonth = report?.months.find((m) => m.key === lastKey)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const projected = thisMonth ? (thisMonth.cost / now.getDate()) * daysInMonth : 0

  return (
    <div className="space-y-6">
      <StatusAlert status={error ? { tone: 'error', message: error } : null} />
      {report ? (
        <Card className="flex flex-wrap items-end gap-x-10 gap-y-3 p-4 sm:p-5">
          <div>
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              Chi phí tháng {now.getMonth() + 1}/{now.getFullYear()} · 01/{pad(now.getMonth() + 1)} → {pad(now.getDate())}/{pad(now.getMonth() + 1)}
            </p>
            <p className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums dark:text-white">
              {fmtUsd(thisMonth?.cost ?? 0)}
              {rate ? <span className="ml-2 text-lg font-bold text-slate-500 dark:text-slate-400">{fmtVnd(thisMonth?.cost ?? 0, rate) || '0 ₫'}</span> : null}
            </p>
            <p className="text-xs text-slate-500 tabular-nums">
              {fmtInt(thisMonth?.calls ?? 0)} requests · {fmtTokens(thisMonth?.total ?? 0)} tokens · mọi model
            </p>
          </div>
          <div className="text-sm text-slate-600 tabular-nums dark:text-slate-300">
            <p className="text-xs text-slate-400">Dự kiến cả tháng (theo tốc độ hiện tại)</p>
            <p className="font-semibold">
              {fmtUsd(projected)}
              {rate ? ` · ${fmtVnd(projected, rate) || '0 ₫'}` : ''}
            </p>
          </div>
          <div className="text-sm text-slate-600 tabular-nums dark:text-slate-300">
            <p className="text-xs text-slate-400">Tháng trước (cả tháng)</p>
            <p className="font-semibold">
              {fmtUsd(lastMonth?.cost ?? 0)}
              {rate ? ` · ${fmtVnd(lastMonth?.cost ?? 0, rate) || '0 ₫'}` : ''}
            </p>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className={chip} aria-label="Time range">
          <option value="7d">7 ngày qua</option>
          <option value="30d">30 ngày qua</option>
          <option value="90d">90 ngày qua</option>
          <option value="this-month">Tháng này</option>
          <option value="last-month">Tháng trước</option>
          <option value="all">Toàn bộ</option>
          <option value="custom">Tuỳ chọn…</option>
        </select>
        <select value={providerPick} onChange={(e) => setProviderPick(e.target.value)} className={chip} aria-label="Nguồn Engine">
          <option value="*">Tất cả nguồn (Engine)</option>
          <option value="antigravity">Antigravity CLI (Gói sub)</option>
          <option value="antigravity-acp">Antigravity ấm, agy acp (Gói sub)</option>
          <option value="claude">Claude Code (Gói sub)</option>
          <option value="gemini_api">Gemini API Key (Google Cloud)</option>
        </select>
        <select value={model} onChange={(e) => setModelPick(e.target.value)} className={chip} aria-label="Model">
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value="*">Tất cả model</option>
        </select>
        {preset === 'custom' ? (
          <span className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <TextInput type="date" className="h-9 w-40" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />→
            <TextInput type="date" className="h-9 w-40" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </span>
        ) : (
          <span className="ml-1 text-sm text-slate-500 tabular-nums">{period.from ? `${shortDay(period.from)} – ${shortDay(period.to)}, ${period.to.slice(0, 4)}` : `Từ ${report?.first?.slice(0, 10) ?? '—'}`}</span>
        )}
      </div>

      {report ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <MetricCard
            title="Chi phí mỗi ngày"
            total={`${fmtUsd(t.cost)}${rate ? ` · ${fmtVnd(t.cost, rate)}` : ''}`}
            axis={axis}
            values={at('cost')}
            format={(v) => (v === 0 ? '$0' : v < 0.1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`)}
            tip={(i) => `${fmtUsd(at('cost')[i])}${rate ? ` (${fmtVnd(at('cost')[i], rate)})` : ''}`}
            legend={legend}
          />
          <MetricCard
            title="Requests mỗi ngày"
            total={`${fmtInt(t.calls)} requests${t.failed ? ` · ${t.failed} lỗi` : ''}`}
            axis={axis}
            values={at('calls')}
            format={(v) => fmtTokens(Math.round(v))}
            tip={(i) => `${fmtInt(at('calls')[i])} requests${at('failed')[i] ? ` · ${at('failed')[i]} lỗi` : ''}`}
            legend={legend}
          />
          <MetricCard title="Input tokens mỗi ngày" total={`${fmtTokens(t.input)} tokens`} axis={axis} values={at('input')} format={(v) => fmtTokens(Math.round(v))} tip={(i) => `${fmtInt(at('input')[i])} tokens`} legend={legend} />
          <MetricCard
            title="Output tokens mỗi ngày (gồm thinking)"
            total={`${fmtTokens(t.output + t.thinking)} tokens`}
            axis={axis}
            values={axis.map((_, i) => at('output')[i] + at('thinking')[i])}
            format={(v) => fmtTokens(Math.round(v))}
            tip={(i) => `${fmtInt(at('output')[i] + at('thinking')[i])} tokens (thinking ${fmtInt(at('thinking')[i])})`}
            legend={legend}
          />
        </div>
      ) : null}

      {report?.unpriced.length ? (
        <StatusAlert status={{ tone: 'warning', message: `Chưa có đơn giá cho: ${report.unpriced.join(', ')} — các lượt này tính $0. Thêm giá ở bảng dưới.` }} />
      ) : null}

      {report ? (
        <Card className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900 dark:text-white">Theo nguồn Engine (Antigravity CLI / Claude Code / Gemini API)</h3>
            <span className="text-xs text-slate-500">Phân loại nguồn thực thi</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(['antigravity', 'antigravity-acp', 'claude', 'gemini_api'] as const).map((pk) => {
              const meta = PROVIDER_LABEL[pk]
              const bucket = report.providers.find((p) => p.key === pk)
              const calls = bucket?.calls ?? 0
              const tokens = bucket?.total ?? 0
              const cost = bucket?.cost ?? 0
              const isSelected = providerPick === pk
              return (
                <div
                  key={pk}
                  onClick={() => setProviderPick(providerPick === pk ? '*' : pk)}
                  className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
                    isSelected
                      ? 'border-brand-500 bg-brand-50/40 ring-2 ring-brand-500/20 dark:bg-brand-950/20'
                      : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${meta.badge}`}>
                      {meta.label}
                    </span>
                    {pk === 'gemini_api' ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Trả phí API</span>
                    ) : (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Gói Sub ($0)</span>
                    )}
                  </div>
                  <div className="mt-2.5 flex items-baseline justify-between">
                    <span className="text-lg font-bold text-slate-900 tabular-nums dark:text-white">
                      {fmtTokens(tokens)} <span className="text-xs font-normal text-slate-500">tokens</span>
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">{fmtInt(calls)} reqs</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                    <span>Chi phí:</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {fmtUsd(cost)}
                      {rate && cost > 0 ? ` (${fmtVnd(cost, rate)})` : ''}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      ) : null}

      {report ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-4 sm:p-5 space-y-3">
            <h3 className="font-bold text-slate-900 dark:text-white">Theo tính năng</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
                    <th className="pb-2 font-semibold">Tính năng</th>
                    <th className="pb-2 text-right font-semibold">Requests</th>
                    <th className="pb-2 text-right font-semibold">Tokens</th>
                    <th className="pb-2 text-right font-semibold">Chi phí</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.features.map((f) => (
                    <tr key={f.key}>
                      <td className="py-2 font-medium text-slate-800 dark:text-slate-200">{f.key}</td>
                      <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtInt(f.calls)}</td>
                      <td className="py-2 text-right tabular-nums font-semibold text-slate-900 dark:text-white">{fmtTokens(f.total)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtUsd(f.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4 sm:p-5 space-y-3">
            <h3 className="font-bold text-slate-900 dark:text-white">Theo model</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
                    <th className="pb-2 font-semibold">Model</th>
                    <th className="pb-2 font-semibold">Nguồn</th>
                    <th className="pb-2 text-right font-semibold">Requests</th>
                    <th className="pb-2 text-right font-semibold">Tokens</th>
                    <th className="pb-2 text-right font-semibold">Chi phí</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.models.map((m) => {
                    // Match provider from daily or infer
                    const sample = report.daily.find((d) => d.model === m.key && d.provider)
                    const provKey = sample?.provider || (m.key.startsWith('claude') ? 'claude' : m.cost === 0 ? 'antigravity' : 'gemini_api')
                    const pMeta = PROVIDER_LABEL[provKey]
                    return (
                      <tr key={m.key}>
                        <td className="py-2 font-medium text-slate-800 dark:text-slate-200">{m.key}</td>
                        <td className="py-2">
                          {pMeta ? (
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${pMeta.badge}`}>
                              {pMeta.label}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtInt(m.calls)}</td>
                        <td className="py-2 text-right tabular-nums font-semibold text-slate-900 dark:text-white">{fmtTokens(m.total)}</td>
                        <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtUsd(m.cost)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {report?.recent.length ? (
        <Card className="p-4 sm:p-5 space-y-3">
          <h3 className="font-bold text-slate-900 dark:text-white">Lịch sử gọi AI gần đây ({report.recent.length} lần gần nhất)</h3>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
                  <th className="pb-2 font-semibold">Thời gian</th>
                  <th className="pb-2 font-semibold">Nguồn</th>
                  <th className="pb-2 font-semibold">Tính năng</th>
                  <th className="pb-2 font-semibold">Model</th>
                  <th className="pb-2 text-right font-semibold">Input</th>
                  <th className="pb-2 text-right font-semibold">Output</th>
                  <th className="pb-2 text-right font-semibold">Thinking</th>
                  <th className="pb-2 text-right font-semibold">Tổng token</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.recent.map((r, i) => {
                  const pMeta = r.provider ? PROVIDER_LABEL[r.provider] : null
                  return (
                    <tr key={i}>
                      <td className="py-2 text-xs text-slate-500 tabular-nums">{new Date(r.at).toLocaleTimeString('vi-VN')} {shortDay(r.at.slice(0, 10))}</td>
                      <td className="py-2">
                        {pMeta ? (
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${pMeta.badge}`}>
                            {pMeta.label}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2 font-medium text-slate-800 dark:text-slate-200">{r.feature}</td>
                      <td className="py-2 text-xs text-slate-600 dark:text-slate-400">{r.model}</td>
                      <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtInt(r.input)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtInt(r.output)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-500">{fmtInt(r.thinking)}</td>
                      <td className="py-2 text-right tabular-nums font-semibold text-slate-900 dark:text-white">{fmtInt(r.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <CoachStatsCard />

      {report ? (
        <>
          <p className="-mt-2 text-xs text-slate-500">
            Chi phí ước tính từ số token Gemini trả về và đơn giá bên dưới; hoá đơn thật trên Google Cloud có thể chênh lệch nhỏ.
          </p>
          <details className="group rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700 select-none dark:text-slate-200">
              Đơn giá & tỷ giá <span className="font-normal text-slate-400">— USD / 1 triệu token, 1 USD = {rate.toLocaleString("vi-VN")} ₫</span>
            </summary>
            <div className="mt-4">
              <PricingEditor key={JSON.stringify(report.pricing)} pricing={report.pricing} onSaved={() => setVersion((v) => v + 1)} />
            </div>
          </details>
        </>
      ) : null}
    </div>
  )
}
