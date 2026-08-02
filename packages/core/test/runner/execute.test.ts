// Written from:
//   - §5.7: "The cache is keyed so that only relevant edits invalidate...
//     Re-running an unchanged baseline against a changed candidate hits
//     cache on every baseline case... Cache is opt-out per run (--no-cache)
//     and reports hit rate in the run summary, because a silently-stale
//     cache would be the worst possible bug in a tool whose entire job is
//     detecting change."
//   - §5.3: "Repeat sampling for non-deterministic targets... run each case
//     k times (default 3), average the per-case scores, and pair on the
//     averaged score... Record sample_index so the raw runs stay
//     inspectable."
//   - §5.1: "A case that errored on one side is excluded from the
//     comparison and reported separately as an error, never silently
//     scored zero." Applied at the runner layer per §9 Phase 3's exit
//     criterion: "a single case erroring does not fail the run and is
//     reported as an error, not a zero."
//   - §9 Phase 3: "Concurrent execution with MAX_CONCURRENCY, response
//     cache per §5.7, retries with backoff, error isolation per case."
//   - The interface contract handed down for this phase: `executeRun`,
//     `ExecuteRunOptions`, `CaseExecutionResult`, `CacheStore`,
//     `TargetCaller`, `RunVariant`, `GradedSample`, `AveragedCaseScore`,
//     `averagePerCaseScores` -- reproduced verbatim in the task brief,
//     including the exact fallback defaults (`sampleCount` default 1,
//     `useCache` default true) and the exact cache-key input shape
//     (`{model, temperature, promptHash, input: case.input, sampleIndex}`).
//
// `packages/core/src/runner/{execute,cache,concurrency}.ts` were NOT read
// before writing this file. Fakes (`CacheStore`, `TargetCaller`) are
// injected per the contract so nothing here touches a real database or a
// real API key. Every expected value below is derived from the contract
// text quoted above, not from observing what the implementation currently
// does.
//
// ---------------------------------------------------------------------
// AMBIGUITY noted, not silently resolved
// ---------------------------------------------------------------------
// The contract says a thrown error's result has "error=<the thrown error's
// message>" but doesn't specify behavior when `targetCaller` throws a
// non-Error value (a bare string, an object with no `.message`). "Of any
// kind" in the prose suggests every kind of throw must be caught and
// isolated, but the *message extraction* rule as written presumes an Error
// instance. To avoid asserting a specific coercion rule the contract never
// actually commits to, the tests below only exercise `Error` throws (the
// case the contract's message-extraction text unambiguously covers) and
// assert isolation/non-abort behavior, which the "of any kind" wording does
// commit to regardless of what was thrown.

import { describe, it, expect } from 'vitest';
import {
  executeRun,
  averagePerCaseScores,
  type CacheStore,
  type CachedEntry,
  type TargetCaller,
  type RunVariant,
  type GradedSample,
} from '../../src/runner/execute.js';
import { computeCacheKey } from '../../src/runner/cache.js';
import type { Case } from '../../src/dataset/schema.js';

function makeCase(i: number, content?: string): Case {
  return {
    externalId: `case-${i}`,
    input: { messages: [{ role: 'user', content: content ?? `input content ${i}` }] },
    expected: null,
    tags: [],
    critical: false,
    criticalReason: null,
  };
}

function makeCases(n: number): Case[] {
  return Array.from({ length: n }, (_, i) => makeCase(i));
}

function makeFakeCacheStore(): CacheStore & { map: Map<string, CachedEntry> } {
  const map = new Map<string, CachedEntry>();
  return {
    map,
    async get(cacheKey: string) {
      return map.get(cacheKey) ?? null;
    },
    async put(cacheKey: string, _model: string, entry: CachedEntry) {
      map.set(cacheKey, entry);
    },
  };
}

/** A TargetCaller that counts invocations and returns a fresh output each time. */
function makeCountingCaller(): { caller: TargetCaller; state: { count: number } } {
  const state = { count: 0 };
  const caller: TargetCaller = async () => {
    state.count += 1;
    return { output: `output-${state.count}`, latencyMs: 5, inputTokens: 1, outputTokens: 1 };
  };
  return { caller, state };
}

