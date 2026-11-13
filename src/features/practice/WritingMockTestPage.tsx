import { useState } from 'react'
import { SegmentedControl } from '@/components/ui'
import { useQueryParam } from '@/lib/useQueryParam'
import Task1Mock, { readTask1Attempt } from './writing-mock/Task1Mock'
import Task2Mock from './writing-mock/Task2Mock'

type Task = '1' | '2'

/**
 * Writing Mock Test: Task 1 (charts) and Task 2 (essay), switched by `?task=1|2`. Without `?task` it opens Task 2,
 * unless a Task 1 attempt is in progress.
 */
export default function WritingMockTestPage() {
  const [param, setParam] = useQueryParam('task')
  const [fallback] = useState<Task>(() => (readTask1Attempt() ? '1' : '2'))
  const task: Task = param === '1' || param === '2' ? param : fallback
  const taskSwitch = (
    <SegmentedControl<Task>
      value={task}
      onChange={setParam}
      options={[
        { value: '1', label: 'Task 1 · Biểu đồ' },
        { value: '2', label: 'Task 2 · Essay' },
      ]}
    />
  )
  return task === '1' ? <Task1Mock taskSwitch={taskSwitch} /> : <Task2Mock taskSwitch={taskSwitch} />
}
