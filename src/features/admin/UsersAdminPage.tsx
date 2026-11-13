// Multi-user app, Admin → Users: sign-ups waiting for approval, adding people, daily limits, devices, passwords,
// "view as", data export and deletion; sign-up switch and the learner limit (PLAN-multi-user-v2.md, 6.1–6.3).
import { Check, Eye, KeyRound, Lock, Plus, RefreshCw, Trash2, Unlock, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, Card } from '@/components/ui'
import { setViewAs } from '@/features/auth/session'
import { Field, TextInput } from './ui'

interface Row {
  id: string
  email: string
  displayName: string
  role: 'admin' | 'learner'
  status: 'pending' | 'active' | 'rejected'
  disabled: boolean
  twoFactor: boolean
  mustChangePassword: boolean
  signupNote: string
  createdAt: string
  resetRequestedAt: string | null
  devices: { id: string; label: string; lastSeen: string; lastIp: string; lastCountry: string }[]
  quota: Partial<Record<QuotaKey, number>>
  usage: { used: Record<string, number>; limits: Record<string, number> } | null
  storageBytes: number
}
type QuotaKey = 'writingPerDay' | 'speakingPerDay' | 'lightPerDay' | 'novaPerDay' | 'agyCallsPerDay' | 'storageMb'
interface Settings {
  registration: 'open' | 'closed'
  maxActiveLearners: number
  quota: Record<QuotaKey, number>
}

const QUOTA_FIELDS: [QuotaKey, string][] = [
  ['writingPerDay', 'Writing/ngày'],
  ['speakingPerDay', 'Speaking/ngày'],
  ['lightPerDay', 'AI khác/ngày'],
  ['novaPerDay', 'Nova/ngày'],
  ['agyCallsPerDay', 'Trần agy/ngày'],
  ['storageMb', 'Dung lượng (MB)'],
]

async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`/api${url}`, {
    ...init,
    headers: init?.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error || `Lỗi ${res.status}`)
  return body
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString('vi-VN') : '')

export default function UsersAdminPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [active, setActive] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [newUser, setNewUser] = useState({ email: '', displayName: '' })

  const load = useCallback(() => {
    api<{ users: Row[]; settings: Settings; activeLearners: number }>('/admin/users').then(
      (b) => {
        setRows(b.users)
        setSettings(b.settings)
        setActive(b.activeLearners)
      },
      (e) => setError((e as Error).message),
    )
  }, [])
  useEffect(load, [load])

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError('')
    setNotice('')
    try {
      await fn()
      if (done) setNotice(done)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const pending = rows.filter((r) => r.status === 'pending')
  const others = rows.filter((r) => r.status !== 'pending')

  return (
    <div className="space-y-6">
      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}
      {notice ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm break-all text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p> : null}

      <Card className="p-4">
        <h2 className="font-bold">Chờ duyệt ({pending.length})</h2>
        {pending.length ? (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-semibold">{r.displayName}</span> · {r.email}
                  <span className="block text-xs text-slate-500">
                    {day(r.createdAt)}
                    {r.signupNote ? ` · “${r.signupNote}”` : ''}
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button size="sm" onClick={() => void act(() => api('/admin/users/approve', { method: 'POST', json: { id: r.id } }), `Đã duyệt ${r.email}.`)}>
                    <Check className="size-4" /> Duyệt
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void act(() => api('/admin/users/reject', { method: 'POST', json: { id: r.id } }), `Đã từ chối ${r.email}.`)}>
                    <X className="size-4" /> Từ chối
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Không có yêu cầu nào.</p>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="font-bold">Thêm người dùng</h2>
        <p className="mt-1 text-sm text-slate-500">Tài khoản dùng được ngay. Mật khẩu tạm hiện một lần: gửi cho người đó (Zalo); lần đầu đăng nhập họ phải đổi mật khẩu.</p>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void act(async () => {
              const r = await api<{ password: string }>('/admin/users', { method: 'POST', json: newUser })
              setNewUser({ email: '', displayName: '' })
              setNotice(`Đã tạo ${newUser.email}. Mật khẩu tạm: ${r.password}`)
            })
          }}
        >
          <Field label="Tên" htmlFor="nu-name">
            <TextInput id="nu-name" required value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} />
          </Field>
          <Field label="Email" htmlFor="nu-email">
            <TextInput id="nu-email" type="email" required value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
          </Field>
          <Button type="submit">
            <Plus className="size-4" /> Thêm
          </Button>
        </form>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">
            Tài khoản ({active}/{settings?.maxActiveLearners ?? '?'} học viên đang hoạt động)
          </h2>
          <Button size="sm" variant="ghost" onClick={load} aria-label="Tải lại">
            <RefreshCw className="size-4" />
          </Button>
        </div>
        <ul className="mt-3 space-y-4">
          {others.map((r) => (
            <UserCard key={r.id} row={r} act={act} />
          ))}
        </ul>
      </Card>

      {settings ? <SettingsCard settings={settings} act={act} /> : null}
    </div>
  )
}