const baseVariant: RunVariant = { model: 'claude-sonnet-5', temperature: 0, promptHash: 'hash-a' };

// ===========================================================================
// an-identical-rerun-is-served-entirely-from-cache
// ===========================================================================

describe('an-identical-rerun-is-served-entirely-from-cache', () => {
  it('an-identical-rerun-is-served-entirely-from-cache', async () => {
    const cacheStore = makeFakeCacheStore();
    const { caller, state } = makeCountingCaller();
    const cases = makeCases(3);

    // First run: cache is empty, every (case, sample) pair must call
    // targetCaller. useCache is left at its documented default (true).
    const first = await executeRun({
      cases,
      variant: baseVariant,
      maxConcurrency: 2,
      sampleCount: 2, // exercise the (case x sample) framing, not just per-case
      cacheStore,
      targetCaller: caller,
    });
    const totalPairs = cases.length * 2;
    expect(first.results).toHaveLength(totalPairs);
    expect(state.count).toBe(totalPairs);
    expect(first.cacheHits).toBe(0);

    // Second run: identical cases, identical variant, same cache store
    // instance. Every pair must be served from cache.
    const second = await executeRun({
      cases,
      variant: baseVariant,
      maxConcurrency: 2,
      sampleCount: 2,
      cacheStore,
      targetCaller: caller,
    });

    expect(second.cacheHits).toBe(totalPairs);
    expect(state.count).toBe(totalPairs); // no additional calls to targetCaller
    for (const r of second.results) {
      expect(r.fromCache).toBe(true);
      expect(r.error).toBeNull();
    }
  });
});

// ===========================================================================
// editing-the-prompt-invalidates-exactly-the-affected-cache-entries
// ===========================================================================

describe('editing-the-prompt-invalidates-exactly-the-affected-cache-entries', () => {
  it('editing-the-prompt-invalidates-exactly-the-affected-cache-entries', async () => {
    const cacheStore = makeFakeCacheStore();
    const { caller, state } = makeCountingCaller();
    const cases = makeCases(3);
    const variantA: RunVariant = { model: 'claude-sonnet-5', temperature: 0, promptHash: 'hash-original' };
    const variantB: RunVariant = { model: 'claude-sonnet-5', temperature: 0, promptHash: 'hash-edited' };

    // Run 1: populate the cache under the original prompt hash.
    const run1 = await executeRun({
      cases,
      variant: variantA,
      maxConcurrency: 2,
      cacheStore,
      targetCaller: caller,
    });
    expect(run1.cacheHits).toBe(0);
    const callsAfterRun1 = state.count;
    expect(callsAfterRun1).toBe(3);

    // Confirm exactly the 3 expected keys are present, using the
    // independently-tested computeCacheKey to compute them.
    const keysA = cases.map((c) =>
      computeCacheKey({ model: variantA.model, temperature: variantA.temperature, promptHash: variantA.promptHash, input: c.input, sampleIndex: 0 }),
    );
    expect(cacheStore.map.size).toBe(3);
    for (const k of keysA) expect(cacheStore.map.has(k)).toBe(true);

    // Run 2: same cases, same model/temperature, DIFFERENT prompt hash
    // (the "prompt was edited" scenario). Every case must miss.
    const run2 = await executeRun({
      cases,
      variant: variantB,
      maxConcurrency: 2,
      cacheStore,
      targetCaller: caller,
    });
    expect(run2.cacheHits).toBe(0);
    expect(state.count).toBe(callsAfterRun1 + 3); // all 3 recomputed, nothing served stale

    // The original entries must still be present and untouched -- editing
    // the prompt must not have evicted them, only failed to match them.
    expect(cacheStore.map.size).toBe(6);
    for (const k of keysA) expect(cacheStore.map.has(k)).toBe(true);

    // Run 3: revert to the original prompt hash, same cache store. This
    // proves run 1's entries are genuinely still intact and reachable, not
    // just present-but-corrupted.
    const run3 = await executeRun({
      cases,
      variant: variantA,
      maxConcurrency: 2,
      cacheStore,
      targetCaller: caller,
    });
    expect(run3.cacheHits).toBe(3);
    expect(state.count).toBe(callsAfterRun1 + 3); // no new calls -- served from the original entries
  });
});

