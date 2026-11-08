import { getAdminToken } from '@/features/admin/api'
import type { CoachDayStats, CoachProposal, CoachSession, CoachSessionSummary, CoachStatus, CoachTurnPoll } from '@/types/coach'

async function request<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/coach${url}`, {
      ...init,
      ...(init?.json !== undefined ? { body: JSON.stringify(init.json), headers: { 'Content-Type': 'application/json', ...init.headers } } : {}),
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

/** Confirm: cards and library entries need the admin token, like the app's own buttons. */
export const applyProposal = async (sessionId: string, proposalId: string, keep: number[], library?: { index: number; ok: boolean; label?: string; href?: string; error?: string }[]) => {
  const token = getAdminToken()
  return (
    await request<{ proposal: CoachProposal }>('/proposal/apply', {
      method: 'POST',
      json: { sessionId, proposalId, keep, ...(library ? { library } : {}) },
      headers: token ? { 'x-admin-token': token } : {},
    })
  ).proposal
}
export const dismissProposal = (sessionId: string, proposalId: string) => post<{ ok: true }>('/proposal/dismiss', { sessionId, proposalId })
export const stats = async () => (await request<{ days: CoachDayStats[] }>('/stats')).days
