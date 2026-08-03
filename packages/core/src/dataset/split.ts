/**
 * Deterministic stratified sampling over an array of items. Used by Phase 5's
 * calibration flow (§5.5: "Sample 100–300 real outputs from the suite,
 * stratified across score range and tags") so a calibration sample can't
 * silently miss an entire small group — a naive independent random draw of,
 * say, 20 items from a 100-item set with a 5-item minority group has a real
 * chance of drawing zero items from that group; proportional allocation by
 * group does not.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const temp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = temp;
  }
  return items;
}

/**
 * Returns exactly `n` items from `items` (or all of them if `n >= items.length`),
 * allocated proportionally across the groups induced by `groupKeyFn` via the
 * largest-remainder method, then randomly selected within each group and
 * shuffled in the final output — both driven by `seed`, so the same seed
 * always returns the same sample.
 */
export function stratifiedSample<T>(
  items: readonly T[],
  n: number,
  groupKeyFn: (item: T) => string,
  seed: number,
): T[] {
  if (n >= items.length) {
    return [...items];
  }
  if (n <= 0) {
    return [];
  }

  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = groupKeyFn(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  const rand = mulberry32(seed);
  const keys = [...groups.keys()];
  const groupSizes = keys.map((key) => groups.get(key)!.length);
  const exactShares = groupSizes.map((size) => (size / items.length) * n);
  const counts = exactShares.map(Math.floor);
  let allocated = counts.reduce((sum, c) => sum + c, 0);

  // Largest-remainder method: hand out the leftover slots to the groups whose
  // fractional share was closest to rounding up, in that order.
  const remainders = exactShares.map((share, i) => share - (counts[i] as number));
  const byRemainderDesc = keys
    .map((_, i) => i)
    .sort((a, b) => (remainders[b] as number) - (remainders[a] as number));

  for (const i of byRemainderDesc) {
    if (allocated >= n) break;
    if ((counts[i] as number) < (groupSizes[i] as number)) {
      counts[i] = (counts[i] as number) + 1;
      allocated += 1;
    }
  }
  // Fallback for any still-unallocated slots (only possible when rounding
  // leaves a shortfall larger than the number of groups with spare capacity,
  // which largest-remainder normally avoids but isn't guaranteed to when many
  // groups are already fully allocated): fill from any group with room left.
  let guard = 0;
  while (allocated < n && guard < keys.length * 2) {
    for (let i = 0; i < keys.length && allocated < n; i++) {
      if ((counts[i] as number) < (groupSizes[i] as number)) {
        counts[i] = (counts[i] as number) + 1;
        allocated += 1;
      }
    }
    guard += 1;
  }

  const result: T[] = [];
  keys.forEach((key, i) => {
    const group = shuffle([...groups.get(key)!], rand);
    result.push(...group.slice(0, counts[i] as number));
  });

  return shuffle(result, rand);
}
