// Multi-user background work (PLAN-multi-user-v2.md, 3.4): the planner's reminders and the nightly drills run once per
// approved account, each with that account's own folder as its context, one account after another. A tick never
// reads or writes another account's files, and push reminders go only to the devices that account subscribed.
import { listUsers, statusOf } from '../auth/users.ts'
import { drillsTick } from '../admin/drills-nightly.ts'
import { plannerTick } from '../planner/scheduler.ts'
import { requestUser } from './context.ts'
import { contextFor } from './resolve.ts'
import { hostFreeBytes, nightlyCleanup } from './storage.ts'
import { notifyAdmins } from './notify.ts'
import { freemem } from 'node:os'
import { readFileSync } from 'node:fs'

export function startMultiUserSchedulers(appRoot: string, invalidate: (uid: string) => void) {
  const g = globalThis as { __multiSchedulers?: boolean }
  if (g.__multiSchedulers) return
  g.__multiSchedulers = true
  const base = { contentDir: '', rootDir: appRoot, onContentChange: () => {} }

  const each = async (fn: (ctx: ReturnType<typeof contextFor>) => Promise<void>) => {
    for (const user of await listUsers()) {
      if (user.disabled || statusOf(user) !== 'active') continue
      const ctx = contextFor(user, { appRoot, base, invalidate })
      // Jobs and AI calls a tick starts belong to that account (usage, job ownership).
      await requestUser.run({ id: user.id, role: user.role }, () => fn(ctx)).catch((e) => console.warn(`[scheduler] ${user.email}:`, (e as Error).message))
    }
  }

  let plannerBusy = false
  let drillsBusy = false
  setInterval(() => {
    if (plannerBusy) return
    plannerBusy = true
    void each((ctx) => plannerTick(ctx)).finally(() => (plannerBusy = false))
  }, 30_000).unref?.()
  // Nightly clean-up (recordings older than 15 days, deleted accounts, stale sign-ups), once per VN day after 02:00.
  let cleanedDay = ''
  setInterval(() => {
    const vn = new Date(Date.now() + 7 * 3_600_000)
    const day = vn.toISOString().slice(0, 10)
    if (vn.getUTCHours() < 2 || cleanedDay === day) return
    cleanedDay = day
    void nightlyCleanup().then(
      (r) => console.log(`[cleanup] ${r.recordings} recordings, ${r.folders} deleted accounts, ${r.signups} stale sign-ups removed`),
      (e) => console.warn('[cleanup]', (e as Error).message),
    )
  }, 10 * 60_000).unref?.()

  // Health watch: tell the admin (Web Push, at most every 6 h per kind) when memory or drive C: runs low.
  const lastAlert = new Map<string, number>()
  const alert = (kind: string, body: string) => {
    if (Date.now() - (lastAlert.get(kind) ?? 0) < 6 * 3_600_000) return
    lastAlert.set(kind, Date.now())
    void notifyAdmins({ title: 'English multi: cảnh báo máy chủ', body, tag: `health-${kind}`, url: '/admin/users' })
  }
  setInterval(() => {
    void (async () => {
      const freeGb = (await hostFreeBytes()) / 1024 ** 3
      if (freeGb < (Number(process.env.ALERT_FREE_GB) || 10)) alert('disk', `Ổ C: còn ${freeGb.toFixed(1)} GB trống.`)
      let availMb = freemem() / 1024 / 1024
      try {
        availMb = Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1] ?? 0) / 1024 || availMb
      } catch {
        /* not Linux */
      }
      if (availMb < 400) alert('memory', `RAM khả dụng chỉ còn ${Math.round(availMb)} MB.`)
    })().catch(() => {})
  }, 5 * 60_000).unref?.()

  setInterval(() => {
    if (drillsBusy) return
    drillsBusy = true
    void each((ctx) => drillsTick(ctx)).finally(() => (drillsBusy = false))
  }, 60_000).unref?.()
}
