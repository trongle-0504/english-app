// Cloudflare Turnstile on the sign-up form (the form is public). Off until TURNSTILE_SITE_KEY and TURNSTILE_SECRET are
// set in .env; the per-IP limit and the admin's approval still apply without it.
export const turnstileSiteKey = () => process.env.TURNSTILE_SITE_KEY || ''

export async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET
  if (!secret || !turnstileSiteKey()) return true
  if (!token) return false
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(10_000),
    })
    return Boolean(((await res.json()) as { success?: boolean }).success)
  } catch {
    return false
  }
}
