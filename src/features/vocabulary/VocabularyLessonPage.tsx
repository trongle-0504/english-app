import { ArrowLeft, BookOpenCheck, EyeOff, Layers, ListChecks } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { StudyOverlay } from '@/components/StudyOverlay'
import { Button, EmptyState, PageHeader, SearchInput, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useData } from '@/lib/data'
import { useLocalStorage } from '@/lib/storage'
import { matchesQuery, plural } from '@/lib/text'
import type { VocabLesson, VocabWord } from '@/types/content'
import { AddAllToReview } from '../review/ReviewButtons'
import { Flashcards } from '../words/Flashcards'
import { useProgressiveList } from '../words/useProgressiveList'
import { WordCard } from '../words/WordCard'

type Sort = 'newest' | 'az'

function sortWords(words: VocabWord[], sort: Sort): VocabWord[] {
  if (sort === 'newest') return words // pipeline already sorts newest first
  return [...words].sort((a, b) => a.word.localeCompare(b.word))
}

function ToggleChip({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors',
        active
          ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-900 dark:bg-brand-950/50 dark:text-brand-300'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export default function VocabularyLessonPage() {
  const { topicId, subTopicId } = useParams()
  const lesson = useData<VocabLesson>(`vocabulary/${topicId}/${subTopicId}.json`)
  const { hash } = useLocation()

  const [sort, setSort] = useLocalStorage<Sort>('vocab.sort', 'newest')
  const [hideMeaning, setHideMeaning] = useLocalStorage('vocab.hideMeaning', false)
  const [expandAll, setExpandAll] = useState(false)
  const [query, setQuery] = useState('')
  const [studyIndex, setStudyIndex] = useState<number | null>(null)
  const [flashcards, setFlashcards] = useState(false)

  const words = useMemo(
    () =>
      sortWords(lesson.words, sort).filter(
        (w) => matchesQuery(w.word, query) || w.senses.some((s) => matchesQuery(s.definition_vi, query)),
      ),
    [lesson.words, sort, query],
  )

  const hashIndex = hash ? words.findIndex((w) => w.id === decodeURIComponent(hash.slice(1))) : -1
  const { visible, sentinel, hasMore } = useProgressiveList(words, 15, hashIndex + 1)

  return (
    <>
      <div className="pt-4 sm:pt-6">
        <Link
          to={lesson.title === lesson.topic.name ? '/vocabulary' : `/vocabulary?topic=${lesson.topic.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft className="size-4" /> {lesson.title === lesson.topic.name ? 'Vocabulary' : lesson.topic.name}
        </Link>
      </div>
      <PageHeader
        className="pt-3 sm:pt-4"
        eyebrow={lesson.title === lesson.topic.name ? 'Vocabulary' : lesson.topic.name}
        title={lesson.title}
        description={lesson.subTopic.description_vi ?? `${plural(lesson.words.length, 'word')} to learn.`}
        actions={
          <>
            <Button onClick={() => setStudyIndex(0)} disabled={!words.length}>
              <BookOpenCheck className="size-4" /> Study mode
            </Button>
            <Button variant="outline" onClick={() => setFlashcards(true)} disabled={!words.length}>
              <Layers className="size-4" /> Flashcards
            </Button>
            <AddAllToReview ids={lesson.words.map((w) => `vocab:${w.id}`)} />
          </>
        }
      />

      {/* On a phone this bar was three rows that stayed pinned while scrolling: there it is the search plus one row that
          scrolls sideways, and it scrolls away with the page. From sm up the inner row dissolves (`contents`). */}
      <div className="-mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200/70 bg-slate-50/85 px-4 py-3 backdrop-blur-xl sm:sticky sm:top-16 sm:z-20 sm:-mx-6 sm:mb-5 sm:px-6 dark:border-slate-800/70 dark:bg-slate-950/85">
        <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${lesson.words.length} words…`} className="w-full sm:w-72" />
        <div className="scrollbar-thin -mx-4 flex w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 *:shrink-0 sm:contents">
          <SegmentedControl
            value={sort}
            onChange={setSort}
            options={[
              { value: 'newest', label: 'Newest' },
              { value: 'az', label: 'A–Z' },
            ]}
          />
          <ToggleChip active={hideMeaning} onClick={() => setHideMeaning(!hideMeaning)} icon={<EyeOff className="size-4" />}>
            Hide meanings
          </ToggleChip>
          <ToggleChip active={expandAll} onClick={() => setExpandAll(!expandAll)} icon={<ListChecks className="size-4" />}>
            Expand all
          </ToggleChip>
          <span className="ml-auto text-sm whitespace-nowrap text-slate-500">{plural(words.length, 'word')}</span>
        </div>
      </div>

      {words.length === 0 ? (
        <EmptyState title="No words match" description="Try a different search." />
      ) : (
        <div className="space-y-5">
          {visible.map((word) => (
            <WordCard key={`${word.id}-${expandAll}-${hideMeaning}`} word={word} defaultExpanded={expandAll} hideMeaning={hideMeaning} reviewId={`vocab:${word.id}`} />
          ))}
          <div ref={sentinel} aria-hidden />
          {hasMore ? <p className="text-center text-sm text-slate-400">Loading more…</p> : null}
        </div>
      )}

      <StudyOverlay
        open={studyIndex !== null}
        onClose={() => setStudyIndex(null)}
        index={studyIndex ?? 0}
        total={words.length}
        onIndexChange={setStudyIndex}
        title={`Study · ${lesson.title}`}
      >
        {studyIndex !== null && words[studyIndex] ? (
          <WordCard word={words[studyIndex]} defaultExpanded anchor={false} className="mx-auto max-w-5xl border-0 p-0 shadow-none sm:p-0 dark:bg-transparent" />
        ) : null}
      </StudyOverlay>
      <Flashcards open={flashcards} onClose={() => setFlashcards(false)} words={words} title={lesson.title} />
    </>
  )
}
