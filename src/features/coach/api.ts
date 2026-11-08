import type { CoachSession, CoachSessionSummary, CoachStatus, CoachTurnPoll } from '@/types/coach'

async function request<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/coach${url}`, {
      ...init,
      ...(init?.json !== undefined ? { body: JSON.stringify(init.json), headers: { 'Content-Type': 'application/json' } } : {}),
    })
  } catch {
    throw new Error('Could not reach the server (are you offline?).')
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw Object.assign(new Error(json.error ?? `Error ${res.status}.`), { status: res.status })
  return json
}

const post = <T>(url: string, json: unknown = {}) => request<T>(url, { method: 'POST', json })

export const status = () => request<CoachStatus>('/status')
export const listSessions = async () => (await request<{ sessions: CoachSessionSummary[] }>('/sessions')).sessions
export const createSession = async () => (await post<{ id: string }>('/sessions')).id
export const getSession = async (id: string) => (await request<{ session: CoachSession }>(`/session?id=${encodeURIComponent(id)}`)).session
export const deleteSession = (id: string) => request<{ ok: true }>(`/session?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
export const startTurn = async (sessionId: string, text: string, page: string) => (await post<{ turnId: string }>('/turn', { sessionId, text, page })).turnId
export const pollTurn = (sessionId: string, turnId: string) => request<CoachTurnPoll>(`/turn?session=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(turnId)}`)
export const cancelTurn = (sessionId: string, turnId: string) => post<{ ok: true }>('/turn/cancel', { sessionId, turnId })
