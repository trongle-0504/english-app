import { createHash } from 'node:crypto'
import type { NewsItem, NewsTopic } from '../../src/types/news.ts'

const TOPIC_RULES: { topic: NewsTopic; pattern: RegExp }[] = [
  { topic: 'Sports', pattern: /bóng đá|quả bóng vàng|ronaldo|messi|hlv |thể thao|vđv|marathon|tennis|pickleball|olympic|world cup|champions league|ngoại hạng anh|v-league/i },
  { topic: 'Entertainment', pattern: /ca sĩ|diễn viên|hoa hậu|showbiz|nhạc |phim |điện ảnh|concert|nghệ sĩ|rapper|truyền hình thực tế|giải trí/i },
  { topic: 'Technology', pattern: /\b(ai|chatgpt|openai|gemini|llm|deepfake|chip)\b|trí tuệ nhân tạo|công nghệ|bán dẫn|vi mạch|smartphone|iphone|samsung|apple|google|microsoft|5g|số hóa|phần mềm|ứng dụng|an ninh mạng|mã độc|hacker|robot/i },
  { topic: 'Science', pattern: /khoa học|vũ trụ|nasa|khảo cổ|hóa thạch|vật lý|sinh học|nghiên cứu mới|phát hiện mới|thiên văn|năng lượng hạt nhân|điện hạt nhân/i },
  { topic: 'Finance', pattern: /ngân hàng|lãi suất|chứng khoán|cổ phiếu|trái phiếu|tỷ giá|giá vàng|\bvàng\b|nợ thuế|thuế môn bài|hoàn thuế|tín dụng|tiền số|bitcoin|bộ tài chính|ngân hàng nhà nước|tài chính/i },
  { topic: 'Business', pattern: /doanh nghiệp|tập đoàn|công ty|lợi nhuận|doanh thu|báo lỗ|cổ đông|khởi nghiệp|startup|bán lẻ|tuyển dụng|lao động đi nhật|xuất khẩu|nhập khẩu|thương mại|bất động sản|chung cư|đấu giá đất|giá xăng|kinh tế|gdp/i },
  { topic: 'Education', pattern: /giáo dục|học sinh|sinh viên|đại học|trường học|thi tốt nghiệp|tuyển sinh|học phí|giáo viên|sách giáo khoa|du học|ielts|học bổng/i },
  { topic: 'Health', pattern: /ung thư|phẫu thuật|vắc xin|vaccine|kháng sinh|mạch vành|đột quỵ|ghép tạng|hiến mô|bệnh viện|ca mổ|điều trị|bác sĩ|bệnh nhân|sức khỏe|y tế|dinh dưỡng|bảo hiểm y tế|dịch bệnh|giảm cân|tích mỡ|ăn cơm trắng|giấc ngủ/i },
  { topic: 'Crime', pattern: /bắt giữ|khởi tố|bị cáo|tội phạm|buôn lậu|tham nhũng|lừa đảo|giết người|ma túy|công an|điều tra|truy nã|trách nhiệm hình sự|đi tù|cướp|trộm|shark bình/i },
  { topic: 'Law', pattern: /pháp luật|tòa án|dự thảo luật|nghị định|xét xử|bản án|hiến pháp|xử phạt|kiện tụng|hợp đồng|tha bổng|khoan hồng/i },
  { topic: 'Environment', pattern: /môi trường|ô nhiễm|rác thải|khí thải|biến đổi khí hậu|bảo tồn|rừng|nước thải|tái chế|\bbão\b|áp thấp|mưa lớn|\blũ\b|ngập lụt|giông lốc|tốc mái|nắng nóng|sạt lở|động đất|thời tiết/i },
  { topic: 'Travel', pattern: /du lịch|khách sạn|resort|visa|hộ chiếu|điểm đến|khách quốc tế|sân bay|hàng không|chuyến bay/i },
  { topic: 'Culture', pattern: /văn hóa|di sản|lễ hội|bảo tàng|lịch sử|kiến trúc|chùa |đền |phong tục|nghệ thuật|sách /i },
  { topic: 'Lifestyle', pattern: /đời sống|gia đình|kết hôn|hôn nhân|nuôi dạy con|ẩm thực|món ăn|nhà cửa|thời trang|làm đẹp|tâm sự/i },
  { topic: 'Politics', pattern: /chính phủ|quốc hội|bộ trưởng|thủ tướng|tổng bí thư|chủ tịch nước|bộ chính trị|tinh gọn|cải cách hành chính|đại biểu quốc hội|bầu cử|tổng thống|nhà trắng|đảng cộng hòa|đảng dân chủ|obama|trump|biden|ngoại giao/i },
  { topic: 'World', pattern: /mỹ |trung quốc|nga |ukraine|israel|iran|triều tiên|nhật bản|hàn quốc|châu âu|\beu\b|tây ban nha|đức |pháp |anh |thế giới|quốc tế|nato|liên hợp quốc/i },
  { topic: 'Vietnam', pattern: /hà nội|tp hcm|tp\.hcm|đà nẵng|hải phòng|cần thơ|an giang|cao tốc|tàu cao tốc|giao thông|metro|đường sắt|cầu |cảng |việt nam/i },
]

