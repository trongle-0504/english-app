import * as Tabs from '@radix-ui/react-tabs'
import { ArrowLeft, BookText, ExternalLink, FileText, Layers, LayoutGrid } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { Button, buttonClass, EmptyState, PageHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useData } from '@/lib/data'
import { plural } from '@/lib/text'
import { useQueryParam } from '@/lib/useQueryParam'
import type { CollocationLesson } from '@/types/content'
import { AddAllToReview } from '../review/ReviewButtons'
import { Flashcards } from '../words/Flashcards'
import { CollocationTile } from './CollocationTile'
import { LessonMarkdown } from './LessonMarkdown'

type Tab = 'lesson' | 'words' | 'pdf'

const tabClass = cn(
  'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-500 transition-colors outline-none hover:text-slate-900',
  'data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm',
  'dark:text-slate-400 dark:hover:text-white dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-white',
)

export default function CollocationLessonPage() {
  const { lessonId } = useParams()
  const lesson = useData<CollocationLesson>(`collocations/${lessonId}.json`)
  const { hash } = useLocation()
  const [tabParam, setTab] = useQueryParam('tab')
  const [flashcards, setFlashcards] = useState(false)

  const words = useMemo(() => {
    const ordered = lesson.sessions.flatMap((s) => s.wordIds).map((id) => lesson.words[id])
    return ordered.filter(Boolean)
  }, [lesson])

  const tab: Tab = tabParam === 'words' || (tabParam === 'pdf' && lesson.pdf) ? tabParam : 'lesson'

  // Links to a single collocation (search results, "View card") open the collocations tab.
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1))
    if (id && lesson.words[id] && tab !== 'words') setTab('words')
  }, [hash, lesson.words, tab, setTab])

  return (
    <>
      <div className="pt-4 sm:pt-6">
        <Link to="/collocations" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white">
          <ArrowLeft className="size-4" /> Collocations
        </Link>
      </div>
      <PageHeader
        className="pt-3 sm:pt-4"
        eyebrow={lesson.topic.name}
        title={lesson.title}
        description={`${plural(words.length, 'collocation')} · ${plural(lesson.sessions.length, 'section')}`}
        actions={
          <>
            <Button onClick={() => setFlashcards(true)} disabled={!words.length}>
              <Layers className="size-4" /> Flashcards
            </Button>
            <AddAllToReview ids={words.map((w) => `colloc:${lesson.id}:${w.id}`)} />
          </>
        }
      />

      <Tabs.Root value={tab} onValueChange={(value) => setTab(value === 'lesson' ? '' : value)}>
        <div className="sticky top-16 z-20 -mx-4 mb-4 border-b border-slate-200/70 bg-slate-50/85 px-4 py-2.5 backdrop-blur-xl sm:-mx-6 sm:mb-6 sm:px-6 dark:border-slate-800/70 dark:bg-slate-950/85">
          <Tabs.List aria-label="Lesson views" className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
            <Tabs.Trigger value="lesson" className={tabClass}>
              <BookText className="size-4" /> Lesson
            </Tabs.Trigger>
            <Tabs.Trigger value="words" className={tabClass}>
              <LayoutGrid className="size-4" /> Collocations
              <span className="rounded-full bg-slate-200/80 px-1.5 text-[11px] dark:bg-slate-600">{words.length}</span>
            </Tabs.Trigger>
            {lesson.pdf ? (
              <Tabs.Trigger value="pdf" className={tabClass}>
                <FileText className="size-4" /> PDF
              </Tabs.Trigger>
            ) : null}
          </Tabs.List>
        </div>

        <Tabs.Content value="lesson" className="animate-fade-in outline-none">
          {lesson.markdown ? (
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
              <article className="rounded-3xl border border-slate-200/80 bg-white p-4 sm:p-8 dark:border-slate-800 dark:bg-slate-900/60">
                <LessonMarkdown markdown={lesson.markdown} words={words} />
              </article>
              <aside className="hidden lg:block">
                <div className="sticky top-36 space-y-1">
                  <p className="mb-2 text-[11px] font-bold tracking-[0.16em] text-slate-400 uppercase">Sections</p>
                  {lesson.sessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setTab('words')}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white"
                    >
                      <span className="font-semibold">{session.title}</span>
                      <span className="ml-1 text-xs text-slate-400">({session.wordIds.length})</span>
                    </button>
                  ))}
                  <p className="px-3 pt-3 text-xs text-slate-400">Tip: click a highlighted phrase to see its meaning.</p>
                </div>
              </aside>
            </div>
          ) : (
            <EmptyState title="No lesson text" description="This lesson only has collocation cards." />
          )}
        </Tabs.Content>

        <Tabs.Content value="words" className="animate-fade-in space-y-10 outline-none">
          {lesson.sessions.map((session) => (
            <section key={session.id}>
              <div className="mb-4">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{session.title}</h2>
                {session.description_vi ? <p className="text-sm text-slate-500 dark:text-slate-400">{session.description_vi}</p> : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {session.wordIds.map((id) => (lesson.words[id] ? <CollocationTile key={id} word={lesson.words[id]} reviewId={`colloc:${lesson.id}:${id}`} /> : null))}
              </div>
            </section>
          ))}
        </Tabs.Content>

        {lesson.pdf ? (
          <Tabs.Content value="pdf" className="animate-fade-in outline-none">
            <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <FileText className="size-4 text-rose-500" /> {lesson.title}.pdf
                </span>
                <a href={lesson.pdf} target="_blank" rel="noreferrer" className={buttonClass('outline', 'sm')}>
                  Open <ExternalLink className="size-3.5" />
                </a>
              </div>
              <iframe src={`${lesson.pdf}#view=FitH`} title={`${lesson.title} PDF`} className="h-[80vh] w-full border-0 bg-slate-100 dark:bg-slate-800" />
            </div>
          </Tabs.Content>
        ) : null}
      </Tabs.Root>

      <Flashcards open={flashcards} onClose={() => setFlashcards(false)} words={words} title={lesson.title} />
    </>
  )
}
