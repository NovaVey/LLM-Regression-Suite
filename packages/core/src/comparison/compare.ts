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
import { getJudgeModel } from '../anthropic.js';
import { getDb } from '../db/client.js';
import { caseResults, cases as casesTable, comparisons, grades, runs } from '../db/schema.js';
import type { GraderConfig, SuiteConfig } from '../dataset/schema.js';
import { checkCalibrationGate } from '../judge/calibration.js';
import { hashPromptTemplate } from '../runner/cache.js';
import { buildJudgeSystemPrompt, rubricFromGraderConfig } from '../judge/prompt.js';
import { getCalibrationsForGrader } from '../judge/persist.js';
import { averagePerCaseScores, type GradedSample } from '../runner/execute.js';
import { pairCases, type CaseOutcome, type Exclusion } from './pairing.js';
import { computeComparison, type ComparisonStats } from './statistics.js';

/**
 * Thrown when a `judge:*` grader has no passing calibration at all. Kept as
 * a distinguishable subclass (not a plain `Error`) specifically so callers
 * can tell this apart from a genuine infrastructure failure — §7's exit
 * code table treats "uncalibrated judge" as warn-level (exit 2, the same
 * bucket as `insufficient_data`, "configurable to block"), not
 * infrastructure failure (exit 3). A plain `catch (err) { exitCode = 3 }`
 * in the CLI would conflate "the DB is unreachable" with "you haven't
 * calibrated your judge yet" — two very different situations for a team to
 * be told about the same way. See docs/DECISIONS.md.
 */
export class UncalibratedJudgeError extends Error {}

/**
 * Returns the weighted average of `graderScores`, or `null` if there is
 * nothing usable to average (either no grades at all, or every grade that
 * exists belongs to a grader weighted to 0 — see `resolveJudgeGraderWeights`).
 * `null` here means the same thing it means throughout pairing.ts: no valid
 * result for this sample, not a real score of 0.
 */
export function weightedScore(
  graderScores: Array<{ grader: string; score: number }>,
  graderWeights: Map<string, number>,
): number | null {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const g of graderScores) {
    const weight = graderWeights.get(g.grader) ?? 1;
    weightedSum += g.score * weight;
    totalWeight += weight;
  }
  return totalWeight === 0 ? null : weightedSum / totalWeight;
}

/**
 * Checks the §5.5 calibration gate for every `judge:*` grader in the suite
 * config, against the CURRENT judge model and the prompt hash computed from
 * the CURRENT suite config's rubric.
 *
 * A known limitation, not silently glossed over: `grades` does not record
 * which judge_prompt_hash produced a given historical grade (§4's schema
 * has no such column, and this file follows that schema rather than
 * unilaterally extending it — see docs/DECISIONS.md). This function can
 * only verify "does a passing calibration exist for the rubric in the
 * suite config I was handed right now" — it cannot detect a run whose
 * grades were computed under a since-edited rubric. In the normal workflow
 * (compare two runs freshly generated from the current suite config, which
 * is what `llmreg run` + `llmreg compare` naturally produce back to back)
 * this gap doesn't manifest; it's a real gap for someone deliberately
 * comparing two old runs after editing the rubric in between.
 *
 * Throws (rejecting the whole comparison, per §5.5: "rejected, not warned
 * about") for any judge grader with no matching calibration at all.
 * Returns the set of grader names whose calibration matched but failed
 * (kappa below floor) — these must not drive the verdict, per §5.5:
 * "reports its scores as advisory only, never as a blocking verdict."
 */
async function checkJudgeCalibrationGates(
  suiteId: string,
  judgeGraders: GraderConfig[],
  judgeModel: string,
): Promise<Set<string>> {
  const advisoryGraders = new Set<string>();

  for (const g of judgeGraders) {
    const rubric = rubricFromGraderConfig(g);
    const judgePromptHash = hashPromptTemplate(buildJudgeSystemPrompt(rubric));

    const calibrations = await getCalibrationsForGrader(suiteId, g.name);
    const gate = checkCalibrationGate(calibrations, judgeModel, judgePromptHash);

    if (gate.status === 'missing') {
      throw new UncalibratedJudgeError(
        `Judge \`${rubric.name}\` has no passing calibration. Run \`llmreg calibrate --grader ${g.name}\`.`,
      );
    }
    if (gate.status === 'failing') {
      advisoryGraders.add(g.name);
    }
  }

  return advisoryGraders;
}

/** graderWeights with every advisory (failing-calibration) judge grader's weight forced to 0. */
function resolveJudgeGraderWeights(suiteConfig: SuiteConfig, advisoryGraders: Set<string>): Map<string, number> {
  return new Map(
    suiteConfig.graders.map((g) => [g.name, advisoryGraders.has(g.name) ? 0 : (g.weight ?? 1)]),
  );
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
    if (score === null) {
      // Every grade recorded for this sample belongs to a grader weighted
      // to 0 (an advisory judge grader) -- nothing usable to score it on,
      // same treatment as the caseGrades.length === 0 branch above.
      continue;
    }
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
  /** Judge model to check calibration gates against; defaults to getJudgeModel(). */
  judgeModel?: string;
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

  const judgeGraders = params.suiteConfig.graders.filter((g) => g.name.startsWith('judge:'));
  const judgeModel = params.judgeModel ?? getJudgeModel();
  const advisoryGraders = await checkJudgeCalibrationGates(baselineRun.suiteId, judgeGraders, judgeModel);
  const graderWeights = resolveJudgeGraderWeights(params.suiteConfig, advisoryGraders);

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
      excludedCaseCount: pairing.excluded.length,
    })
    .returning({ id: comparisons.id });

  return { comparisonId: inserted[0]!.id, stats, excluded: pairing.excluded };
}