/** Classifies an article topic directly from its Vietnamese title into one of NEWS_TOPICS. */
export function classifyTopicFromTitle(title: string, section = ''): NewsTopic {
  const combined = `${title} ${section}`.trim()
  for (const rule of TOPIC_RULES) {
    if (rule.pattern.test(combined)) return rule.topic
  }
  return 'Vietnam'
}

const RSS_URLS = [
  'https://vnexpress.net/rss/tin-moi-nhat.rss',
  'https://vnexpress.net/rss/thoi-su.rss',
  'https://vnexpress.net/rss/the-gioi.rss',
  'https://vnexpress.net/rss/kinh-doanh.rss',
  'https://vnexpress.net/rss/giai-tri.rss',
  'https://vnexpress.net/rss/the-thao.rss',
  'https://vnexpress.net/rss/phap-luat.rss',
  'https://vnexpress.net/rss/giao-duc.rss',
  'https://vnexpress.net/rss/suc-khoe.rss',
  'https://vnexpress.net/rss/doi-song.rss',
  'https://vnexpress.net/rss/du-lich.rss',
  'https://vnexpress.net/rss/khoa-hoc.rss',
  'https://vnexpress.net/rss/so-hoa.rss',
]
const POPULAR_URL = 'https://vnexpress.net/tin-xem-nhieu'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'ref', 'vn_source', 'vn_medium', 'vn_campaign', 'vn_term', 'vn_content'])

/** Normalizes URL: lowercase scheme/host, drop fragment, drop tracking query params. */
export function normalizeUrl(rawUrl: string): string {
  const u = new URL(rawUrl.trim())
  u.protocol = u.protocol.toLowerCase()
  u.hostname = u.hostname.toLowerCase()
  u.hash = ''
  for (const key of [...u.searchParams.keys()]) {
    const lower = key.toLowerCase()
    if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) {
      u.searchParams.delete(key)
    }
  }
  return u.toString()
}

/** First 16 hex chars of SHA-256(normalized_url). */
export function newsIdOf(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl, 'utf8').digest('hex').slice(0, 16)
}

