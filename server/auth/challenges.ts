// Half-finished logins: the password was right but the account has two-factor on. A challenge token (random, 5 minutes,
// in memory) stands for "this user passed the password step"; it becomes a session only with a valid code. In memory
// on purpose: a restart just asks people to type the password again. On globalThis for the dev server's reloads.
import { randomBytes } from 'node:crypto'

const TTL_MS = 5 * 60 * 1000
const MAX_TRIES = 5

interface Challenge {
  userId: string
  expires: number
  tries: number
}

const challenges = ((globalThis as { __loginChallenges?: Map<string, Challenge> }).__loginChallenges ??= new Map<string, Challenge>())

export function createChallenge(userId: string): string {
  for (const [token, c] of challenges) if (c.expires < Date.now()) challenges.delete(token)
  const token = randomBytes(24).toString('base64url')
  challenges.set(token, { userId, expires: Date.now() + TTL_MS, tries: 0 })
  return token
}

/** The pending challenge, or null when unknown or expired. */
export function peekChallenge(token: string): { userId: string } | null {
  const c = challenges.get(token)
  if (!c || c.expires < Date.now()) {
    challenges.delete(token)
    return null
  }
  return { userId: c.userId }
}

/** Counts a wrong code; after MAX_TRIES the challenge is gone and the password must be typed again. Returns tries left. */
export function failChallenge(token: string): number {
  const c = challenges.get(token)
  if (!c) return 0
  c.tries += 1
  if (c.tries >= MAX_TRIES) {
    challenges.delete(token)
    return 0
  }
  return MAX_TRIES - c.tries
}

export const consumeChallenge = (token: string) => void challenges.delete(token)
