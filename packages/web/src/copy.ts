/**
 * Reimplemented from packages/core/src/report/copy.ts, verbatim, for the
 * same reason format.ts is reimplemented rather than imported: packages/web
 * may only ever import *types* from '@llmreg/core'. See format.ts's module
 * comment.
 *
 * Shared verdict copy — the exact sentences used for the "one-line
 * verdict" (§5.8 point 1) so the Report UI never disagrees with the PR
 * comment about what a comparison means. Keep in lockstep with
 * report/copy.ts.
 */

import { formatDeltaWithInterval, formatMagnitudePP } from './format.js';
import type { ComparisonReportData } from '@llmreg/core';

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
    // definition `regressedCases` uses). Saying "0 of N regressed" here
    // without this context would read as self-contradicting next to a
    // regression verdict.
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
    return `${pairedCaseCount} paired cases — no comparison could be computed from this dataset. This is a warning about the dataset, not the change.`;
  }

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
