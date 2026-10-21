import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { navGroups, type NavGroup, type NavItem } from '@/components/layout/nav'
import { Card } from '@/components/ui'

const ACCENTS = [
  'from-amber-400 to-orange-500 shadow-orange-500/25',
  'from-rose-400 to-pink-600 shadow-pink-500/25',
  'from-sky-400 to-blue-600 shadow-blue-500/25',
  'from-violet-400 to-purple-600 shadow-purple-500/25',
  'from-teal-400 to-emerald-600 shadow-emerald-500/25',
  'from-lime-400 to-green-600 shadow-green-500/25',
]

function groupItems(group: NavGroup): NavItem[] {
  if (group.items) return group.items
  return group.to ? [{ to: group.to, label: group.label, description: group.description, icon: group.icon }] : []
}

function FeatureCard({ group, accent }: { group: NavGroup; accent: string }) {
  return (
    <Card className="flex flex-col p-4 sm:p-5 transition-shadow hover:shadow-md">
      <div className="flex items-center gap-3">
        <span className={`flex size-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg ${accent}`}>
          <group.icon className="size-5" aria-hidden />
        </span>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">{group.label}</h3>
      </div>
      <ul className="mt-4 space-y-1">
        {groupItems(group).map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <item.icon
                className="size-4 shrink-0 text-slate-400 transition-colors group-hover:text-brand-600 dark:group-hover:text-brand-400"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{item.label}</span>
                {item.description ? <span className="block text-xs text-slate-500 dark:text-slate-400">{item.description}</span> : null}
              </span>
              <ArrowRight
                className="size-4 shrink-0 -translate-x-1 text-slate-300 opacity-0 transition-all group-hover:translate-x-0 group-hover:text-brand-500 group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function FeatureGrid() {
  return (
    <section aria-labelledby="features-title" className="mt-14">
      <p className="text-xs font-bold tracking-[0.18em] text-brand-600 uppercase dark:text-brand-400">Explore</p>
      <h2 id="features-title" className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
        Everything you need, connected
      </h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {navGroups.map((group, i) => (
          <FeatureCard key={group.label} group={group} accent={ACCENTS[i % ACCENTS.length]} />
        ))}
      </div>
    </section>
  )
}
