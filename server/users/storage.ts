// Disk use of the multi-user app (PLAN-multi-user-v2.md, 2.3 and 6.5): 300 MB per account, recordings kept 15 days,
// deleted accounts and unanswered sign-ups cleaned up, and new uploads refused while drive C: (where WSL's disk
// lives) is nearly full.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ApiError } from '../api.ts'
import { dataDir } from '../auth/store.ts'
import { listUsers, removeUser, statusOf } from '../auth/users.ts'
import { limitsOf } from './quota.ts'
import { userRootDir, usersDir } from './root.ts'

const run = promisify(execFile)
const DAY = 24 * 3_600_000

const sizes = new Map<string, { at: number; bytes: number }>()
/** Bytes in an account's folder (links to shared content not followed); cached 5 minutes. */
export async function accountBytes(uid: string): Promise<number> {
  const hit = sizes.get(uid)
  if (hit && Date.now() - hit.at < 300_000) return hit.bytes
  const dir = userRootDir(uid)
  if (!existsSync(dir)) return 0
  const { stdout } = await run('du', ['-sb', dir]).catch(() => ({ stdout: '0' }))
  const bytes = Number(stdout.split(/\s/)[0]) || 0
  sizes.set(uid, { at: Date.now(), bytes })
  return bytes
}

/** Free bytes on the drive that holds WSL's virtual disk (C:), or Infinity when it cannot be read. */
let freeCache: { at: number; bytes: number } | null = null
export async function hostFreeBytes(): Promise<number> {
  if (freeCache && Date.now() - freeCache.at < 300_000) return freeCache.bytes
  const mount = process.env.HOST_DISK_MOUNT || '/mnt/c'
  const { stdout } = await run('df', ['-B1', '--output=avail', mount]).catch(() => ({ stdout: '' }))
  const bytes = Number(stdout.trim().split('\n')[1]) || Number.POSITIVE_INFINITY
  freeCache = { at: Date.now(), bytes }
  return bytes
}

/** Routes that store a recording or a picture in the account's folder. */
export const UPLOAD_ROUTES = new Set([
  'POST /speaking-review',
  'POST /notepad/images',
  'POST /writing-task1/images',
  'POST /listening/simplify/read-image',
  'POST /admin/vocabulary/image',
  'POST /admin/notes/image',
])

/** Throws 507 when the account is over its storage limit, or drive C: has under 5 GB free. */
export async function assertRoomFor(uid: string, role: string): Promise<void> {
  if ((await hostFreeBytes()) < (Number(process.env.MIN_FREE_GB) || 5) * 1024 ** 3) {
    throw new ApiError(507, 'Máy chủ sắp hết dung lượng ổ đĩa: tạm thời chưa nhận ghi âm/ảnh mới. Admin đã được báo.')
  }
  if (role === 'admin') return
  const limitMb = (await limitsOf(uid)).storageMb
  if ((await accountBytes(uid)) > limitMb * 1024 * 1024) {
    throw new ApiError(507, `Tài khoản đã dùng hết ${limitMb} MB. Xóa bớt bản ghi âm/ảnh cũ hoặc nhờ admin tăng dung lượng.`)
  }
}

/** Removes files older than `days` with one of `exts` under `dir` (recursive). */
async function removeOld(dir: string, exts: string[], days: number): Promise<number> {
  let removed = 0
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) removed += await removeOld(p, exts, days)
    else if (e.isFile() && exts.some((x) => e.name.endsWith(x)) && Date.now() - (await stat(p)).mtimeMs > days * DAY) {
      await rm(p, { force: true })
      removed++
    }
  }
  return removed
}

/** The nightly clean-up: old recordings, deleted accounts after 30 days, sign-ups nobody answered in 14 days. */
export async function nightlyCleanup(): Promise<{ recordings: number; folders: number; signups: number }> {
  const keepDays = Number(process.env.RECORDING_RETENTION_DAYS) || 15
  let recordings = 0
  for (const uid of await readdir(usersDir()).catch(() => [] as string[])) {
    recordings += await removeOld(path.join(usersDir(), uid, 'progress'), ['.wav', '.webm', '.ogg', '.m4a', '.mp3'], keepDays)
  }
  let folders = 0
  const deleted = path.join(dataDir(), 'deleted')
  for (const name of await readdir(deleted).catch(() => [] as string[])) {
    const p = path.join(deleted, name)
    if (Date.now() - (await stat(p)).mtimeMs > 30 * DAY) {
      await rm(p, { recursive: true, force: true })
      folders++
    }
  }
  let signups = 0
  for (const u of await listUsers()) {
    if ((statusOf(u) === 'pending' || statusOf(u) === 'rejected') && Date.now() - Date.parse(u.createdAt) > 14 * DAY) {
      await removeUser(u.id)
      signups++
    }
  }
  return { recordings, folders, signups }
}
