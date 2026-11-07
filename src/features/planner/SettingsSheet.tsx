import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui'
import type { PlannerSettings, PushDevice } from '@/types/planner'
import * as api from './api'
import { EnablePushCard } from './EnablePushCard'
import { inputClass, Sheet } from './Sheet'
import { showToast } from './toast'

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const BANDS = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9]

export function SettingsSheet({ open, onOpenChange, settings, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; settings: PlannerSettings; onSaved: (s: PlannerSettings) => void }) {
  const [draft, setDraft] = useState(settings)
  const [devices, setDevices] = useState<PushDevice[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(settings)
    api.pushDevices().then(setDevices).catch(() => setDevices([]))
  }, [open, settings])

  const set = <K extends keyof PlannerSettings>(key: K, value: PlannerSettings[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const save = async () => {
    setBusy(true)
    try {
      const saved = await api.saveSettings({ ...draft, targetBand: draft.targetBand ?? null })
      onSaved(saved)
      showToast('Đã lưu cài đặt.')
      onOpenChange(false)
    } catch (err) {
      showToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Cài đặt Planner"
      footer={
        <Button onClick={() => void save()} loading={busy}>
          Lưu
        </Button>
      }
    >
      <div className="space-y-5">
        <EnablePushCard onChange={() => void api.pushDevices().then(setDevices).catch(() => {})} />
        {devices.length ? (
          <div className="text-sm">
            <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Thiết bị nhận thông báo</p>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {devices.map((d) => (
                <li key={d.endpointTail} className="flex justify-between py-2">
                  <span>{d.device}</span>
                  <span className="text-xs text-slate-500">{d.lastOkAt ? `gửi được lần cuối ${new Date(d.lastOkAt).toLocaleString('vi-VN')}` : 'chưa gửi lần nào'}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <TimeField label="Tóm tắt buổi sáng" value={draft.morningTime} onChange={(v) => set('morningTime', v)} />
          <TimeField label="Tổng kết buổi tối" value={draft.eveningTime} onChange={(v) => set('eveningTime', v)} />
          <TimeField label="Yên lặng từ" value={draft.quietStart} onChange={(v) => set('quietStart', v)} />
          <TimeField label="đến" value={draft.quietEnd} onChange={(v) => set('quietEnd', v)} />
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <Toggle checked={draft.taskReminders} onChange={(v) => set('taskReminders', v)}>
            Nhắc theo giờ của từng việc
          </Toggle>
          <Toggle checked={draft.overdueDigest} onChange={(v) => set('overdueDigest', v)}>
            Tổng kết buổi tối (việc chưa xong)
          </Toggle>
          <Toggle checked={draft.aiBrief} onChange={(v) => set('aiBrief', v)}>
            Tóm tắt buổi sáng bằng AI
          </Toggle>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Band mục tiêu</span>
          <select className={inputClass} value={draft.targetBand ?? ''} onChange={(e) => set('targetBand', e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Chưa đặt</option>
            {BANDS.map((b) => (
              <option key={b} value={b}>
                {b.toFixed(1)}
              </option>
            ))}
          </select>
        </label>

        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Số phút học mỗi ngày (cho AI)</p>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((label, i) => (
              <label key={label} className="space-y-1 text-center">
                <span className="text-xs text-slate-500">{label}</span>
                <input
                  inputMode="numeric"
                  className={`${inputClass} h-10 px-1 text-center text-sm`}
                  value={draft.minutesPerDay[i]}
                  onChange={(e) => set('minutesPerDay', draft.minutesPerDay.map((m, j) => (j === i ? Math.min(720, Number(e.target.value.replace(/\D/g, '')) || 0) : m)))}
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  )
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</span>
      <input type="time" className={inputClass} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
  )
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-3">
      <span className="text-sm text-slate-700 dark:text-slate-200">{children}</span>
      <input type="checkbox" className="size-5 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
