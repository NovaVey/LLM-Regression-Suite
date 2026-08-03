/**
 * Power curve — §6.2: "Inject known regressions of 1, 2, 5, 10, 20 points
 * across dataset sizes of 20, 50, 100, 250, 500 cases. Output a grid of
 * detection rates."
 *
 * For each `(effectSize, sampleSize)` cell, run `trialsPerCell` independent
 * trials: generate a fresh synthetic dataset with that true effect injected
 * (via `generateSyntheticPairedCases`), feed it through the real
 * `computeComparison`, and record whether the verdict came back
 * `regression`. `detectionRate` is the fraction of trials in that cell where
 * it did.
 *
 * Same `critical: false` convention as null-model.ts, and the same
 * reasoning: this grid measures the statistical detection power of the
 * bootstrap-CI mechanism at a given true effect and n, not the deterministic
 * critical-case policy layered on top of it in production use.
 *
 * DETERMINISM: same seeded-`bootstrapCI` mechanism as null-model.ts — each
 * trial hands `computeComparison` an explicit `mulberry32` stream via the
 * `rand` parameter, so `detectionRate` per cell is exactly reproducible
 * given the same `params.seed`. See null-model.ts's module comment and
 * `../stats/bootstrap.ts`'s for the full explanation — not repeated here.
 */

import { generateSyntheticPairedCases } from './generator.js';
import { computeComparison } from '../comparison/statistics.js';
import { mulberry32 } from '../dataset/split.js';

export interface PowerCurveParams {
  effectSizes: number[]; // e.g. [0.01, 0.02, 0.05, 0.10, 0.20] -- "1, 2, 5, 10, 20 points"
  sampleSizes: number[]; // e.g. [20, 50, 100, 250, 500]
  basePassRate: number;
  caseDifficultySpread: number;
  trialsPerCell: number;
  alpha: number;
  mdeCeiling: number;
  minPairedN: number;
  bootstrapIterations: number;
  seed: number;
}

export interface PowerCurveCell {
  effectSize: number;
  sampleSize: number;
  trials: number;
  detections: number;
  detectionRate: number;
}

export interface PowerCurveResult {
  cells: PowerCurveCell[]; // one per (effectSize, sampleSize) pair
}

/** See null-model.ts for the full doc comment on this helper — duplicated
 * here rather than exported from a shared module because it's a two-line
 * utility, matching this repo's established convention for small internal
 * helpers (e.g. `sampleStandardDeviation` in `../comparison/statistics.ts`
 * and again in `mde-validation.ts`). */
function deriveTrialSeed(seed: number, index: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(index, 0x85ebca6b)) >>> 0;
}

export function runPowerCurveSimulation(params: PowerCurveParams): PowerCurveResult {
  const {
    effectSizes,
    sampleSizes,
    basePassRate,
    caseDifficultySpread,
    trialsPerCell,
    alpha,
    mdeCeiling,
    minPairedN,
    bootstrapIterations,
    seed,
  } = params;

  const cells: PowerCurveCell[] = [];
  let cellIndex = 0;

  for (const effectSize of effectSizes) {
    for (const sampleSize of sampleSizes) {
      let detections = 0;

      for (let trial = 0; trial < trialsPerCell; trial++) {
        // Combine the cell's position in the grid with the trial index so
        // every (effectSize, sampleSize, trial) triple gets its own
        // independent stream from a single top-level seed; a second,
        // disjoint sub-stream drives the bootstrap resampling.
        const trialIndex = cellIndex * trialsPerCell + trial;
        const datasetSeed = deriveTrialSeed(seed, trialIndex * 2);
        const bootstrapSeed = deriveTrialSeed(seed, trialIndex * 2 + 1);

        const paired = generateSyntheticPairedCases({
          n: sampleSize,
          effectSize,
          basePassRate,
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
          detections++;
        }
      }

      cells.push({
        effectSize,
        sampleSize,
        trials: trialsPerCell,
        detections,
        detectionRate: detections / trialsPerCell,
      });
      cellIndex++;
    }
  }

  return { cells };
}

/**
 * Linear interpolation: given the cells for ONE sample size, finds the
 * effect size at which `detectionRate` first crosses `targetPower`,
 * interpolating linearly between the two bracketing grid points by
 * `effectSize`. Returns `null` if the given cells don't bracket a crossing
 * (every detection rate already at/above `targetPower`, or every one below
 * it, or an empty input).
 *
 * Sorts a copy of the input by `effectSize` ascending (does not mutate the
 * caller's array), then walks consecutive pairs looking for the first pair
 * where `detectionRate` moves from at-or-below `targetPower` to
 * at-or-above it.
 */
export function interpolateDetectionThreshold(
  cellsForOneSampleSize: PowerCurveCell[],
  targetPower: number,
): number | null {
  if (cellsForOneSampleSize.length < 2) {
    return null;
  }

  const sorted = [...cellsForOneSampleSize].sort((a, b) => a.effectSize - b.effectSize);

  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i] as PowerCurveCell;
    const hi = sorted[i + 1] as PowerCurveCell;

    if (lo.detectionRate <= targetPower && hi.detectionRate >= targetPower) {
      if (hi.detectionRate === lo.detectionRate) {
        // Flat segment exactly at targetPower: no meaningful interpolation
        // to do, the crossing is the whole segment. Report its lower end.
        return lo.effectSize;
      }
      const t = (targetPower - lo.detectionRate) / (hi.detectionRate - lo.detectionRate);
      return lo.effectSize + t * (hi.effectSize - lo.effectSize);
    }
  }

  return null;
}
