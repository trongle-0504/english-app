import { Bell, BellOff, CheckCircle2, Share, SquarePlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { pushTest } from './api'
import { disablePush, enablePush, pushState, type PushState } from './push'
import { showToast } from './toast'

/** Turning push on for this device, with the honest limits of each platform. */
export function EnablePushCard({ onChange }: { onChange?: (state: PushState) => void }) {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  // A ref, so a parent's inline callback does not re-run the check on every render.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    void pushState()
      .catch(() => 'unsupported' as const)
      .then((s) => {
        setState(s)
        onChangeRef.current?.(s)
      })
  }, [])

  const update = (s: PushState) => {
    setState(s)
    onChangeRef.current?.(s)
  }

  // requestPermission() must run inside the tap's handler (iOS).
  const turnOn = () => {
    setBusy(true)
    enablePush()
      .then((s) => {
        update(s)
        if (s === 'on') showToast('Đã bật thông báo trên thiết bị này.')
      })
      .catch((err: Error) => showToast(err.message || 'Không bật được thông báo.'))
      .finally(() => setBusy(false))
  }

  const test = async () => {
    setBusy(true)
    try {
      const results = await pushTest()
      showToast(results.map((r) => `${r.device}: ${r.status === 201 || r.status === 200 ? 'đã gửi' : r.status}`).join(' · '))
    } catch (err) {
      showToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async () => {
    setBusy(true)
    await disablePush().catch(() => {})
    update('default')
    setBusy(false)
  }

  if (!state) return <div className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />

  return (
    <div className="space-y-3 rounded-2xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
      <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
        {state === 'on' ? <CheckCircle2 className="size-5 text-emerald-500" /> : state === 'denied' ? <BellOff className="size-5 text-rose-500" /> : <Bell className="size-5 text-brand-500" />}
        Thông báo đẩy
      </div>

      {state === 'unsupported' ? <p className="text-slate-600 dark:text-slate-300">Trình duyệt này không hỗ trợ thông báo.</p> : null}
      {state === 'dev' ? <p className="text-slate-600 dark:text-slate-300">Thông báo chỉ chạy trên bản build (https://ailab.com.vn).</p> : null}
      {state === 'ios-not-installed' ? (
        <div className="space-y-2 text-slate-600 dark:text-slate-300">
          <p>Trên iPhone, thông báo chỉ chạy khi mở app từ màn hình chính:</p>
          <ol className="space-y-1.5">
            <li className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-white text-xs font-bold dark:bg-slate-700">1</span>
              Bấm <Share className="inline size-4" /> Chia sẻ trong Safari
            </li>
            <li className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-white text-xs font-bold dark:bg-slate-700">2</span>
              Chọn <SquarePlus className="inline size-4" /> Thêm vào MH chính
            </li>
            <li className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-white text-xs font-bold dark:bg-slate-700">3</span>
              Mở app từ màn hình chính rồi bật thông báo ở đây
            </li>
          </ol>
        </div>
      ) : null}
      {state === 'default' || state === 'off' ? (
        <div className="space-y-2">
          <p className="text-slate-600 dark:text-slate-300">
            {state === 'off' ? 'Thiết bị này chưa nhận thông báo (có thể vì khoá máy chủ đã đổi).' : 'Nhận tóm tắt buổi sáng, nhắc giờ học và nhắc sự kiện.'}
          </p>
          <Button onClick={turnOn} loading={busy}>
            <Bell className="size-4" /> {state === 'off' ? 'Bật lại thông báo' : 'Bật thông báo'}
          </Button>
        </div>
      ) : null}
      {state === 'denied' ? <p className="text-slate-600 dark:text-slate-300">Đã chặn. Vào Cài đặt → NeSy → Thông báo để bật lại.</p> : null}
      {state === 'on' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-600 dark:text-slate-300">Đã bật trên thiết bị này.</span>
          <Button size="sm" variant="outline" onClick={() => void test()} loading={busy}>
            Gửi thử
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void turnOff()}>
            Tắt
          </Button>
        </div>
      ) : null}
      <p className="text-xs leading-relaxed text-slate-500">
        Máy tính chạy app phải đang bật thì thông báo mới được gửi. Với ngày thi, hãy dùng “Thêm vào Lịch” để điện thoại tự nhắc kể cả khi máy tính tắt.
      </p>
    </div>
  )
}
