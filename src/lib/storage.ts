import { useCallback, useEffect, useState } from 'react'
import { getCurrentUser, useCurrentUser } from '@/features/auth/session'

function scopedKey(key: string, userId?: string): string {
  const uid = userId ?? getCurrentUser()?.id
  return uid ? `u:${uid}:${key}` : key
}

function read<T>(key: string, fallback: T, userId?: string): T {
  try {
    const raw = localStorage.getItem(scopedKey(key, userId))
    if (raw != null) return JSON.parse(raw) as T
    // Admin fallback to legacy unprefixed key so existing drafts are preserved seamlessly.
    if (getCurrentUser()?.role === 'admin') {
      const legacy = localStorage.getItem(key)
      if (legacy != null) return JSON.parse(legacy) as T
    }
    return fallback
  } catch {
    return fallback
  }
}

/** useState persisted to localStorage (scoped per logged-in user so accounts on the same browser stay isolated). */
export function useLocalStorage<T>(key: string, initial: T) {
  const user = useCurrentUser()
  const fullKey = scopedKey(key, user?.id)
  const [value, setValue] = useState<T>(() => read(key, initial, user?.id))

  useEffect(() => {
    setValue(read(key, initial, user?.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey])

  useEffect(() => {
    try {
      localStorage.setItem(fullKey, JSON.stringify(value))
    } catch {
      // Storage full or blocked: keep the in-memory value.
    }
  }, [fullKey, value])

  const update = useCallback((next: T | ((prev: T) => T)) => setValue(next), [])
  return [value, update] as const
}