function UserCard({ row: r, act }: { row: Row; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [quota, setQuota] = useState<Partial<Record<QuotaKey, string>>>({})
  return (
    <li className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-semibold">{r.displayName}</span> · {r.email}
          <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs dark:bg-slate-800">{r.role === 'admin' ? 'admin' : 'học viên'}</span>
          {r.disabled ? <span className="ml-1 rounded bg-rose-100 px-1.5 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">đã khóa</span> : null}
          {r.status === 'rejected' ? <span className="ml-1 rounded bg-rose-100 px-1.5 text-xs text-rose-800">đã từ chối</span> : null}
          {r.twoFactor ? <span className="ml-1 rounded bg-emerald-100 px-1.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">2FA</span> : null}
          {r.mustChangePassword ? <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-800">chưa đổi mật khẩu</span> : null}
          {r.resetRequestedAt ? <span className="ml-1 rounded bg-amber-200 px-1.5 text-xs text-amber-900">quên mật khẩu {day(r.resetRequestedAt)}</span> : null}
        </span>
        <span className="text-xs text-slate-500">
          {mb(r.storageBytes)}
          {r.usage ? ` · hôm nay: W ${r.usage.used.writing}/${r.usage.limits.writing}, S ${r.usage.used.speaking}/${r.usage.limits.speaking}, AI ${r.usage.used.light}/${r.usage.limits.light}, Nova ${r.usage.used.nova}/${r.usage.limits.nova}, agy ${r.usage.used.agy}` : ''}
        </span>
      </div>

      {r.devices.length ? (
        <ul className="mt-2 space-y-1">
          {r.devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span>
                {d.label} · {d.lastIp} {d.lastCountry} · {day(d.lastSeen)}
              </span>
              <button
                type="button"
                className="font-semibold text-rose-600 hover:underline"
                onClick={() => void act(() => api(`/admin/users/devices?id=${r.id}&device=${d.id}`, { method: 'DELETE' }), `Đã gỡ thiết bị ${d.label}.`)}
              >
                Gỡ
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {r.role === 'learner' ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const change = Object.fromEntries(Object.entries(quota).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, Number(v)]))
            void act(() => api('/admin/users', { method: 'PATCH', json: { id: r.id, quota: change } }), 'Đã lưu hạn mức.')
          }}
        >
          {QUOTA_FIELDS.map(([k, label]) => (
            <label key={k} className="text-xs">
              <span className="block text-slate-500">{label}</span>
              <TextInput className="h-8 w-20" inputMode="numeric" placeholder={String(r.quota[k] ?? 'mặc định')} value={quota[k] ?? ''} onChange={(e) => setQuota({ ...quota, [k]: e.target.value })} />
            </label>
          ))}
          <Button size="sm" variant="secondary" type="submit">
            Lưu hạn mức
          </Button>
        </form>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {r.role === 'learner' && r.status === 'active' ? (
          <Button size="sm" variant="ghost" onClick={() => setViewAs({ id: r.id, name: r.displayName })}>
            <Eye className="size-4" /> Xem như học viên
          </Button>
        ) : null}
        <ResetPassword row={r} act={act} />
        {r.twoFactor ? (
          <Button size="sm" variant="ghost" onClick={() => void act(() => api('/admin/users/reset-2fa', { method: 'POST', json: { id: r.id } }), `Đã tắt 2FA của ${r.email}.`)}>
            Tắt 2FA
          </Button>
        ) : null}
        {r.role === 'learner' ? (
          <Button size="sm" variant="ghost" onClick={() => void act(() => api('/admin/users', { method: 'PATCH', json: { id: r.id, disabled: !r.disabled } }), r.disabled ? 'Đã mở khóa.' : 'Đã khóa.')}>
            {r.disabled ? <Unlock className="size-4" /> : <Lock className="size-4" />} {r.disabled ? 'Mở khóa' : 'Khóa'}
          </Button>
        ) : null}
        <a className="inline-flex items-center px-2 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300" href={`/api/admin/users/export?id=${r.id}`}>
          Tải dữ liệu
        </a>
        {r.role === 'learner' ? <DeleteUser row={r} act={act} /> : null}
      </div>
    </li>
  )
}

function ResetPassword({ row, act }: { row: Row; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [password, setPassword] = useState('')
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          void act(async () => {
            const b = await api<{ password: string }>('/admin/users/reset-password', { method: 'POST', json: { id: row.id } })
            setPassword(b.password)
          })
        }
      >
        <KeyRound className="size-4" /> Mật khẩu tạm
      </Button>
      {password ? (
        <span className="inline-flex items-center rounded bg-amber-50 px-2 font-mono text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {row.email}: {password}
        </span>
      ) : null}
    </>
  )
}

function DeleteUser({ row, act }: { row: Row; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [sure, setSure] = useState(false)
  return sure ? (
    <span className="inline-flex gap-1">
      <Button size="sm" variant="danger" onClick={() => void act(() => api(`/admin/users?id=${row.id}`, { method: 'DELETE' }), `Đã xóa ${row.email}.`)}>
        Xóa hẳn {row.email}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
        Hủy
      </Button>
    </span>
  ) : (
    <Button size="sm" variant="ghost" onClick={() => setSure(true)}>
      <Trash2 className="size-4" /> Xóa
    </Button>
  )
}

function SettingsCard({ settings, act }: { settings: Settings; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [max, setMax] = useState(String(settings.maxActiveLearners))
  const [quota, setQuota] = useState<Record<QuotaKey, string>>(Object.fromEntries(QUOTA_FIELDS.map(([k]) => [k, String(settings.quota[k])])) as Record<QuotaKey, string>)
  return (
    <Card className="p-4">
      <h2 className="font-bold">Cài đặt</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span>
          Đăng ký: <strong>{settings.registration === 'open' ? 'đang mở' : 'đang đóng'}</strong>
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void act(() => api('/admin/system/settings', { method: 'PUT', json: { registration: settings.registration === 'open' ? 'closed' : 'open' } }), 'Đã lưu.')}
        >
          {settings.registration === 'open' ? 'Đóng đăng ký' : 'Mở đăng ký'}
        </Button>
      </div>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void act(
            () =>
              api('/admin/system/settings', {
                method: 'PUT',
                json: { maxActiveLearners: Number(max), quota: Object.fromEntries(Object.entries(quota).map(([k, v]) => [k, Number(v)])) },
              }),
            'Đã lưu cài đặt.',
          )
        }}
      >
        <label className="text-xs">
          <span className="block text-slate-500">Số học viên tối đa</span>
          <TextInput className="h-8 w-20" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
        {QUOTA_FIELDS.map(([k, label]) => (
          <label key={k} className="text-xs">
            <span className="block text-slate-500">{label} (mặc định)</span>
            <TextInput className="h-8 w-20" inputMode="numeric" value={quota[k]} onChange={(e) => setQuota({ ...quota, [k]: e.target.value })} />
          </label>
        ))}
        <Button size="sm" type="submit">
          Lưu
        </Button>
      </form>
    </Card>
  )
}
