/** Fenced code, inline code, or an unescaped `$` directly followed by a digit. */
const CODE_OR_CURRENCY = /(?:^|\n)(```|~~~)[\s\S]*?\n\1|`[^`\n]*`|(?<!\\)\$(?=\d)/g

/**
 * remark-math pairs any two `$` in a paragraph, so "$450 … ($280)" became a formula.
 * Math in posts never starts with a digit, so prices are turned into a `$` entity
 * (works in markdown text and raw HTML alike) and left out of math parsing.
 */
export function escapeCurrency(markdown: string): string {
  return markdown.replace(CODE_OR_CURRENCY, (match) => (match === '$' ? '&#36;' : match))
}
