export type NewsStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'timeout'

export const NEWS_TOPICS = [
  'World',
  'Vietnam',
  'Politics',
  'Business',
  'Finance',
  'Technology',
  'Science',
  'Health',
  'Education',
  'Environment',
  'Crime',
  'Law',
  'Travel',
  'Culture',
  'Sports',
  'Lifestyle',
  'Entertainment',
  'Other',
] as const

export type NewsTopic = (typeof NEWS_TOPICS)[number]

export interface NewsVocabItem {
  phrase: string
  ipa: string
  meaning_vi: string
}

export interface NewsProcessing {
  status: NewsStatus
  sent_at: string | null
  started_at: string | null
  completed_at: string | null
  attempts: number
  last_error: string | null
  timeout_at: string | null
}

export interface NewsAiData {
  summary: string | null
  article: string | null
  topic: NewsTopic | null
  vocabulary: NewsVocabItem[]
  raw_response: string | null
}

export interface NewsItem {
  news_id: string
  language: 'vi'
  title: string
  source: string
  source_url: string
  published_at: string | null
  fetched_at: string
  popularity_rank: number | null
  content: string
  content_hash: string
  processing: NewsProcessing
  ai: NewsAiData
}

export interface NewsPipelineState {
  running?: boolean
  current_step?: string | null
  last_run_at: string | null
  last_success_at: string | null
  last_error: string | null
  last_collected: number
  last_processed: number
}
