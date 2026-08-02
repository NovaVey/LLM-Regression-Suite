/**
 * Runs `worker` over `items` with at most `limit` in flight at once,
 * preserving output order (results[i] corresponds to items[i]) regardless
 * of completion order. A fixed pool of `limit` "lanes" each pull the next
 * unclaimed index until the queue is empty, rather than launching all
 * promises and gating with a semaphore — simpler to reason about and no
 * risk of ever exceeding `limit` concurrent calls in flight.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runLane(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  }

  const laneCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: laneCount }, () => runLane()));
  return results;
}
