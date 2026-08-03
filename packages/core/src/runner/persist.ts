/**
 * Writes run results into the `suites`/`cases`/`variants`/`runs`/
 * `case_results`/`grades` tables (§4). Kept separate from `execute.ts` so
 * the actual execution/caching/error-isolation logic stays testable without
 * a database (see execute.ts's injectable `CacheStore`/`TargetCaller`) —
 * this file is the part that's inherently DB-coupled.
 *
 * Drizzle's `numeric` columns are typed as `string` (not `number`) to avoid
 * floating-point precision loss on arbitrary-precision Postgres `numeric` —
 * every numeric value here is written with `String(...)` and would need
 * `Number(...)` on the way back out.
 */

import { eq } from 'drizzle-orm';
import { getJudgeModel } from '../anthropic.js';
import { getDb } from '../db/client.js';
import { caseResults, cases as casesTable, grades, runs, suites, variants } from '../db/schema.js';
import type { Case, SuiteConfig } from '../dataset/schema.js';
import { getGrader } from '../graders/registry.js';
import type { GraderContext } from '../graders/types.js';
import { callJudge } from '../judge/call.js';
import { rubricFromGraderConfig } from '../judge/prompt.js';
import type { CaseExecutionResult } from './execute.js';

export async function ensureSuite(config: SuiteConfig): Promise<string> {
  const db = getDb();
  const existing = await db.select().from(suites).where(eq(suites.name, config.name)).limit(1);
  if (existing[0]) {
    return existing[0].id;
  }
  const inserted = await db
    .insert(suites)
    .values({
      name: config.name,
      description: config.description ?? null,
      config: config as unknown as Record<string, unknown>,
    })
    .returning({ id: suites.id });
  return inserted[0]!.id;
}

/** Upserts every case by (suite_id, external_id); returns externalId -> db-id. */
export async function ensureCases(suiteId: string, caseList: Case[]): Promise<Map<string, string>> {
  const db = getDb();
  if (caseList.length === 0) {
    return new Map();
  }

  await db
    .insert(casesTable)
    .values(
      caseList.map((c) => ({
        suiteId,
        externalId: c.externalId,
        input: c.input,
        expected: c.expected,
        tags: c.tags,
        critical: c.critical,
      })),
    )
    .onConflictDoNothing();

  const rows = await db
    .select({ id: casesTable.id, externalId: casesTable.externalId })
    .from(casesTable)
    .where(eq(casesTable.suiteId, suiteId));

  const idMap = new Map<string, string>();
  for (const row of rows) {
    idMap.set(row.externalId, row.id);
  }
  return idMap;
}

export interface VariantInput {
  label: string;
  model: string;
  temperature: number;
  promptHash: string;
  gitSha?: string;
  gitRef?: string;
  config?: Record<string, unknown>;
}

export async function createVariant(suiteId: string, variant: VariantInput): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(variants)
    .values({
      suiteId,
      label: variant.label,
      gitSha: variant.gitSha ?? null,
      gitRef: variant.gitRef ?? null,
      promptHash: variant.promptHash,
      model: variant.model,
      temperature: String(variant.temperature),
      config: variant.config ?? {},
    })
    .returning({ id: variants.id });
  return inserted[0]!.id;
}

export interface PersistRunResult {
  runId: string;
  cacheHitRate: number;
}

/**
 * Creates a `runs` row, one `case_results` row per execution result, and
 * grades each successful (non-errored) result with the suite's configured
 * graders — both deterministic and `judge:*`.
 *
 * `judge:*` grading is always PERFORMED (a case's judge score is always
 * computed and recorded, so calibration has something to compare against
 * and a run's stored grades stay complete) — it is the COMPARISON engine
 * (packages/core/src/comparison/compare.ts), not the runner, that enforces
 * the calibration gate on whether a judge score may drive a verdict, per
 * §5.5. Running the judge ungated here and gating its use downstream keeps
 * "was this graded" and "is this grade trusted enough to block on"
 * separate questions, matching how the `passed` column on
 * `judge_calibrations` already separates "computed" from "trusted."
 *
 * A judge call failing (API error, malformed response) is isolated to that
 * one (case, grader) pair — logged and skipped, not thrown — because the
 * case's own output already succeeded; only the grading attempt failed,
 * which is a materially smaller blast radius than a case erroring outright
 * (§5.1's error isolation) and doesn't warrant aborting the run.
 */
