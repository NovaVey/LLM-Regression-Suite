/**
 * MDE validation — §6.3: "The MDE the tool reports must match the effect
 * size the power curve actually detects at ~80% rate. If the reported MDE
 * says 5 points but the power curve shows 50% detection at 5 points, the
 * MDE formula is wrong."
 *
 * For each `sampleSize`:
 *
 *   1. Generate one representative null-effect dataset (`effectSize: 0`),
 *      compute the sample SD of its `difference` values, and call the real
 *      `minimumDetectableEffect` (`../stats/mde.js`) on that SD and n —
 *      this is `reportedMde`.
 *   2. Run `runPowerCurveSimulation` over `effectSizeSweep` at that one
 *      `sampleSize` and call `interpolateDetectionThreshold` on the
 *      resulting cells at `targetPower: power` — this is `empiricalMde`.
 *   3. Compare the two within a 35% relative tolerance (see the constant
 *      below for why that number and not something tighter).
 */

import { generateSyntheticPairedCases } from './generator.js';
import { minimumDetectableEffect } from '../stats/mde.js';
import { runPowerCurveSimulation, interpolateDetectionThreshold } from './power-curve.js';
import type { PowerCurveParams } from './power-curve.js';

export interface MdeValidationParams {
  sampleSizes: number[];
  effectSizeSweep: number[]; // denser than power-curve's headline grid, e.g. 0.01 through 0.30 in small steps
  basePassRate: number;
  caseDifficultySpread: number;
  trialsPerCell: number;
  alpha: number;
  power: number; // target detection rate the MDE formula is checked against, e.g. 0.8
  mdeCeiling: number;
  minPairedN: number;
  bootstrapIterations: number;
  seed: number;
}

export interface MdeValidationCell {
  sampleSize: number;
  reportedMde: number;
  empiricalMde: number | null; // null iff the sweep didn't bracket the crossing (see interpolateDetectionThreshold)
  withinTolerance: boolean; // false whenever empiricalMde is null
}

export interface MdeValidationResult {
  cells: MdeValidationCell[];
  allWithinTolerance: boolean;
}

/**
 * Relative tolerance between `reportedMde` (closed-form) and `empiricalMde`
 * (estimated from finite-trial simulation, via linear interpolation across
 * a necessarily-coarse-ish effect-size sweep). Wide on purpose: a tight
 * tolerance here would be testing simulation noise — how many trials ran
 * per cell, how fine the sweep is — rather than testing whether the MDE
 * formula itself is right. 35% relative tolerance is generous enough to
 * absorb that estimation noise while still catching a formula that is
 * actually wrong (e.g. off by the sqrt(2) that would come from mistakenly
 * using the two-independent-samples power formula instead of the
 * one-sample/paired formula — see `../stats/mde.ts`'s module comment).
 */
const RELATIVE_TOLERANCE = 0.35;

/** See null-model.ts for the full doc comment on this helper — duplicated
 * per this repo's established convention for small internal helpers not
 * worth a cross-module export. */
function deriveTrialSeed(seed: number, index: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(index, 0x85ebca6b)) >>> 0;
}

/**
 * Sample standard deviation (Bessel-corrected, n-1 denominator) of
 * `values`. Duplicated from the private `sampleStandardDeviation` in
 * `../comparison/statistics.ts` rather than exported from there, per this
 * contract's own instruction: it's a two-line utility and not worth a
 * cross-module export for. Same convention, same formula — comparable MDE
 * inputs to what `computeComparison` itself would compute on the same data.
 */
function sampleStandardDeviation(values: number[]): number {
  const n = values.length;
  if (n < 2) {
    return 0;
  }
  let sum = 0;
  for (const v of values) {
    sum += v;
  }
  const mean = sum / n;
  let sumSquares = 0;
  for (const v of values) {
    sumSquares += (v - mean) ** 2;
  }
  return Math.sqrt(sumSquares / (n - 1));
}

export function runMdeValidation(params: MdeValidationParams): MdeValidationResult {
  const {
    sampleSizes,
    effectSizeSweep,
    basePassRate,
    caseDifficultySpread,
    trialsPerCell,
    alpha,
    power,
    mdeCeiling,
    minPairedN,
    bootstrapIterations,
    seed,
  } = params;

  const cells: MdeValidationCell[] = [];

  sampleSizes.forEach((sampleSize, sampleIndex) => {
    // Two independent sub-streams per sample size: one for the
    // representative dataset used to estimate reportedMde's input SD, one
    // (offset well clear of the first) for the power-curve sweep used to
    // estimate empiricalMde — kept apart so the two don't share a stream.
    const representativeSeed = deriveTrialSeed(seed, sampleIndex * 2);
    const powerCurveSeed = deriveTrialSeed(seed, sampleIndex * 2 + 1);

    const representative = generateSyntheticPairedCases({
      n: sampleSize,
      effectSize: 0,
      basePassRate,
      caseDifficultySpread,
      seed: representativeSeed,
    });
    const differences = representative.map((c) => c.difference);
    const differenceSD = sampleStandardDeviation(differences);
    const reportedMde = minimumDetectableEffect(differenceSD, sampleSize, alpha, power);

    const powerCurveParams: PowerCurveParams = {
      effectSizes: effectSizeSweep,
      sampleSizes: [sampleSize],
      basePassRate,
      caseDifficultySpread,
      trialsPerCell,
      alpha,
      mdeCeiling,
      minPairedN,
      bootstrapIterations,
      seed: powerCurveSeed,
    };
    const powerCurve = runPowerCurveSimulation(powerCurveParams);
    const empiricalMde = interpolateDetectionThreshold(powerCurve.cells, power);

    // reportedMde === 0 is a theoretical divide-by-zero guard, not a case
    // expected to occur in practice: it would require the representative
    // dataset's per-case differences to have exactly zero sample variance,
    // which needs every one of `sampleSize` independent Bernoulli draw
    // pairs to agree — vanishingly unlikely for any sampleSize this
    // simulation is run at. Documented rather than defended against
    // further, matching this repo's convention for genuinely negligible
    // edge cases (see `../comparison/statistics.ts`'s n < 2 SD note).
    const withinTolerance =
      empiricalMde !== null &&
      reportedMde > 0 &&
      Math.abs(reportedMde - empiricalMde) / reportedMde <= RELATIVE_TOLERANCE;

    cells.push({ sampleSize, reportedMde, empiricalMde, withinTolerance });
  });

  const allWithinTolerance = cells.every((c) => c.withinTolerance);

  return { cells, allWithinTolerance };
}
