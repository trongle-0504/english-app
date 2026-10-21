import { useCallback, useEffect, useState } from 'react'
import type { SpeakingSyncStatus } from '@/types/speaking'
import { speakingApi } from './api'

const POLL_MS = 3000

/** The library sync status, polled while a sync runs. */
export function useSyncStatus() {
  const [status, setStatus] = useState<SpeakingSyncStatus | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      setStatus((await speakingApi.syncStatus()).status)
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  // Follow a running sync.
  const running = status?.job?.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(timer)
  }, [running, load])
  return { status, error, reload: load }
}
