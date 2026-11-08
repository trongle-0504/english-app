import type { ApiHandler } from './api.ts'
import { geminiConfigured } from './gemini.ts'
import { adminRoutes } from './routes/admin.ts'
import { analyzeRoutes } from './routes/analyze.ts'
import { authRoutes } from './routes/auth.ts'
import { coachRoutes } from './routes/coach.ts'
import { essayRoutes } from './routes/essays.ts'
import { ideaRoutes } from './routes/idea.ts'
import { reportRoutes } from './routes/report.ts'
import { listeningRoutes } from './routes/listening.ts'
import { lookupRoutes } from './routes/lookup.ts'
import { newsRoutes } from './routes/news.ts'
import { notepadRoutes } from './routes/notepad.ts'
import { plannerRoutes } from './routes/planner.ts'
import { practiceRoutes } from './routes/practice.ts'
import { reviewRoutes } from './routes/review.ts'
import { speakingRoutes } from './routes/speaking.ts'
import { speakingMockRoutes } from './routes/speaking-mock.ts'
import { speakingReviewRoutes } from './routes/speaking-review.ts'
import { ttsRoutes } from './routes/tts.ts'
import { translateRoutes } from './routes/translate.ts'
import { writingReviewRoutes } from './routes/writing-review.ts'

/** All API endpoints, keyed "METHOD /path" relative to /api. */
export const routes: Record<string, ApiHandler> = {
  'GET /health': () => ({ json: { ok: true, gemini: geminiConfigured() } }),
  ...authRoutes,
  ...coachRoutes,
  ...analyzeRoutes,
  ...adminRoutes,
  ...reviewRoutes,
  ...practiceRoutes,
  ...lookupRoutes,
  ...notepadRoutes,
  ...newsRoutes,
  ...writingReviewRoutes,
  ...speakingRoutes,
  ...speakingMockRoutes,
  ...speakingReviewRoutes,
  ...ttsRoutes,
  ...translateRoutes,
  ...ideaRoutes,
  ...reportRoutes,
  ...listeningRoutes,
  ...essayRoutes,
  ...plannerRoutes,
}
