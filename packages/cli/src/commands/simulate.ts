import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  runNullModelSimulation,
  runPowerCurveSimulation,
  runPairingBenefitSimulation,
  runMdeValidation,
  type NullModelResult,
  type PowerCurveResult,
  type PairingBenefitResult,
  type MdeValidationResult,
} from '@llmreg/core';

/**
 * Default synthetic-data parameters for `llmreg simulate`. These are NOT
 * suite-specific -- Phase 6's whole point (§6) is validating the comparison
 * engine's statistical behavior against data with a known ground truth, not
 * against any particular suite's real cases. `--seed` is exposed so a run
 * is reproducible; every other default is a reasonable, moderate choice
 * that keeps a `simulate` command finishing in seconds to tens of seconds
 * rather than minutes, overridable via flags for a more rigorous run.
 */
const DEFAULT_SEED = 20260803;

export interface SimulateNullOptions {
  n?: number;
  basePassRate?: number;
  caseDifficultySpread?: number;
  trials?: number;
  alpha?: number;
  bootstrapIterations?: number;
  seed?: number;
}

export function runSimulateNull(options: SimulateNullOptions): NullModelResult {
  return runNullModelSimulation({
    n: options.n ?? 100,
    basePassRate: options.basePassRate ?? 0.6,
    caseDifficultySpread: options.caseDifficultySpread ?? 0.25,
    trials: options.trials ?? 2000,
    alpha: options.alpha ?? (process.env.SIGNIFICANCE_ALPHA !== undefined ? Number(process.env.SIGNIFICANCE_ALPHA) : 0.05),
    mdeCeiling: 1,
    minPairedN: 5,
    bootstrapIterations: options.bootstrapIterations ?? 1000,
    seed: options.seed ?? DEFAULT_SEED,
  });
}

export interface SimulatePowerOptions {
  effectSizes?: number[];
  sampleSizes?: number[];
  basePassRate?: number;
  caseDifficultySpread?: number;
  trialsPerCell?: number;
  alpha?: number;
  bootstrapIterations?: number;
  seed?: number;
}

export interface SimulatePowerOutcome {
  powerCurve: PowerCurveResult;
  pairingBenefit: PairingBenefitResult;
}

export function runSimulatePower(options: SimulatePowerOptions): SimulatePowerOutcome {
  const basePassRate = options.basePassRate ?? 0.6;
  const caseDifficultySpread = options.caseDifficultySpread ?? 0.25;
  const alpha = options.alpha ?? (process.env.SIGNIFICANCE_ALPHA !== undefined ? Number(process.env.SIGNIFICANCE_ALPHA) : 0.05);
  const seed = options.seed ?? DEFAULT_SEED;

  const powerCurve = runPowerCurveSimulation({
    effectSizes: options.effectSizes ?? [0.01, 0.02, 0.05, 0.1, 0.2],
    sampleSizes: options.sampleSizes ?? [20, 50, 100, 250, 500],
    basePassRate,
    caseDifficultySpread,
    trialsPerCell: options.trialsPerCell ?? 150,
    alpha,
    mdeCeiling: 1,
    minPairedN: 5,
    bootstrapIterations: options.bootstrapIterations ?? 400,
    seed,
  });

  // §6.5's pairing-benefit demonstration needs real shared per-case
  // difficulty to be meaningful (see generator.ts) and a moderate effect
  // size/n where paired and unpaired power genuinely diverge -- not part of
  // the headline grid above, so run once more with its own params.
  const pairingBenefit = runPairingBenefitSimulation({
    n: 100,
    effectSize: 0.08,
    basePassRate,
    caseDifficultySpread: Math.max(caseDifficultySpread, 0.4),
    trials: 300,
    alpha,
    bootstrapIterations: options.bootstrapIterations ?? 800,
    seed: seed + 1,
  });

  return { powerCurve, pairingBenefit };
}

export interface SimulateMdeOptions {
  sampleSizes?: number[];
  basePassRate?: number;
  caseDifficultySpread?: number;
  trialsPerCell?: number;
  alpha?: number;
  power?: number;
  bootstrapIterations?: number;
  seed?: number;
}

export function runSimulateMde(options: SimulateMdeOptions): MdeValidationResult {
  const step = 0.02;
  const sweep: number[] = [];
  for (let e = 0.01; e <= 0.31; e += step) {
    sweep.push(Math.round(e * 1000) / 1000);
  }

  return runMdeValidation({
    sampleSizes: options.sampleSizes ?? [50, 100, 250],
    effectSizeSweep: sweep,
    basePassRate: options.basePassRate ?? 0.6,
    caseDifficultySpread: options.caseDifficultySpread ?? 0.25,
    trialsPerCell: options.trialsPerCell ?? 200,
    alpha: options.alpha ?? (process.env.SIGNIFICANCE_ALPHA !== undefined ? Number(process.env.SIGNIFICANCE_ALPHA) : 0.05),
    power: options.power ?? 0.8,
    mdeCeiling: 1,
    minPairedN: 5,
    bootstrapIterations: options.bootstrapIterations ?? 500,
    seed: options.seed ?? DEFAULT_SEED,
  });
}

/** Writes `result` as pretty JSON to `<repo root>/simulations/results/<name>.json`, creating the directory if needed. Repo-root, not package-scoped, per §6's own directory layout intent -- these are Phase 6 output artifacts a future report UI (§9) reads, not package source. */
export function writeSimulationResult(name: string, result: unknown): string {
  const path = resolve(process.cwd(), 'simulations', 'results', `${name}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result, null, 2) + '\n', 'utf8');
  return path;
}
