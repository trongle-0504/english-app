// Admin-set switches of the multi-user app (data/auth/settings.json): sign-up open or closed, how many learners may be
// active, and the default daily limits.
import { readAuthFile, updateAuthFile } from '../auth/store.ts'
import type { Quota } from '../auth/users.ts'

export interface AppSettings {
  registration: 'open' | 'closed'
  maxActiveLearners: number
  quota: Quota
}

export const DEFAULT_QUOTA: Quota = {
  writingPerDay: 5,
  speakingPerDay: 30,
  lightPerDay: 50,
  novaPerDay: 50,
  agyCallsPerDay: 200,
  storageMb: 300,
}

export const DEFAULT_SETTINGS: AppSettings = { registration: 'open', maxActiveLearners: 4, quota: DEFAULT_QUOTA }

const FILE = 'settings.json'

export async function readSettings(): Promise<AppSettings> {
  const saved = await readAuthFile<Partial<AppSettings>>(FILE, {})
  return { ...DEFAULT_SETTINGS, ...saved, quota: { ...DEFAULT_QUOTA, ...(saved.quota ?? {}) } }
}

export async function updateSettings(change: Partial<AppSettings>): Promise<AppSettings> {
  await updateAuthFile<Partial<AppSettings>>(FILE, {}, (saved) => ({ ...saved, ...change, quota: { ...DEFAULT_QUOTA, ...(saved.quota ?? {}), ...(change.quota ?? {}) } }))
  return readSettings()
}
