import { cn } from '@/lib/cn'

export type OrbMode = 'idle' | 'speaking' | 'listening' | 'preparing'

export function ExaminerOrb({
  mode,
  level = 0,
  label,
  sublabel,
}: {
  mode: OrbMode
  level?: number
  label: string
  sublabel?: string
}) {
  // Scale the outer glow gently with live microphone input when listening, or pulse when examiner is speaking.
  const activeScale = mode === 'listening' ? 1 + Math.min(0.28, level * 1.6) : mode === 'speaking' ? 1.08 : 1

  return (
    <div className="flex flex-col items-center justify-center select-none">
      {/* Status pill above orb (inspired by reference screenshot) */}
      <div
        className={cn(
          'mb-7 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold tracking-wider uppercase shadow-sm transition-colors',
          mode === 'listening'
            ? 'bg-rose-500 text-white shadow-rose-500/25'
            : mode === 'speaking'
              ? 'bg-sky-600 text-white shadow-sky-500/25'
              : mode === 'preparing'
                ? 'bg-slate-400/80 text-white dark:bg-slate-700 dark:text-slate-100'
                : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        )}
      >
        <span
          className={cn(
            'size-2 rounded-full',
            mode === 'listening'
              ? 'animate-ping bg-white'
              : mode === 'speaking'
                ? 'animate-pulse bg-white'
                : 'bg-current opacity-75',
          )}
        />
        <span>{label}</span>
      </div>

      {/* 3D-inspired luminous blue water/nebula sphere */}
      <div className="relative flex size-48 items-center justify-center sm:size-56">
        {/* Outer ambient halo */}
        <div
          style={{ transform: `scale(${activeScale * 1.12})` }}
          className={cn(
            'pointer-events-none absolute inset-0 rounded-full blur-2xl transition-transform duration-150',
            mode === 'listening'
              ? 'bg-sky-400/45 dark:bg-sky-500/35'
              : mode === 'speaking'
                ? 'animate-pulse bg-blue-500/45 dark:bg-blue-400/40'
                : 'bg-sky-300/30 dark:bg-sky-600/25',
          )}
        />

        {/* Secondary ripple ring when speaking or listening */}
        {(mode === 'speaking' || mode === 'listening') && (
          <div
            style={{ transform: `scale(${activeScale * 1.05})` }}
            className="pointer-events-none absolute inset-2 animate-ping rounded-full border border-sky-400/30 duration-1000"
          />
        )}

        {/* Main orb sphere */}
        <div
          style={{
            transform: `scale(${activeScale})`,
            background:
              'radial-gradient(circle at 32% 28%, #e0f2fe 0%, #7dd3fc 22%, #38bdf8 48%, #0284c7 76%, #1e3a8a 100%)',
            boxShadow:
              'inset -14px -18px 32px rgba(15, 23, 42, 0.45), inset 12px 12px 26px rgba(255, 255, 255, 0.7), 0 18px 45px -10px rgba(2, 132, 199, 0.55)',
          }}
          className="relative size-40 overflow-hidden rounded-full transition-transform duration-150 sm:size-44"
        >
          {/* Cloud/water texture layers inside the sphere */}
          <div
            style={{
              background:
                'radial-gradient(circle at 65% 35%, rgba(255,255,255,0.65) 0%, transparent 45%), radial-gradient(circle at 25% 70%, rgba(186,230,253,0.55) 0%, transparent 50%), radial-gradient(circle at 70% 75%, rgba(3,105,161,0.65) 0%, transparent 48%)',
            }}
            className={cn(
              'absolute inset-0 rounded-full mix-blend-overlay',
              (mode === 'speaking' || mode === 'listening') && 'animate-spin [animation-duration:14s]',
            )}
          />
          {/* Specular top-left highlight */}
          <div
            style={{
              background: 'radial-gradient(circle at 30% 24%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 42%)',
            }}
            className="pointer-events-none absolute inset-0 rounded-full"
          />
        </div>
      </div>

      {sublabel ? (
        <p className="mt-4 text-center text-xs font-medium text-slate-500 dark:text-slate-400">{sublabel}</p>
      ) : null}
    </div>
  )
}
