import path from 'node:path'
import { z } from 'zod'
import { NEWS_TOPICS, type NewsItem, type NewsPipelineState, type NewsTopic } from '../../src/types/news.ts'
import { readJsonDoc, updateJsonDoc } from '../admin/store.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { antigravityJson } from '../llm/antigravity-cli.ts'
import {
  buildInitialNewsItem,
  classifyTopicFromTitle,
  extractArticle,
  fetchPopularCandidates,
  fetchRssCandidates,
  newsIdOf,
  normalizeUrl,
  vnDateString,
  type RssCandidate,
} from './collector.ts'

const newsFile = (ctx: Pick<ApiContext, 'rootDir'>) => path.join(ctx.rootDir, 'data', 'news.json')
const stateFile = (ctx: Pick<ApiContext, 'rootDir'>) => path.join(ctx.rootDir, 'data', 'pipeline_state.json')

const DEFAULT_STATE: NewsPipelineState = {
  running: false,
  current_step: null,
  last_run_at: null,
  last_success_at: null,
  last_error: null,
  last_collected: 0,
  last_processed: 0,
}

const AiNewsSchema = z.object({
  summary: z.string().min(20).describe('A concise 3-5 sentence English summary preserving all names, numbers, dates, and events.'),
  topic: z.enum(NEWS_TOPICS).catch('Other').describe('Exactly one topic from the allowed list.'),
  article: z
    .string()
    .min(100)
    .describe('Complete English news article rewritten in journalistic style suitable for IELTS Band 6.5-7.0, with a headline and clear paragraphs.'),
  vocabulary: z
    .array(
      z.object({
        phrase: z.string().min(2).describe('Useful IELTS word or collocation that appears verbatim in the English article.'),
        ipa: z.string().min(1).describe('IPA pronunciation, e.g. /treɪd ˈdefɪsɪt/.'),
        meaning_vi: z.string().min(1).describe('Concise Vietnamese meaning in the context of the article.'),
      }),
    )
    .max(15)
    .describe('Up to 15 useful IELTS words or collocations taken verbatim from the English article.'),
})

function toJsonSchema(schema: z.ZodType): unknown {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  return rest
}

const NEWS_SYSTEM_PROMPT = `You are an expert bilingual journalist and IELTS instructor.
You will receive a Vietnamese news article (title and full content) from VnExpress.
Your task is to return a single JSON object matching the required schema with four fields: "summary", "topic", "article", and "vocabulary".

STRICT RULES:
1. SUMMARY ("summary"):
   - Write a 3 to 5 sentence summary in English.
   - Preserve all proper names, figures/statistics, dates, and key events accurately.
   - Do not invent or speculate beyond the source text.

2. TOPIC ("topic"):
   - Choose converter topic strictly from: ${NEWS_TOPICS.join(', ')}.

3. ENGLISH ARTICLE ("article"):
   - Translate and rewrite the entire Vietnamese article into natural, well-structured English.
   - Preserve every event, statistic, proper name, quote, and timeline from the original Vietnamese article.
   - Use clear journalistic/academic English suitable for IELTS around Band 6.5–7.0, with natural collocations (do not make it artificially archaic or overly complex).
   - Do not add personal opinions or information not present in the source.
   - Start with a clear English headline on the first line (e.g. "### Headline"), followed by clear paragraphs separated by blank lines.
   - Do NOT append any source URLs or redirect links at the end of the article.

4. IELTS VOCABULARY ("vocabulary"):
   - Select between 8 and 15 high-value IELTS words or collocations that appear VERBATIM inside your English "article".
   - Do not repeat phrases, do not pick proper nouns or full sentences.
   - For each item provide:
     * "phrase": the exact word or collocation as written in the English article
     * "ipa": standard IPA transcription (e.g. "/kʌm ˈʌndə ˈskruːtəni/")
     * "meaning_vi": clear, concise Vietnamese meaning.`

const newsModel = () =>
  process.env.NEWS_ANTIGRAVITY_MODEL ||
  process.env.WRITING_REVIEW_ANTIGRAVITY_MODEL ||
  process.env.SPEAKING_ANTIGRAVITY_MODEL ||
  'gemini-3.8-flash-medium'