// ===========================================================================
// one-failing-case-does-not-abort-the-run
// ===========================================================================

describe('one-failing-case-does-not-abort-the-run', () => {
  it('one-failing-case-does-not-abort-the-run', async () => {
    const cases = makeCases(5);
    const failingCase = cases[2]!;
    const failingContent = failingCase.input.messages[0]!.content;

    const caller: TargetCaller = async (messages) => {
      if (messages[0]?.content === failingContent) {
        throw new Error('simulated upstream failure for this case');
      }
      return { output: 'ok', latencyMs: 3, inputTokens: 1, outputTokens: 1 };
    };

    // Executing must resolve, not reject -- if it threw, this `await` would
    // throw and fail the test.
    const result = await executeRun({
      cases,
      variant: baseVariant,
      maxConcurrency: 3,
      useCache: false,
      targetCaller: caller,
    });

    expect(result.results).toHaveLength(5);

    const failing = result.results.find((r) => r.externalId === failingCase.externalId);
    expect(failing).toBeDefined();
    expect(failing?.error).toBe('simulated upstream failure for this case');
    expect(failing?.output).toBeNull();

    const others = result.results.filter((r) => r.externalId !== failingCase.externalId);
    expect(others).toHaveLength(4);
    for (const r of others) {
      expect(r.error).toBeNull();
      expect(r.output).toBe('ok');
    }
  });

  it('a-cases-error-does-not-poison-the-cache-entry-for-a-different-case', async () => {
    // Companion check: the one case that failed must not have written a
    // cache entry (there is nothing successful to cache), while the
    // succeeding cases' entries are present and correct. This uses
    // computeCacheKey directly rather than re-deriving the format.
    const cacheStore = makeFakeCacheStore();
    const cases = makeCases(3);
    const failingCase = cases[1]!;
    const failingContent = failingCase.input.messages[0]!.content;

    const caller: TargetCaller = async (messages) => {
      if (messages[0]?.content === failingContent) {
        throw new Error('boom');
      }
      return { output: 'fine', latencyMs: 1, inputTokens: 1, outputTokens: 1 };
    };

    await executeRun({ cases, variant: baseVariant, maxConcurrency: 3, cacheStore, targetCaller: caller });

    const failingKey = computeCacheKey({
      model: baseVariant.model,
      temperature: baseVariant.temperature,
      promptHash: baseVariant.promptHash,
      input: failingCase.input,
      sampleIndex: 0,
    });
    expect(cacheStore.map.has(failingKey)).toBe(false);
    expect(cacheStore.map.size).toBe(2); // the two succeeding cases only
  });
});

// ===========================================================================
// repeat-sampling-averages-per-case-before-pairing
// ===========================================================================

