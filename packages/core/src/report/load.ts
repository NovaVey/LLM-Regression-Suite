/**
 * DB orchestration for the report layer: assembles a `ComparisonReportData`
 * (types.ts) from a persisted `comparisons` row, for the pure renderers
 * (markdown.ts, json.ts, html.ts) to consume. Kept separate from those for
 * the same reason every other DB-coupled/pure split in this repo exists —
 * `compare.ts`/`pairing.ts`+`statistics.ts`, `runner/persist.ts`/`execute.ts`.
 *
 * Reuses `compare.ts`'s own `weightedScore()` for per-case scores, rather
 * than reimplementing it, so a case's score as shown in a report always
 * agrees with the score that actually drove the stored verdict — including
 * which judge graders were zeroed out for a failing calibration.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { getJudgeModel } from '../anthropic.js';
import { weightedScore } from '../comparison/compare.js';
import { getDb } from '../db/client.js';
import { caseResults, cases as casesTable, comparisons, grades, runs, suites, variants } from '../db/schema.js';
import type { SuiteConfig } from '../dataset/schema.js';
import { checkCalibrationGate } from '../judge/calibration.js';
import { buildJudgeSystemPrompt, rubricFromGraderConfig } from '../judge/prompt.js';
import { getCalibrationsForGrader } from '../judge/persist.js';
import { hashPromptTemplate } from '../runner/cache.js';
import { averagePerCaseScores, type GradedSample } from '../runner/execute.js';
import type {
  ComparisonReportData,
  FixedCaseRow,
  JudgeCalibrationStatus,
  MethodsInfo,
  RegressedCaseRow,
  Verdict,
} from './types.js';

async function countCaseResults(runId: string): Promise<number> {
  const db = getDb();
  const rows = await db.select({ id: caseResults.id }).from(caseResults).where(eq(caseResults.runId, runId));
  return rows.length;
}

interface CaseScoreAndOutput {
  score: number;
  /** The case's sample_index=0 output only -- a representative example for the diff, not every repeat sample. */
  output: string;
}

/**
 * For each of `caseIds` in `runId`, the weighted-averaged score (same
 * computation compare.ts used to decide regressed/fixed) plus a
 * representative output. Cases that produced no usable graded sample on
 * this side are simply absent from the returned map -- callers here only
 * ever look up regressed/fixed case ids, which by construction (pairing.ts)
 * always had a valid score on both sides when the comparison was computed.
 */
async function loadCaseScoresAndOutputs(
  runId: string,
  caseIds: string[],
  graderWeights: Map<string, number>,
): Promise<Map<string, CaseScoreAndOutput>> {
  const db = getDb();
  const result = new Map<string, CaseScoreAndOutput>();
  if (caseIds.length === 0) {
    return result;
  }

  const resultRows = await db
    .select({
      caseResultId: caseResults.id,
      caseId: caseResults.caseId,
      sampleIndex: caseResults.sampleIndex,
      output: caseResults.output,
      error: caseResults.error,
    })
    .from(caseResults)
    .where(and(eq(caseResults.runId, runId), inArray(caseResults.caseId, caseIds)));

  const validRows = resultRows.filter((r): r is typeof r & { output: string } => r.error === null && r.output !== null);
  if (validRows.length === 0) {
    return result;
  }

  const caseResultIds = validRows.map((r) => r.caseResultId);
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

  // averagePerCaseScores (runner/execute.ts) groups by a `externalId`
  // string field -- reused here purely as a grouping key holding the
  // case's DB uuid, not a human-readable external id. That's fine: the
  // function only ever uses it to group same-case samples together.
  const gradedSamples: GradedSample[] = [];
  const sample0OutputByCaseId = new Map<string, string>();

  for (const row of validRows) {
    if (row.sampleIndex === 0) {
      sample0OutputByCaseId.set(row.caseId, row.output);
    }
    const caseGrades = gradesByCaseResultId.get(row.caseResultId) ?? [];
    if (caseGrades.length === 0) {
      continue;
    }
    const score = weightedScore(caseGrades, graderWeights);
    if (score === null) {
      continue;
    }
    gradedSamples.push({ externalId: row.caseId, sampleIndex: row.sampleIndex, score, passed: score >= 0.5 });
  }

  const averaged = averagePerCaseScores(gradedSamples);
  for (const avg of averaged) {
    result.set(avg.externalId, { score: avg.score, output: sample0OutputByCaseId.get(avg.externalId) ?? '' });
  }

  return result;
}

