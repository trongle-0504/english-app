/** Whole-number percentage, 0 when there is nothing to score. */
export function percent(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0
}
