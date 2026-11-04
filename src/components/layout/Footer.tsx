import { Link } from 'react-router'
import { navGroups } from './nav'

export function Footer() {
  return (
    <footer className="border-t border-slate-200/70 bg-white/60 dark:border-slate-800/70 dark:bg-slate-950/60">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-slate-500 sm:px-6 dark:text-slate-400">
        <p>
          <span className="font-semibold text-slate-700 dark:text-slate-200">NeuralSymbolic</span> · Mastery through connection
        </p>
        <nav className="flex flex-wrap gap-x-4 sm:gap-y-1" aria-label="Footer">
          {navGroups.map((group) => (
            <Link key={group.label} to={group.to ?? group.items![0].to} className="py-2 hover:text-slate-900 sm:py-0 dark:hover:text-white">
              {group.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
