// Written from spec §5.1 ("Comparison is paired, always") and the interface
// contract handed down for Phase 4, WITHOUT reading src/comparison/pairing.ts
// (implemented concurrently by a different agent).
//
// §5.1: "Both variants run every case in the dataset, and the statistic is
// computed on the per-case difference d_i = score_candidate(i) -
// score_baseline(i)... Only cases with a valid result in both runs enter the
// comparison. A case that errored on one side is excluded from the statistic
// and reported separately as an error, never silently scored zero --
// scoring an infrastructure timeout as a quality failure is how a flaky
// network becomes a 'regression.'"
//
// Interface contract (given, not read from src):
//   interface CaseOutcome { externalId; critical; score: number|null; passed: boolean|null }
//     -- score/passed are null iff the case errored on that side.
//   interface PairedCase { externalId; critical; baselineScore; candidateScore;
//     baselinePassed; candidatePassed; difference }
//     -- difference = candidateScore - baselineScore, per §5.1's d_i formula.
//   type ExclusionReason = 'errored-baseline' | 'errored-candidate' |
//     'errored-both' | 'missing-baseline' | 'missing-candidate'
//   interface Exclusion { externalId; reason }
//   interface PairingResult { paired: PairedCase[]; excluded: Exclusion[] }
//   function pairCases(baseline: CaseOutcome[], candidate: CaseOutcome[]): PairingResult
//     -- "Only a case with a non-null score on BOTH sides enters `paired`.
//        Every case that fails that bar appears exactly once in `excluded`
//        with the correct reason. A case's own externalId must never appear
//        in both paired and excluded."
//
// ---------------------------------------------------------------------
// No unresolved ambiguity in this file beyond what's already flagged in the
// task brief: the naming convention itself makes both "missing" reasons
// unambiguous ('missing-baseline' = absent from the baseline list even
// though present in candidate's, and vice versa), and is distinguished
// cleanly from the 'errored-*' reasons (present on both sides as a list
// entry, but score is null on one/both sides -- an infra failure, not an
// absence).
// ---------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { pairCases, type CaseOutcome, type Exclusion } from '../../src/comparison/pairing.js';

function outcome(externalId: string, overrides: Partial<CaseOutcome> = {}): CaseOutcome {
  return {
    externalId,
    critical: false,
    score: 0.8,
    passed: true,
    ...overrides,
  };
}

function findExclusion(excluded: Exclusion[], externalId: string): Exclusion | undefined {
  return excluded.find((e) => e.externalId === externalId);
}

// ===========================================================================
// a-case-that-errored-on-one-side-is-excluded-not-scored-zero
// ===========================================================================

describe('a-case-that-errored-on-one-side-is-excluded-not-scored-zero', () => {
  it('an-error-on-the-baseline-side-excludes-the-case-with-reason-errored-baseline-never-entering-paired-with-an-implied-zero', () => {
    const baseline: CaseOutcome[] = [
      outcome('healthy-1'),
      outcome('errored-case', { score: null, passed: null }),
      outcome('healthy-2'),
    ];
    const candidate: CaseOutcome[] = [
      outcome('healthy-1'),
      outcome('errored-case', { score: 0.9, passed: true }), // succeeded on this side
      outcome('healthy-2'),
    ];

    const { paired, excluded } = pairCases(baseline, candidate);

    const ex = findExclusion(excluded, 'errored-case');
    expect(ex).toBeDefined();
    expect(ex?.reason).toBe('errored-baseline');

    // Must NOT appear in paired at all -- specifically, no entry with
    // baselineScore silently defaulted to 0.
    expect(paired.some((p) => p.externalId === 'errored-case')).toBe(false);
    expect(paired).toHaveLength(2);
    expect(excluded).toHaveLength(1);
  });

  it('an-error-on-the-candidate-side-excludes-the-case-with-reason-errored-candidate-never-entering-paired-with-an-implied-zero', () => {
    const baseline: CaseOutcome[] = [
      outcome('healthy-1'),
      outcome('errored-case', { score: 0.7, passed: true }), // succeeded on this side
      outcome('healthy-2'),
    ];
    const candidate: CaseOutcome[] = [
      outcome('healthy-1'),
      outcome('errored-case', { score: null, passed: null }),
      outcome('healthy-2'),
    ];

    const { paired, excluded } = pairCases(baseline, candidate);

    const ex = findExclusion(excluded, 'errored-case');
    expect(ex).toBeDefined();
    expect(ex?.reason).toBe('errored-candidate');
    expect(paired.some((p) => p.externalId === 'errored-case')).toBe(false);
    expect(paired).toHaveLength(2);
    expect(excluded).toHaveLength(1);
  });

  it('an-error-on-both-sides-excludes-the-case-with-reason-errored-both', () => {
    const baseline: CaseOutcome[] = [outcome('both-errored', { score: null, passed: null })];
    const candidate: CaseOutcome[] = [outcome('both-errored', { score: null, passed: null })];

    const { paired, excluded } = pairCases(baseline, candidate);

    expect(paired).toHaveLength(0);
    expect(excluded).toHaveLength(1);
    expect(excluded[0]?.reason).toBe('errored-both');
  });
});

