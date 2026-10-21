import type { Element, Root } from 'hast'

const DECLARATION = /(?:^|;)\s*(color|background(?:-color)?)\s*:\s*([^;]+)/gi
const PLAIN_COLOR = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([^()]*\)|[a-z]+)$/i
const KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'currentcolor', 'transparent', 'none'])

/**
 * Posts hard-code colours picked for a white page (`style="color:#1f2937"`, `background:#bfdbfe`).
 * Copy each plain colour into a custom property and tag the element, so post.css can
 * re-derive a legible shade in dark mode while light mode keeps the exact original.
 */
export function rehypeDarkColors() {
  return (tree: Root) => visit(tree)
}

function visit(parent: Root | Element) {
  for (const node of parent.children) {
    if (node.type !== 'element') continue
    if (typeof node.properties.style === 'string') tag(node, node.properties.style)
    visit(node)
  }
}

function tag(element: Element, style: string) {
  const found = new Map<'fg' | 'bg', string>()
  for (const [, property, raw] of style.matchAll(DECLARATION)) {
    const value = raw.replace(/!important/i, '').trim()
    if (!PLAIN_COLOR.test(value) || KEYWORDS.has(value.toLowerCase())) continue
    found.set(property.toLowerCase() === 'color' ? 'fg' : 'bg', value)
  }
  if (!found.size) return

  const variables = [...found].map(([kind, value]) => `--post-${kind}:${value}`)
  element.properties.style = `${style.replace(/;?\s*$/, ';')}${variables.join(';')}`
  const classes = element.properties.className
  element.properties.className = [...(Array.isArray(classes) ? classes : []), ...[...found.keys()].map((kind) => `post-${kind}`)]
}
