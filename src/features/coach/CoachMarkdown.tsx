// The coach's answers: Markdown with app links opening in-app, everything else in a new tab. No raw HTML.
import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { Link } from 'react-router'
import remarkGfm from 'remark-gfm'

function makeComponents(onNavigate: () => void): Components {
  return {
    p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
    strong: ({ children }) => <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>,
    h1: ({ children }) => <p className="mt-3 mb-1 font-bold">{children}</p>,
    h2: ({ children }) => <p className="mt-3 mb-1 font-bold">{children}</p>,
    h3: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
    code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-px text-[0.9em] dark:bg-slate-800">{children}</code>,
    pre: ({ children }) => <div className="my-1.5 overflow-x-auto rounded-lg bg-slate-50 p-2 dark:bg-slate-800">{children}</div>,
    hr: () => <hr className="my-3 border-slate-200 dark:border-slate-700" />,
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="w-full text-left text-xs">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b border-slate-200 px-1.5 py-1 font-semibold dark:border-slate-700">{children}</th>,
    td: ({ children }) => <td className="border-b border-slate-100 px-1.5 py-1 align-top dark:border-slate-800">{children}</td>,
    a: ({ href = '', children }) =>
      href.startsWith('/') && !href.startsWith('//') ? (
        <Link to={href} onClick={onNavigate} className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 dark:text-brand-300">
          {children}
        </Link>
      ) : /^https?:\/\//.test(href) ? (
        <a href={href} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300">
          {children}
        </a>
      ) : (
        <span>{children}</span>
      ),
  }
}

export const CoachMarkdown = memo(function CoachMarkdown({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  return (
    <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={makeComponents(onNavigate)}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
