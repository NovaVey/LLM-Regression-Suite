/**
 * Shared synthetic paired-case generator for Phase 6 (§6 of the spec). Every
 * other file in this directory builds its simulation on top of this one
 * function, so its correctness is load-bearing for the whole phase.
 *
 * GENERATIVE MODEL:
 *
 *   p_i = clamp(basePassRate + caseDifficultySpread * u_i, 0, 1),  u_i ~ Uniform(-1, 1)
 *   baseline_i  ~ Bernoulli(p_i)
 *   candidate_i ~ Bernoulli(clamp(p_i - effectSize, 0, 1))
 *
 * Each of the `n` synthetic cases gets its own latent "difficulty" `p_i` —
 * some inputs are inherently easier or harder than others, independent of
 * which variant answers them — and that difficulty is SHARED between the
 * baseline and candidate draw for that case. `effectSize` then shifts the
 * candidate's pass probability down (or up, if negative) from that shared
 * baseline.
 *
 * WHY p_i IS SHARED BETWEEN BASELINE AND CANDIDATE, NOT DRAWN INDEPENDENTLY
 * PER SIDE: this is what gives paired analysis something real to cancel out.
 * If baseline_i and candidate_i were drawn from two independently-sampled
 * p_i's, there would be no shared per-case variance for pairing to remove,
 * and pairing-benefit.ts's whole comparison (paired vs. unpaired power)
 * would be a non-demonstration — both methods would have identical power
 * because there would be nothing case-correlated to exploit. null-model.ts
 * and power-curve.ts reuse this same generator for consistency, even though
 * neither strictly needs the shared-variance property to make its point.
 *
 * WHY caseDifficultySpread IS A UNIFORM WOBBLE AND NOT A BETA DISTRIBUTION:
 * a Beta sampler needs a Gamma sampler layered on top of the seeded uniform
 * PRNG this repo already has — real added complexity that none of the five
 * §6 validations actually need. Every one of them only needs *some* shared
 * per-case variance to exist, not any particular distributional shape. This
 * is a deliberate simplification, not a TODO.
 *
 * Score is binary (0 or 1 — pass/fail), not continuous, matching the
 * `judge_calibrations`/`grades` schema's boolean `passed` and this phase's
 * focus on McNemar-shaped discordant-pair reasoning. `critical` is `false`
 * on every generated case, unconditionally: see null-model.ts's module
 * comment for why (in short — the critical-case override in §5.6 is a
 * deterministic POLICY layered on top of the statistical test, not itself a
 * calibratable false-positive-rate claim, and mixing it in would measure
 * something other than what §6.1/§6.2 ask about).
 *
 * `externalId` is `sim-case-{i}`, unique per case within one generated
 * dataset; nothing downstream reads it semantically.
 */

import type { PairedCase } from '../comparison/pairing.js';
import { mulberry32 } from '../dataset/split.js';

export interface CaseGeneratorParams {
  n: number;
  /** Overall mean pass probability across cases, in (0, 1). */
  basePassRate: number;
  /** True injected shift in the candidate's pass probability (negative = regression). 0 for a null-model run. */
  effectSize: number;
  /** Half-width of the per-case difficulty wobble around basePassRate, in [0, 1). 0 = every case has identical difficulty. */
  caseDifficultySpread: number;
  seed: number;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Generates `n` synthetic paired cases per the model above, driven entirely
 * by `mulberry32(params.seed)` — same seed, same output, every time, and no
 * other source of randomness anywhere in this function.
 *
 * `effectSize` is intentionally NOT range-restricted: a caller can pass a
 * value that would push `p_i - effectSize` outside `[0, 1]` (e.g. a large
 * effect on a case whose difficulty is already near a boundary). The
 * `clamp01` in the generative model above already makes any `effectSize`
 * value safe, so validating it away here would reject legitimate inputs for
 * no benefit — it's simpler and equally correct to let the clamp do its job
 * and document that it exists.
 */
export function generateSyntheticPairedCases(params: CaseGeneratorParams): PairedCase[] {
  const { n, basePassRate, effectSize, caseDifficultySpread, seed } = params;

  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`generateSyntheticPairedCases requires n >= 1, got ${n}`);
  }
  if (!(basePassRate > 0 && basePassRate < 1)) {
    throw new Error(
      `generateSyntheticPairedCases requires basePassRate in (0, 1), got ${basePassRate}`,
    );
  }
  if (!(caseDifficultySpread >= 0 && caseDifficultySpread < 1)) {
    throw new Error(
      `generateSyntheticPairedCases requires caseDifficultySpread in [0, 1), got ${caseDifficultySpread}`,
    );
  }

  const rand = mulberry32(seed);
  const cases: PairedCase[] = new Array(n);

  for (let i = 0; i < n; i++) {
    // Draw order per case is fixed (difficulty, then baseline, then
    // candidate) so the same seed always produces the same stream.
    const u = rand() * 2 - 1; // Uniform(-1, 1)
    const pI = clamp01(basePassRate + caseDifficultySpread * u);

    const baselinePassed = rand() < pI;
    const candidatePassed = rand() < clamp01(pI - effectSize);

    const baselineScore = baselinePassed ? 1 : 0;
    const candidateScore = candidatePassed ? 1 : 0;

    cases[i] = {
      externalId: `sim-case-${i}`,
      critical: false, // deliberate — see module comment
      baselineScore,
      candidateScore,
      baselinePassed,
      candidatePassed,
      difference: candidateScore - baselineScore, // §5.1: d_i = candidate_i - baseline_i
    };
  }

  return cases;
}
