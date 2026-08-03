/**
 * DB orchestration for a comparison: fetches both runs' case_results and
 * grades, computes each case's aggregate score (weighted across the
 * suite's configured graders, averaged across repeat samples via Phase
 * 3's averagePerCaseScores), pairs the two runs (pairing.ts), computes the
 * comparison statistics (statistics.ts), and persists a `comparisons` row.
 *
 * Kept separate from pairing.ts/statistics.ts (both pure, DB-free) for the
 * same reason execute.ts and persist.ts were split in Phase 3: the math is
 * independently testable without a database, and this file is the part
 * that's inherently DB-coupled.
 */

import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { caseResults, cases as casesTable, comparisons, grades, runs } from '../db/schema.js';
import type { SuiteConfig } from '../dataset/schema.js';
import { averagePerCaseScores, type GradedSample } from '../runner/execute.js';
import { pairCases, type CaseOutcome, type Exclusion } from './pairing.js';
import { computeComparison, type ComparisonStats } from './statistics.js';

function weightedScore(
  graderScores: Array<{ grader: string; score: number }>,
  graderWeights: Map<string, number>,
): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const g of graderScores) {
    const weight = graderWeights.get(g.grader) ?? 1;
    weightedSum += g.score * weight;
    totalWeight += weight;
  }
  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

interface RunCaseData {
  outcomes: Map<string, CaseOutcome>;
  caseDbIdByExternalId: Map<string, string>;
}

/**
 * A case counts as errored for comparison purposes only if it produced no
 * usable graded sample at all. If repeat sampling produced a mix of
 * errored and successful samples, the case is scored from the successful
 * samples alone (per §5.3, samples are independently computed) rather than
 * the whole case being discarded over a partial failure.
 */
async function loadRunCaseData(runId: string, graderWeights: Map<string, number>): Promise<RunCaseData> {
  const db = getDb();

  const resultRows = await db
    .select({
      caseResultId: caseResults.id,
      caseDbId: caseResults.caseId,
      sampleIndex: caseResults.sampleIndex,
      error: caseResults.error,
      externalId: casesTable.externalId,
      critical: casesTable.critical,
    })
    .from(caseResults)
    .innerJoin(casesTable, eq(caseResults.caseId, casesTable.id))
    .where(eq(caseResults.runId, runId));

  const caseDbIdByExternalId = new Map<string, string>();
  const criticalByExternalId = new Map<string, boolean>();
  const outcomes = new Map<string, CaseOutcome>();

  if (resultRows.length === 0) {
    return { outcomes, caseDbIdByExternalId };
  }

  const caseResultIds = resultRows.map((r) => r.caseResultId);
  const gradeRows = await db
    .select({ caseResultId: grades.caseResultId, grader: grades.grader, score: grades.score })
    .from(grades)
    .where(inArray(grades.caseResultId, caseResultIds));

  const gradesByCaseResultId = new Map<string, Array<{ grader: string; score: number }>>();
  for (const g of gradeRows) {
    const entry = { grader: g.grader, score: Number(g.score) };
    const list = gradesByCaseResultId.get(g.caseResultId);
    if (list) {
      list.push(entry);
    } else {
      gradesByCaseResultId.set(g.caseResultId, [entry]);
    }
  }

  const gradedSamples: GradedSample[] = [];
  const seenExternalIds = new Set<string>();

  for (const row of resultRows) {
    caseDbIdByExternalId.set(row.externalId, row.caseDbId);
    criticalByExternalId.set(row.externalId, row.critical);
    seenExternalIds.add(row.externalId);

    if (row.error !== null) {
      continue;
    }

    const caseGrades = gradesByCaseResultId.get(row.caseResultId) ?? [];
    if (caseGrades.length === 0) {
      // No grades recorded for this sample (e.g. every configured grader
      // was judge:* and skipped per Phase 3) -- nothing to score it on.
      continue;
    }

    const score = weightedScore(caseGrades, graderWeights);
    gradedSamples.push({ externalId: row.externalId, sampleIndex: row.sampleIndex, score, passed: score >= 0.5 });
  }

  const averaged = averagePerCaseScores(gradedSamples);
  const averagedByExternalId = new Map(averaged.map((a) => [a.externalId, a]));

  for (const externalId of seenExternalIds) {
    const avg = averagedByExternalId.get(externalId);
    outcomes.set(externalId, {
      externalId,
      critical: criticalByExternalId.get(externalId) ?? false,
      score: avg ? avg.score : null,
      passed: avg ? avg.passed : null,
    });
  }

  return { outcomes, caseDbIdByExternalId };
}

