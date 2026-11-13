import type { ComponentType } from 'react'
import { createBrowserRouter, Navigate, redirect, useParams, type LoaderFunctionArgs, type RouteObject } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { NotFound, RouteError } from '@/components/layout/RouteError'
import { requireUser } from '@/features/auth/session'
import { prefetchData } from '@/lib/data'

type PageModule = { default: ComponentType }

/** Lazy page module; `data` keys are fetched in parallel with the page's JavaScript. */
function page(load: () => Promise<PageModule>, data?: (params: LoaderFunctionArgs['params']) => string[]) {
  return {
    lazy: async () => ({ Component: (await load()).default }),
    loader: data
      ? ({ params }: LoaderFunctionArgs) => {
          data(params).forEach(prefetchData)
          return null
        }
      : undefined,
  }
}

/** Redirect preserving params, for URLs from the previous version of the site. */
function Legacy({ to }: { to: (params: Record<string, string | undefined>) => string }) {
  return <Navigate to={to(useParams())} replace />
}

const routes: RouteObject[] = [
  // Outside the app shell: no header or menus before logging in.
  { path: 'login', errorElement: <RouteError />, ...page(() => import('@/features/auth/LoginPage')) },
  // Multi-user app: the sign-up form and the "waiting for approval" page, also outside the shell.
  { path: 'register', errorElement: <RouteError />, ...page(() => import('@/features/auth/RegisterPage')) },
  { path: 'pending', errorElement: <RouteError />, ...page(() => import('@/features/auth/PendingPage')) },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    // Every page needs a session (the server refuses /api and /data without one).
    loader: requireUser,
    // Shown while the first route's code loads.
    hydrateFallbackElement: <div className="min-h-dvh" aria-busy="true" />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, ...page(() => import('@/features/home/HomePage')) },

          /* Collocations */
          {
            path: 'collocations',
            ...page(
              () => import('@/features/collocations/CollocationListPage'),
              () => ['collocations/index.json'],
            ),
          },
          {
            path: 'collocations/:lessonId',
            ...page(
              () => import('@/features/collocations/CollocationLessonPage'),
              (p) => [`collocations/${p.lessonId}.json`],
            ),
          },
          { path: 'collocations/:topicId/:lessonId', element: <Legacy to={(p) => `/collocations/${p.lessonId}`} /> },
          // The mind map feature was removed; send its old URLs to the lessons.
          { path: 'collocations-mindmap', element: <Navigate to="/collocations" replace /> },
          { path: 'collocations-mindmap/:lessonId', element: <Legacy to={(p) => `/collocations/${p.lessonId}`} /> },
          { path: 'collocations-mindmap/:topicId/:lessonId', element: <Legacy to={(p) => `/collocations/${p.lessonId}`} /> },

          /* Vocabulary */
          {
            path: 'vocabulary',
            ...page(
              () => import('@/features/vocabulary/VocabularyListPage'),
              () => ['vocabulary/index.json'],
            ),
          },
          {
            path: 'vocabulary/:topicId/:subTopicId',
            ...page(
              () => import('@/features/vocabulary/VocabularyLessonPage'),
              (p) => [`vocabulary/${p.topicId}/${p.subTopicId}.json`],
            ),
          },
          { path: 'vocabulary-mindmap', element: <Navigate to="/vocabulary" replace /> },
          { path: 'vocabulary-mindmap/:topicId/:subTopicId', element: <Legacy to={(p) => `/vocabulary/${p.topicId}/${p.subTopicId}`} /> },
          { path: 'mindmap', element: <Navigate to="/vocabulary" replace /> },
          { path: 'mindmap/:topicId/:subTopicId', element: <Legacy to={(p) => `/vocabulary/${p.topicId}/${p.subTopicId}`} /> },

          /* Grammar */
          {
            path: 'grammar',
            ...page(
              () => import('@/features/grammar/GrammarListPage'),
              () => ['grammar/index.json'],
            ),
          },
          {
            path: 'grammar/:slug',
            ...page(
              () => import('@/features/grammar/GrammarLessonPage'),
              (p) => [`grammar/${p.slug}.json`],
            ),
          },
          { path: 'grammar-analyze', ...page(() => import('@/features/grammar/GrammarAnalyzePage')) },

          /* Notes */
          {
            path: 'notes',
            ...page(
              () => import('@/features/notes/NotesPage'),
              () => ['notes.json'],
            ),
          },
          { path: 'note', element: <Navigate to="/notes" replace /> },

          /* Review (spaced repetition; progress needs the local server) */
          {
            path: 'review',
            ...page(
              () => import('@/features/review/ReviewPage'),
              () => ['review/index.json'],
            ),
          },
          {
            path: 'review/session',
            ...page(
              () => import('@/features/review/ReviewSessionPage'),
              () => ['review/index.json'],
            ),
          },
          {
            path: 'review/usage',
            ...page(
              () => import('@/features/review/UsageSessionPage'),
              () => ['review/index.json'],
            ),
          },

          /* Blog */
          {
            path: 'blog',
            ...page(
              () => import('@/features/blog/BlogListPage'),
              () => ['blog/index.json'],
            ),
          },
          {
            path: 'blog/:slug',
            ...page(
              () => import('@/features/blog/BlogPostPage'),
              (p) => [`blog/${p.slug}.json`, 'blog/index.json'],
            ),
          },

          /* Practice */
          {
            path: 'practice',
            ...page(
              () => import('@/features/practice/PracticeHomePage'),
              () => ['practice/index.json'],
            ),
          },
          {
            path: 'practice/quiz/:quizId',
            ...page(
              () => import('@/features/practice/QuizPage'),
              (p) => [`practice/quiz/${p.quizId}.json`],
            ),
          },
          {
            path: 'practice/writing',
            ...page(
              () => import('@/features/practice/WritingListPage'),
              () => ['practice/index.json'],
            ),
          },
          {
            path: 'practice/writing/:setId',
            ...page(
              () => import('@/features/practice/WritingPage'),
              (p) => [`practice/writing/${p.setId}.json`],
            ),
          },
          { path: 'practice/dictation', ...page(() => import('@/features/practice/DictationPage')) },
          { path: 'practice/listening-simplify', ...page(() => import('@/features/practice/ListeningSimplifyPage')) },
          { path: 'practice/listening-simplify/history', ...page(() => import('@/features/practice/ListeningHistoryPage')) },
          { path: 'practice/speaking', ...page(() => import('@/features/practice/ReadAloudPage')) },
          { path: 'practice/writing-review', ...page(() => import('@/features/practice/WritingReviewPage')) },
          {
            path: 'practice/writing-mock',
            ...page(
              () => import('@/features/practice/WritingMockTestPage'),
              () => ['practice/writing-mock/prompts.json', 'practice/writing-mock/topics.json', 'practice/writing-mock/task1-prompts.json'],
            ),
          },
          { path: 'practice/writing-review/history', ...page(() => import('@/features/practice/WritingReviewHistoryPage')) },
          { path: 'practice/speaking-ideas', ...page(() => import('@/features/practice/SpeakingIdeasPage')) },
          { path: 'practice/speaking-ideas/history', ...page(() => import('@/features/practice/SpeakingHistoryPage')) },
          { path: 'practice/speaking-review', ...page(() => import('@/features/practice/SpeakingReviewPage')) },
          { path: 'practice/speaking-review/history', ...page(() => import('@/features/practice/SpeakingReviewHistoryPage')) },
          {
            path: 'practice/speaking-mock',
            ...page(
              () => import('@/features/practice/SpeakingMockTestPage'),
              () => ['practice/speaking-mock.json'],
            ),
          },
          { path: 'practice/mistakes', ...page(() => import('@/features/practice/MistakesPage')) },
          {
            path: 'practice/essays',
            ...page(
              () => import('@/features/essays/EssayLibraryPage'),
              () => ['essays/index.json'],
            ),
          },
          {
            path: 'practice/essays/:essayId',
            ...page(
              () => import('@/features/essays/EssayPage'),
              (p) => [`essays/${p.essayId}.json`],
            ),
          },
          { path: 'practice-writing', element: <Navigate to="/practice/writing" replace /> },
          { path: 'practice-dictation', element: <Navigate to="/practice/dictation" replace /> },

          { path: 'planner', ...page(() => import('@/features/planner/PlannerPage')) },
          { path: 'news', ...page(() => import('@/features/news/NewsPage')) },
          { path: 'notepad', ...page(() => import('@/features/notepad/NotepadPage')) },
          { path: 'account', ...page(() => import('@/features/auth/AccountPage')) },
          { path: 'help', ...page(() => import('@/features/help/HelpPage')) },
          { path: 'help/:id', ...page(() => import('@/features/help/HelpPage')) },

          /* Admin (needs the local API server) */
          {
            path: 'admin',
            ...page(() => import('@/features/admin/AdminLayout')),
            children: [
              { index: true, element: <Navigate to="/admin/vocabulary" replace /> },
              { path: 'vocabulary', ...page(() => import('@/features/admin/VocabularyAdminPage')) },
              { path: 'grammar', ...page(() => import('@/features/admin/GrammarAdminPage')) },
              { path: 'note', ...page(() => import('@/features/admin/NoteAdminPage')) },
              { path: 'notepad', element: <Navigate to="/notepad" replace /> },
              { path: 'blog', ...page(() => import('@/features/admin/BlogAdminPage')) },
              { path: 'essays', ...page(() => import('@/features/admin/EssayAdminPage')) },
              { path: 'usage', ...page(() => import('@/features/admin/UsageAdminPage')) },
              { path: 'users', ...page(() => import('@/features/admin/UsersAdminPage')) },
              { path: 'reference', ...page(() => import('@/features/admin/ReferenceBankPage')) },
            ],
          },

          {
            // The old site prefixed every URL with a locale (/en/vocabulary → /vocabulary).
            path: ':locale/*',
            loader: ({ params, request }) => {
              if (params.locale !== 'en' && params.locale !== 'fr') return null
              const url = new URL(request.url)
              throw redirect(`/${params['*'] ?? ''}${url.search}${url.hash}`)
            },
            element: <NotFound />,
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
