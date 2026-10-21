import { Badge, type Tone } from '@/components/ui'
import type { CefrLevel } from '@/types/content'

const LEVEL_TONES: Record<CefrLevel, Tone> = { A1: 'emerald', A2: 'teal', B1: 'sky', B2: 'indigo', C1: 'violet', C2: 'rose' }

export function LevelBadge({ level, className }: { level: CefrLevel; className?: string }) {
  if (!level) return null
  return (
    <Badge tone={LEVEL_TONES[level] ?? 'slate'} className={className} title={`CEFR level ${level}`}>
      {level}
    </Badge>
  )
}
