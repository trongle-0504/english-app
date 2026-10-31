import type { NewsItem } from '../../src/types/news.ts'
import { isObject, jsonBody, queryParam } from '../admin/input.ts'
import { updateJsonDoc } from '../admin/store.ts'
import { ApiError, type ApiHandler } from '../api.ts'
import {
  collectNews,
  listNews,
  processNewsItemWithAi,
  processTopPendingNews,
  startNewsScheduler,
} from '../news/service.ts'
import path from 'node:path'

export const newsRoutes: Record<string, ApiHandler> = {
  'GET /news': async (_req, ctx) => {
    startNewsScheduler(ctx)
    return { json: await listNews(ctx) }
  },

  'POST /news/collect': async (req, ctx) => {
    startNewsScheduler(ctx)
    const body = isObject(req.body) ? req.body : {}
    const targetDate = typeof body.date === 'string' && body.date.trim() ? body.date.trim() : 'today'
    const limit = typeof body.limit === 'number' && body.limit >= 0 ? body.limit : 0
    const runAiCount = typeof body.runAiCount === 'number' && body.runAiCount >= 0 ? body.runAiCount : 0

    const col = await collectNews(ctx, { targetDate, limit })
    if (runAiCount > 0) {
      void processTopPendingNews(ctx, runAiCount).catch((err) =>
        console.warn('[news] Background batch AI error:', (err as Error).message),
      )
    }
    const latest = await listNews(ctx)
    return { json: { ...col, ...latest } }
  },

  'POST /news/process': async (req, ctx) => {
    startNewsScheduler(ctx)
    const body = jsonBody(req)
    const newsId = typeof body.news_id === 'string' ? body.news_id.trim() : ''
    if (!newsId) throw new ApiError(400, 'Thiếu news_id.')
    const item = await processNewsItemWithAi(ctx, newsId)
    return { json: { item } }
  },

  'POST /news/process-batch': async (req, ctx) => {
    startNewsScheduler(ctx)
    const body = isObject(req.body) ? req.body : {}
    const count = typeof body.count === 'number' && body.count > 0 ? Math.min(20, body.count) : 5
    const res = await processTopPendingNews(ctx, count)
    const latest = await listNews(ctx)
    return { json: { ...res, ...latest } }
  },

  'DELETE /news': async (req, ctx) => {
    const id = queryParam(req, 'id')
    const file = path.join(ctx.rootDir, 'data', 'news.json')
    await updateJsonDoc<NewsItem[], void>(file, [], (items) => {
      const idx = items.findIndex((it) => it.news_id === id)
      if (idx < 0) throw new ApiError(404, 'Không tìm thấy bài báo này.')
      items.splice(idx, 1)
    })
    return { json: { ok: true, id } }
  },
}
