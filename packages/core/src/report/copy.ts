/**
 * Shared verdict copy — the exact sentences used for the "one-line
 * verdict" (§5.8 point 1) across every renderer. Centralized so
 * markdown.ts and html.ts (and any future renderer) say the same thing
 * about the same comparison: wording drift between formats would be its
 * own kind of dishonesty in a tool whose entire premise is that its text
 * says exactly what it means. Only presentation (bold in markdown,
 * color+weight in HTML) is renderer-specific; these functions return
 * plain, unmarked-up sentences.
 *
 * Split into a headline (verdict + delta + interval — sufficient on its
 * own, per §8: "someone skimming on their phone must be able to tell
 * whether to worry from the first line alone") and an elaboration (the
 * additional context §5.8/§8 also requires: regressed count and critical
 * flag for `regression`; the MDE sentence for `no_detectable_difference`;
 * "detected, not proven" for `improvement_detected`; the dataset-specific
 * reason for `insufficient_data`).
 */

import { formatDeltaWithInterval, formatMagnitudePP } from './format.js';
import type { ComparisonReportData } from './types.js';

export function verdictHeadline(data: ComparisonReportData): string {
  const deltaCI = formatDeltaWithInterval(data.delta, data.ciLower, data.ciUpper);
  switch (data.verdict) {
    case 'regression':
      return `Regression: ${deltaCI}.`;
    case 'no_detectable_difference':
      return `No detectable difference: ${deltaCI}.`;
    case 'improvement_detected':
      return `Improvement detected: ${deltaCI}.`;
    case 'insufficient_data':
      return `Insufficient data: ${deltaCI}.`;
    default: {
      const exhaustive: never = data.verdict;
      throw new Error(`verdictHeadline: unhandled verdict ${String(exhaustive)}`);
    }
  }
}

function regressionElaboration(data: ComparisonReportData): string {
  const { regressedCases, pairedCaseCount, criticalRegressed } = data;
  if (regressedCases.length === 0) {
    // The aggregate CI can land entirely below zero (continuous score
    // movement) with no individual case flipping pass -> fail (the
    // definition `regressedCases` uses, per comparison/statistics.ts).
    // Saying "0 of N regressed" here without this context would read as
    // self-contradicting next to a regression verdict.
    return `No individual case flipped from passing to failing; the aggregate score moved down across ${pairedCaseCount} paired cases.`;
  }
  const criticalClause =
    criticalRegressed > 0
      ? `, including ${criticalRegressed} critical ${criticalRegressed === 1 ? 'case' : 'cases'}`
      : ' (none critical)';
  return `${regressedCases.length} of ${pairedCaseCount} paired cases flipped from passing to failing${criticalClause}.`;
}

function insufficientDataElaboration(data: ComparisonReportData): string {
  const { pairedCaseCount, mde, mdeCeiling, minPairedN } = data;
  if (!Number.isFinite(mde) || pairedCaseCount === 0) {
    // §5.1/§5.4 edge case: zero paired cases means nothing was measured at
    // all, not merely "measured imprecisely" -- say that plainly rather
    // than printing a nonsensical "Infinitypp" MDE.
    return `${pairedCaseCount} paired cases — no comparison could be computed from this dataset. This is a warning about the dataset, not the change.`;
  }

  // §5.6: "MDE above ceiling, or paired n below floor" are named as
  // reading differently -- say specifically which (or both) actually
  // triggered this verdict, now that mdeCeiling/minPairedN are threaded
  // through from the suite config (load.ts) rather than guessed at.
  const mdeExceeded = mde > mdeCeiling;
  const nBelowFloor = pairedCaseCount < minPairedN;

  if (mdeExceeded && nBelowFloor) {
    return `Only ${pairedCaseCount} paired cases (below this suite's floor of ${minPairedN}), producing a minimum detectable effect of ${formatMagnitudePP(mde)} — above this suite's ${formatMagnitudePP(mdeCeiling)} ceiling. Both the sample size and the resulting sensitivity are too low to trust a verdict here. This is a warning about the dataset, not the change.`;
  }
  if (nBelowFloor) {
    return `Only ${pairedCaseCount} paired cases — below this suite's floor of ${minPairedN}. This is a warning about the dataset, not the change.`;
  }
  if (mdeExceeded) {
    return `${pairedCaseCount} paired cases produced a minimum detectable effect of ${formatMagnitudePP(mde)}, above this suite's ${formatMagnitudePP(mdeCeiling)} ceiling — too imprecise to trust a verdict here. This is a warning about the dataset, not the change.`;
  }
  // Neither threshold reads as crossed from this data (e.g. thresholds
  // changed between compute time and report time) -- report the real
  // numbers plainly rather than asserting a reason that isn't actually
  // supported by them.
  return `${pairedCaseCount} paired cases produced a minimum detectable effect of ${formatMagnitudePP(mde)} (ceiling ${formatMagnitudePP(mdeCeiling)}, floor ${minPairedN}). This is a warning about the dataset, not the change.`;
}

export function verdictElaboration(data: ComparisonReportData): string {
  switch (data.verdict) {
    case 'regression':
      return regressionElaboration(data);
    case 'no_detectable_difference':
      return `This suite can detect changes of ${formatMagnitudePP(data.mde)} or larger.`;
    case 'improvement_detected':
      return `Detected, not proven — the interval sits entirely above zero across ${data.pairedCaseCount} paired cases. This suite can detect changes of ${formatMagnitudePP(data.mde)} or larger.`;
    case 'insufficient_data':
      return insufficientDataElaboration(data);
    default: {
      const exhaustive: never = data.verdict;
      throw new Error(`verdictElaboration: unhandled verdict ${String(exhaustive)}`);
    }
  }
}