// ===========================================================================
// only-cases-present-in-both-runs-enter-the-statistic
// ===========================================================================

describe('only-cases-present-in-both-runs-enter-the-statistic', () => {
  it('a-case-present-only-in-candidates-list-is-excluded-with-reason-missing-baseline', () => {
    const baseline: CaseOutcome[] = [outcome('shared-1'), outcome('shared-2')];
    const candidate: CaseOutcome[] = [outcome('shared-1'), outcome('shared-2'), outcome('candidate-only')];

    const { paired, excluded } = pairCases(baseline, candidate);

    const ex = findExclusion(excluded, 'candidate-only');
    expect(ex).toBeDefined();
    expect(ex?.reason).toBe('missing-baseline');
    expect(paired.some((p) => p.externalId === 'candidate-only')).toBe(false);
    expect(paired).toHaveLength(2);
  });

  it('a-case-present-only-in-baselines-list-is-excluded-with-reason-missing-candidate', () => {
    const baseline: CaseOutcome[] = [outcome('shared-1'), outcome('shared-2'), outcome('baseline-only')];
    const candidate: CaseOutcome[] = [outcome('shared-1'), outcome('shared-2')];

    const { paired, excluded } = pairCases(baseline, candidate);

    const ex = findExclusion(excluded, 'baseline-only');
    expect(ex).toBeDefined();
    expect(ex?.reason).toBe('missing-candidate');
    expect(paired.some((p) => p.externalId === 'baseline-only')).toBe(false);
    expect(paired).toHaveLength(2);
  });

  it('pairedCaseCount-downstream-only-counts-cases-genuinely-double-present-and-double-valid', async () => {
    // Integration check across the pairing/statistics boundary: everything
    // that isn't a clean, valid, double-present case must be excluded
    // BEFORE it can inflate pairedCaseCount in the comparison stats.
    const { computeComparison } = await import('../../src/comparison/statistics.js');

    const baseline: CaseOutcome[] = [
      outcome('ok-1'),
      outcome('ok-2'),
      outcome('baseline-only'), // missing from candidate
      outcome('errored-on-candidate', { score: 0.5, passed: true }),
    ];
    const candidate: CaseOutcome[] = [
      outcome('ok-1'),
      outcome('ok-2'),
      outcome('candidate-only'), // missing from baseline
      outcome('errored-on-candidate', { score: null, passed: null }),
    ];

    const { paired } = pairCases(baseline, candidate);
    expect(paired).toHaveLength(2); // only ok-1 and ok-2 qualify

    const stats = computeComparison({
      paired,
      alpha: 0.05,
      mdeCeiling: 1,
      minPairedN: 1,
      bootstrapIterations: 200,
    });
    expect(stats.pairedCaseCount).toBe(2);
  });
});

// ===========================================================================
// A case's own externalId must never appear in both paired and excluded --
// stated explicitly in the interface contract, and load-bearing enough
// (a case double-counted as both valid evidence and an error would corrupt
// both the statistic and the error report) to deserve its own invariant
// check across a fixture that exercises every branch at once.
// ===========================================================================

