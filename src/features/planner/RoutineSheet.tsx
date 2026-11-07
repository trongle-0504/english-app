import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { NON_STUDY_SKILLS, STUDY_SKILLS, type PlannerRoutineItem, type PlannerSkill } from '@/types/planner'
import * as api from './api'
import { inputClass, Sheet } from './Sheet'
import { SKILL_DOT, SKILL_LABELS, SKILL_LINKS } from './skills'
import { showToast } from './toast'

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

/** The weekly routine: fixed slots per weekday, applied to a week with "Áp dụng lịch cố định". */
export function RoutineSheet({ open, onOpenChange, routine, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; routine: PlannerRoutineItem[]; onSaved: () => void }) {
  const [items, setItems] = useState(routine)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setItems(routine)
  }, [open, routine])

  const patch = (id: string, next: Partial<PlannerRoutineItem>) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...next } : x)))
  const add = (weekday: number) =>
    setItems((list) => [...list, { id: `new-${Date.now()}`, weekday, title: '', skill: 'review', durationMin: 20, link: SKILL_LINKS.review }])

  const save = async () => {
    setBusy(true)
    try {
      await api.saveRoutine(items.filter((x) => x.title.trim()).map((x) => ({ ...x, id: x.id.startsWith('new-') ? '' : x.id })))
      showToast('Đã lưu lịch cố định.')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      showToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Lịch cố định"
      description="Các buổi lặp lại mỗi tuần. Bấm “Áp dụng lịch cố định” ở tuần để tạo việc."
      footer={
        <Button onClick={() => void save()} loading={busy}>
          Lưu
        </Button>
      }
    >
      <div className="space-y-4">
        {WEEKDAYS.map((label, i) => {
          const weekday = i + 1
          const list = items.filter((x) => x.weekday === weekday)
          return (
            <section key={label} className="border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{label}</h4>
                <button type="button" onClick={() => add(weekday)} className="inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/40">
                  <Plus className="size-4" /> Thêm
                </button>
              </div>
              {list.map((x) => (
                <div key={x.id} className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <input className={cn(inputClass, 'h-10 flex-1 text-sm')} value={x.title} placeholder="Ôn thẻ 20 phút" onChange={(e) => patch(x.id, { title: e.target.value })} maxLength={120} />
                    <button type="button" aria-label="Xoá" onClick={() => setItems((all) => all.filter((y) => y.id !== x.id))} className="flex size-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="time" className={cn(inputClass, 'h-9 w-28 text-sm')} value={x.time ?? ''} onChange={(e) => patch(x.id, { time: e.target.value || undefined })} />
                    <input
                      inputMode="numeric"
                      className={cn(inputClass, 'h-9 w-20 text-sm')}
                      value={x.durationMin ?? ''}
                      placeholder="phút"
                      onChange={(e) => patch(x.id, { durationMin: Number(e.target.value.replace(/\D/g, '').slice(0, 3)) || undefined })}
                    />
                    <select
                      className={cn(inputClass, 'h-9 w-auto text-sm')}
                      value={x.skill}
                      onChange={(e) => patch(x.id, { skill: e.target.value as PlannerSkill, link: SKILL_LINKS[e.target.value as PlannerSkill] })}
                    >
                      {[
                        { name: 'Học', list: STUDY_SKILLS },
                        { name: 'Việc khác', list: NON_STUDY_SKILLS },
                      ].map((group) => (
                        <optgroup key={group.name} label={group.name}>
                          {group.list.map((s) => (
                            <option key={s} value={s}>
                              {SKILL_LABELS[s]}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <span className={cn('size-2.5 rounded-full', SKILL_DOT[x.skill])} />
                  </div>
                </div>
              ))}
            </section>
          )
        })}
      </div>
    </Sheet>
  )
}
