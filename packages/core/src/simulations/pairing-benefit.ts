/**
 * Pairing benefit — §6.5: "Run the same injected regression through paired
 * and unpaired analysis at the same n. The paired version detects it; the
 * unpaired version often does not. One chart, and it justifies §5.1 to
 * anyone who asks why this is more complex than comparing two averages."
 *
 * For each trial, generate ONE synthetic dataset via
 * `generateSyntheticPairedCases` (shared per-case difficulty — this is
 * exactly what makes the comparison meaningful, see generator.ts's module
 * comment) and evaluate it two ways:
 *
 * PAIRED: the real `computeComparison`. Detected = `verdict === 'regression'`.
 *
 * UNPAIRED: treat `baselineScore`/`candidateScore` as two INDEPENDENT
 * samples, discarding the per-case correspondence entirely — as if the tool
 * had compared two averages instead of per-case differences. A percentile
 * bootstrap CI is computed on the difference of means between two
 * INDEPENDENTLY resampled groups: resample the baseline scores with
 * replacement (size = n) `bootstrapIterations` times computing the mean
 * each time; independently resample the candidate scores the same way;
 * form `unpairedIterations[b] = candidateMeanB - baselineMeanB`. The CI is
 * the `(alpha/2, 1 - alpha/2)` percentiles of that vector. Detected =
 * CI upper bound `< 0` — the same "excludes zero on the harmful side"
 * criterion `determineVerdict` uses for the paired CI, applied here
 * directly without the MDE-ceiling/critical-case/insufficient-data
 * machinery, because this comparison is specifically about the statistical
 * power of paired vs. unpaired testing, not a full second verdict pipeline.
 *
 * WHY THE UNPAIRED BOOTSTRAP IS IMPLEMENTED SELF-CONTAINED HERE, NOT ADDED
 * TO `../stats/bootstrap.ts`: it exists solely to make this one comparison
 * possible and has no other caller anywhere in the product. Adding a
 * permanent product-facing "unpaired analysis" capability to satisfy a
 * one-off simulation would be over-building — the whole point of §5.1 is
 * that this tool never actually offers unpaired comparison as a real
 * option.
 *
 * ON `computeComparison`'S mdeCeiling/minPairedN INPUTS, WHICH THIS FILE'S
 * PARAMS DON'T INCLUDE: `computeComparison` requires both, but
 * `determineVerdict`'s precedence rules (`../stats/verdict.ts`) check
 * `ciUpper < 0 || criticalRegressed > 0` FIRST and return `'regression'`
 * immediately if it holds — before the MDE-ceiling/minPairedN
 * `insufficient_data` branch is ever reached. Since every generated case
 * here has `critical: false` (generator.ts), `criticalRegressed` is always
 * 0, so whether `detected = verdict === 'regression'` is true here depends
 * only on `ciUpper < 0`, never on `mdeCeiling`/`minPairedN`. Passed-through
 * placeholder values below (`mdeCeiling: Infinity`, `minPairedN: 1`) are
 * therefore inert for this comparison's purposes, not a real second policy
 * decision — documented so a future reader isn't left wondering why they
 * were picked.
 *
 * DETERMINISM: both paths are fully seeded. The paired path hands
 * `computeComparison` an explicit `mulberry32` stream via the `rand`
 * parameter (same mechanism as null-model.ts/power-curve.ts), and the
 * unpaired path already used its own `mulberry32` stream directly — so both
 * `pairedDetectionRate` and `unpairedDetectionRate` are exactly reproducible
 * given the same `params.seed`.
 */

import { generateSyntheticPairedCases } from './generator.js';
import { computeComparison } from '../comparison/statistics.js';
import { mulberry32 } from '../dataset/split.js';

export interface PairingBenefitParams {
  n: number;
  effectSize: number;
  basePassRate: number;
  caseDifficultySpread: number;
  trials: number;
  alpha: number;
  bootstrapIterations: number;
  seed: number;
}

export interface PairingBenefitResult {
  n: number;
  effectSize: number;
  trials: number;
  pairedDetectionRate: number;
  unpairedDetectionRate: number;
}

