import type {
  PlannerBrief,
  PlannerEvent,
  PlannerEventAhead,
  PlannerHome,
  PlannerRoutineItem,
  PlannerSettings,
  PlannerTask,
  PlannerWeek,
  PushDevice,
  QuickAddItem,
  RescheduleProposal,
  WeekDraftTask,
} from '@/types/planner'

export class OfflineError extends Error {
  constructor() {
    super('Could not reach the server (are you offline?).')
    this.name = 'OfflineError'
  }
}

async function request<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/planner${url}`, {
      ...init,
      ...(init?.json !== undefined ? { body: JSON.stringify(init.json), headers: { 'Content-Type': 'application/json' } } : {}),
    })
  } catch {
    throw new OfflineError()
  }
  if (!res.headers.get('content-type')?.includes('json')) throw new OfflineError()
  const json = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}.`)
  return json
}

const post = <T>(url: string, json: unknown = {}) => request<T>(url, { method: 'POST', json })
const put = <T>(url: string, json: unknown) => request<T>(url, { method: 'PUT', json })

export const getHome = () => request<PlannerHome>('/home')
export const getWeek = (start: string) => request<PlannerWeek>(`/week?start=${start}`)
export const saveTask = async (task: Partial<PlannerTask>) => (await put<{ task: PlannerTask }>('/task', task)).task
export const createTasks = async (tasks: Partial<PlannerTask>[]) => (await post<{ tasks: PlannerTask[] }>('/tasks', { tasks })).tasks
export const deleteTask = async (id: string) => void (await request(`/task?id=${encodeURIComponent(id)}`, { method: 'DELETE' }))
export const setDone = async (id: string, done: boolean) => (await post<{ task: PlannerTask }>('/task/done', { id, done })).task
export const snooze = async (id: string, minutes: number) => (await post<{ task: PlannerTask }>('/task/snooze', { id, minutes })).task
export const moveTask = async (id: string, date: string, time?: string) =>
  (await post<{ task: PlannerTask }>('/task/move', time === undefined ? { id, date } : { id, date, time })).task
export const saveEvent = async (event: Partial<PlannerEvent>) => (await put<{ event: PlannerEvent }>('/event', event)).event
export const getEvents = async () => (await request<{ events: PlannerEventAhead[] }>('/events')).events
export const deleteEvent = async (id: string) => void (await request(`/event?id=${encodeURIComponent(id)}`, { method: 'DELETE' }))
export const eventIcsUrl = (id: string) => `/api/planner/event.ics?id=${encodeURIComponent(id)}`
export const saveRoutine = async (routine: PlannerRoutineItem[]) => (await put<{ routine: PlannerRoutineItem[] }>('/routine', { routine })).routine
export const applyRoutine = async (start: string) => (await post<{ added: number }>('/week/apply-routine', { start })).added
export const copyWeek = async (from: string, to: string) => (await post<{ added: number }>('/week/copy', { from, to })).added
/** targetBand: null clears it. */
export const saveSettings = async (patch: Partial<Omit<PlannerSettings, 'targetBand'>> & { targetBand?: number | null }) => (await put<{ settings: PlannerSettings }>('/settings', patch)).settings
export const quickAdd = (text: string) => post<{ items: QuickAddItem[]; unparsed: string }>('/quick-add', { text })
/** force: always rewrite. refresh: rewrite only if the plan moved on since the cached one (the server decides). */
export const generateBrief = async (force = false, refresh = false) => (await post<{ brief: PlannerBrief }>('/brief', { force, refresh })).brief
export const proposeReschedule = () => post<RescheduleProposal>('/reschedule')
export const applyReschedule = (moves: { taskId: string; date: string; time?: string }[], drop: string[]) =>
  post<{ moved: number; dropped: number }>('/reschedule/apply', { moves, drop })
export const draftWeek = (start: string, minutesPerDay?: number[], focus?: string) =>
  post<{ tasks: WeekDraftTask[]; summary: string }>('/week/draft', { start, minutesPerDay, focus })
export const pushKey = async () => (await request<{ publicKey: string }>('/push/key')).publicKey
export const pushSubscribe = async (subscription: PushSubscriptionJSON, device: string) => void (await post('/push/subscribe', { subscription, device }))
export const pushUnsubscribe = async (endpoint: string) => void (await post('/push/unsubscribe', { endpoint }))
export const pushDevices = async () => (await request<{ devices: PushDevice[] }>('/push/devices')).devices
export const pushTest = async () => (await post<{ results: { device: string; status: number | string }[] }>('/push/test')).results