export async function listNews(ctx: Pick<ApiContext, 'rootDir'>): Promise<{
  items: NewsItem[]
  state: NewsPipelineState
}> {
  const [newsDoc, stateDoc] = await Promise.all([
    readJsonDoc<NewsItem[]>(newsFile(ctx), []),
    readJsonDoc<NewsPipelineState>(stateFile(ctx), DEFAULT_STATE),
  ])
  const sorted = [...newsDoc.value].sort((a, b) => {
    const rankA = a.popularity_rank ?? 9999
    const rankB = b.popularity_rank ?? 9999
    if (rankA !== rankB) return rankA - rankB
    const timeA = a.published_at ? Date.parse(a.published_at) || 0 : Date.parse(a.fetched_at) || 0
    const timeB = b.published_at ? Date.parse(b.published_at) || 0 : Date.parse(b.fetched_at) || 0
    return timeB - timeA
  })
  return { items: sorted, state: stateDoc.value }
}

async function setPipelineState(
  ctx: Pick<ApiContext, 'rootDir'>,
  patch: Partial<NewsPipelineState>,
): Promise<NewsPipelineState> {
  return updateJsonDoc<NewsPipelineState, NewsPipelineState>(stateFile(ctx), DEFAULT_STATE, (cur) => {
    Object.assign(cur, patch)
    return { ...cur }
  })
}

const BatchTitleTopicSchema = z.object({
  items: z.array(
    z.object({
      news_id: z.string(),
      topic: z.enum(NEWS_TOPICS).catch('Other'),
    }),
  ),
})

/**
 * Classifies a list of articles into NEWS_TOPICS using only their titles in a single fast AI call.
 */
export async function classifyTitlesBatchWithAi(
  ctx: Pick<ApiContext, 'rootDir'>,
  targets: { news_id: string; title: string }[],
): Promise<void> {
  if (targets.length === 0) return
  const CHUNK = 40
  for (let i = 0; i < targets.length; i += CHUNK) {
    const slice = targets.slice(i, i + CHUNK)
    try {
      const res = await antigravityJson({
        label: `news-topics-batch (${slice.length} titles)`,
        system: `You are a news editor. Classify each Vietnamese news headline into EXACTLY ONE topic from this list: ${NEWS_TOPICS.join(', ')}.`,
        prompt: slice.map((t) => `${t.news_id}: ${t.title}`).join('\n'),
        jsonSchema: toJsonSchema(BatchTitleTopicSchema),
        model: newsModel(),
        effort: 'low',
      })
      const parsed = BatchTitleTopicSchema.parse(res.value)
      const map = new Map(parsed.items.map((it) => [it.news_id, it.topic]))
      await updateJsonDoc<NewsItem[], void>(newsFile(ctx), [], (items) => {
        for (const it of items) {
          const tp = map.get(it.news_id)
          if (tp && (NEWS_TOPICS as readonly string[]).includes(tp)) {
            it.ai.topic = tp
          } else if (!it.ai.topic || !(NEWS_TOPICS as readonly string[]).includes(it.ai.topic)) {
            it.ai.topic = classifyTopicFromTitle(it.title)
          }
        }
      })
    } catch (err) {
      console.warn('[news] Batch title topic AI fallback to keyword rules:', (err as Error).message)
    }
  }
}

/**
 * Collects today's VnExpress RSS + Tin xem nhiều, extracts article text for new URLs, and merges atomically into data/news.json.
 */
