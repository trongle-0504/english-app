// What the review pages show of the cards that come from your own Speaking / Writing: a phrase card's dictionary check,
// the "fix" exercise of a mistake card (Sổ lỗi: correct the sentence you once wrote), and where you used a card yourself.
import { Check, ExternalLink, PenLine, ShieldCheck, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { CardMistake, CardPhrase } from '@/types/content'
import type { RealUse } from '@/types/review'
import { PHRASE_GROUP_LABEL, WORK_LABEL, workPath, type WorkKind } from '@/types/practice'
import { DiffText } from '../practice/components/DiffText'
import { compareSentence } from '../practice/lib/compare'
import { STAGE_LABEL } from './ladder'

/** A "Speaking & Writing" card: which list the phrase was in and the dictionary lines that confirm it. */
export function PhraseCheck({ phrase }: { phrase: CardPhrase }) {
  return (
    <div className="space-y-1.5 rounded-xl bg-sky-50/70 px-3.5 py-2.5 text-[13px] dark:bg-sky-950/30">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-600 dark:text-slate-300">{PHRASE_GROUP_LABEL[phrase.group]}</span>
        {phrase.verified && phrase.dictionary.length ? (
          <Badge tone="emerald">
            <ShieldCheck className="size-3" /> Longman / OZDIC
          </Badge>
        ) : phrase.natural ? (
          <Badge tone="slate">
            <Check className="size-3" /> Tự nhiên (từ điển chưa liệt kê)
          </Badge>
        ) : null}
        {phrase.sources.map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-semibold text-sky-700 hover:underline dark:text-sky-300"
          >
            {s.name} <ExternalLink className="size-3" />
          </a>
        ))}
      </p>
      {phrase.dictionary.map((line) => (
        <p key={line} className="text-slate-500 dark:text-slate-400">
          {line}
        </p>
      ))}
    </div>
  )
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Right when you typed the correction, or the whole corrected sentence. */
const isFixCorrect = (typed: string, m: CardMistake) =>
  Boolean(norm(typed)) && (norm(typed) === norm(m.right) || (!!m.fixed && norm(typed) === norm(m.fixed)))

/** Your sentence with the wrong words underlined (or `right` in place, marked green). */
function Marked({ sentence, part, tone }: { sentence: string; part: string; tone: 'wrong' | 'right' }) {
  const at = sentence.toLowerCase().indexOf(part.toLowerCase())
  if (at < 0 || !part) return <span>{sentence}</span>
  return (
    <span>
      {sentence.slice(0, at)}
      <mark
        className={cn(
          'rounded px-0.5',
          tone === 'wrong'
            ? 'bg-rose-50 text-rose-800 underline decoration-rose-400 decoration-wavy underline-offset-4 dark:bg-rose-950/50 dark:text-rose-200'
            : 'bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
        )}
      >
        {sentence.slice(at, at + part.length)}
      </mark>
      {sentence.slice(at + part.length)}
    </span>
  )
}

/** "fix": the sentence you once wrote, the wrong part underlined — type its correction. */
export function FixExercise({ mistake, onSubmit }: { mistake: CardMistake; onSubmit: (answer: { typed: string; correct: boolean }) => void }) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  return (
    <div className="flex w-full flex-col items-center gap-5 text-center">
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500">
        <PenLine className="size-4" /> Câu bạn từng viết — sửa phần gạch chân cho đúng
      </p>
      <p className="max-w-2xl text-lg leading-relaxed text-balance text-slate-800 dark:text-slate-100">
        <Marked sentence={mistake.sentence} part={mistake.wrong} tone="wrong" />
      </p>
      <form
        className="flex w-full max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit({ typed, correct: isFixCorrect(typed, mistake) })
        }}
      >
        <input
          ref={inputRef}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={`Thay “${mistake.wrong}” bằng…`}
          aria-label="Phần sửa"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-lg focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        />
        <Button type="submit" size="lg" className="shrink-0">
          Check
        </Button>
      </form>
      <button
        type="button"
        onClick={() => onSubmit({ typed: '', correct: false })}
        className="text-xs font-semibold text-slate-400 hover:text-slate-600"
      >
        Không biết — xem cách sửa
      </button>
    </div>
  )
}

