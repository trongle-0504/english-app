// Your Speaking results and Writing reviews (<userDir>/progress/speaking, <userDir>/progress/writing-reviews) and
// the combined shared + custom review cards for server/practice/*.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { buildContent } from '../../content-pipeline/index.ts'
import { buildCustomCards } from '../../content-pipeline/review.ts'
import type { ReviewCard, ReviewIndex } from '../../src/types/content.ts'
import { workPath } from '../../src/types/practice.ts'
import type { TalkReviewResult } from '../../src/types/speakingReview.ts'
import type { SpeakingResult } from '../../src/types/speaking.ts'
import type { WritingReviewResult } from '../../src/types/writingReview.ts'
import type { ApiContext } from '../api.ts'
import { userPath } from '../paths.ts'

export type WorkContext = Pick<ApiContext, 'rootDir' | 'contentDir' | 'user' | 'userDir'>

async function readAll<T>(dir: string): Promise<T[]> {
  let names: string[] = []
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const docs = await Promise.all(
    names.map(async (name) => {
      try {
        return JSON.parse(await readFile(path.join(dir, name), 'utf8')) as T
      } catch {
        return null
      }
    }),
  )
  return docs.filter((d): d is NonNullable<typeof d> => d !== null) as T[]
}

export const speakingResults = (ctx: WorkContext) => readAll<SpeakingResult>(userPath(ctx, 'progress', 'speaking'))
export const writingReviews = (ctx: WorkContext) => readAll<WritingReviewResult>(userPath(ctx, 'progress', 'writing-reviews'))

export async function speakingResult(ctx: WorkContext, id: string): Promise<SpeakingResult | null> {
  return (await speakingResults(ctx)).find((r) => r.id === id) ?? null
}
export async function writingReview(ctx: WorkContext, id: string): Promise<WritingReviewResult | null> {
  return (await writingReviews(ctx)).find((r) => r.id === id) ?? null
}

export const workHref = workPath

const excerpt = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max).replace(/\s+\S*$/, '')}?` : flat
}
export const speakingTitle = (r: SpeakingResult) => `Speaking Part ${r.part} ? ${r.topic.trim()}`
export const writingTitle = (r: WritingReviewResult) => `Writing ? ${excerpt(r.text, 60)}`
export const talkTitle = (r: TalkReviewResult) => `${r.part === 'free' ? 'Free talk' : `Part ${r.part}`} ? ${excerpt(r.question || r.topic || r.transcript, 60)}`

/** Your recorded answers (Speaking review). */
export const talkReviews = (ctx: WorkContext) => readAll<TalkReviewResult>(userPath(ctx, 'progress', 'speaking-reviews'))

/** Every review card available to this user: shared library cards + the user's own custom cards. */
export function reviewCards(ctx: WorkContext): ReviewCard[] {
  const json = buildContent(ctx.contentDir).files.get('review/index.json')
  const shared = (JSON.parse(json ?? '{"cards":[]}') as ReviewIndex).cards
  const custom = buildCustomCards(userPath(ctx, 'review')).cards
  return [...shared, ...custom]
}

/** Text of segments. */
export const segmentsText = (segments: { text: string }[] | undefined) => (segments ?? []).map((s) => s.text).join('')
