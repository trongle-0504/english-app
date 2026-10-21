import { ArrowLeft } from 'lucide-react'
import { useRef, useState } from 'react'
import { useParams } from 'react-router'
import { ButtonLink, PageHeader } from '@/components/ui'
import { useData } from '@/lib/data'
import { useLocalStorage } from '@/lib/storage'
import { plural, shuffle } from '@/lib/text'
import type { QuizQuestion, QuizSet } from '@/types/content'
import type { QuizAnswer, QuizMode } from './lib/quiz'
import { useBestScores } from './quiz/bestScores'
import { QuizPlayer } from './quiz/QuizPlayer'
import { QuizResults } from './quiz/QuizResults'
import { QuizSetup } from './quiz/QuizSetup'

interface Round {
  id: number
  mode: QuizMode
  questions: QuizQuestion[]
  /** "Retry wrong only" rounds don't count towards the best score. */
  isRetry: boolean
}

type Stage =
  | { name: 'setup'; mode?: QuizMode }
  | { name: 'playing'; round: Round }
  | { name: 'finished'; round: Round; answers: QuizAnswer[]; isNewBest: boolean }

function Quiz({ quiz }: { quiz: QuizSet }) {
  const [shuffled, setShuffled] = useLocalStorage('practice:quiz-shuffle', true)
  const [stage, setStage] = useState<Stage>({ name: 'setup' })
  const best = useBestScores()
  const roundCount = useRef(0)

  const byMode = (mode: QuizMode) => quiz.questions.filter((q) => q.type === mode)
  const counts: Record<QuizMode, number> = {
    multiple_choice: byMode('multiple_choice').length,
    short_answer: byMode('short_answer').length,
  }

  const start = (mode: QuizMode, pool = byMode(mode), isRetry = false) => {
    roundCount.current += 1
    setStage({ name: 'playing', round: { id: roundCount.current, mode, isRetry, questions: shuffled ? shuffle(pool) : pool } })
    window.scrollTo({ top: 0 })
  }

  const finish = (round: Round, answers: QuizAnswer[]) => {
    const correct = answers.filter((a) => a.outcome === 'correct').length
    const isNewBest = !round.isRetry && best.record(quiz.id, round.mode, { correct, total: round.questions.length })
    setStage({ name: 'finished', round, answers, isNewBest })
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Vocabulary · Quiz"
        title={quiz.title}
        description={`${plural(quiz.questions.length, 'question')} · ${counts.multiple_choice} multiple choice · ${counts.short_answer} fill in the blank`}
        actions={
          <ButtonLink to="/practice" variant="ghost" size="sm">
            <ArrowLeft className="size-4" />
            All quizzes
          </ButtonLink>
        }
      />

      {stage.name === 'setup' ? (
        <QuizSetup
          counts={counts}
          best={(mode) => best.get(quiz.id, mode)}
          shuffled={shuffled}
          onShuffledChange={setShuffled}
          onStart={start}
          initialMode={stage.mode}
        />
      ) : null}

      {stage.name === 'playing' ? (
        <QuizPlayer
          key={stage.round.id}
          mode={stage.round.mode}
          questions={stage.round.questions}
          onFinish={(answers) => finish(stage.round, answers)}
        />
      ) : null}

      {stage.name === 'finished' ? (
        <QuizResults
          questions={stage.round.questions}
          answers={stage.answers}
          isNewBest={stage.isNewBest}
          onRetryMistakes={() =>
            start(
              stage.round.mode,
              stage.round.questions.filter((_, i) => stage.answers[i].outcome !== 'correct'),
              true,
            )
          }
          onRestart={() => start(stage.round.mode)}
          onChangeMode={() => setStage({ name: 'setup', mode: stage.round.mode })}
        />
      ) : null}
    </div>
  )
}

export default function QuizPage() {
  const { quizId = '' } = useParams()
  const quiz = useData<QuizSet>(`practice/quiz/${quizId}.json`)
  // Keyed so that switching quizzes starts from a fresh setup screen.
  return <Quiz key={quiz.id} quiz={quiz} />
}
