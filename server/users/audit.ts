// Account and admin events (data/auth/audit.jsonl): sign-ups, approvals, device changes, password resets and every
// time the admin reads a learner's pages. One JSON line each; never the content of anyone's work.
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { authFile } from '../auth/store.ts'

export async function audit(event: string, fields: Record<string, unknown> = {}): Promise<void> {
  const file = authFile('audit.jsonl')
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`, { mode: 0o600 }).catch((e) =>
    console.warn('[audit]', (e as Error).message),
  )
}
