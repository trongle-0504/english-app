// The right side of the card header in a session: the card's usage-ladder stage and its FSRS state, with an ⓘ that
// lists every stage and every state (the card's own marked).
import { cn } from '@/lib/cn'
import type { SchedulerCard, UsageStage } from '@/types/review'
import { InfoTip } from './InfoTip'
import { STAGE_LABEL, STAGES } from './ladder'

const STAGE_HINT: Record<UsageStage, string> = {
  recognize: 'thấy từ → nhớ nghĩa, hoặc nghe chép',
  recall: 'thấy nghĩa → gõ ra từ',
  collocate: 'điền từ đi kèm của một collocation',
  paraphrase: 'viết lại câu cho sẵn bằng từ/cụm (Gemini chấm)',
  produce: 'tự viết 1 câu IELTS với từ/cụm (Gemini chấm)',
}

const STATES: { state: SchedulerCard['state']; label: string; hint: string }[] = [
  { state: 0, label: 'New', hint: 'thẻ mới, chưa học lần nào' },
  { state: 1, label: 'Learning', hint: 'đang học lần đầu, quay lại sau vài phút đến khi nhớ' },
  { state: 2, label: 'Review', hint: 'đã thuộc; mỗi lần nhớ đúng, khoảng cách ôn giãn ra (ngày → tuần → tháng)' },
  { state: 3, label: 'Relearning', hint: 'thẻ Review bị quên (Again), đang học lại' },
]

export const stateLabel = (state: SchedulerCard['state'] | undefined) => STATES.find((s) => s.state === (state ?? 0))?.label ?? 'New'

/** `stage` null = usage ladder switched off in Settings (only the state is shown). */
export function CardStatus({ stage, ladderOff, state }: { stage: UsageStage | null; ladderOff: boolean; state: SchedulerCard['state'] | undefined }) {
  const current = state ?? 0
  return (
    <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-500 dark:text-slate-400">
      {stage ? (
        <span className="rounded-full bg-brand-50 px-2.5 py-0.5 whitespace-nowrap text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
          {STAGES.indexOf(stage) + 1}/{STAGES.length} · {STAGE_LABEL[stage]}
        </span>
      ) : null}
      <span>{stateLabel(state)}</span>
      <InfoTip wide label="What do the stage and state mean?">
        {stage ? (
          <>
            <p className="font-semibold">Bậc dùng từ (Usage ladder) — 5 bậc:</p>
            <ol className="mt-1 space-y-0.5">
              {STAGES.map((s, i) => (
                <li key={s} className={cn(s === stage ? 'font-bold text-white' : 'text-slate-300')}>
                  {i + 1}. {STAGE_LABEL[s]} — {STAGE_HINT[s]}
                  {s === stage ? ' ← thẻ này' : ''}
                </li>
              ))}
            </ol>
            <p className="mt-1 text-slate-300">
              {ladderOff
                ? 'Thẻ này đã bỏ tick Usage ladder nên chỉ ôn ở mức Nhận ra.'
                : 'Good/Easy lên một bậc, Again lùi lại. Bậc thẻ không có dữ liệu được bỏ qua.'}
            </p>
          </>
        ) : null}
        <p className={cn('font-semibold', stage && 'mt-2')}>Trạng thái lịch ôn (FSRS):</p>
        <ul className="mt-1 space-y-0.5">
          {STATES.map((s) => (
            <li key={s.state} className={cn(s.state === current ? 'font-bold text-white' : 'text-slate-300')}>
              {s.label} — {s.hint}
              {s.state === current ? ' ← thẻ này' : ''}
            </li>
          ))}
        </ul>
      </InfoTip>
    </span>
  )
}
