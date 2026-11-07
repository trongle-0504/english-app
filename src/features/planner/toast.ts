// A tiny toast: one message at a time at the bottom of the screen. <Toaster /> shows it.
type Listener = (message: string) => void
const listeners = new Set<Listener>()

export function showToast(message: string) {
  for (const listener of listeners) listener(message)
}

export const useToast = () => showToast

export function onToast(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
