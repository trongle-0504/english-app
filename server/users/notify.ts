// Tells the admin about sign-ups and forgotten passwords: a Web Push to every device the admin subscribed in the
// Planner (Planner → Nhắc nhở → Bật thông báo). Without a subscription the request just waits in Admin → Users.
import path from 'node:path'
import { listUsers } from '../auth/users.ts'
import { sendToAll, type PushPayload } from '../planner/push.ts'
import { ensureUserRoot } from './root.ts'

const appRoot = path.resolve(import.meta.dirname, '..', '..')

export async function notifyAdmins(payload: PushPayload): Promise<void> {
  for (const admin of (await listUsers()).filter((u) => u.role === 'admin' && !u.disabled)) {
    await sendToAll({ rootDir: ensureUserRoot(admin.id, appRoot) }, payload).catch((e) => console.warn('[notify]', (e as Error).message))
  }
}