export async function persistRun(params: {
  suiteId: string;
  variantId: string;
  trigger: 'cli' | 'ci' | 'api';
  cases: Case[];
  caseIdByExternalId: Map<string, string>;
  executionResults: CaseExecutionResult[];
  cacheHits: number;
  graders: SuiteConfig['graders'];
  judgeModel?: string;
  judgeTemperature?: number;
}): Promise<PersistRunResult> {
  const db = getDb();
  const casesByExternalId = new Map(params.cases.map((c) => [c.externalId, c]));

  const totalInputTokens = params.executionResults.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0);
  const totalOutputTokens = params.executionResults.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0);

  const runInserted = await db
    .insert(runs)
    .values({
      suiteId: params.suiteId,
      variantId: params.variantId,
      trigger: params.trigger,
      status: 'running',
      caseCount: params.cases.length,
      cacheHits: params.cacheHits,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    })
    .returning({ id: runs.id });
  const runId = runInserted[0]!.id;

  const deterministicGraders = params.graders.filter((g) => !g.name.startsWith('judge:'));
  const judgeGraders = params.graders.filter((g) => g.name.startsWith('judge:'));

  for (const result of params.executionResults) {
    const caseId = params.caseIdByExternalId.get(result.externalId);
    if (!caseId) {
      throw new Error(`persistRun: no db id found for case "${result.externalId}" — was ensureCases run first?`);
    }

    const caseResultInserted = await db
      .insert(caseResults)
      .values({
        runId,
        caseId,
        sampleIndex: result.sampleIndex,
        output: result.output,
        latencyMs: result.latencyMs,
        error: result.error,
        fromCache: result.fromCache,
      })
      .returning({ id: caseResults.id });
    const caseResultId = caseResultInserted[0]!.id;

    // A case that errored is excluded from grading entirely — never scored
    // as a zero (§5.1).
    if (result.error !== null || result.output === null) {
      continue;
    }

    const caseData = casesByExternalId.get(result.externalId);
    if (!caseData) {
      continue;
    }

    for (const graderConfig of deterministicGraders) {
      const grader = getGrader(graderConfig.name);
      const ctx: GraderContext = {
        output: result.output,
        latencyMs: result.latencyMs,
        caseData,
        ...(graderConfig.config !== undefined ? { config: graderConfig.config } : {}),
      };
      const graded = grader(ctx);
      await db
        .insert(grades)
        .values({
          caseResultId,
          grader: graderConfig.name,
          score: String(graded.score),
          passed: graded.passed,
          rationale: graded.rationale ?? null,
        })
        .onConflictDoNothing();
    }

    for (const graderConfig of judgeGraders) {
      const rubric = rubricFromGraderConfig(graderConfig);

      try {
        const judgeModel = params.judgeModel ?? getJudgeModel();
        const judgeTemperature =
          params.judgeTemperature ?? (process.env.JUDGE_TEMPERATURE !== undefined ? Number(process.env.JUDGE_TEMPERATURE) : 0);

        const judgeResult = await callJudge(rubric, caseData.input.messages, result.output, judgeModel, judgeTemperature);

        await db
          .insert(grades)
          .values({
            caseResultId,
            grader: graderConfig.name,
            score: String(judgeResult.score),
            passed: judgeResult.score >= 0.5,
            rationale: judgeResult.rationale,
            judgeModel,
            judgeTokens: judgeResult.judgeTokens,
          })
          .onConflictDoNothing();
      } catch (err) {
        // Isolated to this (case, grader) pair -- the case's output already
        // succeeded, only this grading attempt failed. Skipped, not thrown;
        // see the module comment above for why this differs from a case-
        // level error.
        console.error(
          `Judge grading failed for case "${result.externalId}" grader "${graderConfig.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const finishedAt = new Date();
  await db
    .update(runs)
    .set({ status: 'complete', finishedAt })
    .where(eq(runs.id, runId));

  const cacheHitRate = params.executionResults.length > 0 ? params.cacheHits / params.executionResults.length : 0;
  return { runId, cacheHitRate };
}
