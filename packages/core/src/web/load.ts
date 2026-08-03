/**
 * DB orchestration for the Report UI (Phase 9, types.ts's contract) --
 * assembles each of §8's six screens' data from persisted rows, the same
 * DB-coupled/pure split as every other phase (report/load.ts, compare.ts,
 * runner/persist.ts). packages/api's routes call these directly; the React
 * screens never touch the database.
 *
 * The Comparison screen (§8 screen 2) is deliberately NOT re-implemented
 * here -- it reuses report/load.ts's `loadComparisonReportData` verbatim,
 * since that function already assembles exactly what the signature screen
 * needs (verdict, interval, MDE, paired n, methods) and a report comment
 * for a comparison and its Comparison-screen view of the same comparison
 * must never be able to disagree.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { getJudgeModel } from '../anthropic.js';
import { loadRunCaseData } from '../comparison/compare.js';
import { pairCases } from '../comparison/pairing.js';
import type { SuiteConfig } from '../dataset/schema.js';
import { getDb } from '../db/client.js';
import { caseResults, cases as casesTable, comparisons, grades, runs, suites, variants } from '../db/schema.js';
import { checkCalibrationGate } from '../judge/calibration.js';
import { getCalibrationHistoryForSuite, getCalibrationsForGrader } from '../judge/persist.js';
import { buildJudgeSystemPrompt, rubricFromGraderConfig } from '../judge/prompt.js';
import { hashPromptTemplate } from '../runner/cache.js';
import type {
  CalibrationOverview,
  CaseComparisonStatus,
  CaseDiffData,
  CaseGradeDetail,
  ComparisonCaseListItem,
  ComparisonListItem,
  DatasetOverview,
  GraderCalibrationOverview,
  SuiteCalibrationSummary,
  SuiteListItem,
  TagCoverage,
} from './types.js';

function msPerDay(): number {
  return 1000 * 60 * 60 * 24;
}

// --- Screen 1: Suites ---

export async function getSuiteList(): Promise<SuiteListItem[]> {
  const db = getDb();
  const suiteRows = await db.select().from(suites).orderBy(suites.name);

  const result: SuiteListItem[] = [];
  for (const suite of suiteRows) {
    const suiteConfig = suite.config as unknown as SuiteConfig;

    const caseRows = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.suiteId, suite.id));

    const lastRunRows = await db
      .select({
        id: runs.id,
        trigger: runs.trigger,
        status: runs.status,
        finishedAt: runs.finishedAt,
        startedAt: runs.startedAt,
      })
      .from(runs)
      .where(eq(runs.suiteId, suite.id))
      .orderBy(desc(runs.startedAt))
      .limit(1);
    const lastRun = lastRunRows[0];

    const judgeGraders = suiteConfig.graders.filter((g) => g.name.startsWith('judge:'));
    const calibrations: SuiteCalibrationSummary[] = [];
    if (judgeGraders.length > 0) {
      const judgeModel = getJudgeModel();
      for (const g of judgeGraders) {
        const rubric = rubricFromGraderConfig(g);
        const judgePromptHash = hashPromptTemplate(buildJudgeSystemPrompt(rubric));
        const history = await getCalibrationsForGrader(suite.id, g.name);
        const gate = checkCalibrationGate(history, judgeModel, judgePromptHash);

        if (gate.status === 'missing') {
          calibrations.push({ grader: g.name, status: 'missing', cohensKappa: null, calibratedAt: null, ageDays: null });
          continue;
        }
        // checkCalibrationGate's CalibrationRecord doesn't carry calibratedAt
        // (see judge/calibration.ts) -- fetch the full history row for the
        // matching one to report an age.
        const fullHistory = await getCalibrationHistoryForSuite(suite.id);
        const matchingFull = fullHistory
          .filter((h) => h.grader === g.name && h.judgeModel === judgeModel && h.judgePromptHash === judgePromptHash)
          .sort((a, b) => b.calibratedAt.localeCompare(a.calibratedAt))[0];
        const ageDays = matchingFull ? (Date.now() - new Date(matchingFull.calibratedAt).getTime()) / msPerDay() : null;

        calibrations.push({
          grader: g.name,
          status: gate.status,
          cohensKappa: gate.calibration.cohensKappa,
          calibratedAt: matchingFull?.calibratedAt ?? null,
          ageDays,
        });
      }
    }

    result.push({
      id: suite.id,
      name: suite.name,
      description: suite.description,
      caseCount: caseRows.length,
      lastRun: lastRun
        ? { id: lastRun.id, trigger: lastRun.trigger as 'cli' | 'ci' | 'api', status: lastRun.status, finishedAt: lastRun.finishedAt?.toISOString() ?? null }
        : null,
      calibrations,
    });
  }

  return result;
}

// --- Screen 2 (list only -- the detail view reuses report/load.ts) ---

export async function getComparisonsForSuite(suiteId: string): Promise<ComparisonListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: comparisons.id,
      verdict: comparisons.verdict,
      delta: comparisons.delta,
      ciLower: comparisons.ciLower,
      ciUpper: comparisons.ciUpper,
      pairedCaseCount: comparisons.pairedCaseCount,
      computedAt: comparisons.computedAt,
      baselineLabel: variants.label,
    })
    .from(comparisons)
    .innerJoin(runs, eq(comparisons.baselineRunId, runs.id))
    .innerJoin(variants, eq(runs.variantId, variants.id))
    .where(eq(comparisons.suiteId, suiteId))
    .orderBy(desc(comparisons.computedAt));

  // candidateLabel needs a second join the query above can't also express
  // against the same `variants` table in one pass -- fetch separately by id.
  const candidateVariantLabels = await db
    .select({ runId: runs.id, label: variants.label })
    .from(runs)
    .innerJoin(variants, eq(runs.variantId, variants.id))
    .where(
      inArray(
        runs.id,
        (await db.select({ id: comparisons.candidateRunId }).from(comparisons).where(eq(comparisons.suiteId, suiteId))).map(
          (r) => r.id,
        ),
      ),
    );
  const candidateRunRows = await db
    .select({ comparisonId: comparisons.id, candidateRunId: comparisons.candidateRunId })
    .from(comparisons)
    .where(eq(comparisons.suiteId, suiteId));
  const candidateLabelByComparisonId = new Map<string, string>();
  const labelByRunId = new Map(candidateVariantLabels.map((r) => [r.runId, r.label]));
  for (const r of candidateRunRows) {
    const label = labelByRunId.get(r.candidateRunId);
    if (label) {
      candidateLabelByComparisonId.set(r.comparisonId, label);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    verdict: r.verdict as ComparisonListItem['verdict'],
    delta: Number(r.delta),
    ciLower: Number(r.ciLower),
    ciUpper: Number(r.ciUpper),
    pairedCaseCount: r.pairedCaseCount,
    baselineLabel: r.baselineLabel,
    candidateLabel: candidateLabelByComparisonId.get(r.id) ?? '(unknown)',
    computedAt: r.computedAt.toISOString(),
  }));
}

// --- Screen 3: Case diff ---

async function resolveGraderWeights(suiteId: string, suiteConfig: SuiteConfig): Promise<Map<string, number>> {
  const judgeGraders = suiteConfig.graders.filter((g) => g.name.startsWith('judge:'));
  const advisory = new Set<string>();
  if (judgeGraders.length > 0) {
    const judgeModel = getJudgeModel();
    for (const g of judgeGraders) {
      const rubric = rubricFromGraderConfig(g);
      const judgePromptHash = hashPromptTemplate(buildJudgeSystemPrompt(rubric));
      const history = await getCalibrationsForGrader(suiteId, g.name);
      const gate = checkCalibrationGate(history, judgeModel, judgePromptHash);
      if (gate.status !== 'passing') {
        advisory.add(g.name);
      }
    }
  }
  return new Map(suiteConfig.graders.map((g) => [g.name, advisory.has(g.name) ? 0 : (g.weight ?? 1)]));
}

function statusFor(caseDbId: string, comparison: { regressedCaseIds: string[]; fixedCaseIds: string[] }): CaseComparisonStatus {
  if (comparison.regressedCaseIds.includes(caseDbId)) return 'regressed';
  if (comparison.fixedCaseIds.includes(caseDbId)) return 'fixed';
  return 'unchanged';
}

export async function getComparisonCaseList(comparisonId: string): Promise<ComparisonCaseListItem[]> {
  const db = getDb();
  const comparisonRows = await db.select().from(comparisons).where(eq(comparisons.id, comparisonId)).limit(1);
  const comparison = comparisonRows[0];
  if (!comparison) {
    throw new Error(`No comparison found with id ${comparisonId}`);
  }
  const suiteRows = await db.select().from(suites).where(eq(suites.id, comparison.suiteId)).limit(1);
  const suite = suiteRows[0];
  if (!suite) {
    throw new Error(`web/load.ts: no suite found with id ${comparison.suiteId} -- this should be unreachable`);
  }
  const suiteConfig = suite.config as unknown as SuiteConfig;
  const graderWeights = await resolveGraderWeights(suite.id, suiteConfig);

  const [baselineData, candidateData] = await Promise.all([
    loadRunCaseData(comparison.baselineRunId, graderWeights),
    loadRunCaseData(comparison.candidateRunId, graderWeights),
  ]);

  const pairing = pairCases([...baselineData.outcomes.values()], [...candidateData.outcomes.values()]);

  const tagsAndCriticalReason = await db
    .select({ id: casesTable.id, externalId: casesTable.externalId, tags: casesTable.tags })
    .from(casesTable)
    .where(eq(casesTable.suiteId, suite.id));
  const tagsByExternalId = new Map(tagsAndCriticalReason.map((c) => [c.externalId, c.tags]));

  const caseDbId = (externalId: string): string | undefined =>
    candidateData.caseDbIdByExternalId.get(externalId) ?? baselineData.caseDbIdByExternalId.get(externalId);

  const result: ComparisonCaseListItem[] = [];

  for (const paired of pairing.paired) {
    const dbId = caseDbId(paired.externalId);
    result.push({
      externalId: paired.externalId,
      critical: paired.critical,
      tags: tagsByExternalId.get(paired.externalId) ?? [],
      status: dbId ? statusFor(dbId, comparison) : 'unchanged',
      baselineScore: paired.baselineScore,
      candidateScore: paired.candidateScore,
      exclusionReason: null,
    });
  }

  for (const excl of pairing.excluded) {
    const baseline = baselineData.outcomes.get(excl.externalId);
    const candidate = candidateData.outcomes.get(excl.externalId);
    result.push({
      externalId: excl.externalId,
      critical: baseline?.critical || candidate?.critical || false,
      tags: tagsByExternalId.get(excl.externalId) ?? [],
      status: 'excluded',
      baselineScore: baseline?.score ?? null,
      candidateScore: candidate?.score ?? null,
      exclusionReason: excl.reason,
    });
  }

  return result;
}

async function loadCaseGradeDetails(runId: string, caseDbId: string): Promise<{ output: string | null; error: string | null; gradeDetails: CaseGradeDetail[] }> {
  const db = getDb();
  // sample_index 0 only -- the Case diff screen shows a representative
  // sample, same convention report/load.ts uses for its regressed/fixed rows.
  const resultRows = await db
    .select({ id: caseResults.id, output: caseResults.output, error: caseResults.error })
    .from(caseResults)
    .where(and(eq(caseResults.runId, runId), eq(caseResults.caseId, caseDbId), eq(caseResults.sampleIndex, 0)))
    .limit(1);
  const row = resultRows[0];
  if (!row) {
    return { output: null, error: null, gradeDetails: [] };
  }
  if (row.error !== null || row.output === null) {
    return { output: row.output, error: row.error, gradeDetails: [] };
  }

  const gradeRows = await db.select().from(grades).where(eq(grades.caseResultId, row.id));
  const gradeDetails: CaseGradeDetail[] = gradeRows.map((g) => ({
    grader: g.grader,
    score: Number(g.score),
    passed: g.passed,
    rationale: g.rationale,
    judgeModel: g.judgeModel,
  }));

  return { output: row.output, error: row.error, gradeDetails };
}

export async function getCaseDiffDetail(comparisonId: string, externalId: string): Promise<CaseDiffData> {
  const db = getDb();
  const comparisonRows = await db.select().from(comparisons).where(eq(comparisons.id, comparisonId)).limit(1);
  const comparison = comparisonRows[0];
  if (!comparison) {
    throw new Error(`No comparison found with id ${comparisonId}`);
  }

  const caseRows = await db
    .select()
    .from(casesTable)
    .where(and(eq(casesTable.suiteId, comparison.suiteId), eq(casesTable.externalId, externalId)))
    .limit(1);
  const caseRow = caseRows[0];
  if (!caseRow) {
    throw new Error(`No case "${externalId}" found in suite ${comparison.suiteId}`);
  }

  const [baseline, candidate] = await Promise.all([
    loadCaseGradeDetails(comparison.baselineRunId, caseRow.id),
    loadCaseGradeDetails(comparison.candidateRunId, caseRow.id),
  ]);

  const input = caseRow.input as unknown as { messages: Array<{ role: 'user' | 'assistant'; content: string }> };

  return {
    externalId: caseRow.externalId,
    critical: caseRow.critical,
    criticalReason: caseRow.criticalReason,
    tags: caseRow.tags,
    inputMessages: input.messages,
    baselineOutput: baseline.output,
    baselineError: baseline.error,
    baselineGrades: baseline.gradeDetails,
    candidateOutput: candidate.output,
    candidateError: candidate.error,
    candidateGrades: candidate.gradeDetails,
  };
}

// --- Screen 4: Calibration ---

export async function getCalibrationOverview(suiteId: string): Promise<CalibrationOverview> {
  const db = getDb();
  const suiteRows = await db.select().from(suites).where(eq(suites.id, suiteId)).limit(1);
  const suite = suiteRows[0];
  if (!suite) {
    throw new Error(`No suite found with id ${suiteId}`);
  }
  const suiteConfig = suite.config as unknown as SuiteConfig;

  const allHistory = await getCalibrationHistoryForSuite(suiteId);
  const byGrader = new Map<string, typeof allHistory>();
  for (const h of allHistory) {
    const list = byGrader.get(h.grader);
    if (list) {
      list.push(h);
    } else {
      byGrader.set(h.grader, [h]);
    }
  }

  const graders: GraderCalibrationOverview[] = [...byGrader.entries()].map(([grader, history]) => ({
    grader,
    history: history.map((h) => ({
      id: h.id,
      judgeModel: h.judgeModel,
      judgePromptHash: h.judgePromptHash,
      labelCount: h.labelCount,
      cohensKappa: h.cohensKappa,
      agreementRate: h.agreementRate,
      passed: h.passed,
      biasNote: h.biasNote,
      confusionMatrix: h.confusionMatrix,
      calibratedAt: h.calibratedAt,
    })),
  }));

  return {
    suiteId: suite.id,
    suiteName: suite.name,
    judgeKappaFloor: suiteConfig.thresholds.judgeKappaFloor,
    graders,
  };
}

// --- Screen 5: Dataset ---

export async function getDatasetOverview(suiteId: string): Promise<DatasetOverview> {
  const db = getDb();
  const suiteRows = await db.select().from(suites).where(eq(suites.id, suiteId)).limit(1);
  const suite = suiteRows[0];
  if (!suite) {
    throw new Error(`No suite found with id ${suiteId}`);
  }
  const suiteConfig = suite.config as unknown as SuiteConfig;

  const caseRows = await db
    .select({
      externalId: casesTable.externalId,
      tags: casesTable.tags,
      critical: casesTable.critical,
      criticalReason: casesTable.criticalReason,
    })
    .from(casesTable)
    .where(eq(casesTable.suiteId, suiteId))
    .orderBy(casesTable.externalId);

  const tagCounts = new Map<string, number>();
  for (const c of caseRows) {
    for (const tag of c.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const minPairedN = suiteConfig.thresholds.minPairedN;
  const tagCoverage: TagCoverage[] = [...tagCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, caseCount]) => ({ tag, caseCount, isGap: caseCount < minPairedN }));

  return {
    suiteId: suite.id,
    suiteName: suite.name,
    cases: caseRows.map((c) => ({ externalId: c.externalId, tags: c.tags, critical: c.critical, criticalReason: c.criticalReason })),
    criticalCount: caseRows.filter((c) => c.critical).length,
    minPairedN,
    tagCoverage,
  };
}