export function contentHashOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** Formats a Date or date string as YYYY-MM-DD in Asia/Ho_Chi_Minh timezone. */
export function vnDateString(dateInput: Date | string = new Date()): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url: string, timeoutMs = 20_000, retries = 3): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: controller.signal,
      })
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(900 * (attempt + 1))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} when fetching ${url}`)
      return await res.text()
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`Failed to fetch ${url}`)
}

export interface RssCandidate {
  url: string
  rssTitle?: string
  rssPubDate?: string
  popularityRank: number | null
}

/** Reads VnExpress RSS and filters items matching targetDate ('today' or 'YYYY-MM-DD'). */
export async function fetchRssCandidates(targetDate = 'today', limit = 0): Promise<RssCandidate[]> {
  const dateStr = targetDate === 'today' ? vnDateString(new Date()) : targetDate === 'all' ? '' : targetDate
  const xmlList = await Promise.all(
    RSS_URLS.map((u) => fetchText(u).catch(() => '')),
  )
  const seen = new Set<string>()
  const items: RssCandidate[] = []

  for (const xml of xmlList) {
    if (!xml) continue
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
      const block = m[1]
      const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(block)
      const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(block)
      const pubMatch = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(block)
      if (!linkMatch) continue

      const rawUrl = decodeHtmlEntities(linkMatch[1])
      if (!rawUrl.startsWith('http') || rawUrl.includes('/video/') || rawUrl.includes('/podcast/')) continue
      const normUrl = normalizeUrl(rawUrl)
      if (seen.has(normUrl)) continue

      const rawPub = pubMatch ? decodeHtmlEntities(pubMatch[1]) : undefined
      const parsedPub = rawPub && !Number.isNaN(Date.parse(rawPub)) ? new Date(rawPub).toISOString() : rawPub
      const pubDate = parsedPub
      if (dateStr && pubDate) {
        const itemDate = vnDateString(pubDate)
        if (itemDate && itemDate !== dateStr) continue
      }

      seen.add(normUrl)
      items.push({
        url: normUrl,
        rssTitle: titleMatch ? decodeHtmlEntities(titleMatch[1]) : undefined,
        rssPubDate: pubDate,
        popularityRank: null,
      })
      if (limit > 0 && items.length >= limit) break
    }
    if (limit > 0 && items.length >= limit) break
  }
  return items
}

/** Reads VnExpress Tin xem nhiều and returns ranked article URLs (rank = 1, 2, 3...). */
export async function fetchPopularCandidates(maxRank = 50): Promise<RssCandidate[]> {
  try {
    const html = await fetchText(POPULAR_URL)
    const seen = new Set<string>()
    const ranked: RssCandidate[] = []
    for (const m of html.matchAll(/<a\s+[^>]*href="(https:\/\/vnexpress\.net\/[^"#?]+-\d+\.html)"[^>]*>/gi)) {
      const tag = m[0]
      const rawUrl = m[1]
      if (rawUrl.includes('/video/') || rawUrl.includes('/podcast/') || rawUrl.includes('/infographics/')) continue
      const norm = normalizeUrl(rawUrl)
      const titleAttr = /title="([^"]+)"/i.exec(tag)?.[1]
      if (seen.has(norm)) continue
      seen.add(norm)
      ranked.push({
        url: norm,
        rssTitle: titleAttr ? decodeHtmlEntities(titleAttr) : undefined,
        popularityRank: ranked.length + 1,
      })
      if (ranked.length >= maxRank) break
    }
    return ranked
  } catch (err) {
    console.warn('[news] Failed to fetch Tin xem nhiều, continuing with RSS only:', (err as Error).message)
    return []
  }
}

/** Parses attributes of <meta ...> tags without breaking on single quotes inside double-quoted Vietnamese titles. */
function parseMetaTags(html: string): Map<string, string> {
  const map = new Map<string, string>()
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? html.slice(0, 25_000)
  for (const tagMatch of head.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = tagMatch[0]
    const attrs: Record<string, string> = {}
    for (const attrMatch of tag.matchAll(/([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const key = attrMatch[1].toLowerCase()
      const val = attrMatch[2] ?? attrMatch[3] ?? ''
      attrs[key] = decodeHtmlEntities(val)
    }
    const content = attrs.content
    if (!content) continue
    for (const k of ['property', 'name', 'itemprop']) {
      if (attrs[k] && !map.has(attrs[k].toLowerCase())) {
        map.set(attrs[k].toLowerCase(), content)
      }
    }
  }
  return map
}

function extractJsonLdDate(html: string): string | null {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]) as Record<string, unknown>
      if (typeof data.datePublished === 'string' && data.datePublished.trim()) {
        return data.datePublished.trim()
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return null
}

/** Extracts full title, published_at, and Vietnamese body content from a VnExpress article page. */
export async function extractArticle(candidate: RssCandidate): Promise<{
  title: string
  published_at: string | null
  content: string
}> {
  const html = await fetchText(candidate.url)
  const metas = parseMetaTags(html)

  // Title priority: 1. og:title, 2. headline, 3. twitter:title, 4. h1.title-detail, 5. RSS title, 6. <title>
  const h1Title = /<h1[^>]*class="[^"]*title-detail[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
  const docTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const rawTitle =
    metas.get('og:title') ||
    metas.get('headline') ||
    metas.get('twitter:title') ||
    (h1Title ? stripTags(h1Title) : '') ||
    candidate.rssTitle ||
    (docTitle ? stripTags(docTitle) : '')
  const title = rawTitle.replace(/\s*-\s*VnExpress[\s\S]*$/i, '').trim()

  // Published date priority: 1. RSS pubDate, 2. article:published_time, 3. datePublished, 4. pubdate, 5. JSON-LD datePublished
  const published_at =
    candidate.rssPubDate ||
    metas.get('article:published_time') ||
    metas.get('datepublished') ||
    metas.get('pubdate') ||
    extractJsonLdDate(html) ||
    null

  // Body content extraction (lead description + fck_detail paragraphs, without comments/tables/captions)
  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<figure[\s\S]*?<\/figure>/gi, '')
    .replace(/<table[\s\S]*?<\/table>/gi, '')

  const paragraphs: string[] = []
  const descMatch = /<p[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(cleanHtml)
  if (descMatch) {
    const lead = stripTags(descMatch[1])
    if (lead) paragraphs.push(lead)
  }

  const articleMatch = /<article[^>]*class="[^"]*fck_detail[^"]*"[^>]*>([\s\S]*?)<\/article>/i.exec(cleanHtml)
  const bodyScope = articleMatch ? articleMatch[1] : cleanHtml
  for (const pMatch of bodyScope.matchAll(/<p(?:\s+[^>]*)?>([\s\S]*?)<\/p>/gi)) {
    const pHtml = pMatch[0]
    if (/class="[^"]*(?:author_mail|Image|subtitle|description)[^"]*"/i.test(pHtml)) continue
    const text = stripTags(pMatch[1])
    if (!text || text.length < 2) continue
    if (paragraphs[paragraphs.length - 1] === text) continue
    paragraphs.push(text)
  }

  // Drop trailing short author name paragraph if present
  if (paragraphs.length > 2 && paragraphs[paragraphs.length - 1].split(/\s+/).length <= 4) {
    paragraphs.pop()
  }

  const content = paragraphs.join('\n\n').trim()
  if (!content || content.length < 80) {
    throw new Error('Nội dung bài báo quá ngắn hoặc không bóc tách được (có thể là bài video/ảnh).')
  }

  return { title: title || candidate.url, published_at, content }
}

export function buildInitialNewsItem(
  candidate: RssCandidate,
  extracted: { title: string; published_at: string | null; content: string } | { error: string },
): NewsItem {
  const normUrl = normalizeUrl(candidate.url)
  const now = new Date().toISOString()
  const u = new URL(normUrl)

  if ('error' in extracted) {
    return {
      news_id: newsIdOf(normUrl),
      language: 'vi',
      title: candidate.rssTitle || normUrl,
      source: u.hostname,
      source_url: normUrl,
      published_at: candidate.rssPubDate || null,
      fetched_at: now,
      popularity_rank: candidate.popularityRank,
      content: '',
      content_hash: '',
      processing: {
        status: 'failed',
        sent_at: null,
        started_at: null,
        completed_at: null,
        attempts: 0,
        last_error: `Extract failed: ${extracted.error}`,
        timeout_at: null,
      },
      ai: {
        summary: null,
        article: null,
        topic: null,
        vocabulary: [],
        raw_response: null,
      },
    }
  }

  return {
    news_id: newsIdOf(normUrl),
    language: 'vi',
    title: extracted.title,
    source: u.hostname,
    source_url: normUrl,
    published_at: extracted.published_at,
    fetched_at: now,
    popularity_rank: candidate.popularityRank,
    content: extracted.content,
    content_hash: contentHashOf(extracted.content),
    processing: {
      status: 'pending',
      sent_at: null,
      started_at: null,
      completed_at: null,
      attempts: 0,
      last_error: null,
      timeout_at: null,
    },
    ai: {
      summary: null,
      article: null,
      topic: null,
      vocabulary: [],
      raw_response: null,
    },
  }
}