/** The answer of a "fix" card: your correction against the review's, the corrected sentence, why. */
export function FixResult({ mistake, answer, href }: { mistake: CardMistake; answer: { typed: string; correct: boolean }; href?: string }) {
  return (
    <div className="space-y-4 text-left">
      <div
        className={cn(
          'flex items-start gap-2 rounded-xl px-4 py-3 text-sm',
          answer.correct
            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
            : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
        )}
      >
        {answer.correct ? <Check className="mt-0.5 size-4 shrink-0" /> : <X className="mt-0.5 size-4 shrink-0" />}
        <div>
          {answer.correct ? 'Đúng rồi!' : answer.typed ? <DiffText parts={compareSentence(answer.typed, mistake.right).parts} /> : 'Đáp án:'}
          {!answer.correct ? (
            <p className="mt-1">
              <span className="line-through decoration-rose-400">{mistake.wrong}</span> → <strong>{mistake.right}</strong>
            </p>
          ) : null}
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-bold tracking-wide text-slate-400 uppercase">Câu đã sửa</p>
        <p className="text-[15px] leading-relaxed text-slate-800 dark:text-slate-100">
          <Marked sentence={mistake.fixed || mistake.sentence} part={mistake.right} tone="right" />
        </p>
      </div>
      {mistake.why ? <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{mistake.why}</p> : null}
      {mistake.dictionary?.length ? (
        <div className="space-y-1 rounded-xl bg-sky-50/70 px-3.5 py-2.5 text-[13px] text-slate-500 dark:bg-sky-950/30 dark:text-slate-400">
          {mistake.dictionary.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
      {href ? (
        <Link
          to={href}
          target="_blank"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
        >
          Mở bài làm <ExternalLink className="size-3.5" />
        </Link>
      ) : null}
    </div>
  )
}

const workOf = (ref: string) => {
  const [kind, id] = ref.split(':') as [WorkKind, string]
  return { kind, href: workPath(kind, id) }
}
const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  })

/** Where you used the card in your own Speaking / Writing (latest first). */
export function RealUses({ uses, limit = 3, className }: { uses?: RealUse[]; limit?: number; className?: string }) {
  if (!uses?.length) return null
  return (
    <div className={cn('space-y-1.5', className)}>
      <p className="text-xs font-bold tracking-wide text-slate-400 uppercase">Bạn đã tự dùng trong bài</p>
      <ul className="space-y-1.5">
        {[...uses]
          .reverse()
          .slice(0, limit)
          .map((u) => {
            const work = workOf(u.ref)
            return (
              <li key={u.ref} className="flex items-start gap-2 text-[13px] leading-relaxed">
                {u.ok ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <X className="mt-0.5 size-4 shrink-0 text-rose-500" />}
                <div className="min-w-0">
                  <p className="text-slate-700 dark:text-slate-200">
                    {u.ok ? (
                      <Marked sentence={u.sentence.replace(/\*\*/g, '')} part={u.term} tone="right" />
                    ) : (
                      <>
                        Bạn viết <span className="text-rose-700 line-through decoration-rose-400 dark:text-rose-300">{u.wrote}</span>
                        {u.fixed ? (
                          <>
                            {' '}
                            → <strong>{u.fixed}</strong>
                          </>
                        ) : null}
                        {u.why ? <span className="text-slate-500"> — {u.why}</span> : null}
                      </>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    <Link to={work.href} target="_blank" className="hover:underline">
                      {WORK_LABEL[work.kind] ?? 'Writing'} · {dayOf(u.at)}
                    </Link>
                    {u.to ? ` · ${STAGE_LABEL[u.from ?? 'recognize']} → ${STAGE_LABEL[u.to]}` : ''}
                  </p>
                </div>
              </li>
            )
          })}
      </ul>
    </div>
  )
}
