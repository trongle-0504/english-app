import { AudioLines, Headphones, Library, ListChecks, MessageSquareQuote, Mic, PenLine, ShieldCheck, Trophy, Volume2, Timer } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { Badge, EmptyState, PageHeader, SearchInput, SectionTitle } from '@/components/ui'
import { useData } from '@/lib/data'
import { matchesQuery, plural } from '@/lib/text'
import type { PracticeIndex } from '@/types/content'
import { PracticeLinkCard } from './components/PracticeLinkCard'
import { MODE_LABELS, type QuizMode } from './lib/quiz'
import { percent } from './lib/score'
import { useBestScores, type BestScore } from './quiz/bestScores'

const MODE_SHORT: Record<QuizMode, string> = { multiple_choice: 'MC', short_answer: 'Fill' }

function BestBadge({ mode, score }: { mode: QuizMode; score: BestScore }) {
  return (
    <Badge tone="amber" title={`Best ${MODE_LABELS[mode].toLowerCase()} score: ${score.correct}/${score.total}`}>
      <Trophy className="size-3" aria-hidden />
      {MODE_SHORT[mode]} {percent(score.correct, score.total)}%
    </Badge>
  )
}

export default function PracticeHomePage() {
  const { quizzes } = useData<PracticeIndex>('practice/index.json')
  const best = useBestScores()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const visible = quizzes.filter((quiz) => matchesQuery(quiz.title, deferredQuery))

  return (
    <>
      <PageHeader
        eyebrow="Vocabulary"
        title="Vocabulary quiz"
        description="Test your collocations with multiple-choice and fill-in-the-blank quizzes."
      />

      <div className="animate-slide-up grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <PracticeLinkCard
          to="/practice/writing"
          prefetch="practice/index.json"
          icon={PenLine}
          title="Writing practice"
          description="Fill in passages and rewrite paragraphs from Vietnamese, checked sentence by sentence."
        />
        <PracticeLinkCard
          to="/practice/essays"
          prefetch="essays/index.json"
          icon={Library}
          title="Model essays"
          description="Learn vocabulary, collocations and how a model essay is written: read, recall, rebuild a paragraph, then use the phrases in a new task."
        />
        <PracticeLinkCard
          to="/practice/writing-review"
          icon={ShieldCheck}
          title="Writing review"
          description="Paste your Writing paragraph: AI fixes collocations and word choice, every fix checked against the OZDIC dictionary."
        />
        <PracticeLinkCard
          to="/practice/writing-mock"
          prefetch="practice/writing-mock/prompts.json"
          icon={Timer}
          title="Writing mock test"
          description="Lập ý tưởng tiếng Việt 15 phút, viết bài tiếng Anh 40 phút, rồi gửi cả đề và ý tưởng cho AI chấm."
        />
        <PracticeLinkCard
          to="/practice/speaking-ideas"
          icon={MessageSquareQuote}
          title="Speaking ideas"
          description="Paste a Speaking topic and its questions: phrases from your library, example sentences and a model answer that uses them."
        />
        <PracticeLinkCard
          to="/practice/speaking-review"
          icon={AudioLines}
          title="Speaking review"
          description="Record your answer and get IELTS band scores across 4 criteria with Longman & OZDIC dictionary verification."
        />
        <PracticeLinkCard
          to="/practice/speaking-mock"
          prefetch="practice/speaking-mock.json"
          icon={Mic}
          title="Speaking mock test"
          description="Take timed IELTS Speaking mock tests by topic (Part 1, 2, 3) with a virtual examiner and AI band evaluation."
        />
        <PracticeLinkCard
          to="/practice/dictation"
          icon={Headphones}
          title="Dictation practice"
          description="Paste any paragraph, listen to each sentence and type what you hear."
        />
        <PracticeLinkCard
          to="/practice/speaking"
          icon={Volume2}
          title="Read aloud"
          description="Paste your speaking answer and hear how it is pronounced, sentence by sentence."
        />
      </div>

      <div className="mt-10 mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle count={visible.length} className="mb-0">
          Quiz sets
        </SectionTitle>
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search quiz sets…"
          aria-label="Search quiz sets"
          className="w-full sm:w-72"
        />
      </div>

      {visible.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((quiz) => {
            const bestMc = best.get(quiz.id, 'multiple_choice')
            const bestFill = best.get(quiz.id, 'short_answer')
            return (
              <PracticeLinkCard
                key={quiz.id}
                to={`/practice/quiz/${quiz.id}`}
                prefetch={`practice/quiz/${quiz.id}.json`}
                icon={ListChecks}
                title={quiz.title}
                description={plural(quiz.total, 'question')}
                footer={
                  <>
                    {quiz.multipleChoice ? <Badge tone="brand">{quiz.multipleChoice} multiple choice</Badge> : null}
                    {quiz.shortAnswer ? <Badge tone="violet">{quiz.shortAnswer} fill-in</Badge> : null}
                    {bestMc ? <BestBadge mode="multiple_choice" score={bestMc} /> : null}
                    {bestFill ? <BestBadge mode="short_answer" score={bestFill} /> : null}
                  </>
                }
              />
            )
          })}
        </div>
      ) : (
        <EmptyState icon={<ListChecks className="size-8" />} title="No quiz sets found" description="Try a different search term." />
      )}
    </>
  )
}
