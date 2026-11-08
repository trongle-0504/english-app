// Admin → Usage: the Study Coach per day (questions, failures, median answer time, tokens, proposals confirmed).
// From the saved chats, so it covers the last 30 days at most (chats are deleted after that).
import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui'
import type { CoachDayStats } from '@/types/coach'
import * as api from './api'

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export function CoachStatsCard() {
  const [days, setDays] = useState<CoachDayStats[] | null>(null)
  useEffect(() => {
    let live = true
    api
      .stats()
      .then((d) => live && setDays(d))
      .catch(() => live && setDays([]))
    return () => {
      live = false
    }
  }, [])
  if (!days?.length) return null
  const turns = days.reduce((s, d) => s + d.turns, 0)
  const tokens = days.reduce((s, d) => s + d.tokens, 0)
  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-bold">
          <Sparkles className="size-4 text-violet-600 dark:text-violet-400" /> Nova Agent
        </h2>
        <p className="text-xs text-slate-500">
          {turns} questions · {fmtTokens(tokens)} tokens · {fmtTokens(Math.round(tokens / Math.max(1, turns)))} per question · last {days.length} active days
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
              <th className="py-2 font-medium">Day</th>
              <th className="py-2 text-right font-medium">Questions</th>
              <th className="py-2 text-right font-medium">Failed</th>
              <th className="py-2 text-right font-medium">Median time</th>
              <th className="py-2 text-right font-medium">Tokens</th>
              <th className="py-2 text-right font-medium">Confirmed</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                <td className="py-2 tabular-nums">{d.day}</td>
                <td className="py-2 text-right tabular-nums">{d.turns}</td>
                <td className="py-2 text-right tabular-nums text-slate-500">{d.errors || '—'}</td>
                <td className="py-2 text-right tabular-nums">{d.medianMs ? `${(d.medianMs / 1000).toFixed(1)} s` : '—'}</td>
                <td className="py-2 text-right tabular-nums">{fmtTokens(d.tokens)}</td>
                <td className="py-2 text-right tabular-nums text-slate-500">{d.proposals ? `${d.applied} / ${d.proposals}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
