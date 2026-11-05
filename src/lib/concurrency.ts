export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency))
  let nextIndex = 0

  const runWorker = async () => {
    while (!shouldStop()) {
      const index = nextIndex++
      if (index >= items.length) return
      await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()))
}
