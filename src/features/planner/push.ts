// Web Push on this device: what is possible here, and subscribing. Permission is asked only from a tap (iOS needs that).
import { pushDevices, pushKey, pushSubscribe, pushUnsubscribe } from './api'

export type PushState = 'unsupported' | 'dev' | 'ios-not-installed' | 'default' | 'denied' | 'on' | 'off'

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

/** A short label for the devices list. */
export function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPad/.test(ua)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac OS X/.test(ua)) return 'Mac'
  return 'Thiết bị'
}

/** 'off' = permission granted but this device is not subscribed (or the server forgot it, e.g. new VAPID keys). */
export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return isIos() && !isStandalone() ? 'ios-not-installed' : 'unsupported'
  if (import.meta.env.DEV) return 'dev'
  if (isIos() && !isStandalone()) return 'ios-not-installed'
  if (!('PushManager' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission === 'default') return 'default'
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return 'off'
  const devices = await pushDevices().catch(() => null)
  if (devices && !devices.some((d) => sub.endpoint.endsWith(d.endpointTail))) return 'off'
  return 'on'
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Call from a click handler: asks permission, subscribes and tells the server. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default'
  const reg = await navigator.serviceWorker.ready
  const key = urlBase64ToUint8Array(await pushKey())
  let sub = await reg.pushManager.getSubscription()
  // A subscription made with other VAPID keys cannot be reused.
  if (sub) {
    const current = sub.options?.applicationServerKey
    const same = current && new Uint8Array(current).every((b, i) => b === key[i])
    if (!same) {
      await sub.unsubscribe().catch(() => {})
      sub = null
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await pushSubscribe(sub.toJSON(), deviceLabel())
  return 'on'
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await pushUnsubscribe(sub.endpoint).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

/** App icon badge where supported (installed PWA on Android, iOS 16.4+, desktop). */
export function setBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  if (count > 0) nav.setAppBadge?.(count).catch(() => {})
  else nav.clearAppBadge?.().catch(() => {})
}
