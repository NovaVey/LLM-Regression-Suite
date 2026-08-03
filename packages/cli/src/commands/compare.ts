import { closeDb, compareRuns, loadSuiteConfig } from '@llmreg/core';

export interface CompareCommandOptions {
  suite: string;
  baselineRun: string;
  candidateRun: string;
  bootstrapIterations?: number;
}

export interface CompareCommandOutcome {
  comparisonId: string;
  pairedCaseCount: number;
  delta: number;
  ciLower: number;
  ciUpper: number;
  mde: number;
  verdict: string;
  regressedCount: number;
  fixedCount: number;
  criticalRegressed: number;
  excludedCount: number;
}

export async function runCompareCommand(options: CompareCommandOptions): Promise<CompareCommandOutcome> {
  const suiteConfig = loadSuiteConfig(options.suite);
  const bootstrapIterations =
    options.bootstrapIterations ?? (process.env.BOOTSTRAP_ITERATIONS !== undefined ? Number(process.env.BOOTSTRAP_ITERATIONS) : 10000);

  const { comparisonId, stats, excluded } = await compareRuns({
    baselineRunId: options.baselineRun,
    candidateRunId: options.candidateRun,
    suiteConfig,
    bootstrapIterations,
  });

  await closeDb();

  return {
    comparisonId,
    pairedCaseCount: stats.pairedCaseCount,
    delta: stats.delta,
    ciLower: stats.ciLower,
    ciUpper: stats.ciUpper,
    mde: stats.mde,
    verdict: stats.verdict,
    regressedCount: stats.regressedExternalIds.length,
    fixedCount: stats.fixedExternalIds.length,
    criticalRegressed: stats.criticalRegressed,
    excludedCount: excluded.length,
  };
}
