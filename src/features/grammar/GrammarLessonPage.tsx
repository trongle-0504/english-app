import { TriangleAlert, ArrowLeft, Lightbulb, Radar, Ruler } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Card, SectionTitle } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useData } from '@/lib/data'
import type { GrammarLesson } from '@/types/content'
import { LevelBadge } from './levels'
import { SpeakButton } from '@/components/SpeakButton'

type Structure = GrammarLesson['structures'][number]
type Usage = GrammarLesson['usages'][number]

const STRUCTURE_STYLES: Record<Structure['type'], { symbol: string; label: string; className: string }> = {
  affirmative: { symbol: '+', label: 'Affirmative', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
  negative: { symbol: '−', label: 'Negative', className: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' },
  question: { symbol: '?', label: 'Question', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  other: { symbol: '✨', label: 'Other', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="animate-fade-in">
      <SectionTitle className="mb-4">
        {icon}
        {title}
      </SectionTitle>
      {children}
    </section>
  )
}

function StructureCard({ structure }: { structure: Structure }) {
  const style = STRUCTURE_STYLES[structure.type] ?? STRUCTURE_STYLES.other
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
        <span className={cn('flex size-7 items-center justify-center rounded-lg text-sm font-black', style.className)} aria-hidden>
          {style.symbol}
        </span>
        <span className="text-xs font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">{style.label}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <code className="rounded-lg bg-brand-50/70 px-3 py-2 font-mono text-sm font-semibold text-brand-800 dark:bg-brand-950/40 dark:text-brand-200">
          {structure.formula}
        </code>
        {structure.example ? (
          <div className="flex items-start gap-1">
            <p className="flex-1 text-sm text-slate-600 italic dark:text-slate-400">“{structure.example}”</p>
            <SpeakButton text={structure.example} className="-mt-1" />
          </div>
        ) : null}
      </div>
    </Card>
  )
}

function UsageCard({ usage, index }: { usage: Usage; index: number }) {
  return (
    <Card className="flex gap-4 p-4 sm:p-5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm font-bold text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="leading-relaxed font-semibold text-slate-900 dark:text-slate-100">{usage.explanation_vi}</h3>
        {usage.examples.length ? (
          <ul className="mt-4 space-y-2.5">
            {usage.examples.map((example, i) => (
              <li key={i} className="flex items-start gap-2 rounded-xl border-l-4 border-teal-400 bg-teal-50/50 py-2.5 pr-2 pl-4 dark:border-teal-600 dark:bg-teal-950/20">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800 dark:text-slate-200">{example.en}</p>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{example.vi}</p>
                </div>
                <SpeakButton text={example.en} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  )
}

export default function GrammarLessonPage() {
  const { slug } = useParams()
  const lesson = useData<GrammarLesson>(`grammar/${slug}.json`)
  const hasExtras = lesson.signals.length > 0 || lesson.notes_and_exceptions.length > 0

  return (
    <article className="mx-auto max-w-4xl space-y-6 pt-4 sm:space-y-10 sm:pt-10">
      <title>NeSy</title>

      <header className="animate-fade-in rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-sky-50 p-4 sm:p-8 dark:border-brand-950 dark:from-brand-950/40 dark:via-slate-900/60 dark:to-sky-950/30">
        <Link
          to="/grammar"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-brand-700 dark:text-slate-400 dark:hover:text-brand-300"
        >
          <ArrowLeft className="size-4" />
          All grammar
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3 sm:mt-4">
          <LevelBadge level={lesson.level} className="px-3 py-1 text-xs" />
          <h1 className="text-2xl font-extrabold tracking-tight text-balance text-slate-900 sm:text-4xl dark:text-white">{lesson.title}</h1>
        </div>
        {lesson.brief_description_vi ? (
          <p className="mt-3 max-w-3xl text-base leading-relaxed sm:mt-4 text-slate-600 dark:text-slate-300">{lesson.brief_description_vi}</p>
        ) : null}
      </header>

      {lesson.structures.length ? (
        <Section icon={<Ruler className="size-4" />} title="Structures">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lesson.structures.map((structure, i) => (
              <StructureCard key={i} structure={structure} />
            ))}
          </div>
        </Section>
      ) : null}

      {lesson.usages.length ? (
        <Section icon={<Lightbulb className="size-4" />} title="How to use">
          <div className="space-y-4">
            {lesson.usages.map((usage, i) => (
              <UsageCard key={i} usage={usage} index={i} />
            ))}
          </div>
        </Section>
      ) : null}

      {hasExtras ? (
        <div className="grid gap-4 md:grid-cols-2">
          {lesson.signals.length ? (
            <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 sm:p-5 dark:border-sky-900/60 dark:bg-sky-950/20">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-wider text-sky-800 uppercase dark:text-sky-300">
                <Radar className="size-4" />
                Signals
              </h2>
              <ul className="mt-4 flex flex-wrap gap-2">
                {lesson.signals.map((signal, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-sm font-medium text-sky-700 shadow-sm dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
                  >
                    {signal}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {lesson.notes_and_exceptions.length ? (
            <section className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 sm:p-5 dark:border-rose-900/60 dark:bg-rose-950/20">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-wider text-rose-800 uppercase dark:text-rose-300">
                <TriangleAlert className="size-4" />
                Notes & Exceptions
              </h2>
              <ul className="mt-4 list-outside list-disc space-y-2 pl-4 marker:text-rose-400">
                {lesson.notes_and_exceptions.map((note, i) => (
                  <li key={i} className="text-sm leading-relaxed text-rose-900 dark:text-rose-200">
                    {note}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
