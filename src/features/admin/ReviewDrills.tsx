// The Review drills of an Admin entry (vocabulary word or note), shown under its preview — they are not on the public card.
import type { ReactNode } from 'react'
import type { Drills } from '@/lib/wordDrills'

/** Section heading of the Review drills block. */
const DrillHeading = ({ children }: { children: ReactNode }) => (
  <p className="mb-1.5 text-xs font-bold tracking-wide text-slate-500 uppercase">{children}</p>
)

/** An entry's Review drills — "Tự dùng" questions, "Nghe chép" sentences, "Viết lại câu" tasks (not on the public card). */
export function ReviewDrills({ drills }: { drills: Drills }) {
  const { use_prompts: prompts, dictation, paraphrase } = drills
  if (!prompts?.length && !dictation?.length && !paraphrase?.length) {
    return (
      <p className="rounded-xl border border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-700">
        Chưa có dữ liệu Review (câu hỏi Tự dùng, câu Nghe chép, câu Viết lại) — Generate lại để có.
      </p>
    )
  }
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700">
      {prompts?.length ? (
        <div>
          <DrillHeading>Câu hỏi “Tự dùng”</DrillHeading>
          <ol className="space-y-2">
            {prompts.map((p, i) => (
              <li key={i}>
                <span className="mr-1.5 rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                  {p.context}
                </span>
                <span className="text-slate-800 dark:text-slate-100">{p.question}</span>
                {p.fits.length ? <span className="block text-xs text-slate-500">Hợp với: {p.fits.join(' · ')}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {paraphrase?.length ? (
        <div>
          <DrillHeading>Viết lại câu</DrillHeading>
          <ul className="space-y-2">
            {paraphrase.map((p, i) => (
              <li key={i}>
                <span className="text-slate-800 dark:text-slate-100">{p.source}</span>
                <span className="block text-xs text-slate-500">
                  → với <strong>{p.target}</strong>: {p.model}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {dictation?.length ? (
        <div>
          <DrillHeading>Nghe chép</DrillHeading>
          <ul className="space-y-1">
            {dictation.map((d, i) => (
              <li key={i} className="text-slate-800 dark:text-slate-100">
                <span className="mr-1.5 text-xs font-semibold text-slate-500">{d.target}:</span>
                {d.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
