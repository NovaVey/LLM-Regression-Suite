/**
 * The null model — §6.1, "the single most important artifact in the repo."
 *
 * Generate two variants with IDENTICAL true behaviour (effectSize: 0), run
 * the full real comparison pipeline (`computeComparison`, not a
 * reimplementation of it) `trials` times on freshly resampled synthetic
 * data, and tally how often the verdict comes back `regression` and how
 * often it comes back `improvement_detected`.
 *
 * WHY THIS RESULT REPORTS TWO RATES, NOT ONE — READ BEFORE TRUSTING EITHER
 * NUMBER IN ISOLATION: §5.6's `determineVerdict` sets `verdict: 'regression'`
 * when `ciUpper < 0` — one edge of a TWO-SIDED `(1 - alpha)` percentile
 * bootstrap CI (§5.2). Standard CI theory: under a true null, a two-sided
 * `(1 - alpha)` CI excludes zero with total probability `alpha`, split
 * ~symmetrically between "entirely above zero" (`improvement_detected`,
 * ~alpha/2) and "entirely below zero" (`regression`, ~alpha/2). Verified
 * directly: at alpha=0.05, `regressionRate` converges to ~2-3%, not ~5%,
 * across every parameter combination tried in real 1,000+ trial runs (both
 * the statistician's and test-author's independent Phase 6 verification,
 * plus a from-scratch confirmation against `bootstrapCI` directly on
 * Gaussian data with true mean 0).
 *
 * §6.1's prose ("the observed rate must land near 5%") and the README's
 * worked example (§12: "reports a false regression 4.9% of the time") are
 * most consistent with the STANDARD two-sided Type-I-error framing (`P(CI
 * excludes zero at all)`, i.e. `regressionRate + improvementRate` — which
 * DOES converge to ~alpha, confirmed at ~4.4-4.9% in the same runs) --
 * except that §6.1 explicitly says to count only verdicts that are
 * `regression`, which is the one-sided event. The two readings disagree by a
 * factor of ~2, and which one is "the false positive rate that matters" is
 * a genuine, unresolved product question, not a bug: `regressionRate` is
 * the rate that actually blocks a PR under a true null (the operationally
 * relevant number, since `improvement_detected` still passes the check per
 * §5.6's table); `combinedRate` is what the spec's plain-language numbers
 * actually land on empirically. This function reports BOTH, each against
 * its own mathematically-correct target (alpha/2 for `regressionRate`,
 * alpha for `combinedRate`), rather than silently picking one framing —
 * see docs/DECISIONS.md for the full writeup and the open question raised
 * to the user at the Phase 6 checkpoint.
 *
 * This is a real, load-bearing question for the product (does "5% false
 * positive rate" as advertised in a README mean the one-sided regression
 * rate, which would require changing how the CI feeds the verdict rule, or
 * the two-sided rate, which the system already delivers) — resolving it by
 * picking a number here and moving on would bury the single most important
 * finding this phase exists to surface.
 *
 * ALL GENERATED CASES ARE NON-CRITICAL. `generateSyntheticPairedCases`
 * already guarantees `critical: false` on every case it produces, and that
 * is deliberate here specifically: §5.6's critical-case override is a
 * deterministic POLICY decision layered on top of the statistical test, not
 * itself a statistical claim with a calibratable false-positive rate. If
 * critical cases were mixed in, any critical case's random pass-to-fail flip
 * (which WILL happen periodically under repeated resampling purely by
 * chance) forces `verdict: 'regression'` regardless of what the CI says —
 * inflating the observed rate arbitrarily and measuring something other than
 * what §6.1 is actually asking about.
 *
 * DETERMINISM: `generateSyntheticPairedCases` is fully deterministic given
 * its seed, and so is each trial's verdict here — `computeComparison`'s
 * `bootstrapCI` call is handed an explicit seeded RNG (`mulberry32`, via a
 * `rand` parameter added to `bootstrapCI`/`computeComparison` specifically
 * for this phase; see `../stats/bootstrap.ts`'s module comment) instead of
 * defaulting to the global, unseeded `Math.random()`. Every production call
 * site (`compare.ts`) omits that parameter and is completely unaffected.
 * Each trial uses its own independent sub-stream for dataset generation and
 * a separate one for bootstrap resampling, so the two don't share state.
 */

