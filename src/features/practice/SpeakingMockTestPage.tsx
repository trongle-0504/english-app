import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  CornerDownRight,
  Eye,
  Mic,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  Sparkles,
} from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useData } from '@/lib/data'
import { useLocalStorage } from '@/lib/storage'
import type {
  SpeakingMockDataset,
  SpeakingMockPart1Topic,
  SpeakingMockPart23SubTopic,
} from '@/types/content'
import type { TalkReviewResult } from '@/types/speakingReview'
import { talkApi } from './speaking-review/api'
import { MockExamRoom } from './speaking-mock/MockExamRoom'
import { MockReviewAndResults } from './speaking-mock/MockReviewAndResults'
import {
  buildMockSessionQuestions,
  getCompletedSetIds,
  getSavedMockAttempts,
  markSetIdCompleted,
  markSetIdSeen,
  PART_COMBINATIONS,
  pickUnseenRandom,
  saveMockAttempt,
  type BuiltMockSession,
  type MockQuestionEvaluation,
  type MockQuestionRecording,
  type PartCombinationId,
  type SavedMockAttempt,
} from './speaking-mock/types'

type ScreenStage = 'select' | 'exam' | 'review'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default function SpeakingMockTestPage() {
  const dataset = useData<SpeakingMockDataset>('practice/speaking-mock.json')

  const [stage, setStage] = useState<ScreenStage>('select')
  const [combinationId, setCombinationId] = useLocalStorage<PartCombinationId>(
    'practice:speaking-mock:combination',
    'full',
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'todo' | 'done'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const [selectedPart1Id, setSelectedPart1Id] = useState<string>('')
  const [selectedPart23Id, setSelectedPart23Id] = useState<string>('')

  const [session, setSession] = useState<BuiltMockSession | null>(null)
  const [examInitialQuestionIdx, setExamInitialQuestionIdx] = useState<number>(0)
  const [singleQuestionRerecord, setSingleQuestionRerecord] = useState<boolean>(false)

  const [recordings, setRecordings] = useState<Record<string, MockQuestionRecording>>({})
  const [evaluations, setEvaluations] = useState<Record<string, MockQuestionEvaluation>>({})
  const [isEvaluatingAll, setIsEvaluatingAll] = useState<boolean>(false)
  const [completedVersion, setCompletedVersion] = useState<number>(0)

  const abortEvaluationRef = useRef<boolean>(false)

  const activeCombination = useMemo(
    () => PART_COMBINATIONS.find((c) => c.id === combinationId) ?? PART_COMBINATIONS[0],
    [combinationId],
  )
  const needsPart1 = activeCombination.parts.includes(1)
  const needsPart2 = activeCombination.parts.includes(2)
  const needsPart3 = activeCombination.parts.includes(3)
  const needsPart2Or3 = needsPart2 || needsPart3

  // Flatten all Part 2/3 subTopics across categories.
  // If Part 3 is selected, only include subTopics that have Part 3 questions.
  const allPart23SubTopics = useMemo(() => {
    const raw = dataset.part23Categories.flatMap((c) => c.subTopics)
    return needsPart3 ? raw.filter((s) => s.part3.questions.length > 0) : raw
  }, [dataset.part23Categories, needsPart3])

  const completedIds = useMemo(() => {
    void completedVersion
    return getCompletedSetIds()
  }, [completedVersion])

  const savedAttempts = useMemo(() => {
    void completedVersion
    return getSavedMockAttempts()
  }, [completedVersion])

  // Auto-seed the Band ~6.5 AI-evaluated sample attempt on first visit so the user can inspect the Results UI immediately
  useEffect(() => {
    const targetP23Id = 'p23-describe-an-event-activity-1-describe-a-car-motorbike-or-bicycle-trip'
    const existing = getSavedMockAttempts()
    if (existing[targetP23Id]) return
    const p1Topic = dataset.part1Topics[0]
    const p23Sub = dataset.part23Categories
      .flatMap((c) => c.subTopics)
      .find((s) => s.id === targetP23Id)
    if (!p1Topic || !p23Sub) return

    let cancelled = false
    fetch('/mock-demo-attempt.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((bundle: { results?: Record<string, TalkReviewResult> } | null) => {
        if (cancelled || !bundle?.results) return
        const built = buildMockSessionQuestions({
          parts: [1, 2, 3],
          part1Topic: p1Topic,
          part23SubTopic: p23Sub,
        })
        // Keep only the evaluated questions in the demo session so all 3 parts show clean Band ~6.5 results
        built.questions = built.questions.filter((q) => Boolean(bundle.results?.[q.id]))
        const now = new Date().toISOString()
        saveMockAttempt({
          setId: p23Sub.id,
          updatedAt: now,
          session: built,
          results: bundle.results,
          durations: { 'p1-q1': 22, 'p2-cue': 78, 'p3-q1': 34, 'p3-q2': 28 },
        })
        saveMockAttempt({
          setId: p1Topic.id,
          updatedAt: now,
          session: built,
          results: bundle.results,
          durations: { 'p1-q1': 22, 'p2-cue': 78, 'p3-q1': 34, 'p3-q2': 28 },
        })
        markSetIdCompleted(p23Sub.id)
        markSetIdCompleted(p1Topic.id)
        setCompletedVersion((v) => v + 1)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [dataset.part1Topics, dataset.part23Categories])

  const totalSetsCount = dataset.part1Topics.length + allPart23SubTopics.length
  const completedSetsCount = useMemo(() => {
    let count = 0
    for (const p1 of dataset.part1Topics) {
      if (completedIds.has(p1.id)) count++
    }
    for (const p23 of allPart23SubTopics) {
      if (completedIds.has(p23.id)) count++
    }
    return count
  }, [allPart23SubTopics, completedIds, dataset.part1Topics])

  // Filtered lists for selection UI
  const filteredPart1Topics = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return dataset.part1Topics.filter((item) => {
      if (statusFilter === 'done' && !completedIds.has(item.id)) return false
      if (statusFilter === 'todo' && completedIds.has(item.id)) return false
      if (q && !item.topic.toLowerCase().includes(q) && !item.questions.some((x) => x.toLowerCase().includes(q))) {
        return false
      }
      return true
    })
  }, [completedIds, dataset.part1Topics, searchQuery, statusFilter])

  const filteredPart23SubTopics = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allPart23SubTopics.filter((item) => {
      if (categoryFilter !== 'all' && item.categoryId !== categoryFilter) return false
      if (statusFilter === 'done' && !completedIds.has(item.id)) return false
      if (statusFilter === 'todo' && completedIds.has(item.id)) return false
      if (
        q &&
        !item.subTopic.toLowerCase().includes(q) &&
        !item.category.toLowerCase().includes(q) &&
        !item.part3.questions.some((x) => x.toLowerCase().includes(q))
      ) {
        return false
      }
      return true
    })
  }, [allPart23SubTopics, categoryFilter, completedIds, searchQuery, statusFilter])

  // Persist current session's evaluated results so the user can view them again after exiting
  const persistSessionAttempt = useCallback(
    (
      curSession: BuiltMockSession,
      nextResults: Record<string, TalkReviewResult>,
      curRecordings: Record<string, MockQuestionRecording>,
    ) => {
      const durations: Record<string, number> = {}
      for (const [qId, rec] of Object.entries(curRecordings)) {
        durations[qId] = rec.durationSeconds
      }
      const now = new Date().toISOString()
      if (curSession.part1Topic) {
        saveMockAttempt({
          setId: curSession.part1Topic.id,
          updatedAt: now,
          session: curSession,
          results: nextResults,
          durations,
        })
        markSetIdCompleted(curSession.part1Topic.id)
      }
      if (curSession.part23SubTopic) {
        saveMockAttempt({
          setId: curSession.part23SubTopic.id,
          updatedAt: now,
          session: curSession,
          results: nextResults,
          durations,
        })
        markSetIdCompleted(curSession.part23SubTopic.id)
      }
      setCompletedVersion((v) => v + 1)
    },
    [],
  )

  // Open a previously saved attempt in Review & Results view
  const openSavedAttempt = useCallback((attempt: SavedMockAttempt) => {
    const restoredEvals: Record<string, MockQuestionEvaluation> = {}
    for (const [qId, res] of Object.entries(attempt.results)) {
      restoredEvals[qId] = {
        questionId: qId,
        status: 'done',
        jobId: res.id,
        result: res,
      }
    }
    setRecordings({})
    setEvaluations(restoredEvals)
    setSession(attempt.session)
    setExamInitialQuestionIdx(0)
    setSingleQuestionRerecord(false)
    setStage('review')
  }, [])

  // Launch a mock test session with specific or random unseen question sets
  const startTestSession = useCallback(
    (opts?: { forcePart1?: SpeakingMockPart1Topic; forcePart23?: SpeakingMockPart23SubTopic }) => {
      const parts = activeCombination.parts

      let p1Topic: SpeakingMockPart1Topic | undefined = opts?.forcePart1
      if (parts.includes(1) && !p1Topic) {
        p1Topic =
          dataset.part1Topics.find((t) => t.id === selectedPart1Id) ??
          pickUnseenRandom(filteredPart1Topics.length ? filteredPart1Topics : dataset.part1Topics)
      }

      let p23Sub: SpeakingMockPart23SubTopic | undefined = opts?.forcePart23
      if ((parts.includes(2) || parts.includes(3)) && !p23Sub) {
        p23Sub =
          allPart23SubTopics.find((s) => s.id === selectedPart23Id) ??
          pickUnseenRandom(filteredPart23SubTopics.length ? filteredPart23SubTopics : allPart23SubTopics)
      }

      if (p1Topic) markSetIdSeen(p1Topic.id)
      if (p23Sub) markSetIdSeen(p23Sub.id)

      const built = buildMockSessionQuestions({
        parts,
        part1Topic: p1Topic,
        part23SubTopic: p23Sub,
      })

      if (!built.questions.length) return

      setRecordings({})
      setEvaluations({})
      setSession(built)
      setExamInitialQuestionIdx(0)
      setSingleQuestionRerecord(false)
      setStage('exam')
    },
    [
      activeCombination.parts,
      allPart23SubTopics,
      dataset.part1Topics,
      filteredPart1Topics,
      filteredPart23SubTopics,
      selectedPart1Id,
      selectedPart23Id,
    ],
  )

  const handleSaveRecording = useCallback((rec: MockQuestionRecording) => {
    setRecordings((prev) => {
      const old = prev[rec.questionId]
      if (old?.audioUrl && old.audioUrl !== rec.audioUrl) {
        URL.revokeObjectURL(old.audioUrl)
      }
      return { ...prev, [rec.questionId]: rec }
    })
    setEvaluations((prev) => {
      if (!prev[rec.questionId]) return prev
      const next = { ...prev }
      delete next[rec.questionId]
      return next
    })
  }, [])

  // Evaluate a single question via POST /api/speaking-review and poll until completion
  const evaluateOneQuestion = useCallback(
    async (questionId: string): Promise<TalkReviewResult | null> => {
      if (!session) return null
      const q = session.questions.find((item) => item.id === questionId)
      const rec = recordings[questionId]
      if (!q || !rec) return null

      setEvaluations((prev) => ({
        ...prev,
        [questionId]: { questionId, status: 'submitting', step: 'transcribe' },
      }))

      try {
        let startedJobId = ''
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            const { job } = await talkApi.start({
              part: q.part,
              question: q.questionText,
              topic: q.topic,
              audio: rec.base64Audio,
            })
            startedJobId = job.id
            break
          } catch (err) {
            const msg = (err as Error).message || ''
            if (msg.includes('Another review is still running') && attempt < 9) {
              await sleep(2500)
              continue
            }
            throw err
          }
        }

        setEvaluations((prev) => ({
          ...prev,
          [questionId]: { questionId, status: 'running', jobId: startedJobId, step: 'transcribe' },
        }))

        while (!abortEvaluationRef.current) {
          await sleep(1600)
          const { job } = await talkApi.get(startedJobId)
          if (job.status === 'running') {
            setEvaluations((prev) => ({
              ...prev,
              [questionId]: {
                questionId,
                status: 'running',
                jobId: startedJobId,
                step: job.step ?? 'analyze',
              },
            }))
            continue
          }
          if (job.status === 'done' && job.result) {
            const finalResult = job.result
            setEvaluations((prev) => {
              const next = {
                ...prev,
                [questionId]: {
                  questionId,
                  status: 'done' as const,
                  jobId: startedJobId,
                  result: finalResult,
                },
              }
              const collectedResults: Record<string, TalkReviewResult> = {}
              for (const [k, ev] of Object.entries(next)) {
                if (ev.result) collectedResults[k] = ev.result
              }
              persistSessionAttempt(session, collectedResults, recordings)
              return next
            })
            return finalResult
          }
          throw new Error(job.error || 'Chấm bài không thành công.')
        }
        return null
      } catch (err) {
        const message = (err as Error).message || 'Không thể chấm câu trả lời này.'
        setEvaluations((prev) => ({
          ...prev,
          [questionId]: {
            questionId,
            status: 'error',
            error: message,
          },
        }))
        return null
      }
    },
    [persistSessionAttempt, recordings, session],
  )

  const handleEvaluateAll = useCallback(async () => {
    if (!session || isEvaluatingAll) return
    abortEvaluationRef.current = false
    setIsEvaluatingAll(true)

    try {
      const pendingQuestions = session.questions.filter((q) => {
        const rec = recordings[q.id]
        if (!rec) return false
        const existing = evaluations[q.id]
        return !(existing?.status === 'done' && existing.result)
      })
      // Run up to 4 evaluations in parallel for fast multi-question grading
      const CONCURRENCY = 4
      const queue = [...pendingQuestions]
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0 && !abortEvaluationRef.current) {
          const nextQ = queue.shift()
          if (!nextQ) break
          await evaluateOneQuestion(nextQ.id)
        }
      })
      await Promise.all(workers)
    } finally {
      setIsEvaluatingAll(false)
    }
  }, [evaluateOneQuestion, evaluations, isEvaluatingAll, recordings, session])

  const handleUpdateResult = useCallback(
    (questionId: string, updated: TalkReviewResult) => {
      setEvaluations((prev) => {
        const next = {
          ...prev,
          [questionId]: {
            ...(prev[questionId] ?? { questionId }),
            status: 'done' as const,
            result: updated,
          },
        }
        if (session) {
          const collectedResults: Record<string, TalkReviewResult> = {}
          for (const [k, ev] of Object.entries(next)) {
            if (ev.result) collectedResults[k] = ev.result
          }
          persistSessionAttempt(session, collectedResults, recordings)
        }
        return next
      })
    },
    [persistSessionAttempt, recordings, session],
  )

  /* ───────────── Stage 2: Active Virtual Exam Room ───────────── */
  if (stage === 'exam' && session) {
    return (
      <div className="mx-auto max-w-6xl">
        <MockExamRoom
          session={session}
          initialQuestionIndex={examInitialQuestionIdx}
          singleQuestionMode={singleQuestionRerecord}
          existingRecordings={recordings}
          onSaveRecording={handleSaveRecording}
          onFinishExam={() => setStage('review')}
          onExitExam={() => setStage('select')}
        />
      </div>
    )
  }

  /* ───────────── Stage 3: Review Recordings & Grouped Results ───────────── */
  if (stage === 'review' && session) {
    return (
      <div className="mx-auto max-w-4xl">
        <MockReviewAndResults
          session={session}
          recordings={recordings}
          evaluations={evaluations}
          isEvaluatingAll={isEvaluatingAll}
          onSubmitAll={() => void handleEvaluateAll()}
          onEvaluateSingle={(questionId) => void evaluateOneQuestion(questionId)}
          onUpdateResult={handleUpdateResult}
          onRerecordQuestion={(qIdx) => {
            setExamInitialQuestionIdx(qIdx)
            setSingleQuestionRerecord(true)
            setStage('exam')
          }}
          onRetakeFullTest={() => {
            abortEvaluationRef.current = true
            setRecordings({})
            setEvaluations({})
            setExamInitialQuestionIdx(0)
            setSingleQuestionRerecord(false)
            setStage('exam')
          }}
          onNewTest={() => {
            abortEvaluationRef.current = true
            setStage('select')
          }}
        />
      </div>
    )
  }

  /* ───────────── Stage 1: Topic & Part Selection ("Phòng thi ảo") ───────────── */
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Page Title */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Phòng thi ảo
        </h1>

        <Button
          onClick={() => startTestSession()}
          className="bg-sky-600 text-white shadow-xs hover:bg-sky-700"
        >
          <Shuffle className="size-4" />
          <span>
            {selectedPart1Id || selectedPart23Id
              ? 'Vào thi với đề đã chọn'
              : 'Thi ngẫu nhiên'}
          </span>
        </Button>
      </div>

      {/* Progress Hero Banner */}
      <Card className="flex flex-col items-start gap-4 border-slate-200/90 bg-white p-5 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-sm">
          <Mic className="size-7" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                Bạn đã làm {completedSetsCount} bài
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tiếp tục tập trung hoàn thành các bài luyện tập còn lại nhé!
              </p>
            </div>
            <span className="text-xs font-extrabold text-slate-700 tabular-nums dark:text-slate-300">
              {completedSetsCount} / {totalSetsCount}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              style={{
                width: `${totalSetsCount > 0 ? Math.min(100, Math.round((completedSetsCount / totalSetsCount) * 100)) : 0}%`,
              }}
              className="h-full rounded-full bg-sky-600 transition-all duration-500 dark:bg-sky-400"
            />
          </div>
        </div>
      </Card>

      {/* Compact Single-Row Filter & Part Selection Bar */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm kiếm..."
            className="w-full rounded-xl border border-slate-200/80 bg-slate-100/70 py-2.5 pr-4 pl-10 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Trạng thái"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'todo' | 'done')}
            className="rounded-xl border border-slate-200/80 bg-slate-100/70 px-3.5 py-2.5 text-sm font-medium text-slate-700 focus:border-sky-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="all">Trạng thái</option>
            <option value="todo">Chưa làm</option>
            <option value="done">Đã hoàn thành</option>
          </select>

          <select
            aria-label="Kỹ năng / Phần thi"
            value={combinationId}
            onChange={(e) => setCombinationId(e.target.value as PartCombinationId)}
            className="rounded-xl border border-slate-200/80 bg-slate-100/70 px-3.5 py-2.5 text-sm font-semibold text-slate-800 focus:border-sky-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          >
            {PART_COMBINATIONS.map((combo) => (
              <option key={combo.id} value={combo.id}>
                Kỹ năng: {combo.shortLabel}
              </option>
            ))}
          </select>

          {needsPart2Or3 ? (
            <select
              aria-label="Nhóm chủ đề"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-xl border border-slate-200/80 bg-slate-100/70 px-3.5 py-2.5 text-sm font-medium text-slate-700 focus:border-sky-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="all">Chủ đề: Tất cả ({allPart23SubTopics.length})</option>
              {dataset.part23Categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.category} ({cat.subTopics.length})
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {/* Topic Cards List */}
      <div className="space-y-6">
        {/* Part 1 Topics Section */}
        {needsPart1 ? (
          <section className="space-y-3">
            {needsPart2Or3 ? (
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                  Speaking Part 1 ({filteredPart1Topics.length})
                </span>
                {selectedPart1Id ? (
                  <button
                    type="button"
                    onClick={() => setSelectedPart1Id('')}
                    className="text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
                  >
                    Bỏ chọn Part 1
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-3">
              {filteredPart1Topics.map((item, idx) => {
                const isSelected = selectedPart1Id === item.id
                const isDone = completedIds.has(item.id)
                const savedAttempt = savedAttempts[item.id]

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (savedAttempt) {
                        openSavedAttempt(savedAttempt)
                      } else if (needsPart2Or3) {
                        setSelectedPart1Id(isSelected ? '' : item.id)
                      } else {
                        startTestSession({ forcePart1: item })
                      }
                    }}
                    className={cn(
                      'group flex cursor-pointer flex-col justify-between gap-4 rounded-2xl border bg-white p-4 shadow-2xs transition-all hover:border-slate-300 hover:shadow-sm sm:flex-row sm:items-center sm:px-5 dark:bg-slate-900',
                      isSelected
                        ? 'border-sky-500 ring-2 ring-sky-500/15 dark:border-sky-400'
                        : 'border-slate-200/80 dark:border-slate-800',
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <Mic className="size-3.5 text-slate-400" />
                        <span>Speaking part 1</span>
                      </div>

                      <h3 className="text-sm font-bold text-slate-900 sm:text-base dark:text-white">
                        IELTS Speaking - Part 1 - Set {idx + 1}: {item.topic}
                      </h3>

                      <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <CornerDownRight className="size-3.5 shrink-0 text-slate-400" />
                        <span className="line-clamp-1">
                          {item.questions.length} câu hỏi • {item.questions[0]}
                        </span>
                      </p>

                      <div className="pt-1">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold',
                            isDone
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : isSelected
                                ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                          )}
                        >
                          {isDone ? (
                            <>
                              <CheckCircle2 className="size-3" /> Đã hoàn thành
                            </>
                          ) : isSelected ? (
                            'Đang chọn'
                          ) : (
                            'Chưa làm'
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {savedAttempt ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openSavedAttempt(savedAttempt)
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300"
                        >
                          <Eye className="size-3.5" />
                          <span>Xem lại kết quả</span>
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedPart1Id(item.id)
                          startTestSession({ forcePart1: item })
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 transition group-hover:bg-sky-600 group-hover:text-white dark:bg-slate-800 dark:text-slate-200 dark:group-hover:bg-sky-500"
                      >
                        {isDone ? (
                          <>
                            <RotateCcw className="size-3.5" />
                            <span>Làm lại</span>
                          </>
                        ) : (
                          <>
                            <Play className="size-3.5 fill-current" />
                            <span>Vào thi</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}

        {/* Part 2 & Part 3 Topics Section */}
        {needsPart2Or3 ? (
          <section className="space-y-3">
            {needsPart1 ? (
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                  Speaking {needsPart2 && needsPart3 ? 'Part 2 & 3' : needsPart2 ? 'Part 2' : 'Part 3'} ({filteredPart23SubTopics.length})
                </span>
                {selectedPart23Id ? (
                  <button
                    type="button"
                    onClick={() => setSelectedPart23Id('')}
                    className="text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
                  >
                    Bỏ chọn Part 2/3
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-3">
              {filteredPart23SubTopics.map((item, idx) => {
                const isSelected = selectedPart23Id === item.id
                const isDone = completedIds.has(item.id)
                const savedAttempt = savedAttempts[item.id]
                const partLabel =
                  needsPart2 && needsPart3
                    ? 'Speaking part 2 & 3'
                    : needsPart2
                      ? 'Speaking part 2'
                      : 'Speaking part 3'

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (savedAttempt) {
                        openSavedAttempt(savedAttempt)
                      } else {
                        startTestSession({ forcePart23: item })
                      }
                    }}
                    className={cn(
                      'group flex cursor-pointer flex-col justify-between gap-4 rounded-2xl border bg-white p-4 shadow-2xs transition-all hover:border-slate-300 hover:shadow-sm sm:flex-row sm:items-center sm:px-5 dark:bg-slate-900',
                      isSelected
                        ? 'border-sky-500 ring-2 ring-sky-500/15 dark:border-sky-400'
                        : 'border-slate-200/80 dark:border-slate-800',
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1.5">
                          <Sparkles className="size-3.5 text-slate-400" />
                          <span>{partLabel}</span>
                        </span>
                        <span>•</span>
                        <span>{item.category}</span>
                      </div>

                      <h3 className="text-sm font-bold text-slate-900 sm:text-base dark:text-white">
                        IELTS Speaking - {needsPart2 && needsPart3 ? 'Part 2 & 3' : needsPart2 ? 'Part 2' : 'Part 3'} - Set {idx + 1}: {item.subTopic}
                      </h3>

                      <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <CornerDownRight className="size-3.5 shrink-0 text-slate-400" />
                        <span>
                          Cue Card ({item.part2.cueCard.length} gợi ý)
                          {item.part3.questions.length > 0
                            ? ` - ${item.part3.questions.length} câu hỏi Part 3`
                            : ''}
                        </span>
                      </p>

                      <div className="pt-1">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold',
                            isDone
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : isSelected
                                ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                          )}
                        >
                          {isDone ? (
                            <>
                              <CheckCircle2 className="size-3" /> Đã hoàn thành
                            </>
                          ) : isSelected ? (
                            'Đang chọn'
                          ) : (
                            'Chưa làm'
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {savedAttempt ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openSavedAttempt(savedAttempt)
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300"
                        >
                          <Eye className="size-3.5" />
                          <span>Xem lại kết quả</span>
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedPart23Id(item.id)
                          startTestSession({ forcePart23: item })
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 transition group-hover:bg-sky-600 group-hover:text-white dark:bg-slate-800 dark:text-slate-200 dark:group-hover:bg-sky-500"
                      >
                        {isDone ? (
                          <>
                            <RotateCcw className="size-3.5" />
                            <span>Làm lại</span>
                          </>
                        ) : (
                          <>
                            <Play className="size-3.5 fill-current" />
                            <span>Vào thi</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
