// Per-card switch for the usage ladder: untick a word you only need to recognise (rare in speaking/writing); it is
// then only practised at "Nhận ra" and keeps its stage, so ticking it again carries on from there.
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { setCardsLadder, useReviewStore } from './store'

export function LadderToggle({ id, className }: { id: string; className?: string }) {
  const card = useReviewStore().cards[id]
  const [error, setError] = useState(false)
  if (!card) return null
  const on = card.ladder !== false
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold select-none',
        on ? 'text-slate-500' : 'text-amber-700 dark:text-amber-400',
        className,
      )}
      title={
        on
          ? 'Bỏ tick nếu từ này ít dùng khi nói/viết: thẻ chỉ còn ôn ở mức Nhận ra.'
          : 'Đang tắt: thẻ chỉ ôn ở mức Nhận ra. Tick lại để tiếp tục học kỹ từ bậc cũ.'
      }
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setError(false)
          setCardsLadder([id], e.target.checked).catch(() => setError(true))
        }}
        className="size-3.5 rounded accent-brand-600"
      />
      {on ? 'Usage ladder' : 'Chỉ nhận dạng'}
      {error ? <span className="text-rose-600">· chưa lưu được</span> : null}
    </label>
  )
}
