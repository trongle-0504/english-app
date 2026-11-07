// Web Push: VAPID keys, the subscribed devices (progress/planner/push.json) and sending. The server sends every push,
// so nothing arrives while the PC (or WSL / the tunnel) is off; the push service keeps a message for its TTL when the
// phone is offline.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import webpush from 'web-push'
import { readJsonDoc, updateJsonDoc, writeJsonDoc } from '../admin/store.ts'
import type { PushDevice } from '../../src/types/planner.ts'
import { plannerDir, type PlannerCtx } from './store.ts'

export interface PushPayload {
  title: string
  body: string
  /** Same tag replaces the shown notification (one brief per day, one reminder per task). */
  tag: string
  /** Opened on tap. */
  url: string
  /** Shown on Android; ignored by iOS. */
  actions?: { action: 'done' | 'snooze'; title: string }[]
  taskId?: string
  /** App icon badge: undone today + overdue. */
  badge?: number
}

interface StoredSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
  device: string
  createdAt: string
  lastOkAt?: string
  failures: number
}

interface PushDoc {
  subscriptions: StoredSubscription[]
}

const pushFile = (ctx: PlannerCtx) => path.join(plannerDir(ctx), 'push.json')
const vapidFile = (ctx: PlannerCtx) => path.join(ctx.rootDir, 'data', 'vapid.json')

let keys: { publicKey: string; privateKey: string } | null = null

/** VAPID keys from .env, else data/vapid.json (generated once). Changing them invalidates every subscription. */
export async function vapidKeys(ctx: PlannerCtx): Promise<{ publicKey: string; privateKey: string }> {
  if (keys) return keys
  const fromEnv = { publicKey: process.env.VAPID_PUBLIC_KEY ?? '', privateKey: process.env.VAPID_PRIVATE_KEY ?? '' }
  if (fromEnv.publicKey && fromEnv.privateKey) keys = fromEnv
  else if (existsSync(vapidFile(ctx))) keys = JSON.parse(await readFile(vapidFile(ctx), 'utf8')) as { publicKey: string; privateKey: string }
  else {
    keys = webpush.generateVAPIDKeys()
    await writeJsonDoc(vapidFile(ctx), keys)
    console.log('[planner] generated VAPID keys in data/vapid.json')
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@ailab.com.vn', keys.publicKey, keys.privateKey)
  return keys
}

export async function readSubscriptions(ctx: PlannerCtx): Promise<StoredSubscription[]> {
  return (await readJsonDoc<PushDoc>(pushFile(ctx), { subscriptions: [] })).value.subscriptions ?? []
}

export function subscribe(ctx: PlannerCtx, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, device: string): Promise<void> {
  return updateJsonDoc<PushDoc, void>(pushFile(ctx), { subscriptions: [] }, (doc) => {
    doc.subscriptions ??= []
    const existing = doc.subscriptions.find((s) => s.endpoint === sub.endpoint)
    if (existing) {
      existing.keys = sub.keys
      existing.failures = 0
      if (device && device !== 'renewed') existing.device = device
    } else {
      doc.subscriptions.push({ endpoint: sub.endpoint, keys: sub.keys, device: device || 'Thiết bị', createdAt: new Date().toISOString(), failures: 0 })
    }
  })
}

export function unsubscribe(ctx: PlannerCtx, endpoint: string): Promise<void> {
  return updateJsonDoc<PushDoc, void>(pushFile(ctx), { subscriptions: [] }, (doc) => {
    doc.subscriptions = (doc.subscriptions ?? []).filter((s) => s.endpoint !== endpoint)
  })
}

export async function listDevices(ctx: PlannerCtx): Promise<PushDevice[]> {
  return (await readSubscriptions(ctx)).map((s) => ({ endpointTail: s.endpoint.slice(-12), device: s.device, createdAt: s.createdAt, lastOkAt: s.lastOkAt }))
}

export interface SendOptions {
  /** Seconds the push service keeps the message for an offline phone (default 4 h). */
  ttl?: number
  urgency?: 'normal' | 'high'
  /** ≤ 32 URL-safe chars: replaces an undelivered older push of the same kind. */
  topic?: string
}

/** Sends to every device. 404/410 → the subscription is gone; other errors count, and 5 in a row remove it. */
export async function sendToAll(ctx: PlannerCtx, payload: PushPayload, opts: SendOptions = {}): Promise<{ device: string; status: number | string }[]> {
  const subs = await readSubscriptions(ctx)
  if (!subs.length) return []
  await vapidKeys(ctx)
  const results = await Promise.all(
    subs.map(async (sub) => {
      try {
        const res = await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), {
          TTL: opts.ttl ?? 4 * 3600,
          urgency: opts.urgency ?? 'normal',
          ...(opts.topic ? { topic: opts.topic } : {}),
        })
        return { endpoint: sub.endpoint, device: sub.device, status: res.statusCode as number | string, ok: true, gone: false }
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        return { endpoint: sub.endpoint, device: sub.device, status: status ?? (error as Error).message, ok: false, gone: status === 404 || status === 410 }
      }
    }),
  )
  const nowIso = new Date().toISOString()
  await updateJsonDoc<PushDoc, void>(pushFile(ctx), { subscriptions: [] }, (doc) => {
    doc.subscriptions = (doc.subscriptions ?? []).filter((sub) => {
      const result = results.find((r) => r.endpoint === sub.endpoint)
      if (!result) return true
      if (result.gone) return false
      if (result.ok) {
        sub.lastOkAt = nowIso
        sub.failures = 0
        return true
      }
      sub.failures = (sub.failures ?? 0) + 1
      return sub.failures < 5
    })
  })
  for (const r of results) if (!r.ok) console.warn(`[planner] push to ${r.device} failed: ${r.status}`)
  return results.map(({ device, status }) => ({ device, status }))
}