export interface CompareRunsParams {
  baselineRunId: string;
  candidateRunId: string;
  suiteConfig: SuiteConfig;
  bootstrapIterations: number;
  power?: number;
}

export interface CompareRunsResult {
  comparisonId: string;
  stats: ComparisonStats;
  excluded: Exclusion[];
}

export async function compareRuns(params: CompareRunsParams): Promise<CompareRunsResult> {
  const db = getDb();

  const baselineRows = await db.select().from(runs).where(eq(runs.id, params.baselineRunId)).limit(1);
  const candidateRows = await db.select().from(runs).where(eq(runs.id, params.candidateRunId)).limit(1);
  const baselineRun = baselineRows[0];
  const candidateRun = candidateRows[0];
  if (!baselineRun) {
    throw new Error(`No run found with id ${params.baselineRunId}`);
  }
  if (!candidateRun) {
    throw new Error(`No run found with id ${params.candidateRunId}`);
  }
  if (baselineRun.suiteId !== candidateRun.suiteId) {
    throw new Error(
      `Baseline run (suite ${baselineRun.suiteId}) and candidate run (suite ${candidateRun.suiteId}) belong to different suites -- cannot compare`,
    );
  }

  const graderWeights = new Map(params.suiteConfig.graders.map((g) => [g.name, g.weight ?? 1]));

  const [baselineData, candidateData] = await Promise.all([
    loadRunCaseData(params.baselineRunId, graderWeights),
    loadRunCaseData(params.candidateRunId, graderWeights),
  ]);

  const pairing = pairCases([...baselineData.outcomes.values()], [...candidateData.outcomes.values()]);

  const stats = computeComparison({
    paired: pairing.paired,
    alpha: params.suiteConfig.thresholds.significanceAlpha,
    mdeCeiling: params.suiteConfig.thresholds.mdeCeiling,
    minPairedN: params.suiteConfig.thresholds.minPairedN,
    bootstrapIterations: params.bootstrapIterations,
    ...(params.power !== undefined ? { power: params.power } : {}),
  });

  const caseDbId = (externalId: string): string => {
    const id = candidateData.caseDbIdByExternalId.get(externalId) ?? baselineData.caseDbIdByExternalId.get(externalId);
    if (!id) {
      throw new Error(`compareRuns: no case id found for externalId "${externalId}" -- this should be unreachable`);
    }
    return id;
  };

  const regressedCaseIds = stats.regressedExternalIds.map(caseDbId);
  const fixedCaseIds = stats.fixedExternalIds.map(caseDbId);

  const inserted = await db
    .insert(comparisons)
    .values({
      suiteId: baselineRun.suiteId,
      baselineRunId: params.baselineRunId,
      candidateRunId: params.candidateRunId,
      pairedCaseCount: stats.pairedCaseCount,
      delta: String(stats.delta),
      ciLower: String(stats.ciLower),
      ciUpper: String(stats.ciUpper),
      pValue: stats.pValue !== null ? String(stats.pValue) : null,
      test: stats.test,
      bootstrapIterations: params.bootstrapIterations,
      mde: String(stats.mde),
      verdict: stats.verdict,
      regressedCaseIds,
      fixedCaseIds,
      criticalRegressed: stats.criticalRegressed,
    })
    .returning({ id: comparisons.id });

  return { comparisonId: inserted[0]!.id, stats, excluded: pairing.excluded };
}
