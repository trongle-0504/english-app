// Tells the user when the DOL dictionary stops working for the app (server/writing-review/dol-health.ts), instead of
// the features quietly giving no DOL hints: what fails, a code, a "copy the report" button (to send to the app's owner)
// and "check again" (after a fix). A structure change (DOL renamed or moved what the app reads) needs the code fixed;
// unreachable / refused are usually temporary.
import { AlertTriangle, Check, ClipboardCopy, Loader2, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import type { DolFailure, DolPart, DolProblem, DolStatus } from '@/types/lookup'

const PART: Record<DolPart, string> = {
  list: 'Danh sách từ DOL',
  entry: 'Tra mục từ DOL',
  search: 'Tìm kiếm DOL',
  note: 'Ghi chú DOL',
}
const KIND: Record<DolFailure, string> = {
  format: 'DOL đã đổi cấu trúc dữ liệu — app cần được sửa',
  network: 'Không kết nối được tới DOL (mạng, hoặc DOL đang sập)',
  blocked: 'DOL đang tạm chặn yêu cầu (app tự thử lại sau 15 phút)',
  http: 'DOL trả về lỗi',
}

const when = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

/** The report a user sends to the owner. */
function reportOf(problems: DolProblem[]): string {
  return [
    `Báo lỗi DOL — ${new Date().toLocaleString('vi-VN')}`,
    ...problems.map((p) => `${p.code} (${PART[p.part]}): ${p.message} — lúc ${when(p.at)}`),
    `Trang: ${window.location.pathname}${window.location.search}`,
  ].join('\n')
}

const dismissedKey = (problems: DolProblem[]) => `dol-banner:${problems.map((p) => `${p.code}@${p.at}`).join('|')}`

export function DolStatusBanner({ compact = false, className }: { compact?: boolean; className?: string }) {
  const [status, setStatus] = useState<DolStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [fixed, setFixed] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/dol/status')
      .then((res) => (res.ok && (res.headers.get('content-type') ?? '').includes('json') ? (res.json() as Promise<DolStatus>) : null))
      .then((s) => s && setStatus(s))
      // No local server (static hosting): DOL is not used there either.
      .catch(() => {})
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  const problems = status?.enabled ? status.problems : []
  const key = dismissedKey(problems)
  let hidden = dismissed === key
  try {
    hidden ||= sessionStorage.getItem(key) === '1'
  } catch {
    // Storage blocked: the banner just shows.
  }

  const check = async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/dol/check', { method: 'POST' })
      const next = (await res.json()) as DolStatus
      setStatus(next)
      if (!next.problems.length) setFixed(true)
    } catch {
      // Still failing: the banner stays.
    } finally {
      setChecking(false)
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportOf(problems))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard refused: the codes are on screen.
    }
  }
  const dismiss = () => {
    setDismissed(key)
    try {
      sessionStorage.setItem(key, '1')
    } catch {
      // ignore
    }
  }

  if (fixed && !problems.length)
    return (
      <p className={cn('flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300', className)}>
        <Check className="size-4" /> Từ điển DOL đã hoạt động lại.
      </p>
    )
  if (!problems.length || hidden) return null

  const broken = problems.some((p) => p.kind === 'format')
  const tone = broken
    ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100'
    : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
  const actions = (
    <span className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => void copy()}
        title="Sao chép mã lỗi và chi tiết để gửi cho người quản trị app"
        className="inline-flex items-center gap-1 rounded-lg bg-white/70 px-2 py-1 text-xs font-semibold ring-1 ring-current/20 hover:bg-white dark:bg-slate-900/50"
      >
        {copied ? <Check className="size-3.5" /> : <ClipboardCopy className="size-3.5" />} {copied ? 'Đã sao chép' : 'Sao chép báo lỗi'}
      </button>
      <button
        type="button"
        onClick={() => void check()}
        disabled={checking}
        title="Thử lại DOL ngay (danh sách từ, một mục từ, tìm kiếm)"
        className="inline-flex items-center gap-1 rounded-lg bg-white/70 px-2 py-1 text-xs font-semibold ring-1 ring-current/20 hover:bg-white disabled:opacity-60 dark:bg-slate-900/50"
      >
        {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Kiểm tra lại
      </button>
    </span>
  )

  if (compact)
    return (
      <div className={cn('flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs', tone, className)}>
        <AlertTriangle className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <strong>Từ điển DOL đang lỗi</strong> ({problems.map((p) => p.code).join(', ')}).{' '}
          {broken ? 'Hãy báo lại cho người quản trị app.' : 'Có thể chỉ là tạm thời.'}
        </span>
        {actions}
      </div>
    )

  return (
    <div role="status" className={cn('rounded-2xl border px-4 py-3 text-sm', tone, className)}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-bold">
            Từ điển DOL đang gặp sự cố — gợi ý Việt → Anh từ DOL tạm thời không có.
            {broken ? ' Hãy bấm “Sao chép báo lỗi” và gửi cho người quản trị app để sửa.' : ''}
          </p>
          <ul className="space-y-1">
            {problems.map((p) => (
              <li key={p.code}>
                <span className="font-semibold">{PART[p.part]}:</span> {KIND[p.kind]} · <code className="text-xs">{p.code}</code>
                <span className="block text-xs opacity-75">
                  {p.message} — lúc {when(p.at)}
                </span>
              </li>
            ))}
          </ul>
          {actions}
        </div>
        <button type="button" onClick={dismiss} title="Ẩn thông báo này (đến khi có lỗi mới)" className="rounded-lg p-1 opacity-60 hover:opacity-100">
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
