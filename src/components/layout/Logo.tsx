import { Link } from 'react-router'

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-lg outline-none" aria-label="NeuralSymbolic home">
      <img src="/logo.svg" alt="" width={32} height={32} className="size-8" />
      <span className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-white">
        Neural<span className="text-brand-600 dark:text-brand-400">Symbolic</span>
      </span>
    </Link>
  )
}
