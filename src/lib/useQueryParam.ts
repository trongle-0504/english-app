import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'

/** A single search param as state; empty string removes it. Replaces history and keeps the #hash. */
export function useQueryParam(name: string): [string, (value: string) => void] {
  const location = useLocation()
  const navigate = useNavigate()
  const value = new URLSearchParams(location.search).get(name) ?? ''

  const setValue = useCallback(
    (next: string) => {
      const params = new URLSearchParams(window.location.search)
      if (next) params.set(name, next)
      else params.delete(name)
      const search = params.toString()
      navigate({ search: search ? `?${search}` : '', hash: window.location.hash }, { replace: true, preventScrollReset: true })
    },
    [name, navigate],
  )
  return [value, setValue]
}
