// Failed-login limits, in memory: 5 wrong passwords for one (IP, email) or 30 from one IP within 15 minutes lock that
// key for the rest of the window. Kept on globalThis: the dev server reloads server modules in-process.
const WINDOW_MS = 15 * 60 * 1000
const LIMITS = { pair: 5, ip: 30 }

const failures = ((globalThis as { __loginFailures?: Map<string, number[]> }).__loginFailures ??= new Map<string, number[]>())

const recent = (key: string) => (failures.get(key) ?? []).filter((t) => Date.now() - t < WINDOW_MS)
const keys = (ip: string, email: string) => ({ pair: `${ip}|${email}`, ip: `ip|${ip}` })

/** Minutes until another try is allowed, or 0 when it is allowed now. */
export function lockedFor(ip: string, email: string): number {
  const k = keys(ip, email)
  for (const [kind, key] of Object.entries(k) as [keyof typeof LIMITS, string][]) {
    const times = recent(key)
    if (times.length >= LIMITS[kind]) return Math.ceil((times[0] + WINDOW_MS - Date.now()) / 60_000)
  }
  return 0
}

export function recordFailure(ip: string, email: string): void {
  for (const key of Object.values(keys(ip, email))) failures.set(key, [...recent(key), Date.now()])
}

export function clearFailures(ip: string, email: string): void {
  failures.delete(keys(ip, email).pair)
}