export async function collectNews(
  ctx: Pick<ApiContext, 'rootDir'>,
  { targetDate = 'today', limit = 0 }: { targetDate?: string; limit?: number } = {},
): Promise<{ added: number; total: number }> {
  await setPipelineState(ctx, {
    running: true,
    current_step: 'Đang tải danh sách bài mới từ VnExpress RSS & Tin xem nhiều...',
    last_run_at: new Date().toISOString(),
    last_error: null,
  })

  try {
    const [rssList, popularList] = await Promise.all([
      fetchRssCandidates(targetDate, limit),
      fetchPopularCandidates(50),
    ])

    // Merge candidates by normalized URL; popularList provides popularityRank
    const mergedMap = new Map<string, RssCandidate>()
    for (const pop of popularList) {
      mergedMap.set(pop.url, { ...pop })
    }
    for (const rss of rssList) {
      const existing = mergedMap.get(rss.url)
      if (existing) {
        existing.rssTitle = existing.rssTitle || rss.rssTitle
        existing.rssPubDate = existing.rssPubDate || rss.rssPubDate
      } else {
        mergedMap.set(rss.url, { ...rss })
      }
    }

    const rankByUrl = new Map<string, number>()
    for (const pop of popularList) {
      if (pop.popularityRank != null) rankByUrl.set(pop.url, pop.popularityRank)
    }

    const currentDoc = await readJsonDoc<NewsItem[]>(newsFile(ctx), [])
    const existingById = new Map(currentDoc.value.map((item) => [item.news_id, item]))

    // Determine which candidates need HTML extraction (new articles, or failed extraction with empty content)
    const toExtract: RssCandidate[] = []
    for (const cand of mergedMap.values()) {
      const id = newsIdOf(cand.url)
      const prev = existingById.get(id)
      if (!prev || (!prev.content && prev.processing.status === 'failed')) {
        toExtract.push(cand)
      }
    }

    const cap = limit > 0 ? toExtract.slice(0, limit) : toExtract
    const extractedItems: NewsItem[] = []

    // Extract in polite batches of 3 with 250ms delay to avoid VnExpress HTTP 429
    const BATCH = 3
    for (let i = 0; i < cap.length; i += BATCH) {
      if (i > 0) await new Promise((r) => setTimeout(r, 250))
      const slice = cap.slice(i, i + BATCH)
      await setPipelineState(ctx, {
        current_step: `Đang bóc tách nội dung bài báo (${Math.min(i + BATCH, cap.length)}/${cap.length})...`,
      })
      const batchRes = await Promise.all(
        slice.map(async (cand) => {
          try {
            const ext = await extractArticle(cand)
            return buildInitialNewsItem(cand, ext)
          } catch (err) {
            return buildInitialNewsItem(cand, { error: (err as Error).message })
          }
        }),
      )
      const targetYmd = targetDate === 'today' ? vnDateString(new Date()) : targetDate === 'all' ? '' : targetDate
      extractedItems.push(
        ...batchRes.filter((item) => {
          if (!item.content && item.title.startsWith('http')) return false
          if (targetYmd && item.published_at) {
            const pubYmd = vnDateString(item.published_at)
            if (pubYmd && pubYmd !== targetYmd) return false
          }
          return true
        }),
      )
    }

    let addedCount = 0
    const totalCount = await updateJsonDoc<NewsItem[], number>(newsFile(ctx), [], (items) => {
      const byId = new Map(items.map((it) => [it.news_id, it]))

      // Update popularity ranks on all items
      for (const it of items) {
        const norm = normalizeUrl(it.source_url)
        if (rankByUrl.has(norm)) {
          it.popularity_rank = rankByUrl.get(norm)!
        }
      }

      for (const fresh of extractedItems) {
        const prev = byId.get(fresh.news_id)
        if (!prev) {
          items.push(fresh)
          byId.set(fresh.news_id, fresh)
          addedCount++
        } else if (!prev.content && fresh.content) {
          prev.title = fresh.title
          prev.published_at = fresh.published_at
          prev.content = fresh.content
          prev.content_hash = fresh.content_hash
          prev.popularity_rank = fresh.popularity_rank ?? prev.popularity_rank
          prev.processing.status = 'pending'
          prev.processing.last_error = null
        }
      }
      return items.length
    })

    if (extractedItems.length > 0) {
      await setPipelineState(ctx, {
        current_step: `Đang phân loại chủ đề từ tiêu đề cho ${extractedItems.length} bài mới...`,
      })
      await classifyTitlesBatchWithAi(
        ctx,
        extractedItems.map((it) => ({ news_id: it.news_id, title: it.title })),
      )
    }

    await setPipelineState(ctx, {
      running: false,
      current_step: null,
      last_success_at: new Date().toISOString(),
      last_collected: addedCount,
    })

    return { added: addedCount, total: totalCount }
  } catch (err) {
    const msg = (err as Error).message
    await setPipelineState(ctx, {
      running: false,
      current_step: null,
      last_error: msg,
    })
    throw err
  }
}

