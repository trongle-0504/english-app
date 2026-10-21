// Password hashing with scrypt (node:crypto): no dependency, and slow enough that a stolen users.json is expensive to
// brute-force. Stored as "scrypt$N$r$p$salt$hash" so the parameters can change later without breaking old hashes.
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

const N = 2 ** 15
const R = 8
const P = 1
const KEY_LENGTH = 64
// N=2^15, r=8 needs 32 MB, exactly Node's default maxmem, which then refuses it.
const MAX_MEM = 64 * 1024 * 1024

export const MIN_PASSWORD_LENGTH = 10

function derive(password: string, salt: Buffer, options: ScryptOptions, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, length, options, (error, key) => (error ? reject(error) : resolve(key))))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await derive(password, salt, { N, r: R, p: P, maxmem: MAX_MEM }, KEY_LENGTH)
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await derive(password, Buffer.from(salt, 'base64'), { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEM }, expected.length)
  return timingSafeEqual(actual, expected)
}

/** A hash of a random password: verifying against it takes as long as a real one when the email is unknown. */
export const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'))
