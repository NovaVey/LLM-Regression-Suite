// Written from the interface contract handed down for this phase:
//
//   function stratifiedSample<T>(items: T[], n: number,
//     groupKeyFn: (item: T) => string, seed: number): T[]
//
//   "Deterministic stratified sample: groups `items` by `groupKeyFn(item)`,
//   then draws roughly proportional to each group's share of the total,
//   seeded so the same seed always returns the same sample. Returns
//   exactly n items (or all of them if n >= items.length). Used later
//   (Phase 5) to draw a stratified calibration sample across tags/score-
//   range per §5.5."
//
// and from §5.5 itself: "Sample 100-300 real outputs from the suite,
// stratified across score range and tags" -- a human then labels each
// sampled output by hand, which is the concrete reason stratification (as
// opposed to plain random sampling) matters here: a plain random sample of
// 20-300 from a suite where one tag is rare has a real, non-negligible
// chance of drawing zero examples of that tag, and a judge calibrated on
// zero examples of "refunds" cases tells you nothing about how the judge
// behaves on refunds.
//
// `packages/core/src/dataset/split.ts` was confirmed EMPTY before writing
// this file and was not read.
//
// ---------------------------------------------------------------------
// AMBIGUITY / inference flagged
// ---------------------------------------------------------------------
// The contract does not say explicitly whether sampling is with or
// without replacement. I infer "without replacement" from purpose alone:
// §5.5's calibration sample is handed to a human labeler one output at a
// time ("a human labels them with the same rubric the judge receives");
// a duplicate entry in that set would waste labeling effort for no
// benefit and there is no stated use case (e.g. bootstrap resampling)
// that would want replacement here -- bootstrap resampling is a distinct,
// separately-specified mechanism in §5.2 operating on score differences,
// not on cases. `stratified-sample-never-returns-duplicate-items` below
// encodes this inference explicitly; if the real design intends sampling
// with replacement, that test (and only that test) is wrong, not the
// rest of this file, and is worth flagging back rather than silently
// dropping.

import { describe, it, expect } from 'vitest';
import { stratifiedSample } from '../../src/dataset/split.js';

interface Item {
  id: number;
  group: string;
}

function makeGroupedItems(counts: Record<string, number>): Item[] {
  const items: Item[] = [];
  let id = 0;
  for (const [group, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      items.push({ id: id++, group });
    }
  }
  return items;
}

const byGroup = (item: Item) => item.group;

describe('stratified-sample-returns-exactly-n-items-when-n-is-below-the-population-size', () => {
  it('stratified-sample-returns-exactly-n-items-when-n-is-below-the-population-size', () => {
    const items = makeGroupedItems({ a: 20, b: 20, c: 20, d: 20, e: 20 }); // 100 total
    const result = stratifiedSample(items, 30, byGroup, 1);
    expect(result).toHaveLength(30);
    // Every returned item must actually be one of the input items (a
    // buggy implementation could fabricate placeholders to pad length).
    const inputIds = new Set(items.map((i) => i.id));
    for (const r of result) {
      expect(inputIds.has(r.id)).toBe(true);
    }
  });

  it('works for a small n such as 1', () => {
    const items = makeGroupedItems({ a: 5, b: 5 });
    const result = stratifiedSample(items, 1, byGroup, 1);
    expect(result).toHaveLength(1);
  });
});

describe('stratified-sample-returns-every-item-when-n-meets-or-exceeds-the-population-size', () => {
  it('returns all items when n exactly equals the population size', () => {
    const items = makeGroupedItems({ a: 5, b: 5, c: 5 }); // 15 total
    const result = stratifiedSample(items, 15, byGroup, 1);
    expect(result).toHaveLength(15);
    expect(new Set(result.map((i) => i.id))).toEqual(new Set(items.map((i) => i.id)));
  });

  it('returns all items when n exceeds the population size', () => {
    const items = makeGroupedItems({ a: 5, b: 5, c: 5 }); // 15 total
    const result = stratifiedSample(items, 1000, byGroup, 1);
    expect(result).toHaveLength(15);
    expect(new Set(result.map((i) => i.id))).toEqual(new Set(items.map((i) => i.id)));
  });
});

describe('stratified-sample-is-deterministic-for-a-fixed-seed', () => {
  it('stratified-sample-is-deterministic-for-a-fixed-seed', () => {
    const items = makeGroupedItems({ a: 10, b: 10, c: 10 }); // 30 total
    const first = stratifiedSample(items, 12, byGroup, 42);
    const second = stratifiedSample(items, 12, byGroup, 42);
    expect(second).toEqual(first);
  });

  it('is deterministic across several distinct seeds, not just one', () => {
    // Guards against an implementation that happens to be stable for seed
    // 42 by coincidence (e.g. because it ignores the seed and always
    // iterates items in insertion order) but isn't actually seeded.
    const items = makeGroupedItems({ a: 10, b: 10, c: 10 });
    for (const seed of [1, 2, 3, 7, 99]) {
      const first = stratifiedSample(items, 12, byGroup, seed);
      const second = stratifiedSample(items, 12, byGroup, seed);
      expect(second).toEqual(first);
    }
  });
});

describe('a-rare-group-is-not-silently-dropped-from-a-stratified-sample', () => {
  it('a-rare-group-is-not-silently-dropped-from-a-stratified-sample', () => {
    // The exact scenario stratification exists to prevent: group "rare" is
    // 5% of the population. A naive uniform-random sample of 20 out of
    // 100 has real probability of drawing zero "rare" items --
    // P(zero rare items) = C(95,20)/C(100,20) ≈ (0.80)^5 ≈ 0.33 under a
    // simple hypergeometric approximation, i.e. roughly a 1-in-3 chance a
    // naive sampler misses the group entirely. A stratified sampler must
    // not have that failure mode: with a 5% share and n=20, the
    // proportional allocation for "rare" is exactly 1 (0.05 * 20 = 1), so
    // it must appear in the sample every time, for every seed.
    const items = makeGroupedItems({ rare: 5, common: 95 }); // 100 total
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const result = stratifiedSample(items, 20, byGroup, seed);
      expect(result).toHaveLength(20);
      const rareCount = result.filter((r) => r.group === 'rare').length;
      expect(rareCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('the rare group is not over-represented either -- allocation is proportional, not equal-per-group', () => {
    // A different bug in the opposite direction: an implementation that
    // over-corrects by giving every group an equal share (e.g. n/2 to
    // "rare" and n/2 to "common") would also fail to reflect "roughly
    // proportional to each group's share." With a 5% share and n=20, the
    // "rare" group should get on the order of 1 item, not 10.
    const items = makeGroupedItems({ rare: 5, common: 95 });
    for (const seed of [1, 2, 3]) {
      const result = stratifiedSample(items, 20, byGroup, seed);
      const rareCount = result.filter((r) => r.group === 'rare').length;
      expect(rareCount).toBeLessThan(5); // less than half of "common"'s expected ~19
    }
  });
});

describe('stratified-sample-never-returns-duplicate-items', () => {
  it('stratified-sample-never-returns-duplicate-items', () => {
    // See file-level ambiguity note: inferred from purpose (a human-labeled
    // calibration sample), not stated explicitly in the contract.
    const items = makeGroupedItems({ a: 5, b: 95 });
    const result = stratifiedSample(items, 20, byGroup, 1);
    const ids = result.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