export async function loadComparisonReportData(comparisonId: string): Promise<ComparisonReportData> {
  const db = getDb();

  const comparisonRows = await db.select().from(comparisons).where(eq(comparisons.id, comparisonId)).limit(1);
  const comparison = comparisonRows[0];
  if (!comparison) {
    throw new Error(`No comparison found with id ${comparisonId}`);
  }

  const suiteRows = await db.select().from(suites).where(eq(suites.id, comparison.suiteId)).limit(1);
  const suite = suiteRows[0];
  if (!suite) {
    throw new Error(`report/load.ts: no suite found with id ${comparison.suiteId} -- this should be unreachable`);
  }
  const suiteConfig = suite.config as unknown as SuiteConfig;

  const runRows = await db
    .select({
      runId: runs.id,
      cacheHits: runs.cacheHits,
      label: variants.label,
      model: variants.model,
      promptHash: variants.promptHash,
    })
    .from(runs)
    .innerJoin(variants, eq(runs.variantId, variants.id))
    .where(inArray(runs.id, [comparison.baselineRunId, comparison.candidateRunId]));

  const baselineRunRow = runRows.find((r) => r.runId === comparison.baselineRunId);
  const candidateRunRow = runRows.find((r) => r.runId === comparison.candidateRunId);
  if (!baselineRunRow || !candidateRunRow) {
    throw new Error(`report/load.ts: could not load both runs for comparison ${comparisonId} -- this should be unreachable`);
  }

  const [baselineCaseResultCount, candidateCaseResultCount] = await Promise.all([
    countCaseResults(comparison.baselineRunId),
    countCaseResults(comparison.candidateRunId),
  ]);

  const judgeGraders = suiteConfig.graders.filter((g) => g.name.startsWith('judge:'));
  const judgeCalibrations: JudgeCalibrationStatus[] = [];
  const advisoryGraders = new Set<string>();

  if (judgeGraders.length > 0) {
    const judgeModel = getJudgeModel();
    for (const g of judgeGraders) {
      const rubric = rubricFromGraderConfig(g);
      const judgePromptHash = hashPromptTemplate(buildJudgeSystemPrompt(rubric));
      const calibrations = await getCalibrationsForGrader(comparison.suiteId, g.name);
      const gate = checkCalibrationGate(calibrations, judgeModel, judgePromptHash);

      if (gate.status === 'missing') {
        // The calibration state has drifted since this comparison was
        // computed (e.g. the record was superseded or removed) -- report
        // it as failing rather than throwing: this comparison DID
        // successfully compute at the time, and a report should describe
        // that, not refuse to render because live state has since moved.
        // 'failing' with a zeroed kappa is the closest honest fallback the
        // contract's passing|failing status shape allows.
        judgeCalibrations.push({ grader: g.name, status: 'failing', cohensKappa: 0, labelCount: 0 });
        advisoryGraders.add(g.name);
        continue;
      }
      judgeCalibrations.push({
        grader: g.name,
        status: gate.status,
        cohensKappa: gate.calibration.cohensKappa,
        labelCount: gate.calibration.labelCount,
      });
      if (gate.status === 'failing') {
        advisoryGraders.add(g.name);
      }
    }
  }

  const graderWeights = new Map(
    suiteConfig.graders.map((g) => [g.name, advisoryGraders.has(g.name) ? 0 : (g.weight ?? 1)]),
  );

  const caseIds = [...comparison.regressedCaseIds, ...comparison.fixedCaseIds];
  const caseRowsMeta =
    caseIds.length > 0
      ? await db
          .select({ id: casesTable.id, externalId: casesTable.externalId, critical: casesTable.critical })
          .from(casesTable)
          .where(inArray(casesTable.id, caseIds))
      : [];
  const metaByCaseId = new Map(caseRowsMeta.map((c) => [c.id, c]));

  const [baselineScores, candidateScores] = await Promise.all([
    loadCaseScoresAndOutputs(comparison.baselineRunId, caseIds, graderWeights),
    loadCaseScoresAndOutputs(comparison.candidateRunId, caseIds, graderWeights),
  ]);

  const regressedCases: RegressedCaseRow[] = comparison.regressedCaseIds.map((caseId) => {
    const meta = metaByCaseId.get(caseId);
    const b = baselineScores.get(caseId);
    const c = candidateScores.get(caseId);
    if (!meta || !b || !c) {
      throw new Error(`report/load.ts: missing data for regressed case ${caseId} -- this should be unreachable`);
    }
    return {
      externalId: meta.externalId,
      critical: meta.critical,
      baselineScore: b.score,
      candidateScore: c.score,
      baselineOutput: b.output,
      candidateOutput: c.output,
    };
  });

  const fixedCases: FixedCaseRow[] = comparison.fixedCaseIds.map((caseId) => {
    const meta = metaByCaseId.get(caseId);
    const b = baselineScores.get(caseId);
    const c = candidateScores.get(caseId);
    if (!meta || !b || !c) {
      throw new Error(`report/load.ts: missing data for fixed case ${caseId} -- this should be unreachable`);
    }
    return { externalId: meta.externalId, baselineScore: b.score, candidateScore: c.score };
  });

  const methods: MethodsInfo = {
    test: comparison.test as MethodsInfo['test'],
    bootstrapIterations: comparison.bootstrapIterations,
    baselineLabel: baselineRunRow.label,
    candidateLabel: candidateRunRow.label,
    baselineModel: baselineRunRow.model,
    candidateModel: candidateRunRow.model,
    baselinePromptHash: baselineRunRow.promptHash,
    candidatePromptHash: candidateRunRow.promptHash,
    baselineCacheHitRate: baselineCaseResultCount > 0 ? baselineRunRow.cacheHits / baselineCaseResultCount : 0,
    candidateCacheHitRate: candidateCaseResultCount > 0 ? candidateRunRow.cacheHits / candidateCaseResultCount : 0,
  };

  return {
    comparisonId: comparison.id,
    suiteName: suite.name,
    verdict: comparison.verdict as Verdict,
    delta: Number(comparison.delta),
    ciLower: Number(comparison.ciLower),
    ciUpper: Number(comparison.ciUpper),
    mde: Number(comparison.mde),
    mdeCeiling: suiteConfig.thresholds.mdeCeiling,
    pairedCaseCount: comparison.pairedCaseCount,
    minPairedN: suiteConfig.thresholds.minPairedN,
    excludedCount: comparison.excludedCaseCount,
    criticalRegressed: comparison.criticalRegressed,
    regressedCases,
    fixedCases,
    judgeCalibrations,
    methods,
    computedAt: comparison.computedAt.toISOString(),
  };
}
