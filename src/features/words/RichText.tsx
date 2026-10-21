import { Fragment, memo, type ReactNode } from 'react'
import { Markdown } from '@/components/Markdown'

const BLOCK_SYNTAX = /(^|\n)\s*([-*+]\s|\d+\.\s|#{1,6}\s|>|\|)/

/** Renders **bold**, *italic* and `code` without a markdown parser (hot path: thousands of fields). */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|`[^`]+`)/g
  let last = 0
  let key = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**') || token.startsWith('__')) nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('`')) nodes.push(<code key={key++}>{token.slice(1, -1)}</code>)
    else nodes.push(<em key={key++}>{token.slice(1, -1)}</em>)
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/**
 * Text from the vocabulary generators: mostly plain text with **bold**; usage notes sometimes contain
 * lists. Only those go through the full markdown renderer.
 */
export const RichText = memo(function RichText({ text, className }: { text?: string; className?: string }) {
  if (!text) return null
  if (BLOCK_SYNTAX.test(text)) return <Markdown className={className}>{text}</Markdown>
  const lines = text.split('\n')
  return (
    <span className={className}>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          {renderInline(line)}
        </Fragment>
      ))}
    </span>
  )
})
