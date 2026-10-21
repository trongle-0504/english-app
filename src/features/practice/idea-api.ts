import type { FormattedIdea } from '@/types/speaking'

/** Where a learner's idea is saved: a Speaking answer, or a Writing review's Vietnamese text. */
export type IdeaSource = { source: 'speaking'; id: string; answerIndex: number } | { source: 'writing'; id: string }

/** The learner's idea laid out by the AI (POST /api/idea/format, shared by Speaking and Writing): formatted once, saved. */
export async function formatIdea(at: IdeaSource): Promise<FormattedIdea> {
  const res = await fetch('/api/idea/format', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(at),
  })
  const json = (await res.json().catch(() => ({}))) as { formatted?: FormattedIdea; error?: string }
  if (!res.ok || !json.formatted) throw new Error(json.error ?? `Request failed (${res.status}).`)
  return json.formatted
}
