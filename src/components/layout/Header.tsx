import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, LogOut, Monitor, Moon, Search, Sun, UserRound } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router'
import { Button } from '@/components/ui'
import { logout } from '@/features/auth/session'
import { cn } from '@/lib/cn'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { Logo } from './Logo'
import { MobileNav } from './MobileNav'
import { activeItem, AdminIcon, adminNav, isGroupActive, navGroups, type NavItem } from './nav'

const triggerClass = (active: boolean) =>
  cn(
    'inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm font-semibold transition-colors outline-none',
    active
      ? 'text-brand-700 dark:text-brand-300'
      : 'text-slate-600 hover:text-slate-900 data-[state=open]:text-slate-900 dark:text-slate-300 dark:hover:text-white dark:data-[state=open]:text-white',
  )

const menuContentClass =
  'animate-scale-in z-50 min-w-64 rounded-2xl border border-slate-200/80 bg-white/95 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95'

/** Marks an AI tool in the menus. */
export function AiBadge() {
  return (
    <span className="rounded-md bg-violet-100 px-1.5 py-px text-[10px] font-bold tracking-wide text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
      AI
    </span>
  )
}

function NavMenu({ label, items, active }: { label: string; items: NavItem[]; active: boolean }) {
  const { pathname } = useLocation()
  const current = activeItem(items, pathname)
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className={triggerClass(active)}>
        {label}
        <ChevronDown className="size-3.5 opacity-60 transition-transform [[data-state=open]>&]:rotate-180" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={8} className={menuContentClass}>
          {items.map((item) => (
            <DropdownMenu.Item key={item.to} asChild>
              <Link
                to={item.to}
                className={cn(
                  'flex items-start gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors data-[highlighted]:bg-slate-100 dark:data-[highlighted]:bg-slate-800',
                  current?.to === item.to && 'bg-brand-50/70 dark:bg-brand-950/40',
                )}
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
                  <item.icon className="size-4" />
                </span>
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {item.label}
                    {item.ai ? <AiBadge /> : null}
                  </span>
                  {item.description ? <span className="block text-xs text-slate-500 dark:text-slate-400">{item.description}</span> : null}
                </span>
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export function ThemeMenu() {
  const { preference, isDark, setPreference } = useTheme()
  const Icon = isDark ? Moon : Sun
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme">
          <Icon className="size-[18px]" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className={cn(menuContentClass, 'min-w-40')}>
          {themeOptions.map((option) => (
            <DropdownMenu.Item
              key={option.value}
              onSelect={() => setPreference(option.value)}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-slate-100 dark:data-[highlighted]:bg-slate-800',
                preference === option.value ? 'font-semibold text-brand-700 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300',
              )}
            >
              <option.icon className="size-4" />
              {option.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function AdminMenu() {
  const { pathname } = useLocation()
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Admin" className={cn(pathname.startsWith('/admin') && 'text-brand-600')}>
          <AdminIcon className="size-[18px]" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className={cn(menuContentClass, 'min-w-48')}>
          <DropdownMenu.Label className="px-3 pt-1.5 pb-1 text-[11px] font-bold tracking-[0.16em] text-slate-400 uppercase">Admin</DropdownMenu.Label>
          {adminNav.map((item) => (
            <DropdownMenu.Item key={item.to} asChild>
              <Link
                to={item.to}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-100 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800"
              >
                <item.icon className="size-4 text-slate-400" />
                {item.label}
              </Link>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
          <DropdownMenu.Item asChild>
            <Link
              to="/account"
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-100 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800"
            >
              <UserRound className="size-4 text-slate-400" />
              Tài khoản
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => void logout()} className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-100 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800', 'cursor-pointer')}>
            <LogOut className="size-4 text-slate-400" />
            Đăng xuất
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function Header({ onOpenLookup }: { onOpenLookup: () => void }) {
  const { pathname } = useLocation()

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl supports-[backdrop-filter]:bg-white/65 dark:border-slate-800/70 dark:bg-slate-950/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Logo />

        <nav className="ml-4 hidden items-center gap-0.5 lg:flex" aria-label="Main">
          {navGroups.map((group) =>
            group.items ? (
              <NavMenu key={group.label} label={group.label} items={group.items} active={isGroupActive(group, pathname)} />
            ) : (
              <NavLink key={group.label} to={group.to!} className={() => triggerClass(isGroupActive(group, pathname))}>
                {group.label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onOpenLookup} aria-label="Look up a word (Ctrl K)" title="Look up a word (Ctrl K)">
            <Search className="size-[18px]" />
          </Button>
          <ThemeMenu />
          <div className="hidden lg:block">
            <AdminMenu />
          </div>
          <MobileNav />
        </div>
      </div>
    </header>
  )
}