describe('repeat-sampling-averages-per-case-before-pairing', () => {
  it('each-sample-index-is-computed-and-cached-independently-not-collapsed-onto-one-entry', async () => {
    // Part (a) of the spec item: sampleCount x cases produces that many
    // independently-computed CaseExecutionResults. If sampleIndex were
    // dropped from the cache key, samples 1 and 2 for a case would
    // (wrongly) hit the cache entry sample 0 just wrote, and the counting
    // caller would be invoked far fewer than (cases x samples) times.
    const cases = makeCases(2);
    const cacheStore = makeFakeCacheStore();
    const { caller, state } = makeCountingCaller();

    const first = await executeRun({
      cases,
      variant: baseVariant,
      maxConcurrency: 4,
      sampleCount: 3,
      cacheStore,
      targetCaller: caller,
    });

    expect(first.results).toHaveLength(6); // 2 cases x 3 samples
    expect(state.count).toBe(6); // one real call per (case, sample) pair
    expect(first.cacheHits).toBe(0);

    for (const c of cases) {
      const sampleIndices = first.results
        .filter((r) => r.externalId === c.externalId)
        .map((r) => r.sampleIndex)
        .sort((a, b) => a - b);
      expect(sampleIndices).toEqual([0, 1, 2]);
    }

    // Rerunning the same (cases, variant, sampleCount) must hit cache on
    // all 6 pairs -- proving each sample_index really did get its own,
    // independently addressable cache entry the first time around.
    const second = await executeRun({
      cases,
      variant: baseVariant,
      maxConcurrency: 4,
      sampleCount: 3,
      cacheStore,
      targetCaller: caller,
    });
    expect(second.cacheHits).toBe(6);
    expect(state.count).toBe(6); // no new calls
  });

  it('averagePerCaseScores-averages-the-groups-numeric-scores-per-the-spec-example', () => {
    // The exact scenario named in the task brief: case "a" gets 3 samples
    // scoring [1, 1, 0]; case "b" gets 1 sample scoring 0.
    const samples: GradedSample[] = [
      { externalId: 'a', sampleIndex: 0, score: 1, passed: true },
      { externalId: 'a', sampleIndex: 1, score: 1, passed: true },
      { externalId: 'a', sampleIndex: 2, score: 0, passed: false },
      { externalId: 'b', sampleIndex: 0, score: 0, passed: false },
    ];

    const averaged = averagePerCaseScores(samples);
    const a = averaged.find((r) => r.externalId === 'a');
    const b = averaged.find((r) => r.externalId === 'b');

    expect(a).toBeDefined();
    expect(a?.sampleCount).toBe(3);
    expect(a?.score).toBeCloseTo(2 / 3, 6);
    expect(a?.passed).toBe(true); // 0.667 >= 0.5

    expect(b).toBeDefined();
    expect(b?.sampleCount).toBe(1);
    expect(b?.score).toBe(0);
    expect(b?.passed).toBe(false);
  });

  it('a-case-whose-averaged-score-is-below-half-fails-even-when-most-individual-samples-passed', () => {
    // This is the test that actually distinguishes "average the scores,
    // then threshold" from "vote across the samples' own `passed` flags" --
    // the spec's own [1,1,0] example happens to agree under both readings
    // (2-of-3 individually-passed AND a 0.667 average both cross 0.5), so it
    // alone cannot prove the implementation isn't voting. Here the flags and
    // the scores are constructed to disagree: two samples individually
    // marked passed=true (scores 0.6 each) and one marked passed=false
    // (score 0.0). A majority vote of the flags says 2-of-3 pass -> passed.
    // The mean of the actual scores is (0.6+0.6+0.0)/3 = 0.4, which is
    // BELOW the 0.5 threshold -> the averaged case must be `passed: false`.
    const samples: GradedSample[] = [
      { externalId: 'c', sampleIndex: 0, score: 0.6, passed: true },
      { externalId: 'c', sampleIndex: 1, score: 0.6, passed: true },
      { externalId: 'c', sampleIndex: 2, score: 0.0, passed: false },
    ];

    const [c] = averagePerCaseScores(samples);
    expect(c?.sampleCount).toBe(3);
    expect(c?.score).toBeCloseTo(0.4, 6);
    expect(c?.passed).toBe(false); // NOT true, which a vote-of-flags would produce
  });

  it('groups-by-externalId-regardless-of-input-order-and-preserves-each-groups-full-sample-count', () => {
    const samples: GradedSample[] = [
      { externalId: 'z', sampleIndex: 0, score: 0.2, passed: false },
      { externalId: 'y', sampleIndex: 0, score: 1, passed: true },
      { externalId: 'z', sampleIndex: 1, score: 0.8, passed: true },
    ];
    const averaged = averagePerCaseScores(samples);
    expect(averaged).toHaveLength(2);
    const z = averaged.find((r) => r.externalId === 'z');
    const y = averaged.find((r) => r.externalId === 'y');
    expect(z?.sampleCount).toBe(2);
    expect(z?.score).toBeCloseTo(0.5, 6);
    expect(y?.sampleCount).toBe(1);
    expect(y?.score).toBe(1);
  });
});

// ===========================================================================
// Bonus coverage beyond the four named items -- each derived directly from
// contract text quoted at the top of the file.
// ===========================================================================

