import { ArrowLeft, ArrowRight, ListChecks, type LucideIcon, PenLine } from 'lucide-react'
import { useParams } from 'react-router'
import { Button, ButtonLink, Card, PageHeader, Progress } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useData } from '@/lib/data'
import { useQueryParam } from '@/lib/useQueryParam'
import type { WritingSet, WritingTask } from '@/types/content'
import { FillBlankTask } from './writing/FillBlankTask'
import { GuidedWritingTask } from './writing/GuidedWritingTask'

const TASK_TYPES: Record<WritingTask['taskType'], { label: string; icon: LucideIcon }> = {
  fill_in_the_blank: { label: 'Fill in the blank', icon: ListChecks },
  guided_writing: { label: 'Guided writing', icon: PenLine },
}

function TaskPills({ tasks, current, onSelect }: { tasks: WritingTask[]; current: number; onSelect: (index: number) => void }) {
  return (
    <nav aria-label="Tasks" className="flex flex-wrap gap-1.5">
      {tasks.map((task, i) => (
        <button
          key={task.taskId}
          type="button"
          onClick={() => onSelect(i)}
          aria-current={i === current ? 'step' : undefined}
          title={`${TASK_TYPES[task.taskType].label}: ${task.title}`}
          className={cn(
            'flex size-8 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-all',
            i === current
              ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30 dark:bg-brand-500 dark:text-slate-950'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
          )}
        >
          {i + 1}
        </button>
      ))}
    </nav>
  )
}

export default function WritingPage() {
  const { setId = '' } = useParams()
  const set = useData<WritingSet>(`practice/writing/${setId}.json`)
  const [taskParam, setTaskParam] = useQueryParam('task')
  const count = set.tasks.length
  const index = Math.min(Math.max(Number.parseInt(taskParam, 10) - 1 || 0, 0), count - 1)
  const task = set.tasks[index]
  const { label, icon: TypeIcon } = TASK_TYPES[task.taskType]
  // Keyed per set and task so every task starts with fresh state.
  const taskKey = `${set.id}:${task.taskId}`

  const goTo = (next: number) => {
    setTaskParam(next === 0 ? '' : String(next + 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Writing · Writing practice"
        title={set.title}
        actions={
          <ButtonLink to="/practice/writing" variant="ghost" size="sm">
            <ArrowLeft className="size-4" />
            All writing sets
          </ButtonLink>
        }
      />

      <Card className="mb-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-brand-600 uppercase dark:text-brand-400">
              <TypeIcon className="size-3.5" aria-hidden />
              Task {index + 1} of {count} · {label}
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-900 text-balance dark:text-white">{task.title}</h2>
          </div>
          <TaskPills tasks={set.tasks} current={index} onSelect={goTo} />
        </div>
        <Progress value={((index + 1) / count) * 100} className="mt-4" />
      </Card>

      {task.taskType === 'fill_in_the_blank' ? (
        <FillBlankTask key={taskKey} task={task} />
      ) : (
        <GuidedWritingTask key={taskKey} task={task} draftKey={`practice:writing-draft:${taskKey}`} />
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button variant="outline" onClick={() => goTo(index - 1)} disabled={index === 0}>
          <ArrowLeft className="size-4" />
          Previous
        </Button>
        <Button variant={index === count - 1 ? 'outline' : 'primary'} onClick={() => goTo(index + 1)} disabled={index === count - 1}>
          Next task
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
