import { useState, type ReactNode } from 'react'
import { useOutletContext } from 'react-router'
import { errorMessage } from './api'

/** Provided by AdminLayout to the editor pages. */
export interface AdminOutletContext {
  /** GEMINI_API_KEY is configured, so generation endpoints work. */
  gemini: boolean
}

export function useAdminContext(): AdminOutletContext {
  return useOutletContext<AdminOutletContext>()
}

export type StatusTone = 'success' | 'error' | 'warning' | 'info'

export interface Status {
  tone: StatusTone
  message: ReactNode
}

/** Runs async actions with a pending flag and a status line (errors become an error status). */
export function useAction() {
  const [pending, setPending] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)

  const run = async <T,>(name: string, task: () => Promise<T>): Promise<T | undefined> => {
    setPending(name)
    setStatus(null)
    try {
      return await task()
    } catch (error) {
      setStatus({ tone: 'error', message: errorMessage(error) })
      return undefined
    } finally {
      setPending(null)
    }
  }

  return { pending, status, setStatus, run }
}

export function parseJson(text: string): { value?: unknown; error?: string } {
  if (!text.trim()) return { error: 'Empty' }
  try {
    return { value: JSON.parse(text) }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

/** Same rules as content-pipeline/shared.ts slugify (ids in /data URLs). */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(new Error('Cannot read the image file.'))
    reader.readAsDataURL(file)
  })
}

/** Image files from a paste or drop event. */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  const fromItems = Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  return fromItems.length ? fromItems : Array.from(data.files ?? []).filter((file) => file.type.startsWith('image/'))
}
