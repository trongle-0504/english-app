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
        if (s === 'on') showToast('Notifications are on for this device.')
      })
      .catch((err: Error) => showToast(err.message || 'Could not turn on notifications.'))
      .finally(() => setBusy(false))
  }

  const test = async () => {
    setBusy(true)
    try {
      const results = await pushTest()
      showToast(results.map((r) => `${r.device}: ${r.status === 201 || r.status === 200 ? 'sent' : r.status}`).join(' · '))
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
        Push notifications
      </div>

      {state === 'unsupported' ? <p className="text-slate-600 dark:text-slate-300">This browser does not support notifications.</p> : null}
      {state === 'dev' ? <p className="text-slate-600 dark:text-slate-300">Notifications only work on the built app (https://ailab.com.vn).</p> : null}
      {state === 'ios-not-installed' ? (
        <div className="space-y-2 text-slate-600 dark:text-slate-300">
          <p>On iPhone, notifications only work when the app is opened from the Home Screen:</p>
          <ol className="space-y-1.5">
            <li className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-white text-xs font-bold dark:bg-slate-700">1</span>
              Tap <Share className="inline size-4" /> Share in Safari
            </li>
            <li className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-white text-xs font-bold dark:bg-slate-700">2</span>
              Choose <SquarePlus className="inline size-4" /> Add to Home Screen
            </li>
            <li className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-white text-xs font-bold dark:bg-slate-700">3</span>
              Open the app from the Home Screen and turn notifications on here
            </li>
          </ol>
        </div>
      ) : null}
      {state === 'default' || state === 'off' ? (
        <div className="space-y-2">
          <p className="text-slate-600 dark:text-slate-300">
            {state === 'off' ? 'This device is not getting notifications (the server key may have changed).' : 'Get the morning brief and reminders for tasks and events.'}
          </p>
          <Button onClick={turnOn} loading={busy}>
            <Bell className="size-4" /> {state === 'off' ? 'Turn notifications back on' : 'Turn on notifications'}
          </Button>
        </div>
      ) : null}
      {state === 'denied' ? <p className="text-slate-600 dark:text-slate-300">Blocked. Go to Settings → NeSy → Notifications to allow them.</p> : null}
      {state === 'on' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-600 dark:text-slate-300">On for this device.</span>
          <Button size="sm" variant="outline" onClick={() => void test()} loading={busy}>
            Send a test
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void turnOff()}>
            Turn off
          </Button>
        </div>
      ) : null}
      <p className="text-xs leading-relaxed text-slate-500">
        Notifications are sent only while the computer running the app is on. For exam dates, use “Add to Calendar” so your phone reminds you even when it is off.
      </p>
    </div>
  )
}
