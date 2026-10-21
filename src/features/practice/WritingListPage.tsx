import { FileText } from 'lucide-react'
import { EmptyState, PageHeader, SectionTitle } from '@/components/ui'
import { useData } from '@/lib/data'
import { plural } from '@/lib/text'
import type { PracticeIndex } from '@/types/content'
import { PracticeLinkCard } from './components/PracticeLinkCard'

export default function WritingListPage() {
  const { writing } = useData<PracticeIndex>('practice/index.json')

  return (
    <>
      <PageHeader
        eyebrow="Writing"
        title="Writing practice"
        description="Complete passages with the right collocations, then rewrite whole paragraphs from Vietnamese prompts."
      />

      <SectionTitle count={writing.length}>Writing sets</SectionTitle>
      {writing.length ? (
        <div className="animate-slide-up grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {writing.map((set) => (
            <PracticeLinkCard
              key={set.id}
              to={`/practice/writing/${set.id}`}
              prefetch={`practice/writing/${set.id}.json`}
              icon={FileText}
              title={set.title}
              description={plural(set.taskCount, 'task')}
            />
          ))}
        </div>
      ) : (
        <EmptyState icon={<FileText className="size-8" />} title="No writing sets yet" />
      )}
    </>
  )
}
