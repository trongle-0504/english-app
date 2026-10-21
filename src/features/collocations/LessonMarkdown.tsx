import * as Popover from '@radix-ui/react-popover'
import { memo, useMemo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { Link } from 'react-router'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import type { VocabWord } from '@/types/content'
import { RichText } from '../words/RichText'
import { SpeakButton } from '@/components/SpeakButton'
import { rehypeHighlightPhrases } from './highlightPhrases'

function Term({ word, children }: { word: VocabWord; children: ReactNode }) {
  const sense = word.senses[0]
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="rounded bg-brand-50 px-0.5 font-semibold text-brand-800 decoration-brand-300 decoration-dotted underline-offset-4 transition-colors hover:bg-brand-100 hover:underline dark:bg-brand-950/60 dark:text-brand-200 dark:hover:bg-brand-900/60"
        >
          {children}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={6}
          collisionPadding={12}
          className="animate-scale-in z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-bold text-slate-900 dark:text-white">{word.word}</p>
              {word.pronunciation ? <p className="ipa text-xs text-slate-400">{word.pronunciation}</p> : null}
            </div>
            <SpeakButton text={word.word} />
          </div>
          {sense ? (
            <>
              <RichText text={sense.definition_vi} className="mt-2 block text-sm text-slate-700 dark:text-slate-200" />
              {sense.examples[0] ? <RichText text={sense.examples[0]} className="mt-2 block text-[13px] text-slate-500 italic" /> : null}
            </>
          ) : null}
          <Link to={{ hash: word.id }} className="mt-3 inline-block text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
            View card →
          </Link>
          <Popover.Arrow className="fill-white dark:fill-slate-900" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** The lesson text (from the book) with every collocation of the lesson clickable. */
export const LessonMarkdown = memo(function LessonMarkdown({ markdown, words }: { markdown: string; words: VocabWord[] }) {
  const { components, rehypePlugins } = useMemo(() => {
    const byId = new Map(words.map((w) => [w.id, w]))
    const components = {
      h1: () => null, // the page header already shows the lesson title
      term: ({ children, ...props }: { children?: ReactNode; 'data-id'?: string }) => {
        const word = byId.get(props['data-id'] ?? '')
        return word ? <Term word={word}>{children}</Term> : <>{children}</>
      },
      table: ({ children }: { children?: ReactNode }) => (
        <div className="not-prose my-5 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm [&_td]:border-t [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top dark:[&_td]:border-slate-800 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold dark:[&_th]:bg-slate-800/60">
            {children}
          </table>
        </div>
      ),
    } as Components
    return { components, rehypePlugins: [rehypeRaw, rehypeHighlightPhrases(words)] }
  }, [words])

  return (
    <div className="markdown prose-h2:mt-10 prose-h2:border-b prose-h2:border-slate-100 prose-h2:pb-2 dark:prose-h2:border-slate-800 [&>h2:first-child]:mt-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
})
