import { ArrowUpRight, BookOpenCheck, Headphones, Mic, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'

/** The pages used most, one click from the home page. */
const SHORTCUTS: { to: string; icon: LucideIcon; label: string; hint: string }[] = [
  { to: '/review?tab=recent', icon: BookOpenCheck, label: 'Review recent work', hint: 'Words from your own work' },
  { to: '/practice/writing-review', icon: ShieldCheck, label: 'Writing review', hint: 'Get an essay corrected' },
  { to: '/practice/speaking-ideas', icon: Mic, label: 'Speaking ideas', hint: 'Phrases & a model answer' },
  { to: '/practice/listening-simplify', icon: Headphones, label: 'Simplify transcript', hint: 'Break a listening down' },
]

/** Two columns on a phone leave ~140px a card: the icon goes above the label there, or the label gets ~30px. */
function Shortcut({ to, icon: Icon, label, hint }: (typeof SHORTCUTS)[number]) {
  return (
    <Link
      to={to}
      className="group flex flex-col items-start gap-2 rounded-2xl bg-white/10 p-3 ring-1 ring-white/15 backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-white/15 hover:ring-white/30 sm:flex-row sm:items-center sm:gap-3 sm:px-4"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <span className="w-full min-w-0 flex-1">
        <span className="line-clamp-2 block text-[15px] leading-tight font-bold text-white">{label}</span>
        <span className="hidden truncate text-xs font-medium text-white/70 sm:block">{hint}</span>
      </span>
      <ArrowUpRight
        className="hidden size-4 shrink-0 text-white/50 transition-all sm:block group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-white"
        aria-hidden
      />
    </Link>
  )
}

/** Shortcuts to the pages used most (Review recent work, Writing review, Speaking ideas, Simplify transcript). */
export function HeroShortcuts() {
  return (
    <nav aria-label="Shortcuts" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {SHORTCUTS.map((s) => (
        <Shortcut key={s.to} {...s} />
      ))}
    </nav>
  )
}
