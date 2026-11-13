// Time-based one-time passwords (RFC 6238: HMAC-SHA1, 6 digits, 30 s) with node:crypto only, plus the secret
// encryption and recovery codes around them. The secret is stored encrypted (AES-256-GCM) so a leaked users.json
// does not hand out the second factor. The key is AUTH_ENC_KEY (any string) or, if unset, a random key created once
// in data/auth/totp.key (mode 0600).
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { authFile } from './store.ts'

const STEP_SECONDS = 30
const DIGITS = 6
/** Codes from one step before or after now are accepted (clock drift between phone and server). */
const WINDOW = 1
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of text.replace(/[\s=-]/g, '').toUpperCase()) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) throw new Error('Invalid base32 secret.')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A new random secret: 160 bits, base32 (what authenticator apps expect). */
export const newSecret = () => base32Encode(randomBytes(20))

/** The 6-digit code for one time step. */
export function hotp(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', base32Decode(secret)).update(buffer).digest()
  const offset = hmac[hmac.length - 1] & 15
  const binary = ((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS)

const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * The time step a code matches, or null. Steps at or before `lastStep` are refused, so one code works once
 * (a code seen over a shoulder or in a log cannot be replayed within its 90 s window).
 */
export function verifyTotp(secret: string, code: string, lastStep = -1, now = Date.now()): number | null {
  const clean = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(clean)) return null
  const center = currentStep(now)
  let match: number | null = null
  // No early exit: the work does not depend on which step matched.
  for (let step = center - WINDOW; step <= center + WINDOW; step++) {
    if (sameText(hotp(secret, step), clean) && step > lastStep && match === null) match = step
  }
  return match
}

/** otpauth:// link that authenticator apps read from the QR code (or open directly on the phone). */
export function otpauthUri(secret: string, email: string, issuer = 'NeSy'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
}

/* ───────────── Secret encryption ───────────── */

let keyPromise: Promise<Buffer> | undefined

async function encryptionKey(): Promise<Buffer> {
  if (process.env.AUTH_ENC_KEY) return createHash('sha256').update(process.env.AUTH_ENC_KEY).digest()
  const file = authFile('totp.key')
  try {
    return Buffer.from((await readFile(file, 'utf8')).trim(), 'base64')
  } catch {
    const key = randomBytes(32)
    await mkdir(path.dirname(file), { recursive: true })
    // wx: if another request created it first, use theirs.
    try {
      await writeFile(file, key.toString('base64'), { mode: 0o600, flag: 'wx' })
      await chmod(file, 0o600)
      return key
    } catch {
      return Buffer.from((await readFile(file, 'utf8')).trim(), 'base64')
    }
  }
}

const key = () => (keyPromise ??= encryptionKey())

/** "iv.tag.data" in base64url. */
export async function encryptSecret(secret: string): Promise<string> {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', await key(), iv)
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.')
}

export async function decryptSecret(stored: string): Promise<string> {
  const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', await key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/* ───────────── Recovery codes ───────────── */

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** 10 single-use codes like "k3m9x-b7q2d". Shown once; only their hashes are stored. */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const pick = () => Array.from(randomBytes(5), (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('')
    return `${pick()}-${pick()}`
  })
}

export const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '')
export const hashRecovery = (code: string) => createHash('sha256').update(normalizeRecovery(code)).digest('hex')