import { generateSyntheticPairedCases } from './generator.js';
import { computeComparison } from '../comparison/statistics.js';
import { mulberry32 } from '../dataset/split.js';

export interface NullModelParams {
  n: number;
  basePassRate: number;
  caseDifficultySpread: number;
  trials: number;
  alpha: number;
  mdeCeiling: number;
  minPairedN: number;
  bootstrapIterations: number;
  seed: number;
}

export interface NullModelResult {
  trials: number;
  alpha: number;

  /** Fraction of trials whose verdict was 'regression' -- the rate that actually fails the CI check under a true null. */
  regressionCount: number;
  regressionRate: number;
  /** Mathematically-correct target for regressionRate given a two-sided (1-alpha) CI feeding a one-sided rule: alpha/2, not alpha. */
  regressionRateTarget: number;
  regressionRateStandardError: number;
  regressionRateWithinTolerance: boolean;

  /** Fraction of trials whose verdict was 'improvement_detected' -- the symmetric one-sided event on the other tail. */
  improvementCount: number;
  improvementRate: number;

  /** regressionRate + improvementRate -- "the CI excluded zero at all," the standard two-sided Type-I-error rate. This is the number closest to §6.1's/§12's literal "~5%" language. */
  combinedRate: number;
  combinedRateStandardError: number;
  combinedRateWithinTolerance: boolean;
}

/**
 * Deterministic uint32 combination of a base seed and an integer trial
 * index, giving each trial its own independent `mulberry32` stream derived
 * from a single top-level seed (so trials don't all draw from the same
 * sequence). Not cryptographic — just enough mixing that adjacent trial
 * indices don't produce visibly correlated streams. Kept local to this file
 * (a two-line utility, same convention `sampleStandardDeviation` in
 * `mde-validation.ts` and `../comparison/statistics.ts` follow for small
 * helpers not worth a cross-module export).
 */
function deriveTrialSeed(seed: number, index: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(index, 0x85ebca6b)) >>> 0;
}

export function runNullModelSimulation(params: NullModelParams): NullModelResult {
  const {
    n,
    basePassRate,
    caseDifficultySpread,
    trials,
    alpha,
    mdeCeiling,
    minPairedN,
    bootstrapIterations,
    seed,
  } = params;

  let regressionCount = 0;
  let improvementCount = 0;

  for (let trial = 0; trial < trials; trial++) {
    const datasetSeed = deriveTrialSeed(seed, trial * 2);
    const bootstrapSeed = deriveTrialSeed(seed, trial * 2 + 1);
    const paired = generateSyntheticPairedCases({
      n,
      basePassRate,
      effectSize: 0, // "identical behaviour" per §6.1
      caseDifficultySpread,
      seed: datasetSeed,
    });

    const result = computeComparison({
      paired,
      alpha,
      mdeCeiling,
      minPairedN,
      bootstrapIterations,
      rand: mulberry32(bootstrapSeed),
    });

    if (result.verdict === 'regression') {
      regressionCount++;
    } else if (result.verdict === 'improvement_detected') {
      improvementCount++;
    }
  }

  const regressionRate = regressionCount / trials;
  const improvementRate = improvementCount / trials;
  const combinedRate = regressionRate + improvementRate;

  // Three-sigma band on a binomial proportion, centered on each rate's own
  // mathematically-correct target -- see the module comment for why these
  // targets differ (alpha/2 for the one-sided regression event, alpha for
  // the combined two-sided event).
  const regressionRateTarget = alpha / 2;
  const regressionRateStandardError = Math.sqrt((regressionRateTarget * (1 - regressionRateTarget)) / trials);
  const regressionRateWithinTolerance =
    regressionRate >= regressionRateTarget - 3 * regressionRateStandardError &&
    regressionRate <= regressionRateTarget + 3 * regressionRateStandardError;

  const combinedRateStandardError = Math.sqrt((alpha * (1 - alpha)) / trials);
  const combinedRateWithinTolerance =
    combinedRate >= alpha - 3 * combinedRateStandardError && combinedRate <= alpha + 3 * combinedRateStandardError;

  return {
    trials,
    alpha,
    regressionCount,
    regressionRate,
    regressionRateTarget,
    regressionRateStandardError,
    regressionRateWithinTolerance,
    improvementCount,
    improvementRate,
    combinedRate,
    combinedRateStandardError,
    combinedRateWithinTolerance,
  };
}