/**
 * Runs Antigravity CLI on a single NewsItem by news_id to generate English summary, topic, Band 6.5 article, and IELTS vocabulary.
 */
export async function processNewsItemWithAi(ctx: Pick<ApiContext, 'rootDir'>, newsId: string): Promise<NewsItem> {
  const timeoutMs = Number(process.env.ANTIGRAVITY_TIMEOUT_MS) || 5 * 60_000
  const now = new Date()

  // 1. Claim the item and mark as in_progress
  let claimed = await updateJsonDoc<NewsItem[], NewsItem>(newsFile(ctx), [], (items) => {
    const found = items.find((it) => it.news_id === newsId)
    if (!found) throw new ApiError(404, `Không tìm thấy bài báo (${newsId}).`)
    found.processing.status = 'in_progress'
    found.processing.sent_at = now.toISOString()
    found.processing.started_at = now.toISOString()
    found.processing.attempts = (found.processing.attempts || 0) + 1
    found.processing.last_error = null
    found.processing.timeout_at = new Date(now.getTime() + timeoutMs).toISOString()
    return structuredClone(found)
  })

  try {
    if (!claimed.content.trim()) {
      const ext = await extractArticle({
        url: claimed.source_url,
        rssTitle: claimed.title,
        rssPubDate: claimed.published_at ?? undefined,
        popularityRank: claimed.popularity_rank,
      })
      claimed = await updateJsonDoc<NewsItem[], NewsItem>(newsFile(ctx), [], (items) => {
        const found = items.find((it) => it.news_id === newsId)
        if (!found) throw new ApiError(404, `Không tìm thấy bài báo (${newsId}).`)
        found.title = ext.title || found.title
        found.published_at = ext.published_at || found.published_at
        found.content = ext.content
        return structuredClone(found)
      })
    }
    const prompt = [
      `VIETNAMESE ARTICLE TITLE:\n${claimed.title}`,
      `PUBLISHED AT: ${claimed.published_at || 'N/A'}`,
      `SOURCE URL: ${claimed.source_url}`,
      `VIETNAMESE ARTICLE CONTENT:\n${claimed.content}`,
    ].join('\n\n')

    const res = await antigravityJson({
      label: `news: ${claimed.title.slice(0, 45)}`,
      system: NEWS_SYSTEM_PROMPT,
      prompt,
      jsonSchema: toJsonSchema(AiNewsSchema),
      model: newsModel(),
      effort: 'medium',
    })

    const parsed = AiNewsSchema.parse(res.value)
    const validTopic: NewsTopic = (NEWS_TOPICS as readonly string[]).includes(parsed.topic) ? parsed.topic : 'Other'

    // Deduplicate vocabulary items
    const seenPhrases = new Set<string>()
    const cleanVocab = parsed.vocabulary.filter((v) => {
      const key = v.phrase.trim().toLowerCase()
      if (!key || seenPhrases.has(key)) return false
      seenPhrases.add(key)
      return true
    })

    const updated = await updateJsonDoc<NewsItem[], NewsItem>(newsFile(ctx), [], (items) => {
      const found = items.find((it) => it.news_id === newsId)
      if (!found) throw new ApiError(404, `Không tìm thấy bài báo (${newsId}).`)
      found.ai = {
        summary: parsed.summary.trim(),
        article: parsed.article.trim(),
        topic: validTopic,
        vocabulary: cleanVocab,
        raw_response: null,
      }
      found.processing.status = 'done'
      found.processing.completed_at = new Date().toISOString()
      found.processing.last_error = null
      found.processing.timeout_at = null
      return structuredClone(found)
    })

    return updated
  } catch (err) {
    const msg = (err as Error).message || 'Antigravity CLI failed'
    const isTimeout = /timed out|timeout/i.test(msg)
    await updateJsonDoc<NewsItem[], void>(newsFile(ctx), [], (items) => {
      const found = items.find((it) => it.news_id === newsId)
      if (!found) return
      found.processing.status = isTimeout ? 'timeout' : 'failed'
      found.processing.last_error = msg
    })
    throw err
  }
}