describe('cache-is-opt-out-per-run-per-5-7', () => {
  it('useCache-false-serves-nothing-from-a-populated-cache-and-writes-nothing-back', async () => {
    // §5.7: "Cache is opt-out per run (--no-cache)."
    const cacheStore = makeFakeCacheStore();
    const { caller, state } = makeCountingCaller();
    const cases = makeCases(2);

    // Populate the cache normally first.
    await executeRun({ cases, variant: baseVariant, maxConcurrency: 2, cacheStore, targetCaller: caller });
    expect(state.count).toBe(2);
    expect(cacheStore.map.size).toBe(2);

    // Now rerun the identical scenario with useCache explicitly false.
    const result = await executeRun({
      cases,
      variant: baseVariant,
      maxConcurrency: 2,
      useCache: false,
      cacheStore,
      targetCaller: caller,
    });

    expect(result.cacheHits).toBe(0);
    expect(state.count).toBe(4); // both cases recomputed, cache was not consulted
    for (const r of result.results) {
      expect(r.fromCache).toBe(false);
    }
  });
});

describe('executeRun-defaults', () => {
  it('sampleCount-defaults-to-one-sample-per-case', async () => {
    const cases = makeCases(3);
    const { caller } = makeCountingCaller();
    const result = await executeRun({
      cases,
      variant: baseVariant,
      maxConcurrency: 2,
      useCache: false,
      targetCaller: caller,
    });
    expect(result.results).toHaveLength(3);
    for (const r of result.results) {
      expect(r.sampleIndex).toBe(0);
    }
  });

  it('useCache-defaults-to-true-when-a-cache-store-is-provided', async () => {
    const cacheStore = makeFakeCacheStore();
    const { caller, state } = makeCountingCaller();
    const cases = makeCases(2);

    // useCache intentionally omitted on both calls.
    await executeRun({ cases, variant: baseVariant, maxConcurrency: 2, cacheStore, targetCaller: caller });
    const rerun = await executeRun({ cases, variant: baseVariant, maxConcurrency: 2, cacheStore, targetCaller: caller });

    expect(rerun.cacheHits).toBe(2);
    expect(state.count).toBe(2);
  });
});

describe('the-target-caller-receives-the-variants-model-temperature-and-system-prompt', () => {
  it('the-target-caller-receives-the-variants-model-temperature-and-system-prompt', async () => {
    const variant: RunVariant = {
      model: 'claude-sonnet-5',
      temperature: 0,
      promptHash: 'hash-x',
      systemPrompt: 'You are a helpful support agent.',
    };
    const cases = makeCases(1);
    const calls: Array<{ model: string; temperature: number; systemPrompt: string | undefined }> = [];
    const caller: TargetCaller = async (_messages, model, temperature, options) => {
      calls.push({ model, temperature, systemPrompt: options?.systemPrompt });
      return { output: 'x', latencyMs: 1, inputTokens: 1, outputTokens: 1 };
    };

    await executeRun({ cases, variant, maxConcurrency: 1, useCache: false, targetCaller: caller });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe('claude-sonnet-5');
    expect(calls[0]?.temperature).toBe(0);
    expect(calls[0]?.systemPrompt).toBe('You are a helpful support agent.');
  });
});

describe('executeRun-never-exceeds-maxConcurrency-in-flight-target-calls', () => {
  it('executeRun-never-exceeds-maxConcurrency-in-flight-target-calls', async () => {
    const limit = 3;
    const cases = makeCases(9);
    let inFlight = 0;
    let maxInFlight = 0;

    const caller: TargetCaller = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return { output: 'ok', latencyMs: 1, inputTokens: 1, outputTokens: 1 };
    };

    await executeRun({ cases, variant: baseVariant, maxConcurrency: limit, useCache: false, targetCaller: caller });

    expect(maxInFlight).toBeLessThanOrEqual(limit);
    // Also confirm concurrency is actually being used, not silently
    // serialized down to 1 -- a limit that's "respected" only because
    // nothing ever runs in parallel would be a different (also bad) bug.
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