/** See null-model.ts for the full doc comment on this helper — duplicated
 * per this repo's established convention for small internal helpers not
 * worth a cross-module export. */
function deriveTrialSeed(seed: number, index: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(index, 0x85ebca6b)) >>> 0;
}

/** Same linear-interpolation percentile convention as
 * `../stats/bootstrap.ts`'s private `percentile` (numpy's default),
 * duplicated here for the same "two-line utility, not worth a cross-module
 * export" reason as `sampleStandardDeviation` in `mde-validation.ts`. */
function percentile(sortedValues: number[], p: number): number {
  const n = sortedValues.length;
  if (n === 1) {
    return sortedValues[0] as number;
  }
  const rank = p * (n - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lowerValue = sortedValues[lowerIndex] as number;
  if (lowerIndex === upperIndex) {
    return lowerValue;
  }
  const upperValue = sortedValues[upperIndex] as number;
  const weight = rank - lowerIndex;
  return lowerValue * (1 - weight) + upperValue * weight;
}

/**
 * Percentile bootstrap CI on the difference of means between two
 * INDEPENDENTLY resampled groups (discards the per-case pairing). Returns
 * true iff the CI's upper bound is below zero — the harmful-direction
 * detection criterion, applied directly per this file's module comment.
 */
function unpairedDetectsRegression(
  baselineScores: number[],
  candidateScores: number[],
  bootstrapIterations: number,
  alpha: number,
  rand: () => number,
): boolean {
  const nB = baselineScores.length;
  const nC = candidateScores.length;
  const unpairedIterations = new Array<number>(bootstrapIterations);

  for (let b = 0; b < bootstrapIterations; b++) {
    let baselineSum = 0;
    for (let j = 0; j < nB; j++) {
      const idx = Math.floor(rand() * nB);
      baselineSum += baselineScores[idx] as number;
    }
    let candidateSum = 0;
    for (let j = 0; j < nC; j++) {
      const idx = Math.floor(rand() * nC);
      candidateSum += candidateScores[idx] as number;
    }
    unpairedIterations[b] = candidateSum / nC - baselineSum / nB;
  }

  unpairedIterations.sort((a, b) => a - b);
  const ciUpper = percentile(unpairedIterations, 1 - alpha / 2);
  return ciUpper < 0;
}

export function runPairingBenefitSimulation(params: PairingBenefitParams): PairingBenefitResult {
  const { n, effectSize, basePassRate, caseDifficultySpread, trials, alpha, bootstrapIterations, seed } =
    params;

  let pairedDetections = 0;
  let unpairedDetections = 0;

  for (let trial = 0; trial < trials; trial++) {
    // Three independent sub-streams per trial: the shared synthetic dataset
    // both analyses read, the paired analysis's own bootstrap resampling,
    // and the unpaired bootstrap -- kept apart so none of them share state.
    const datasetSeed = deriveTrialSeed(seed, trial * 3);
    const pairedBootstrapSeed = deriveTrialSeed(seed, trial * 3 + 1);
    const unpairedBootstrapSeed = deriveTrialSeed(seed, trial * 3 + 2);

    const paired = generateSyntheticPairedCases({
      n,
      effectSize,
      basePassRate,
      caseDifficultySpread,
      seed: datasetSeed,
    });

    const comparison = computeComparison({
      paired,
      alpha,
      mdeCeiling: Infinity, // inert for this comparison — see module comment
      minPairedN: 1, // inert for this comparison — see module comment
      bootstrapIterations,
      rand: mulberry32(pairedBootstrapSeed),
    });
    if (comparison.verdict === 'regression') {
      pairedDetections++;
    }

    const rand = mulberry32(unpairedBootstrapSeed);
    const baselineScores = paired.map((c) => c.baselineScore);
    const candidateScores = paired.map((c) => c.candidateScore);
    if (unpairedDetectsRegression(baselineScores, candidateScores, bootstrapIterations, alpha, rand)) {
      unpairedDetections++;
    }
  }

  return {
    n,
    effectSize,
    trials,
    pairedDetectionRate: pairedDetections / trials,
    unpairedDetectionRate: unpairedDetections / trials,
  };
}
