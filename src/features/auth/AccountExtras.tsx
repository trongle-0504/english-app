// Multi-user app, Account page: today's AI limits, the devices this account uses (at most two for a learner), and
// the learner's own data (download, delete the account).
import { Download, Gauge, MonitorSmartphone, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card } from '@/components/ui'
import { TextInput } from '@/features/admin/ui'
import { isMultiUser, logout } from './session'

interface QuotaInfo {
  used: Record<'writing' | 'speaking' | 'light' | 'nova', number>
  limits: Record<'writing' | 'speaking' | 'light' | 'nova', number>
  unlimited: boolean
}
interface DeviceInfo {
  devices: { id: string; label: string; firstSeen: string; lastSeen: string; current: boolean }[]
  max: number | null
  canRemove: boolean
}

const LABELS: Record<keyof QuotaInfo['used'], string> = { writing: 'Bài Writing', speaking: 'Lượt Speaking', light: 'Lượt AI khác', nova: 'Câu hỏi Nova' }
const date = (iso: string) => new Date(iso).toLocaleDateString('vi-VN')

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error || `Lỗi ${res.status}`)
  return body
}

export function AccountExtras({ role }: { role?: 'admin' | 'learner' }) {
  const [quota, setQuota] = useState<QuotaInfo | null>(null)
  const [devices, setDevices] = useState<DeviceInfo | null>(null)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = () => {
    getJson<QuotaInfo>('/api/me/quota').then(setQuota, () => {})
    getJson<DeviceInfo>('/api/me/devices').then(setDevices, () => {})
  }
  useEffect(load, [])
  if (!isMultiUser()) return null

  const removeDevice = async (id: string) => {
    setError('')
    const res = await fetch(`/api/me/devices?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Không gỡ được.')
    load()
  }

  const deleteAccount = async () => {
    setError('')
    const res = await fetch('/api/me/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
    if (!res.ok) return setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Không xóa được.')
    await logout()
  }

  return (
    <>
      {quota && !quota.unlimited ? (
        <Card className="mt-5 p-4 sm:p-6">
          <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <Gauge className="size-4 text-brand-600" /> Hạn mức AI hôm nay
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {(Object.keys(LABELS) as (keyof QuotaInfo['used'])[]).map((k) => (
              <li key={k} className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-300">{LABELS[k]}</span>
                <span className="font-semibold tabular-nums">
                  {quota.used[k]} / {quota.limits[k]}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Hạn mức mới bắt đầu lúc 0:00 mỗi ngày.</p>
        </Card>
      ) : null}

      {devices ? (
        <Card className="mt-5 p-4 sm:p-6">
          <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <MonitorSmartphone className="size-4 text-brand-600" /> Thiết bị đang dùng
          </h2>
          {devices.max ? <p className="mt-1 text-sm text-slate-500">Mỗi tài khoản dùng tối đa {devices.max} thiết bị. Mỗi tuần tự gỡ được một thiết bị.</p> : null}
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {devices.devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-semibold">{d.label}</span>
                  {d.current ? <span className="ml-2 rounded bg-emerald-100 px-1.5 text-xs text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">thiết bị này</span> : null}
                  <span className="block text-xs text-slate-500">
                    Từ {date(d.firstSeen)} · lần cuối {date(d.lastSeen)}
                  </span>
                </span>
                {!d.current && devices.canRemove ? (
                  <Button size="sm" variant="ghost" onClick={() => void removeDevice(d.id)}>
                    Gỡ
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mt-5 p-4 sm:p-6">
        <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <Download className="size-4 text-brand-600" /> Dữ liệu của bạn
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Tải về toàn bộ dữ liệu học (file .tar.gz).{' '}
          <a href="/help/account-privacy" className="font-semibold text-brand-700 underline dark:text-brand-300">
            App lưu những gì?
          </a>
        </p>
        <a href="/api/me/export" className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
          Tải dữ liệu về
        </a>
        {role === 'learner' ? (
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-sm text-rose-700 dark:text-rose-300">Xóa tài khoản và toàn bộ dữ liệu học. Nhập mật khẩu để xác nhận.</p>
                <TextInput type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <div className="flex gap-2">
                  <Button variant="danger" size="sm" disabled={!password} onClick={() => void deleteAccount()}>
                    Xóa vĩnh viễn
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    Hủy
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Xóa tài khoản
              </Button>
            )}
          </div>
        ) : null}
        {error ? <p className="mt-3 text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
      </Card>
    </>
  )
}
