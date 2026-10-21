import { Compass, RotateCcw } from 'lucide-react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button, ButtonLink } from '@/components/ui'
import { NotFoundError } from '@/lib/data'

export function NotFound({ title = 'Page not found', description }: { title?: string; description?: string }) {
  return (
    <div className="animate-fade-in flex flex-col items-center py-24 text-center">
      <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
        <Compass className="size-8" />
      </div>
      <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">{title}</h1>
      <p className="mt-2 max-w-md text-slate-500 dark:text-slate-400">{description ?? 'Trang bạn tìm không tồn tại hoặc đã được di chuyển.'}</p>
      <ButtonLink to="/" className="mt-6">
        Back to home
      </ButtonLink>
    </div>
  )
}

export function RouteError() {
  const error = useRouteError()
  if (error instanceof NotFoundError || (isRouteErrorResponse(error) && error.status === 404)) return <NotFound />
  console.error(error)
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-slate-500">{error instanceof Error ? error.message : 'Unexpected error.'}</p>
      <Button className="mt-6" variant="outline" onClick={() => window.location.reload()}>
        <RotateCcw className="size-4" />
        Reload
      </Button>
    </div>
  )
}