describe('a-cases-own-externalId-never-appears-in-both-paired-and-excluded', () => {
  it('every-case-across-a-mixed-fixture-is-accounted-for-exactly-once', () => {
    const baseline: CaseOutcome[] = [
      outcome('valid-1'),
      outcome('valid-2'),
      outcome('err-baseline', { score: null, passed: null }),
      outcome('err-candidate', { score: 0.6, passed: true }),
      outcome('err-both', { score: null, passed: null }),
      outcome('baseline-only'),
      // 'candidate-only' intentionally absent from baseline
    ];
    const candidate: CaseOutcome[] = [
      outcome('valid-1'),
      outcome('valid-2'),
      outcome('err-baseline', { score: 0.6, passed: true }),
      outcome('err-candidate', { score: null, passed: null }),
      outcome('err-both', { score: null, passed: null }),
      // 'baseline-only' intentionally absent from candidate
      outcome('candidate-only'),
    ];

    const { paired, excluded } = pairCases(baseline, candidate);

    const allIds = [
      'valid-1',
      'valid-2',
      'err-baseline',
      'err-candidate',
      'err-both',
      'baseline-only',
      'candidate-only',
    ];

    for (const id of allIds) {
      const inPaired = paired.some((p) => p.externalId === id);
      const inExcluded = excluded.filter((e) => e.externalId === id);
      // Exactly one of paired/excluded, never both, never neither, never
      // duplicated within excluded.
      expect(inExcluded.length).toBeLessThanOrEqual(1);
      expect(inPaired && inExcluded.length === 1).toBe(false);
      expect(inPaired || inExcluded.length === 1).toBe(true);
    }

    expect(paired).toHaveLength(2);
    expect(excluded).toHaveLength(5);
    expect(findExclusion(excluded, 'err-baseline')?.reason).toBe('errored-baseline');
    expect(findExclusion(excluded, 'err-candidate')?.reason).toBe('errored-candidate');
    expect(findExclusion(excluded, 'err-both')?.reason).toBe('errored-both');
    expect(findExclusion(excluded, 'baseline-only')?.reason).toBe('missing-candidate');
    expect(findExclusion(excluded, 'candidate-only')?.reason).toBe('missing-baseline');
  });
});

// ===========================================================================
// difference = candidate - baseline, never the reverse. Getting this sign
// backwards is not a cosmetic bug: it would report every regression as an
// improvement and vice versa throughout the rest of the pipeline. Derived
// directly from §5.1's formula, d_i = score_candidate(i) - score_baseline(i).
// ===========================================================================

describe('pairing-computes-the-difference-as-candidate-minus-baseline-never-the-reverse', () => {
  it('a-candidate-score-higher-than-baseline-yields-a-positive-difference', () => {
    const baseline: CaseOutcome[] = [outcome('improved', { score: 0.3 })];
    const candidate: CaseOutcome[] = [outcome('improved', { score: 0.9 })];

    const { paired } = pairCases(baseline, candidate);
    expect(paired[0]?.difference).toBeCloseTo(0.6, 10);
  });

  it('a-candidate-score-lower-than-baseline-yields-a-negative-difference', () => {
    const baseline: CaseOutcome[] = [outcome('regressed', { score: 0.9 })];
    const candidate: CaseOutcome[] = [outcome('regressed', { score: 0.2 })];

    const { paired } = pairCases(baseline, candidate);
    expect(paired[0]?.difference).toBeCloseTo(-0.7, 10);
  });
});

// ===========================================================================
// PairedCase must faithfully carry through every field pairCases has no
// business transforming -- critical flag, both raw scores, both pass/fail
// flags. A grader downstream (critical-case override, regressed/fixed
// lists) depends on these surviving unmodified.
// ===========================================================================

describe('paired-cases-preserve-the-critical-flag-and-both-sides-raw-score-and-pass-fail-state', () => {
  it('critical-true-baseline-passed-true-candidate-passed-false-and-both-scores-survive-unchanged', () => {
    const baseline: CaseOutcome[] = [outcome('refund-past-window', { critical: true, score: 0.95, passed: true })];
    const candidate: CaseOutcome[] = [
      outcome('refund-past-window', { critical: true, score: 0.4, passed: false }),
    ];

    const { paired } = pairCases(baseline, candidate);
    expect(paired).toHaveLength(1);
    const p = paired[0]!;
    expect(p.critical).toBe(true);
    expect(p.baselineScore).toBe(0.95);
    expect(p.candidateScore).toBe(0.4);
    expect(p.baselinePassed).toBe(true);
    expect(p.candidatePassed).toBe(false);
  });
});
