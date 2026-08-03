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

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Renders §6.5's "one chart" -- paired vs. unpaired detection rate at the
 * same n -- as a self-contained static SVG. This is a checked-in build
 * artifact meant to render in a GitHub README/PR comment, not a live
 * claude.ai interactive page, so it skips the hover/tooltip/dark-mode-toggle
 * machinery a fully interactive chart would carry and just renders once,
 * statically, against the palette's light-surface values.
 *
 * Two categories (not a repeated series across an axis), each already named
 * by its x-axis label, so a separate legend box would only restate those
 * two labels -- direct labels at the bar tips plus the axis names carry
 * identity on their own, per the mark spec's "a single series needs no
 * legend box" allowance extended to this two-bar comparison.
 */
export function renderPairingBenefitChart(result: PairingBenefitResult): string {
  const width = 480;
  const height = 320;
  const marginLeft = 56;
  const marginRight = 32;
  const marginTop = 56;
  const marginBottom = 56;
  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = height - marginTop - marginBottom;

  const bars = [
    { label: 'Paired', rate: result.pairedDetectionRate, color: '#2a78d6' }, // categorical slot 1
    { label: 'Unpaired', rate: result.unpairedDetectionRate, color: '#eb6834' }, // categorical slot 2
  ];

  const maxRate = Math.max(0.2, ...bars.map((b) => b.rate)); // headroom above the taller bar
  const axisMax = Math.ceil(maxRate * 10) / 10 + 0.1; // round up to the next 10%, plus one step of headroom
  const yFor = (rate: number): number => marginTop + plotHeight * (1 - rate / axisMax);

  const barSlotWidth = plotWidth / bars.length;
  const barWidth = Math.min(96, barSlotWidth * 0.4); // mark spec cap: bars never fill the slot

  const gridlines: string[] = [];
  const ticks: string[] = [];
  for (let pct = 0; pct <= axisMax + 1e-9; pct += 0.1) {
    const y = yFor(pct);
    gridlines.push(`<line x1="${marginLeft}" y1="${y.toFixed(1)}" x2="${width - marginRight}" y2="${y.toFixed(1)}" stroke="#e1e0d9" stroke-width="1" />`);
    ticks.push(
      `<text x="${marginLeft - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#898781" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${Math.round(pct * 100)}%</text>`,
    );
  }

  const barEls = bars.map((b, i) => {
    const slotCenter = marginLeft + barSlotWidth * (i + 0.5);
    const x = slotCenter - barWidth / 2;
    const yTop = yFor(b.rate);
    const barHeight = marginTop + plotHeight - yTop;
    const valueLabel = `${(b.rate * 100).toFixed(1)}%`;
    return `
    <rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="4" fill="${b.color}" />
    <text x="${slotCenter.toFixed(1)}" y="${(yTop - 10).toFixed(1)}" text-anchor="middle" font-size="15" font-weight="600" fill="#0b0b0b" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${valueLabel}</text>
    <text x="${slotCenter.toFixed(1)}" y="${(marginTop + plotHeight + 22).toFixed(1)}" text-anchor="middle" font-size="13" fill="#52514e" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${escapeXml(b.label)}</text>`;
  });

  // Measured to fit the 480px canvas at 16px semibold system-ui (~8.5px/char
  // average) -- the mark spec's "a label that won't fit doesn't get
  // clipped" rule applies to titles too, not just data labels.
  const title = 'Paired detects the regression more often';
  const subtitle = `§6.5 -- n=${result.n}, injected regression=${Math.round(result.effectSize * 100)}pt, ${result.trials} trials`;

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Paired detection rate ${(bars[0]!.rate * 100).toFixed(1)}% versus unpaired detection rate ${(bars[1]!.rate * 100).toFixed(1)}% at the same sample size">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fcfcfb" />
  <text x="${marginLeft}" y="26" font-size="16" font-weight="600" fill="#0b0b0b" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${escapeXml(title)}</text>
  <text x="${marginLeft}" y="44" font-size="12" fill="#898781" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${escapeXml(subtitle)}</text>
  ${gridlines.join('\n  ')}
  <line x1="${marginLeft}" y1="${marginTop + plotHeight}" x2="${width - marginRight}" y2="${marginTop + plotHeight}" stroke="#c3c2b7" stroke-width="1" />
  ${ticks.join('\n  ')}
  ${barEls.join('\n  ')}
</svg>
`;
}

/** Writes an SVG chart to `<repo root>/simulations/results/<name>.svg`. */
export function writeSimulationChart(name: string, svg: string): string {
  const path = resolve(process.cwd(), 'simulations', 'results', `${name}.svg`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, svg, 'utf8');
  return path;
}
