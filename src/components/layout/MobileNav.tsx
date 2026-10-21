import * as Dialog from '@radix-ui/react-dialog'
import { LogOut, Menu, UserRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Button } from '@/components/ui'
import { logout } from '@/features/auth/session'
import { cn } from '@/lib/cn'
import { AiBadge } from './Header'
import { Logo } from './Logo'
import { activeItem, adminNav, navGroups, type NavItem } from './nav'

function MobileLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.to}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors',
        active
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300'
          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
      )}
    >
      <item.icon className="size-[18px] opacity-70" />
      {item.label}
      {item.ai ? <AiBadge /> : null}
    </Link>
  )
}

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => setOpen(false), [pathname])

  const allItems: NavItem[] = navGroups.flatMap((g) => g.items ?? [{ to: g.to!, label: g.label, icon: g.icon, match: g.match }])
  const current = activeItem([...allItems, ...adminNav], pathname)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[min(22rem,88vw)] flex-col bg-white shadow-2xl outline-none data-[state=open]:animate-[slide-in_0.25s_ease-out] dark:bg-slate-950"
        >
          <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4 dark:border-slate-800">
            <Dialog.Title asChild>
              <div>
                <Logo />
              </div>
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close menu">
                <X className="size-5" />
              </Button>
            </Dialog.Close>
          </div>
          <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto p-4" aria-label="Mobile">
            {navGroups.map((group) =>
              group.items ? (
                <div key={group.label}>
                  <p className="mb-1 px-3 text-[11px] font-bold tracking-[0.16em] text-slate-400 uppercase">{group.label}</p>
                  {group.items.map((item) => (
                    <MobileLink key={item.to} item={item} active={current?.to === item.to} />
                  ))}
                </div>
              ) : (
                <MobileLink
                  key={group.label}
                  item={{ to: group.to!, label: group.label, icon: group.icon, match: group.match }}
                  active={current?.to === group.to}
                />
              ),
            )}
            <div>
              <p className="mb-1 px-3 text-[11px] font-bold tracking-[0.16em] text-slate-400 uppercase">Admin</p>
              {adminNav.map((item) => (
                <MobileLink key={item.to} item={item} active={current?.to === item.to} />
              ))}
            </div>
            <MobileLink item={{ to: '/account', label: 'Tài khoản', icon: UserRound }} active={pathname === '/account'} />
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LogOut className="size-[18px] opacity-70" />
              Đăng xuất
            </button>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
