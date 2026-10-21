import { Check, Copy } from 'lucide-react'
import { memo, useEffect, useState, type ReactNode, type Ref } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { Badge, Button, Card, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'

const REMARK_PLUGINS = [remarkGfm, remarkBreaks]

const MARKDOWN_CLASS = cn(
  'markdown',
  'prose-h2:mt-8 prose-h2:text-xl prose-h2:text-brand-800 dark:prose-h2:text-brand-300',
  'prose-h3:text-base prose-hr:my-8',
  'prose-blockquote:rounded-r-xl prose-blockquote:border-brand-300 prose-blockquote:bg-brand-50/60 prose-blockquote:py-1 prose-blockquote:font-medium prose-blockquote:not-italic',
  'dark:prose-blockquote:border-brand-700 dark:prose-blockquote:bg-brand-950/30',
)

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Clipboard blocked (insecure context or permission): nothing sensible to do.
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={copy} aria-live="polite">
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy markdown'}
    </Button>
  )
}

function Header({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-5 dark:border-slate-800">
      <div>
        <h2 className="bg-gradient-to-r from-brand-600 to-violet-600 bg-clip-text text-2xl font-black tracking-tight text-transparent sm:text-3xl dark:from-brand-400 dark:to-violet-400">
          Chi tiết Phân Tích
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Phân tích chuyên sâu theo phương pháp Linear Thinking</p>
      </div>
      {children}
    </div>
  )
}

interface AnalysisResultProps {
  raw: string
  cached: boolean
  ref?: Ref<HTMLDivElement>
}

export const AnalysisResult = memo(function AnalysisResult({ raw, cached, ref }: AnalysisResultProps) {
  return (
    <Card ref={ref} className="animate-slide-up scroll-mt-24 p-4 sm:p-8">
      <Header>
        <div className="flex items-center gap-2">
          {cached ? <Badge tone="sky">From history</Badge> : <Badge tone="emerald">New</Badge>}
          <CopyButton text={raw} />
        </div>
      </Header>
      <div className={cn(MARKDOWN_CLASS, 'mt-6')}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{raw}</ReactMarkdown>
      </div>
    </Card>
  )
})

export function AnalysisSkeleton() {
  return (
    <Card className="animate-fade-in p-4 sm:p-8" aria-busy="true" aria-label="Analyzing">
      <Header />
      <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">Analyzing… this can take up to a minute for long paragraphs.</p>
      <div className="mt-6 space-y-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="mt-6 h-6 w-1/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </Card>
  )
}
