// Multi-user background work (PLAN-multi-user-v2.md, 3.4): the planner's reminders and the nightly drills run once per
// approved account, each with that account's own folder as its context, one account after another. A tick never
// reads or writes another account's files, and push reminders go only to the devices that account subscribed.
import { listUsers, statusOf } from '../auth/users.ts'
import { drillsTick } from '../admin/drills-nightly.ts'
import { plannerTick } from '../planner/scheduler.ts'
import { requestUser } from './context.ts'
import { contextFor } from './resolve.ts'

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
  setInterval(() => {
    if (drillsBusy) return
    drillsBusy = true
    void each((ctx) => drillsTick(ctx)).finally(() => (drillsBusy = false))
  }, 60_000).unref?.()
}
