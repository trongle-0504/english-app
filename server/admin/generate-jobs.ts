// Background work after Admin → Vocabulary / Notes → Generate has saved the entry and answered: the picture and, for a
// word, the practice questions. Both run side by side; each writes into the saved entry when it is done (inside the
// content mutation queue), so a failure never loses the entry. State lives in memory and is read by the page through
// GET /admin/generate/job?id=… ("Ảnh / Practice: đang tạo · xong · lỗi, thử lại").
import { randomUUID } from 'node:crypto'
import { ApiError } from '../api.ts'
import { logGenerate } from './generate-log.ts'
import { OwnedMap } from '../users/context.ts'

export type PartName = 'image' | 'practice'

export interface JobPart {
  status: 'running' | 'done' | 'skipped' | 'error'
  error?: string
  ms?: number
  /** What the part produced (the updated entry, a practice summary…), for the page. */
  result?: unknown
}

export interface GenerateJob {
  id: string
  feature: 'vocabulary' | 'note'
  item: string
  createdAt: string
  parts: Partial<Record<PartName, JobPart>>
}

/** A part's work. Returns what to show; `null` = skipped (nothing to do any more, e.g. the entry was deleted). */
export type PartRunner = () => Promise<unknown>

const MAX_JOBS = 100
const jobs = new OwnedMap<string, GenerateJob>()
const runners = new Map<string, Partial<Record<PartName, PartRunner>>>()

const running = (job: GenerateJob) => Object.values(job.parts).some((p) => p?.status === 'running')

async function runPart(job: GenerateJob, name: PartName, run: PartRunner): Promise<void> {
  const started = Date.now()
  job.parts[name] = { status: 'running' }
  try {
    const result = await run()
    job.parts[name] = { status: result === null ? 'skipped' : 'done', ms: Date.now() - started, ...(result === null ? {} : { result }) }
  } catch (error) {
    job.parts[name] = { status: 'error', error: (error as Error).message, ms: Date.now() - started }
    console.warn(`[admin-generate] ${job.feature} ${JSON.stringify(job.item)} background ${name} failed:`, (error as Error).message)
  }
  if (!running(job)) {
    const summary = Object.fromEntries(Object.entries(job.parts).map(([k, p]) => [k, { status: p.status, ms: p.ms, ...(p.error ? { error: p.error } : {}) }]))
    console.log(
      `[admin-generate] ${job.feature} ${JSON.stringify(job.item)} background ${Object.entries(job.parts)
        .map(([k, p]) => `${k}=${p.status}:${p.ms ?? '-'}`)
        .join(' ')}`,
    )
    logGenerate({ kind: 'background', feature: job.feature, item: job.item, jobId: job.id, parts: summary })
  }
}

/** Starts the given parts side by side and returns the job at once. Undefined when there is nothing to run. */
export function startGenerateJob(
  feature: GenerateJob['feature'],
  item: string,
  parts: Partial<Record<PartName, PartRunner>>,
): GenerateJob | undefined {
  const names = (Object.keys(parts) as PartName[]).filter((name) => parts[name])
  if (!names.length) return undefined
  const job: GenerateJob = { id: randomUUID(), feature, item, createdAt: new Date().toISOString(), parts: {} }
  for (const name of names) job.parts[name] = { status: 'running' }
  jobs.set(job.id, job)
  runners.set(job.id, parts)
  while (jobs.size > MAX_JOBS) {
    const oldest = jobs.keys().next().value!
    jobs.delete(oldest)
    runners.delete(oldest)
  }
  for (const name of names) void runPart(job, name, parts[name]!)
  return job
}

export function getGenerateJob(id: string): GenerateJob {
  const job = jobs.get(id)
  if (!job) throw new ApiError(404, 'This background job is no longer known (the server restarted?).')
  return job
}

/** Runs a failed part again ("thử lại"). */
export function retryGeneratePart(id: string, name: PartName): GenerateJob {
  const job = getGenerateJob(id)
  const run = runners.get(id)?.[name]
  if (!run || !job.parts[name]) throw new ApiError(400, `This job has no ${name} part.`)
  if (job.parts[name]!.status === 'running') return job
  void runPart(job, name, run)
  return job
}

/** Resolves when no part of the job is running (tests). */
export async function settled(job: GenerateJob): Promise<GenerateJob> {
  while (running(job)) await new Promise((r) => setTimeout(r, 5))
  return job
}