/**
 * Processes up to `maxCount` pending (or retryable failed, attempts < 3) articles, prioritizing Tin xem nhiều first.
 */
export async function processTopPendingNews(
  ctx: Pick<ApiContext, 'rootDir'>,
  maxCount = 5,
): Promise<{ processed: number; errors: number }> {
  const { items } = await listNews(ctx)
  const candidates = items
    .filter(
      (it) =>
        Boolean(it.content.trim()) &&
        (it.processing.status === 'pending' || (it.processing.status === 'failed' && it.processing.attempts < 3)),
    )
    .slice(0, maxCount)

  if (!candidates.length) return { processed: 0, errors: 0 }

  await setPipelineState(ctx, {
    running: true,
    current_step: `Đang chạy Antigravity CLI cho ${candidates.length} bài báo nổi bật...`,
  })

  let processed = 0
  let errors = 0
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i]
    await setPipelineState(ctx, {
      current_step: `Đang tạo bài tiếng Anh & Vocab (${i + 1}/${candidates.length}): ${item.title.slice(0, 50)}...`,
    })
    try {
      await processNewsItemWithAi(ctx, item.news_id)
      processed++
    } catch (err) {
      errors++
      console.warn(`[news] AI processing failed for ${item.news_id}:`, (err as Error).message)
    }
  }

  await setPipelineState(ctx, {
    running: false,
    current_step: null,
    last_success_at: new Date().toISOString(),
    last_processed: processed,
  })

  return { processed, errors }
}

/** Full pipeline run (collect + process top batch), invoked by the 06:00, 18:00 scheduler or manually. */
let pipelineInFlight: Promise<{ added: number; processed: number }> | null = null

export function runFullNewsPipeline(
  ctx: Pick<ApiContext, 'rootDir'>,
  { aiBatchSize = 5 }: { aiBatchSize?: number } = {},
): Promise<{ added: number; processed: number }> {
  if (pipelineInFlight) return pipelineInFlight
  pipelineInFlight = (async () => {
    try {
      const col = await collectNews(ctx, { targetDate: 'today', limit: 0 })
      const ai = aiBatchSize > 0 ? await processTopPendingNews(ctx, aiBatchSize) : { processed: 0, errors: 0 }
      return { added: col.added, processed: ai.processed }
    } finally {
      pipelineInFlight = null
    }
  })()
  return pipelineInFlight
}

/**
 * Starts the 2x/day automatic scheduler (06:00, 18:00 in Asia/Ho_Chi_Minh timezone).
 * Also triggers an initial background collection if data/news.json does not exist yet.
 */
const SCHEDULE_SLOTS = new Set(['06:00', '18:00'])

export function startNewsScheduler(ctx: Pick<ApiContext, 'rootDir'>): void {
  // NEWS_SCHEDULER=off (the multi-user app): no timed collection; the admin collects by hand.
  if (process.env.NEWS_SCHEDULER === 'off') return
  const g = globalThis as { __newsSchedulerStarted?: boolean }
  if (g.__newsSchedulerStarted) return
  g.__newsSchedulerStarted = true

  let lastTriggeredKey = ''

  const checkClock = () => {
    const now = new Date()
    const hhmm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now)
    const day = vnDateString(now)
    const key = `${day}_${hhmm}`
    if (SCHEDULE_SLOTS.has(hhmm) && lastTriggeredKey !== key) {
      lastTriggeredKey = key
      console.log(`[news] Running scheduled pipeline at ${key} (Asia/Ho_Chi_Minh)`)
      void runFullNewsPipeline(ctx, { aiBatchSize: 6 }).catch((err) =>
        console.error('[news] Scheduled pipeline error:', err),
      )
    }
  }

  const timer = setInterval(checkClock, 30_000)
  timer.unref?.()

  // Initial seed if news.json is empty
  void (async () => {
    const { items } = await listNews(ctx)
    if (items.length === 0) {
      console.log('[news] data/news.json is empty — running initial collection + top 3 AI processing in background...')
      await runFullNewsPipeline(ctx, { aiBatchSize: 3 }).catch((err) =>
        console.warn('[news] Initial collection failed:', (err as Error).message),
      )
    }
  })()
}
