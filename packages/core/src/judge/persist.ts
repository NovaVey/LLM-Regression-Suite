/**
 * DB-coupled judge/calibration operations: reading a run's outputs for
 * labeling, recording human labels, and reading/writing calibration
 * records. Kept separate from calibration.ts (pure) for the same reason
 * pairing.ts/statistics.ts are split from compare.ts — the logic is
 * independently testable without a database.
 *
 * `output_hash` is not a stored column anywhere upstream — it is computed
 * on demand as sha256(output text), both when a human label is recorded
 * and when reading a run's outputs back for calibration, so the two
 * naturally agree without needing a shared cache or migration.
 */

import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { caseResults, cases as casesTable, grades, humanLabels, judgeCalibrations } from '../db/schema.js';
import type { CalibrationRecord, HumanLabelRecord, JudgeGradeRecord } from './calibration.js';
import type { ConfusionMatrix } from './kappa.js';

export function hashOutput(output: string): string {
  return createHash('sha256').update(output).digest('hex');
}

export interface SampledOutput {
  caseId: string;
  suiteId: string;
  externalId: string;
  outputHash: string;
  output: string;
  tags: string[];
  /** The judge's own recorded score for this output, if this run already graded it with `judgeGrader`. */
  judgeScore: number | null;
}

/** Fetches a run's successfully-completed case outputs, joined with case metadata, for calibration sampling. */
export async function getRunOutputsForCalibration(runId: string, judgeGrader: string): Promise<SampledOutput[]> {
  const db = getDb();

  const rows = await db
    .select({
      caseId: caseResults.caseId,
      caseResultId: caseResults.id,
      suiteId: casesTable.suiteId,
      externalId: casesTable.externalId,
      output: caseResults.output,
      tags: casesTable.tags,
    })
    .from(caseResults)
    .innerJoin(casesTable, eq(caseResults.caseId, casesTable.id))
    .where(eq(caseResults.runId, runId));

  const validRows = rows.filter((r): r is typeof r & { output: string } => r.output !== null);
  if (validRows.length === 0) {
    return [];
  }

  const caseResultIds = validRows.map((r) => r.caseResultId);
  const gradeRows = await db
    .select({ caseResultId: grades.caseResultId, score: grades.score })
    .from(grades)
    .where(and(eq(grades.grader, judgeGrader), inArray(grades.caseResultId, caseResultIds)));
  const scoreByCaseResultId = new Map(gradeRows.map((g) => [g.caseResultId, Number(g.score)]));

  return validRows.map((r) => ({
    caseId: r.caseId,
    suiteId: r.suiteId,
    externalId: r.externalId,
    outputHash: hashOutput(r.output),
    output: r.output,
    tags: r.tags,
    judgeScore: scoreByCaseResultId.get(r.caseResultId) ?? null,
  }));
}

/** The judge grades for a run, in the shape calibration.ts's matchLabelsToJudgeGrades expects. */
export async function getJudgeGradesForCalibration(runId: string, judgeGrader: string): Promise<JudgeGradeRecord[]> {
  const outputs = await getRunOutputsForCalibration(runId, judgeGrader);
  return outputs
    .filter((o): o is SampledOutput & { judgeScore: number } => o.judgeScore !== null)
    .map((o) => ({ caseId: o.caseId, outputHash: o.outputHash, score: o.judgeScore }));
}

export async function recordHumanLabel(params: {
  caseId: string;
  outputHash: string;
  grader: string;
  score: number;
  labeledBy: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(humanLabels)
    .values({
      caseId: params.caseId,
      outputHash: params.outputHash,
      grader: params.grader,
      score: String(params.score),
      labeledBy: params.labeledBy,
    })
    .onConflictDoNothing();
}

export async function getHumanLabelsForGrader(suiteId: string, grader: string): Promise<HumanLabelRecord[]> {
  const db = getDb();
  const rows = await db
    .select({ caseId: humanLabels.caseId, outputHash: humanLabels.outputHash, score: humanLabels.score })
    .from(humanLabels)
    .innerJoin(casesTable, eq(humanLabels.caseId, casesTable.id))
    .where(and(eq(casesTable.suiteId, suiteId), eq(humanLabels.grader, grader)));
  return rows.map((r) => ({ caseId: r.caseId, outputHash: r.outputHash, score: Number(r.score) }));
}

export async function saveCalibration(params: {
  suiteId: string;
  grader: string;
  judgeModel: string;
  judgePromptHash: string;
  labelCount: number;
  cohensKappa: number;
  agreementRate: number;
  biasNote: string;
  passed: boolean;
  confusionMatrix: ConfusionMatrix;
}): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(judgeCalibrations)
    .values({
      suiteId: params.suiteId,
      grader: params.grader,
      judgeModel: params.judgeModel,
      judgePromptHash: params.judgePromptHash,
      labelCount: params.labelCount,
      cohensKappa: String(params.cohensKappa),
      agreementRate: String(params.agreementRate),
      biasNote: params.biasNote,
      passed: params.passed,
      bothPass: params.confusionMatrix.bothPass,
      humanPassJudgeFail: params.confusionMatrix.humanPassJudgeFail,
      humanFailJudgePass: params.confusionMatrix.humanFailJudgePass,
      bothFail: params.confusionMatrix.bothFail,
    })
    .returning({ id: judgeCalibrations.id });
  return inserted[0]!.id;
}

/** Most recent calibration first, so checkCalibrationGate's array-order `.find()` naturally prefers it. */
export async function getCalibrationsForGrader(suiteId: string, grader: string): Promise<CalibrationRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(judgeCalibrations)
    .where(and(eq(judgeCalibrations.suiteId, suiteId), eq(judgeCalibrations.grader, grader)))
    .orderBy(desc(judgeCalibrations.calibratedAt));
  return rows.map((r) => ({
    judgeModel: r.judgeModel,
    judgePromptHash: r.judgePromptHash,
    cohensKappa: Number(r.cohensKappa),
    labelCount: r.labelCount,
    passed: r.passed,
  }));
}

export interface CalibrationHistoryRecord {
  id: string;
  grader: string;
  judgeModel: string;
  judgePromptHash: string;
  labelCount: number;
  cohensKappa: number;
  agreementRate: number;
  biasNote: string | null;
  passed: boolean;
  confusionMatrix: ConfusionMatrix;
  calibratedAt: string;
}

/** Full calibration history for a suite (every grader, oldest first -- a time series), for the Calibration screen (§8). */
export async function getCalibrationHistoryForSuite(suiteId: string): Promise<CalibrationHistoryRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(judgeCalibrations)
    .where(eq(judgeCalibrations.suiteId, suiteId))
    .orderBy(judgeCalibrations.calibratedAt);
  return rows.map((r) => ({
    id: r.id,
    grader: r.grader,
    judgeModel: r.judgeModel,
    judgePromptHash: r.judgePromptHash,
    labelCount: r.labelCount,
    cohensKappa: Number(r.cohensKappa),
    agreementRate: Number(r.agreementRate),
    biasNote: r.biasNote,
    passed: r.passed,
    confusionMatrix: {
      bothPass: r.bothPass,
      humanPassJudgeFail: r.humanPassJudgeFail,
      humanFailJudgePass: r.humanFailJudgePass,
      bothFail: r.bothFail,
    },
    calibratedAt: r.calibratedAt.toISOString(),
  }));
}
